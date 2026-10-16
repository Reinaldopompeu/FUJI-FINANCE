# Fuji Finance

Demonstração de controle financeiro, com saldo, lançamentos, categorias, objetivo e tutorial interativo.

## Executar localmente

```sh
python -m pip install -r requirements.txt
python build.py
python -m http.server 4173 --directory dist
```

Abra http://localhost:4173/login.html.

## Pastas

- `templates/`: páginas e componentes Jinja2.
- `static/`: JavaScript, CSS, imagens e bibliotecas.
- `dist/`: site pronto para hospedagem estática.
- `tests/`: verificações automatizadas em Node.js.

## Dados de demonstração

Os dados ficam temporariamente no sessionStorage da aba. Navegar entre as páginas mantém os dados; recarregar ou clicar em Sair apaga a demonstração. O tutorial usa dados separados, descartados ao sair ou concluir. Não há servidor de banco de dados nem autenticação nesta versão.

## Subir no GitHub

Extraia o ZIP e envie seu conteúdo para o repositório, incluindo as pastas. Não envie apenas o arquivo ZIP se quiser visualizar e editar o código pelo GitHub.

## Hospedagem

Publique o conteúdo de `dist/` na raiz de um domínio. O site usa caminhos absolutos, como `/static/` e `/login.html`. Para GitHub Pages, use um domínio próprio ou um repositório de site de usuário (`usuario.github.io`). Publicação em subpasta (`usuario.github.io/repositorio/`) exige adaptar os caminhos antes de publicar.

## Publicar na Vercel (mais fácil)

1. Extraia `fuji-finance-vercel.zip`.
2. No GitHub, crie um repositório e envie todas as pastas e arquivos extraídos. `vercel.json` e `dist/` devem ficar na raiz do repositório.
3. Acesse https://vercel.com/new e conecte sua conta do GitHub.
4. Importe o repositório e clique em Deploy. Mantenha Root Directory na raiz. Não precisa preencher comandos, banco de dados nem variáveis de ambiente.
5. Abra o endereço gerado pela Vercel. A tela de acesso fica em `/login.html`.

A configuração publica a pasta `dist/`, que já contém o site pronto. Para futuras alterações em `templates/` ou `static/`, execute `python build.py` e envie também a pasta `dist/` atualizada ao GitHub. A Vercel poderá publicar as alterações automaticamente pelo repositório conectado.

Referência da configuração: https://vercel.com/docs/project-configuration/vercel-json
