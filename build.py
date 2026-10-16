"""Exporta os templates originais do Caixa Fácil como páginas estáticas."""
from pathlib import Path
import shutil
import hashlib
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
shutil.copytree(ROOT / 'static', DIST / 'static', dirs_exist_ok=True)
routes = {'index': '/', 'login': '/login.html'}
pages = ['lancamentos', 'graficos', 'relatorios', 'notificacoes', 'configuracoes']
routes.update({f'pagina_{page}': f'/{page}.html' for page in pages})

def url_for(endpoint, **kwargs):
    if endpoint != 'static':
        return routes[endpoint]
    filename = kwargs['filename']
    version = hashlib.sha256((ROOT / 'static' / filename).read_bytes()).hexdigest()[:12]
    return '/static/' + filename + '?v=' + version

env = Environment(loader=FileSystemLoader(ROOT / 'templates'), autoescape=select_autoescape(['html']))
env.globals.update(url_for=url_for, csrf_token=lambda: '')
for template, page in [('index', 'dashboard'), ('login', 'login'), *[(p, p) for p in pages]]:
    html = env.get_template(template + '.html').render(page_id=page, modo_demo=True, pode_gerenciar=True, usuario_atual=None)
    (DIST / (template + '.html')).write_text(html, encoding='utf-8')
print(f'Exportadas {len(pages)+2} páginas em {DIST}')
