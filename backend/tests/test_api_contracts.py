import pytest
from fastapi.exceptions import ResponseValidationError
from fastapi.testclient import TestClient

import backend.app.main as main
from backend.app.sqlite_stats import empty_dashboard


def test_read_responses_have_concrete_schemas():
    schema = main.app.openapi()
    for route, name in [('/api/dashboard', 'Dashboard'), ('/api/device/status', 'DeviceStatus'), ('/api/backups/{backup_id}/restore-preview', 'RestorePreview')]:
        response = schema['paths'][route]['get']['responses']['200']['content']['application/json']['schema']
        assert response == {'$ref': f'#/components/schemas/{name}'}


def test_dashboard_response_omits_internal_fields(monkeypatch, tmp_path):
    monkeypatch.setenv('KOSTATS_DATA_DIR', str(tmp_path))
    payload = empty_dashboard()
    payload['_all_sessions'] = [{'internal': 'data'}]
    monkeypatch.setattr(main, 'empty_dashboard', lambda: payload)
    monkeypatch.setattr(main, 'latest_effective_snapshots', lambda *args: [])
    client = TestClient(main.app, base_url='http://localhost')
    response = client.get('/api/dashboard')
    assert response.status_code == 200
    assert '_all_sessions' not in response.json()


def test_invalid_device_response_is_caught_at_api_boundary(monkeypatch):
    monkeypatch.setattr(main, 'device_status', lambda: {'mounted': True})
    with pytest.raises(ResponseValidationError):
        TestClient(main.app, base_url='http://localhost').get('/api/device/status')
