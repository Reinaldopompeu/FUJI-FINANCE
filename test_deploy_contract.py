"""Contratos estáticos do deploy que não dependem de Flask/GCP."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DeployContractTest(unittest.TestCase):
    def test_startup_probe_matches_live_route(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn("httpGet.path=/live", workflow)
        self.assertIn('@app.get("/live")', app)

    def test_existing_production_configuration_is_reused(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        for variable in ("GCP_PROJECT_ID", "WIF_PROVIDER", "WIF_SERVICE_ACCOUNT"):
            self.assertIn(variable, workflow)
        for secret in ("db-password:latest", "flask-secret:latest", "initial-admin-password:latest"):
            self.assertIn(secret, workflow)
        self.assertNotIn("SESSION_SECRET_REF", workflow)
        self.assertNotIn("ADMIN_SECRET_REF", workflow)

    def test_service_and_job_use_the_same_database_source(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        self.assertEqual(workflow.count("            DATABASE_URL=\n"), 2)
        self.assertEqual(workflow.count("            DB_USER=caixa-app\n"), 2)
        self.assertEqual(workflow.count("            DB_NAME=caixa\n"), 2)

    def test_main_push_deploys_and_pull_request_does_not(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        self.assertIn("push:", workflow)
        self.assertIn("pull_request:", workflow)
        self.assertIn("github.event_name != 'pull_request'", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)

    def test_migration_is_explicit_before_traffic(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        self.assertIn("AUTO_MIGRATE=0", workflow)
        self.assertIn("--command=/cnb/process/migrate", workflow)
        self.assertIn("no_traffic: true", workflow)
        self.assertLess(workflow.index("Aplicar migração com a mesma imagem"), workflow.index("Direcionar tráfego para a revisão validada"))


    def test_existing_admin_password_never_blocks_migration(self):
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        start = app.index("def garantir_usuario_admin():")
        end = app.index("\ndef normalizar_fluxos_categorias", start)
        function = app[start:end]
        self.assertNotIn("O administrador ainda usa a senha padrão. Troque-a antes da publicação.", function)
        self.assertIn("A migração não será bloqueada por isso", function)
        self.assertIn("ADMIN_PASSWORD é obrigatória ao criar o primeiro administrador em PostgreSQL", function)
        self.assertIn("db.session.remove()", function)

    def test_legacy_subcategory_copy_waits_for_an_owner(self):
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        start = app.index("def aplicar_migracoes_aditivas():")
        end = app.index("\ndef garantir_schema_e_migrar_dados", start)
        function = app[start:end]
        self.assertIn('if "usuario_id" in colunas_subcategorias:', function)
        self.assertIn("copiar_subcategorias = False", function)
        self.assertIn("SELECT 1 FROM {prefixo}subcategorias AS destino_subcategoria", function)

    def test_owner_lookup_does_not_keep_an_orm_transaction_open_during_ddl(self):
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        start = app.index("def aplicar_isolamento_usuarios():")
        end = app.index("\ndef normalizar_fluxos_categorias", start)
        function = app[start:end]
        self.assertIn("with db.engine.connect() as conexao:", function)
        self.assertNotIn("admin_id = db.session.scalar", function)

    def test_failed_migration_has_diagnostic_step(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        self.assertIn("Diagnosticar falha da migração", workflow)
        self.assertIn("gcloud run jobs executions describe", workflow)
        self.assertIn("gcloud logging read", workflow)

    def test_legacy_postgres_columns_are_widened(self):
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn('(("tipo", 20), ("origem", 80), ("destino", 80))', app)
        self.assertTrue((ROOT / "migrations/003_20260909_fluxos_categorias.sql").is_file())


if __name__ == "__main__":
    unittest.main()
