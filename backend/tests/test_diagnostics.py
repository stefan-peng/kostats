import json
import logging
import os
import sqlite3
import subprocess
import sys
from contextlib import closing

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import diagnostics


@pytest.fixture(autouse=True)
def private_data(monkeypatch, tmp_path):
    monkeypatch.setenv('KOSTATS_DATA_DIR', str(tmp_path))


def rows():
    with sqlite3.connect(diagnostics.database_path()) as connection:
        return connection.execute('SELECT kind,name,fields FROM events ORDER BY id').fetchall()


def test_retention_and_summary(monkeypatch, capsys):
    monkeypatch.setattr(diagnostics, 'MAX_RECORDS', 3)
    for index in range(5):
        diagnostics.record('operation', 'import', outcome='success', duration_ms=index)
    assert len(rows()) == 3
    with sqlite3.connect(diagnostics.database_path()) as connection:
        connection.execute('UPDATE events SET timestamp=0 WHERE id=(SELECT MIN(id) FROM events)')
    diagnostics.record('operation', 'import', outcome='error', duration_ms=9)
    diagnostics.main()
    summary = json.loads(capsys.readouterr().out)
    assert summary['records'] == 3
    assert summary['groups'][0]['count'] == 2
    assert summary['groups'][1]['result'] == 'error'


def test_operations_preserve_results_and_errors():
    @diagnostics.observed('example')
    def operation(fail=False):
        if fail:
            raise ValueError('private value')
        return {'imported': False, 'reason': 'unchanged'}

    assert operation()['reason'] == 'unchanged'
    with pytest.raises(ValueError, match='private value'):
        operation(True)
    entries = rows()
    assert json.loads(entries[0][2])['reason'] == 'unchanged'
    assert json.loads(entries[1][2])['exception_type'] == 'ValueError'
    assert 'private value' not in str(entries)


def test_requests_use_route_templates_without_private_input():
    app = FastAPI()
    app.add_middleware(diagnostics.RequestDiagnostics)

    @app.get('/books/{identifier}')
    def book(identifier: str):
        return {'title': identifier}

    with TestClient(app) as client:
        assert client.get('/books/private-title?token=secret').json() == {'title': 'private-title'}
        assert client.get('/private-path').status_code == 404
    entries = rows()
    assert entries[0][1] == '/books/{identifier}'
    assert json.loads(entries[0][2])['status'] == 200
    assert entries[1][1] == 'unmatched'
    assert 'private' not in str(entries)
    assert 'secret' not in str(entries)


def test_unavailable_diagnostics_do_not_break_operation(monkeypatch, tmp_path, capsys):
    blocked = tmp_path / 'file'
    blocked.write_text('not a directory')
    monkeypatch.setenv('KOSTATS_DATA_DIR', str(blocked))
    monkeypatch.setattr(diagnostics, '_last_warning', float('-inf'))
    diagnostics.record('operation', 'test')
    diagnostics.record('operation', 'test')
    assert capsys.readouterr().err.count('diagnostics unavailable') == 1


@pytest.mark.skipif(os.name != 'posix', reason='SQLite file locks are process-scoped on POSIX')
def test_record_preserves_locks_held_by_other_connections():
    diagnostics.record('operation', 'seed')
    path = diagnostics.database_path()
    probe = '''
import sqlite3
import sys
from contextlib import closing
try:
    with closing(sqlite3.connect(sys.argv[1], timeout=0)) as connection:
        connection.execute('SELECT count(*) FROM events').fetchone()
except sqlite3.Error as exc:
    print(exc.sqlite_errorname)
else:
    print('unlocked')
'''

    def lock_status():
        return subprocess.check_output([sys.executable, '-c', probe, str(path)], text=True).strip()

    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute('BEGIN EXCLUSIVE')
        assert lock_status() == 'SQLITE_BUSY'
        diagnostics.record('operation', 'concurrent')
        assert lock_status() == 'SQLITE_BUSY'


@pytest.mark.skipif(os.name != 'posix', reason='POSIX permissions')
def test_database_is_created_privately():
    diagnostics.record('operation', 'seed')
    path = diagnostics.database_path()
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700


def test_database_warning_includes_sqlite_error_code_without_private_values(monkeypatch, capsys):
    path = diagnostics.database_path()
    path.parent.mkdir(parents=True)
    path.write_text('private invalid database contents')
    monkeypatch.setattr(diagnostics, '_last_warning', float('-inf'))

    diagnostics.record('operation', 'test')
    diagnostics.record('operation', 'test')

    output = capsys.readouterr().err
    assert output.count('diagnostics unavailable') == 1
    assert 'DatabaseError (SQLITE_NOTADB)' in output
    assert 'private' not in output
    assert str(path) not in output
    assert path.read_text() == 'private invalid database contents'


def test_persistent_logs_and_exception_frames():
    handler = diagnostics.PersistentHandler()
    try:
        raise RuntimeError('private exception')
    except RuntimeError:
        import sys
        entry = logging.LogRecord('backend.test', logging.ERROR, __file__, 1, 'Operation failed', (), sys.exc_info())
        handler.emit(entry)
    fields = json.loads(rows()[0][2])
    assert fields['exception_type'] == 'RuntimeError'
    assert fields['frames'][0]['function'] == 'test_persistent_logs_and_exception_frames'
    assert 'private exception' not in str(fields)


def test_payload_cap_handles_escaped_content():
    diagnostics.record('log', 'large', message='"\\' * 10_000)
    payload = rows()[0][2]
    assert len(payload.encode()) <= 8192
    assert json.loads(payload)['truncated'] is True


def test_p95_uses_nearest_rank(capsys):
    for duration in range(1, 21):
        diagnostics.record('operation', 'timing', duration_ms=duration)
    diagnostics.main()
    assert json.loads(capsys.readouterr().out)['groups'][0]['p95_ms'] == 19


def test_unknown_count_uses_effective_dashboard_status():
    @diagnostics.observed('dashboard')
    def dashboard():
        return {'books': [{'status': None}, {'status': None}], 'summary': {'reading_books': 1}}
    dashboard()
    assert json.loads(rows()[0][2])['unknown_status_count'] == 1
