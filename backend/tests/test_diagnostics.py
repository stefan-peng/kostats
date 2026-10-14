import json
import logging
import sqlite3

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
