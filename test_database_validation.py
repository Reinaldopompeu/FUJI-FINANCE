"""Falhas de schema devem ser diagnosticadas antes do ensaio de escrita."""
import unittest

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine

from database_validation import verify_database


class DatabaseValidationTest(unittest.TestCase):
    def test_integer_id_is_not_accepted_as_text(self):
        engine = create_engine('sqlite://')
        try:
            actual = MetaData()
            Table('bancos', actual, Column('id', Integer, primary_key=True))
            actual.create_all(engine)
            expected = MetaData()
            Table('bancos', expected, Column('id', String(40), primary_key=True))
            with self.assertRaisesRegex(RuntimeError, "tipos incompatíveis=\\['id'\\]"):
                verify_database(engine, expected)
        finally:
            engine.dispose()
