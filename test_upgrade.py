"""Ensaio isolado de atualização de um esquema anterior às regras de fluxo."""
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class UpgradeTest(unittest.TestCase):
    def test_legacy_upgrade_preserves_balances_and_is_idempotent(self):
        with tempfile.TemporaryDirectory(prefix="caixa-upgrade-") as folder:
            path = Path(folder) / "legacy.db"
            with sqlite3.connect(path) as connection:
                connection.executescript("""
                CREATE TABLE categorias (id VARCHAR(40) PRIMARY KEY, nome VARCHAR(80) UNIQUE NOT NULL, cor VARCHAR(16) NOT NULL DEFAULT '#64748b', ativo BOOLEAN NOT NULL DEFAULT 1, criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE bancos (id VARCHAR(40) PRIMARY KEY, nome VARCHAR(80) UNIQUE NOT NULL, cor VARCHAR(16) NOT NULL DEFAULT '#2563eb', saldo_inicial NUMERIC(14,2) NOT NULL DEFAULT 0, ativo BOOLEAN NOT NULL DEFAULT 1, criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE lancamentos (id INTEGER PRIMARY KEY, descricao VARCHAR(80) NOT NULL, tipo VARCHAR(20) NOT NULL, valor NUMERIC(12,2) NOT NULL, data_lancamento DATE, origem VARCHAR(80), destino VARCHAR(80), categoria_id VARCHAR(40), origem_subitem_id INTEGER, destino_subitem_id INTEGER, status VARCHAR(12) DEFAULT 'liquidado', documento VARCHAR(60), criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE subitens (id INTEGER PRIMARY KEY, nome VARCHAR(80) NOT NULL, categoria_id VARCHAR(40), banco_id VARCHAR(40), ativo BOOLEAN NOT NULL DEFAULT 1, criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
                INSERT INTO categorias (id,nome) VALUES ('mista','Mista');
                INSERT INTO bancos (id,nome,saldo_inicial) VALUES ('a','Banco A',1000),('b','Banco B',200);
                INSERT INTO subitens (id,nome,categoria_id) VALUES (1,'Subcategoria antiga','mista');
                INSERT INTO lancamentos (id,descricao,tipo,valor,data_lancamento,origem,destino,categoria_id,origem_subitem_id,destino_subitem_id,documento) VALUES
                  (1,'Receita antiga','entrada',500,'2026-01-03','Mista','Banco A','mista',1,NULL,'ANTIGO-1'),
                  (2,'Despesa antiga','saida',100,'2026-01-04','Banco A','Mista','mista',NULL,1,'ANTIGO-2'),
                  (3,'Transferência antiga','transferencia',50,'2026-01-05','Banco A','Banco B',NULL,NULL,NULL,'ANTIGO-3');
                """)
            env = os.environ.copy()
            for key in ('INSTANCE_CONNECTION_NAME', 'K_SERVICE', 'APP_ENV'):
                env.pop(key, None)
            env.update(DATABASE_URL=f'sqlite:///{path}', SECRET_KEY='upgrade-test-secret', ADMIN_PASSWORD='upgrade-test-password', AUTO_MIGRATE='0')
            command = [sys.executable, '-m', 'flask', '--app', 'app', 'deploy-db']
            subprocess.run(command, cwd=ROOT, env=env, check=True, capture_output=True, text=True)
            def snapshot():
                with sqlite3.connect(path) as connection:
                    return (connection.execute('SELECT id,nome,fluxo FROM categorias ORDER BY id').fetchall(),
                            connection.execute('SELECT id,valor,documento,categoria_id,subcategoria_id FROM lancamentos ORDER BY id').fetchall(),
                            connection.execute('SELECT id,saldo_inicial FROM bancos ORDER BY id').fetchall())
            first = snapshot()
            subprocess.run(command, cwd=ROOT, env=env, check=True, capture_output=True, text=True)
            self.assertEqual(snapshot(), first)
            self.assertEqual([row[1] for row in first[1]], [500,100,50])
            self.assertEqual([row[2] for row in first[1]], ['ANTIGO-1','ANTIGO-2','ANTIGO-3'])
            self.assertEqual(first[2], [('a',1000),('b',200)])
            self.assertEqual({row[2] for row in first[0]}, {'entrada','saida'})
            self.assertIsNone(first[1][2][3])
            self.assertIsNone(first[1][2][4])
            with sqlite3.connect(path) as connection:
                for row in connection.execute('SELECT l.tipo,c.fluxo FROM lancamentos l JOIN categorias c ON l.categoria_id=c.id'):
                    self.assertEqual(row[0], row[1])
                self.assertEqual(connection.execute('SELECT count(*) FROM subcategorias').fetchone()[0], 2)
                owner = connection.execute("SELECT id FROM usuarios WHERE usuario='admin'").fetchone()[0]
                for table in ('categorias','bancos','subcategorias','lancamentos'):
                    self.assertEqual(connection.execute(f'SELECT count(*) FROM {table} WHERE usuario_id IS NULL OR usuario_id != ?', (owner,)).fetchone()[0], 0)
                self.assertEqual(connection.execute("SELECT count(*) FROM migracoes WHERE versao='20260923_isolamento_usuarios'").fetchone()[0], 1)


    def test_existing_default_admin_does_not_block_production_migration(self):
        """Regressão: política de senha não pode derrubar migração de banco existente."""
        with tempfile.TemporaryDirectory(prefix="caixa-admin-upgrade-") as folder:
            path = Path(folder) / "existing.db"
            env = os.environ.copy()
            for key in ("INSTANCE_CONNECTION_NAME", "K_SERVICE"):
                env.pop(key, None)
            env.update(
                APP_ENV="production",
                DATABASE_URL=f"sqlite:///{path}",
                SECRET_KEY="test-" + "s" * 40,
                ADMIN_PASSWORD="initial-admin-password",
                AUTO_MIGRATE="0",
            )
            bootstrap = r"""
from app import app, db, Usuario, atualizar_banco
with app.app_context():
    db.create_all()
    admin = Usuario(nome='Administrador', usuario='admin', email='admin@admin.com', administrador=True)
    admin.definir_senha('admin')
    db.session.add(admin)
    db.session.commit()
    atualizar_banco()
    assert db.session.scalar(db.select(Usuario).where(Usuario.usuario == 'admin')) is not None
"""
            result = subprocess.run(
                [sys.executable, "-c", bootstrap],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_production_requires_secret_and_does_not_migrate_on_import(self):
        with tempfile.TemporaryDirectory(prefix='caixa-startup-') as folder:
            path = Path(folder) / 'untouched.db'
            env = os.environ.copy()
            env.update(APP_ENV='production', DATABASE_URL=f'sqlite:///{path}', AUTO_MIGRATE='0', SECRET_KEY='weak')
            env.pop('INSTANCE_CONNECTION_NAME', None)
            command = [sys.executable, '-c', 'import app']
            rejected = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn('SECRET_KEY', rejected.stderr)
            env['SECRET_KEY'] = 'test-' + 'z' * 40
            accepted = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertFalse(path.exists(), 'Importar o servidor de produção não deve abrir/migrar o banco')
