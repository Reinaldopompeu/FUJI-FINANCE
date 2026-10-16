"""Static checks that can run without installing Flask dependencies."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StaticContractTest(unittest.TestCase):
    def test_transaction_sections_and_hidden_fields(self):
        template = (ROOT / "templates/components/transaction_modal.html").read_text(encoding="utf-8")
        css = (ROOT / "static/css/transaction.css").read_text(encoding="utf-8")
        self.assertEqual(template.count("data-transaction-step="), 3)
        self.assertIn('data-submit-transaction hidden', template)
        self.assertIn('data-review="description"', template)
        self.assertIn('data-review="subcategory"', template)
        self.assertIn("renderReview", (ROOT / "static/js/app.js").read_text(encoding="utf-8"))
        self.assertNotIn("txTransferCategory", template)
        self.assertIn('.transaction-modal [hidden] { display: none !important; }', css)
        self.assertIn('@media (max-width: 600px)', css)

    def test_settings_start_with_three_individual_sections(self):
        template = (ROOT / "templates/configuracoes.html").read_text(encoding="utf-8")
        self.assertIn("data-settings-home", template)
        for section in ("empresa", "categorias", "bancos"):
            self.assertIn(f'data-settings-target="{section}"', template)
            self.assertIn(f'data-settings-panel="{section}"', template)
        self.assertEqual(template.count("data-settings-back"), 3)

    def test_required_files_exist(self):
        for name in (
            "correcaoGCP.md",
            "migrations/001_20260902_subitens_bancos_notificacoes_relatorios.sql",
            "migrations/002_20260903_saldo_inicial_bancos.sql",
            "migrations/003_20260909_fluxos_categorias.sql",
            "migrations/004_20260922_categorias_subcategorias.sql",
            "migrations/005_20260923_isolamento_usuarios.sql",
            "templates/notificacoes.html",
            "static/js/data-service.js",
        ):
            self.assertTrue((ROOT / name).is_file(), name)

    def test_no_duplicate_literal_ids_per_template(self):
        for template in (ROOT / "templates").rglob("*.html"):
            text = template.read_text(encoding="utf-8")
            ids = re.findall(r'\bid=["\']([^"\']+)["\']', text)
            duplicates = sorted({item for item in ids if ids.count(item) > 1})
            self.assertEqual(duplicates, [], f"IDs duplicados em {template.name}: {duplicates}")

    def test_templates_do_not_require_inline_javascript(self):
        for template in (ROOT / "templates").rglob("*.html"):
            text = template.read_text(encoding="utf-8")
            inline_scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", text, flags=re.I)
            self.assertEqual(inline_scripts, [], f"Script inline em {template.name}")
            self.assertNotRegex(text, r"\son(?:click|change|submit|load|error)\s*=", template.name)

    def test_dashboard_contains_only_requested_chart(self):
        text = (ROOT / "templates/index.html").read_text(encoding="utf-8")
        chart_ids = re.findall(r'id=["\']([^"\']*Chart)["\']', text)
        self.assertEqual(chart_ids, ["balanceChart"])
        js = (ROOT / "static/js/app.js").read_text(encoding="utf-8")
        self.assertIn('color:[chartColor("--ui-primary")]', js)
        self.assertIn('lineStyle:{width:4}', js)

    def test_graphs_page_has_one_chart_and_default_cashflow(self):
        text = (ROOT / "templates/graficos.html").read_text(encoding="utf-8")
        self.assertEqual(sum("chart" in value.split() for value in re.findall(r'class=["\']([^"\']+)["\']', text)), 1)
        self.assertNotIn('id="chartType"', text)
        self.assertNotIn('id="analysisContext"', text)
        self.assertNotIn('class="control-surface"', text)
        for value in ("line", "pie", "bar", "histogram"):
            self.assertRegex(text, rf'<option value="{value}">')
        self.assertIn('id="analysisChart"', text)

    def test_transaction_modal_uses_vertical_fields_and_live_validation(self):
        text = (ROOT / "templates/components/transaction_modal.html").read_text(encoding="utf-8")
        for field in ("txCategory", "txSubcategory", "txOriginBank", "txDestinationBank"):
            self.assertIn(f'id="{field}"', text)
        self.assertRegex(text, r'<select class="select" id="txFlux"')
        self.assertNotIn('class="transaction-choice-grid"', text)
        css = (ROOT / "static/css/transaction.css").read_text(encoding="utf-8")
        self.assertIn(".transaction-type-list", css)
        js = (ROOT / "static/js/app.js").read_text(encoding="utf-8")
        self.assertIn("updateFieldValidation", js)

    def test_each_transaction_field_is_an_individual_step(self):
        template = (ROOT / "templates/components/transaction_modal.html").read_text(encoding="utf-8")
        js = (ROOT / "static/js/app.js").read_text(encoding="utf-8")
        for step in ("category", "subcategory", "origin-bank", "destination-bank", "date", "amount", "description"):
            self.assertIn(f'data-field-step="{step}"', template)
        self.assertIn('function rebuildSequence()', js)
        self.assertIn('sequence = ["date", "type", "amount", ...fields, "description", "review"]', js)
        self.assertIn('Etapa ${currentIndex + 1} de ${sequence.length}', js)

    def test_transfer_has_no_category_contract(self):
        template = (ROOT / "templates/components/transaction_modal.html").read_text(encoding="utf-8")
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        data_service = (ROOT / "static/js/data-service.js").read_text(encoding="utf-8")
        self.assertIn('transferência entre bancos', template)
        self.assertIn('else None)', app)
        self.assertIn('subcategoria = None', app)
        self.assertNotIn('/api/subitens', app)
        self.assertIn('listSubcategories', data_service)

    def test_livro_caixa_page_removed_and_legacy_route_redirects(self):
        self.assertFalse((ROOT / "templates/livro_caixa.html").exists())
        sidebar = (ROOT / "templates/components/sidebar.html").read_text(encoding="utf-8")
        self.assertNotIn("pagina_livro_caixa", sidebar)
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn('return redirect(url_for("pagina_relatorios", _anchor="relatorio-livro"), code=302)', app)

    def test_reports_page_has_no_history_and_keeps_book_export(self):
        text = (ROOT / "templates/relatorios.html").read_text(encoding="utf-8")
        self.assertNotIn("reportsTableBody", text)
        self.assertNotIn("Relatórios gerados", text)
        self.assertRegex(text, r'<select[^>]+data-report-period="fluxo"[^>]+data-report-period-kind="month"')
        self.assertRegex(text, r'<select[^>]+data-report-period="livro"[^>]+data-report-period-kind="year"')
        self.assertRegex(text, r'<select[^>]+data-report-period="banco"[^>]+data-report-period-kind="month"')
        self.assertNotRegex(text, r'data-report-period="(?:fluxo|livro|banco)"[^>]+type="(?:month|number|text)"')
        self.assertIn('id="relatorio-livro"', text)

    def test_bank_initial_balance_contract(self):
        template = (ROOT / "templates/configuracoes.html").read_text(encoding="utf-8")
        self.assertIn('name="initial_balance"', template)
        self.assertIn('id="bankInitialTotal"', template)
        self.assertIn('id="bankCurrentTotal"', template)
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertIn("saldo_inicial: Mapped[Decimal]", app)
        self.assertIn('"initial_balance": float(self.saldo_inicial or 0)', app)
        self.assertIn("saldo = saldo_inicial_total()", app)
        self.assertIn("def impacto_saldo_lancamento", app)
        self.assertIn("saldo_inicial_contextual(request.args)", app)

    def test_accessibility_scale_is_preserved(self):
        css = (ROOT / "static/css/style.css").read_text(encoding="utf-8")
        self.assertIn("html { font-size: 16px", css)
        self.assertIn(".skip-link", css)
        base = (ROOT / "templates/base.html").read_text(encoding="utf-8")
        self.assertIn('class="skip-link"', base)

    def test_existing_settings_notifications_and_reports_endpoints_remain(self):
        app = (ROOT / "app.py").read_text(encoding="utf-8")
        for function_name in ("configuracoes_api", "notificacoes_api", "notificacoes_contador", "marcar_notificacao", "validar_periodo_relatorio", "query_relatorio"):
            self.assertIn(f"def {function_name}", app)
        for route in ('/api/configuracoes/<string:secao>', '/api/notificacoes', '/api/notificacoes/contador', '/api/relatorios'):
            self.assertIn(route, app)


    def test_visual_revision_uses_unified_material_tokens_and_icons(self):
        css = (ROOT / "static/css/material-unified.css").read_text(encoding="utf-8")
        self.assertIn("--md-sys-color-primary", css)
        self.assertRegex(css, r"\.stat-icon,[\s\S]*?width:\s*48px\s*!important;[\s\S]*?height:\s*48px\s*!important")
        self.assertRegex(css, r"\.stat-icon svg,[\s\S]*?width:\s*24px\s*!important;[\s\S]*?height:\s*24px\s*!important")
        for template_name in ("index.html", "lancamentos.html", "graficos.html", "relatorios.html", "notificacoes.html", "usuarios.html"):
            text = (ROOT / "templates" / template_name).read_text(encoding="utf-8")
            self.assertNotIn('class="page-intro', text, template_name)
        self.assertRegex(css, r"\.toolbar\s*\{[^}]*border:\s*0;")
        base = (ROOT / "templates/base.html").read_text(encoding="utf-8")
        self.assertIn("material-unified.css", base)
        app_base = (ROOT / "templates/app_base.html").read_text(encoding="utf-8")
        self.assertNotIn("topbar-kicker", app_base)


    def test_final_visual_revision_contract(self):
        settings = (ROOT / "templates/configuracoes.html").read_text(encoding="utf-8")
        self.assertNotIn("settings-nav", settings)
        self.assertNotIn("Preferências financeiras", settings)
        self.assertNotIn("Aparência", settings)
        self.assertNotIn('id="financeiro"', settings)
        self.assertNotIn('id="aparencia"', settings)
        self.assertIn('class="catalog-list"', settings)

        for template_name in ("index.html", "graficos.html"):
            text = (ROOT / "templates" / template_name).read_text(encoding="utf-8")
            for card in re.findall(r'<article class="stat-card".*?</article>', text, flags=re.S):
                value_end = card.find('</strong>')
                self.assertGreater(value_end, -1, template_name)
                self.assertNotRegex(card[value_end + len('</strong>'):], r'<(?:span|p|small)\b', template_name)

        modal = (ROOT / "templates/components/transaction_modal.html").read_text(encoding="utf-8")
        self.assertIn('id="txValue"', modal)
        self.assertRegex(modal, r'id="txValue"[^>]+data-money-input')
        self.assertRegex(settings, r'id="newBankInitialBalance"[^>]+data-money-input')
        self.assertRegex(settings, r'id="catalogEditInitialBalance"[^>]+data-money-input')

        js = (ROOT / "static/js/app.js").read_text(encoding="utf-8")
        self.assertIn("initializeCurrencyMasks", js)
        self.assertIn("formatCurrencyTyping", js)
        self.assertIn("initializeReportPeriodFields", js)
        self.assertNotIn("initializeSettingsNavigation", js)

        css = (ROOT / "static/css/style.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.button,[\s\S]*?min-height:\s*42px")
        self.assertIn("Reforma visual final", css)

    def test_demo_financial_methods_branch_locally(self):
        text = (ROOT / "static/js/data-service.js").read_text(encoding="utf-8")
        self.assertIn('const demoMode = document.body?.dataset.demo === "true"', text)
        self.assertIn('if (demoMode) throw new Error("Operação bloqueada', text)
        self.assertIn('global.sessionStorage.removeItem(demoKey)', text)
        self.assertIn("initial_balance", text)
        self.assertIn("current_balance", text)


if __name__ == "__main__":
    unittest.main()
