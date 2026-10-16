"""Smoke/integration tests for Caixa Fácil.

Requires the packages from requirements.txt. The tests use a temporary SQLite database and
never touch instance/caixa.db or Cloud SQL.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class CaixaFacilIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tempdir = tempfile.TemporaryDirectory(prefix="caixa-facil-tests-")
        db_path = Path(cls.tempdir.name) / "test.db"
        os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
        os.environ["SECRET_KEY"] = "test-secret-not-for-production"
        os.environ["ADMIN_PASSWORD"] = "test-admin-password"
        os.environ["ADMIN_EMAIL"] = "admin@test.invalid"
        sys.path.insert(0, str(ROOT))
        spec = importlib.util.spec_from_file_location("caixa_app_under_test", ROOT / "app.py")
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        cls.module = module
        cls.app = module.app
        cls.app.config.update(TESTING=True, LOGIN_RATE_LIMIT=0)

    @classmethod
    def tearDownClass(cls):
        cls.tempdir.cleanup()

    def setUp(self):
        self.client = self.app.test_client()
        self.login_admin()

    def csrf(self, client=None):
        client = client or self.client
        with client.session_transaction() as sess:
            token = sess.get("csrf_token")
        if token:
            return token
        client.get("/login")
        with client.session_transaction() as sess:
            return sess["csrf_token"]

    def post_json(self, path, payload, client=None):
        client = client or self.client
        return client.post(path, json=payload, headers={"X-CSRF-Token": self.csrf(client)})

    def put_json(self, path, payload, client=None):
        client = client or self.client
        return client.put(path, json=payload, headers={"X-CSRF-Token": self.csrf(client)})

    def patch_json(self, path, payload, client=None):
        client = client or self.client
        return client.patch(path, json=payload, headers={"X-CSRF-Token": self.csrf(client)})

    def delete(self, path, client=None):
        client = client or self.client
        return client.delete(path, headers={"X-CSRF-Token": self.csrf(client)})

    def login_admin(self):
        self.client.get("/login")
        response = self.post_json("/api/login", {"identificador": "admin", "senha": "test-admin-password"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_company_bank_hierarchy_and_report_source(self):
        company = {"company":"Razão Social Exemplo","nomeFantasia":"Fantasia","document":"12345678000190",
                   "inscricaoMunicipal":"123","endereco":"Rua Exemplo","numero":"10","municipio":"Belém",
                   "estado":"pa","inscricaoEstadual":"456"}
        response = self.put_json("/api/configuracoes/empresa", company)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["configuracao"]["estado"], "PA")
        invalid = self.put_json("/api/configuracoes/empresa", {**company, "estado":"XX"})
        self.assertEqual(invalid.status_code, 400)
        bank = self.post_json("/api/bancos", {"name":"Banco Nova Hierarquia","bank_category":"Indisponível","initial_balance":100})
        self.assertEqual(bank.status_code, 201)
        self.assertEqual(bank.json["banco"]["bank_category"], "Disponível")
        with self.app.app_context():
            admin_id = self.module.db.session.scalar(self.module.db.select(self.module.Usuario.id).where(self.module.Usuario.usuario == "admin"))
            legacy = self.module.Banco(id="legacy-hierarchy", usuario_id=admin_id, nome="Banco Legado")
            self.module.db.session.add(legacy)
            self.module.db.session.commit()
        report = self.post_json("/api/relatorios", {"type":"banco","format":"PDF","period":"2026-01","bank_id":bank.json["banco"]["id"]})
        self.assertEqual(report.status_code, 201)
        source = self.client.get(f'/api/relatorios/{report.json["relatorio"]["id"]}/dados')
        self.assertEqual(source.status_code, 200)
        self.assertEqual(source.json["company"]["nomeFantasia"], "Fantasia")
        self.assertTrue(any(b["id"] == "legacy-hierarchy" and b["bank_category"] == "Disponível" for b in source.json["banks"]))

    def test_category_with_optional_subcategory_is_atomic(self):
        invalid = self.post_json("/api/categorias", {"name":"Categoria inválida conjunta", "flow":"saida", "subcategory_name":"x"})
        self.assertEqual(invalid.status_code, 400)
        names = [item["name"] for item in self.client.get("/api/categorias").json["categorias"]]
        self.assertNotIn("Categoria inválida conjunta", names)
        response = self.post_json("/api/categorias", {"name":"Categoria conjunta", "flow":"saida", "subcategory_name":"Energia"})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        item = response.json["categoria"]
        subs = self.client.get("/api/subcategorias", query_string={"category_id":item["id"]}).json["subcategorias"]
        self.assertEqual(len(subs), 1)
        self.assertEqual(subs[0]["name"], "Energia")
        self.assertEqual(subs[0]["flow"], "saida")

    def test_security_headers_invalid_payloads_and_permissions(self):
        response = self.client.get('/')
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertIn("object-src 'none'", response.headers['Content-Security-Policy'])
        for payload in ([1], 'texto', {'origin_id': {'nested': True}}):
            self.assertEqual(self.post_json('/api/lancamentos', payload).status_code, 400)
        oversized = self.client.post('/api/login', data='x' * 70000, content_type='application/json')
        self.assertEqual(oversized.status_code, 413)
        self.assertTrue(oversized.is_json)
        csrf = self.client.post('/api/lancamentos', json={}, headers={'X-CSRF-Token':'inválido'})
        self.assertEqual(csrf.status_code, 403)
        company_before = self.client.get('/api/configuracoes/empresa').json['configuracao']
        new_user = self.post_json('/api/usuarios', {'nome':'Leitor Seguro','usuario':'leitor_seguro','email':'leitor@tests.invalid','senha':'senha-teste-segura','administrador':False})
        self.assertEqual(new_user.status_code, 201)
        other = self.app.test_client()
        other.get('/login')
        self.assertEqual(self.post_json('/api/login', {'identificador':'leitor_seguro','senha':'senha-teste-segura'}, other).status_code, 200)
        self.assertEqual(self.put_json('/api/configuracoes/empresa', {'company':'Empresa do leitor'}, other).status_code, 200)
        self.assertEqual(self.post_json('/api/categorias', {'name':'Categoria do leitor','flow':'entrada'}, other).status_code, 201)
        self.assertEqual(self.client.get('/api/configuracoes/empresa').json['configuracao'], company_before)
        self.assertFalse(any(item['name'] == 'Categoria do leitor' for item in self.client.get('/api/categorias').json['categorias']))

    def test_login_rate_limit_and_unsafe_links(self):
        self.app.extensions['login_attempts'].clear()
        self.app.config['LOGIN_RATE_LIMIT'] = 2
        try:
            client = self.app.test_client()
            client.get('/login')
            for _ in range(2):
                self.assertEqual(self.post_json('/api/login', {'identificador':'ausente','senha':'incorreta'}, client).status_code, 401)
            blocked = self.post_json('/api/login', {'identificador':'ausente','senha':'incorreta'}, client)
            self.assertEqual(blocked.status_code, 429)
            self.assertEqual(blocked.headers['Retry-After'], '60')
        finally:
            self.app.config['LOGIN_RATE_LIMIT'] = 0
        for link in ('//evil.invalid','/\\evil.invalid','javascript:alert(1)','https://[', 'https://user:pass@example.com'):
            response = self.post_json('/api/notificacoes', {'title':'Link inválido','message':'Teste seguro de links','link':link})
            self.assertEqual(response.status_code, 400, link)

    def test_financial_data_is_strictly_isolated_between_users(self):
        category = self.post_json('/api/categorias', {'name':'Categoria isolada','flow':'entrada'}).json['categoria']
        bank = self.post_json('/api/bancos', {'name':'Banco isolado','initial_balance':100}).json['banco']
        transaction = self.post_json('/api/lancamentos', {
            'description':'Dado exclusivo do admin','flow':'entrada','date':'2026-09-23','amount':25,
            'origin_type':'categoria','origin_id':category['id'],'destination_type':'banco','destination_id':bank['id'],
        }).json['lancamento']
        report = self.post_json('/api/relatorios', {'type':'fluxo','period':'2026-09','format':'CSV'}).json['relatorio']
        self.put_json('/api/configuracoes/empresa', {'company':'Empresa exclusiva do admin'})
        created = self.post_json('/api/usuarios', {
            'nome':'Usuário Isolado','usuario':'usuario_isolado','email':'isolado@tests.invalid',
            'senha':'senha-isolada-segura','administrador':False,
        })
        self.assertEqual(created.status_code, 201)

        other = self.app.test_client()
        other.get('/login')
        self.assertEqual(self.post_json('/api/login', {'identificador':'usuario_isolado','senha':'senha-isolada-segura'}, other).status_code, 200)
        self.assertEqual(other.get('/api/lancamentos').json['count'], 0)
        self.assertFalse(any(item['id'] == category['id'] for item in other.get('/api/categorias').json['categorias']))
        self.assertFalse(any(item['id'] == bank['id'] for item in other.get('/api/bancos').json['bancos']))
        self.assertEqual(other.get('/api/configuracoes/empresa').json['configuracao'], {})

        self.assertEqual(other.get(f"/api/lancamentos/{transaction['id']}").status_code, 404)
        self.assertEqual(self.delete(f"/api/lancamentos/{transaction['id']}", other).status_code, 404)
        self.assertEqual(self.put_json(f"/api/categorias/{category['id']}", {'name':'Tentativa'}, other).status_code, 404)
        self.assertEqual(self.put_json(f"/api/bancos/{bank['id']}", {'name':'Tentativa'}, other).status_code, 404)
        self.assertEqual(other.get(report['download_url']).status_code, 404)
        self.assertEqual(other.get(f"/api/relatorios/{report['id']}/dados").status_code, 404)
        forbidden_reference = self.post_json('/api/lancamentos', {
            'description':'Tentativa cruzada','flow':'entrada','date':'2026-09-23','amount':10,
            'origin_type':'categoria','origin_id':category['id'],'destination_type':'banco','destination_id':bank['id'],
        }, other)
        self.assertEqual(forbidden_reference.status_code, 400)

        own_category = self.post_json('/api/categorias', {'name':'Categoria isolada','flow':'entrada'}, other)
        own_bank = self.post_json('/api/bancos', {'name':'Banco isolado','initial_balance':0}, other)
        self.assertEqual(own_category.status_code, 201)
        self.assertEqual(own_bank.status_code, 201)
        self.put_json('/api/configuracoes/empresa', {'company':'Empresa exclusiva do usuário'}, other)
        self.assertEqual(self.client.get('/api/configuracoes/empresa').json['configuracao']['company'], 'Empresa exclusiva do admin')
        self.assertFalse(any(item['id'] == own_category.json['categoria']['id'] for item in self.client.get('/api/categorias').json['categorias']))

    def test_transfer_has_no_category_or_subcategory(self):
        category_response = self.post_json('/api/categorias', {'name':'Transferência segura','flow':'transferencia'})
        self.assertEqual(category_response.status_code, 400)
        category = self.post_json('/api/categorias', {'name':'Receitas para teste','flow':'entrada','subcategory_name':'Serviços'}).json['categoria']
        sub = self.client.get('/api/subcategorias', query_string={'category_id':category['id']}).json['subcategorias'][0]
        a = self.post_json('/api/bancos', {'name':'Banco Teste Origem','initial_balance':100}).json['banco']
        b = self.post_json('/api/bancos', {'name':'Banco Teste Destino','initial_balance':0}).json['banco']
        response = self.post_json('/api/lancamentos', {'description':'Transferência de teste','flow':'transferencia','date':'2026-09-09','amount':10,'origin_type':'banco','origin_id':a['id'],'destination_type':'banco','destination_id':b['id'],'category_id':category['id'],'subcategory_id':sub['id']})
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertIsNone(response.json['lancamento']['subcategory_id'])
        self.assertIsNone(response.json['lancamento']['category_id'])
        filtered = self.client.get('/api/lancamentos', query_string={'subcategory_id':sub['id']})
        self.assertEqual(filtered.json['count'], 0)

    def test_csv_does_not_execute_formulas(self):
        output = self.module.serializar_csv([['=1+1',' -cmd','@SUM(A1)','normal']])
        self.assertIn("'=1+1", output)
        self.assertIn("' -cmd", output)
        self.assertIn("'@SUM", output)

    def test_pdf_treats_company_markup_as_text(self):
        self.put_json('/api/configuracoes/empresa', {'company':'<img src="/arquivo-que-nao-existe.png" />'})
        report = self.post_json('/api/relatorios', {'type':'fluxo','period':'2026-09','format':'PDF'})
        self.assertEqual(report.status_code, 201)
        response = self.client.get(report.json['relatorio']['download_url'])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data.startswith(b'%PDF'))

    def test_bank_name_does_not_match_category_side(self):
        category = self.post_json('/api/categorias', {'name':'Nome compartilhado','flow':'entrada'}).json['categoria']
        bank = self.post_json('/api/bancos', {'name':'Nome compartilhado'}).json['banco']
        destination = self.post_json('/api/bancos', {'name':'Conta real de destino'}).json['banco']
        row = self.post_json('/api/lancamentos', {'description':'Receita com nomes iguais','flow':'entrada','date':'2026-09-09','amount':10,'origin_type':'categoria','origin_id':category['id'],'destination_type':'banco','destination_id':destination['id']}).json['lancamento']
        filtered = self.client.get('/api/lancamentos', query_string={'bank_id':bank['id']})
        self.assertEqual(filtered.json['count'], 0)
        self.assertEqual(self.put_json(f'/api/bancos/{bank["id"]}', {'name':'Banco renomeado'}).status_code, 200)
        self.assertEqual(self.client.get(f'/api/lancamentos/{row["id"]}').json['lancamento']['origem'], 'Nome compartilhado')

    def create_catalogs(self, suffix):
        cat_response = self.post_json("/api/categorias", {"name": f"Vendas {suffix}", "color": "#2563eb", "flow":"entrada"})
        self.assertEqual(cat_response.status_code, 201, cat_response.get_data(as_text=True))
        category = cat_response.get_json()["categoria"]

        expense_response = self.post_json("/api/categorias", {"name": f"Alimentação {suffix}", "color": "#f59e0b", "flow":"saida"})
        self.assertEqual(expense_response.status_code, 201, expense_response.get_data(as_text=True))
        expense = expense_response.get_json()["categoria"]

        bank_a_response = self.post_json("/api/bancos", {"name": f"Banco Itaú {suffix}", "color": "#2563eb", "initial_balance": 1000})
        self.assertEqual(bank_a_response.status_code, 201, bank_a_response.get_data(as_text=True))
        bank_a = bank_a_response.get_json()["banco"]

        bank_b_response = self.post_json("/api/bancos", {"name": f"Banco Bradesco {suffix}", "color": "#dc2626", "initial_balance": 500})
        self.assertEqual(bank_b_response.status_code, 201, bank_b_response.get_data(as_text=True))
        bank_b = bank_b_response.get_json()["banco"]

        def create_subcategory(category_id, name):
            response = self.post_json("/api/subcategorias", {"category_id": category_id, "name": name})
            self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
            return response.get_json()["subcategoria"]

        return {
            "income_category": category,
            "expense_category": expense,
            "bank_a": bank_a,
            "bank_b": bank_b,
            "income_subcategory": create_subcategory(category["id"], f"Venda de camisas {suffix}"),
            "expense_subcategory": create_subcategory(expense["id"], f"Frutas {suffix}"),
        }

    def test_full_financial_and_report_flow(self):
        c = self.create_catalogs("integração")
        missing_flow = self.post_json("/api/categorias", {"name":"Sem fluxo"})
        self.assertEqual(missing_flow.status_code, 400)
        invalid_flow = self.post_json("/api/lancamentos", {
            "date":"2026-08-01","flow":"entrada","amount":10,"description":"Fluxo incorreto",
            "origin_type":"categoria","origin_id":c["expense_category"]["id"],"subcategory_id":c["expense_subcategory"]["id"],
            "destination_type":"banco","destination_id":c["bank_a"]["id"]
        })
        self.assertEqual(invalid_flow.status_code, 400)
        self.assertIn("fluxo", invalid_flow.json["erro"])
        invalid_subcategory = self.post_json("/api/subcategorias", {"category_id":c["bank_a"]["id"],"name":"Não permitida"})
        self.assertEqual(invalid_subcategory.status_code, 400)

        entry = self.post_json("/api/lancamentos", {
            "date": "2026-08-03", "flow": "entrada", "amount": 2850, "description": "Venda de camisas",
            "origin_type": "categoria", "origin_id": c["income_category"]["id"], "subcategory_id": c["income_subcategory"]["id"],
            "destination_type": "banco", "destination_id": c["bank_a"]["id"],
        })
        self.assertEqual(entry.status_code, 201, entry.get_data(as_text=True))
        self.assertEqual(entry.get_json()["lancamento"]["subcategory_id"], c["income_subcategory"]["id"])

        exit_response = self.post_json("/api/lancamentos", {
            "date": "2026-08-05", "flow": "saida", "amount": 380, "description": "Compra de frutas",
            "origin_type": "banco", "origin_id": c["bank_b"]["id"],
            "destination_type": "categoria", "destination_id": c["expense_category"]["id"], "subcategory_id": c["expense_subcategory"]["id"],
        })
        self.assertEqual(exit_response.status_code, 201, exit_response.get_data(as_text=True))

        transfer = self.post_json("/api/lancamentos", {
            "date": "2026-08-10", "flow": "transferencia", "amount": 700, "description": "Transferência entre contas",
            "origin_type": "banco", "origin_id": c["bank_a"]["id"],
            "destination_type": "banco", "destination_id": c["bank_b"]["id"],
        })
        self.assertEqual(transfer.status_code, 201, transfer.get_data(as_text=True))
        self.assertIsNone(transfer.json["lancamento"]["category_id"])
        self.assertIsNone(transfer.json["lancamento"]["subcategory_id"])

        banks_after = self.client.get("/api/bancos").get_json()["bancos"]
        bank_a_after = next(item for item in banks_after if item["id"] == c["bank_a"]["id"])
        bank_b_after = next(item for item in banks_after if item["id"] == c["bank_b"]["id"])
        self.assertEqual(bank_a_after["initial_balance"], 1000.0)
        self.assertEqual(bank_b_after["initial_balance"], 500.0)
        self.assertAlmostEqual(bank_a_after["current_balance"], 3150.0, places=2)
        self.assertAlmostEqual(bank_b_after["current_balance"], 820.0, places=2)

        invalid_child = self.post_json("/api/lancamentos", {
            "date": "2026-08-12", "flow": "entrada", "amount": 100, "description": "Subcategoria incorreta",
            "origin_type": "categoria", "origin_id": c["income_category"]["id"], "subcategory_id": c["expense_subcategory"]["id"],
            "destination_type": "banco", "destination_id": c["bank_a"]["id"],
        })
        self.assertEqual(invalid_child.status_code, 400)
        self.assertIn("não pertence", invalid_child.get_json()["erro"])

        filtered = self.client.get(f"/api/lancamentos?period=2026-08&subcategory_id={c['income_subcategory']['id']}")
        self.assertEqual(filtered.status_code, 200)
        self.assertGreaterEqual(filtered.get_json()["count"], 1)
        self.assertTrue(all(
            row["subcategory_id"] == c["income_subcategory"]["id"]
            for row in filtered.get_json()["data"]
        ))

        analytics = self.client.get(f"/api/analytics?period=2026-08&subcategory_id={c['income_subcategory']['id']}")
        self.assertEqual(analytics.status_code, 200)
        self.assertIn("monthly", analytics.get_json())
        consolidated = self.client.get("/api/analytics?period=2026")
        self.assertEqual(consolidated.status_code, 200)
        self.assertGreaterEqual(consolidated.get_json()["summary"]["openingBalance"], 1500.0)
        bank_analytics = self.client.get(f"/api/analytics?period=2026&bank_id={c['bank_a']['id']}")
        self.assertEqual(bank_analytics.status_code, 200)
        self.assertAlmostEqual(bank_analytics.get_json()["summary"]["openingBalance"], 1000.0, places=2)
        self.assertAlmostEqual(bank_analytics.get_json()["summary"]["balance"], 3150.0, places=2)

        fluxo_csv = self.post_json("/api/relatorios", {"type": "fluxo", "period": "2026-08", "format": "CSV", "category_id": c["income_category"]["id"], "subcategory_id": c["income_subcategory"]["id"]})
        self.assertEqual(fluxo_csv.status_code, 201, fluxo_csv.get_data(as_text=True))
        csv_download = self.client.get(fluxo_csv.get_json()["relatorio"]["download_url"])
        self.assertEqual(csv_download.status_code, 200)
        self.assertTrue(csv_download.data.startswith(b"\xef\xbb\xbf"))
        self.assertIn("text/csv", csv_download.content_type)

        fluxo_pdf = self.post_json("/api/relatorios", {"type": "fluxo", "period": "2026-08", "format": "PDF"})
        self.assertEqual(fluxo_pdf.status_code, 201, fluxo_pdf.get_data(as_text=True))
        pdf_download = self.client.get(fluxo_pdf.get_json()["relatorio"]["download_url"])
        self.assertEqual(pdf_download.status_code, 200)
        self.assertTrue(pdf_download.data.startswith(b"%PDF"))
        self.assertEqual(pdf_download.mimetype, "application/pdf")

        livro = self.post_json("/api/relatorios", {"type": "livro", "period": "2026", "format": "CSV"})
        self.assertEqual(livro.status_code, 201, livro.get_data(as_text=True))

        bank_report = self.post_json("/api/relatorios", {"type": "banco", "period": "2026-08", "format": "CSV", "bank_id": c["bank_a"]["id"]})
        self.assertEqual(bank_report.status_code, 201, bank_report.get_data(as_text=True))

        unused = self.post_json("/api/subcategorias", {"category_id": c["income_category"]["id"], "name": "Subcategoria removível"})
        self.assertEqual(unused.status_code, 201)
        self.assertEqual(self.delete(f"/api/subcategorias/{unused.get_json()['subcategoria']['id']}").status_code, 200)
        self.assertEqual(self.delete(f"/api/subcategorias/{c['income_subcategory']['id']}").status_code, 409)

    def test_settings_notifications_and_demo_backend_isolation(self):
        company = self.put_json("/api/configuracoes/empresa", {"company": "Empresa Teste", "document": "", "email": "financeiro@test.invalid", "phone": "", "notes": ""})
        self.assertEqual(company.status_code, 200, company.get_data(as_text=True))
        financial = self.put_json("/api/configuracoes/financeiro", {"defaultPeriod": "month", "currency": "BRL", "confirmDelete": False})
        self.assertEqual(financial.status_code, 200, financial.get_data(as_text=True))
        appearance = self.put_json("/api/configuracoes/aparencia", {"density": "compact", "reducedMotion": True})
        self.assertEqual(appearance.status_code, 200, appearance.get_data(as_text=True))
        self.assertEqual(self.client.get("/api/configuracoes/aparencia").get_json()["configuracao"]["density"], "compact")
        invalid = self.put_json("/api/configuracoes/financeiro", {"defaultPeriod": "invalid", "currency": "BRL", "confirmDelete": True})
        self.assertEqual(invalid.status_code, 400)

        notification = self.post_json("/api/notificacoes", {"title": "Nova versão", "message": "Correções e melhorias publicadas.", "link": "/relatorios"})
        self.assertEqual(notification.status_code, 201, notification.get_data(as_text=True))
        notification_id = notification.get_json()["notificacao"]["id"]
        before = self.client.get("/api/notificacoes/contador").get_json()["unread_count"]
        read = self.patch_json(f"/api/notificacoes/{notification_id}/leitura", {"read": True})
        self.assertEqual(read.status_code, 200)
        after = self.client.get("/api/notificacoes/contador").get_json()["unread_count"]
        self.assertEqual(after, before - 1)

        with self.app.app_context():
            before_count = self.module.db.session.scalar(self.module.db.select(self.module.Lancamento).with_only_columns(self.module.func.count(self.module.Lancamento.id))) or 0

        demo = self.app.test_client()
        demo.get("/login")
        start = self.post_json("/api/demo/iniciar", {}, client=demo)
        self.assertEqual(start.status_code, 200, start.get_data(as_text=True))
        self.assertEqual(demo.get("/").status_code, 200)
        blocked = self.post_json("/api/lancamentos", {"flow": "entrada"}, client=demo)
        self.assertEqual(blocked.status_code, 403)
        self.assertIn("demonstração", blocked.get_json()["erro"].lower())
        self.assertEqual(demo.get("/api/lancamentos").status_code, 403)
        logout_demo = self.post_json("/api/logout", {}, client=demo)
        self.assertEqual(logout_demo.status_code, 200)

        with self.app.app_context():
            after_count = self.module.db.session.scalar(self.module.db.select(self.module.Lancamento).with_only_columns(self.module.func.count(self.module.Lancamento.id))) or 0
        self.assertEqual(before_count, after_count)

        logout = self.post_json("/api/logout", {})
        self.assertEqual(logout.status_code, 200)
        self.assertEqual(self.client.get("/lancamentos").status_code, 302)

    def test_health_and_key_pages(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        for route in ("/", "/lancamentos", "/graficos", "/relatorios", "/notificacoes", "/configuracoes"):
            with self.subTest(route=route):
                self.assertEqual(self.client.get(route).status_code, 200)
        legacy_book = self.client.get("/livro-caixa", follow_redirects=False)
        self.assertEqual(legacy_book.status_code, 302)
        self.assertIn("/relatorios#relatorio-livro", legacy_book.headers["Location"])


if __name__ == "__main__":
    unittest.main()
