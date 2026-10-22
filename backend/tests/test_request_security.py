from io import BytesIO
from pathlib import Path

import pytest
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

import backend.app.main as main
import backend.app.request_security as security
from backend.app.request_security import LocalRequestSecurity


@pytest.fixture
def guarded_app():
    app = FastAPI()
    app.state.calls = 0
    app.add_middleware(LocalRequestSecurity, frontend_origins=['http://localhost:5173'])

    @app.post('/api/write')
    async def write(request: Request):
        await request.body()
        app.state.calls += 1
        return {'ok': True}

    @app.post('/api/import/upload')
    async def upload(file: UploadFile = File(...)):
        app.state.calls += 1
        return {'size': file.size}

    return app


@pytest.mark.parametrize('host', ['example.com', 'localhost.attacker.com', '127.0.0.1.attacker.com', 'attacker@localhost', 'localhost/path', 'localhost:bad'])
def test_foreign_hosts_cannot_reach_routes(guarded_app, host):
    response = TestClient(guarded_app).post('/api/write', headers={'host': host})
    assert response.status_code == 400
    assert guarded_app.state.calls == 0


@pytest.mark.parametrize('origin', ['https://example.com', 'null', 'http://localhost:9999', 'http://localhost.attacker.com'])
def test_foreign_browser_posts_cannot_mutate(guarded_app, origin):
    response = TestClient(guarded_app, base_url='http://localhost:8000').post('/api/write', headers={'origin': origin})
    assert response.status_code == 403
    assert guarded_app.state.calls == 0


@pytest.mark.parametrize('host,origin', [
    ('localhost:8000', 'http://localhost:8000'),
    ('127.0.0.1:8000', 'http://localhost:5173'),
    ('[::1]:8000', 'http://[::1]:8000'),
    ('127.0.0.1:8000', None),
])
def test_loopback_same_origin_dev_and_cli_requests_work(guarded_app, host, origin):
    headers = {'origin': origin} if origin else {}
    response = TestClient(guarded_app, base_url=f'http://{host}').post('/api/write', headers=headers)
    assert response.status_code == 200
    assert guarded_app.state.calls == 1


def test_cross_site_fetch_without_origin_is_rejected(guarded_app):
    response = TestClient(guarded_app, base_url='http://localhost').post('/api/write', headers={'sec-fetch-site': 'cross-site'})
    assert response.status_code == 403


@pytest.mark.parametrize('length', ['-1', 'bogus', '999999999999999999999999999999999'])
def test_invalid_and_excessive_declared_lengths_rejected(guarded_app, length):
    response = TestClient(guarded_app, base_url='http://localhost').post('/api/write', headers={'content-length': length}, content=b'')
    assert response.status_code == (413 if length.isdigit() else 400)
    assert guarded_app.state.calls == 0


def test_chunked_or_understated_body_cannot_exceed_limit(monkeypatch, guarded_app):
    import asyncio
    monkeypatch.setattr(security, 'MAX_API_BODY_BYTES', 10)

    async def check():
        async def chunks():
            yield b'123456'
            yield b'789012'
        async with AsyncClient(transport=ASGITransport(app=guarded_app), base_url='http://localhost') as client:
            for headers in ({}, {'content-length': '1'}):
                response = await client.post('/api/write', headers=headers, content=chunks())
                assert response.status_code == 413
            assert (await client.post('/api/write', content=b'1234567890')).status_code == 200
    asyncio.run(check())
    assert guarded_app.state.calls == 1


def test_partial_multipart_is_closed_when_body_limit_is_hit(monkeypatch, guarded_app):
    import asyncio
    import starlette.formparsers as formparsers
    monkeypatch.setattr(security, 'MAX_UPLOAD_BYTES', 10)
    monkeypatch.setattr(security, 'MAX_FORM_OVERHEAD_BYTES', 150)
    spooled = []
    original = formparsers.SpooledTemporaryFile

    def tracked(*args, **kwargs):
        file = original(*args, **kwargs)
        spooled.append(file)
        return file
    monkeypatch.setattr(formparsers, 'SpooledTemporaryFile', tracked)

    async def chunks():
        yield b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="db"\r\n\r\n123'
        yield b'x' * 100

    async def check():
        async with AsyncClient(transport=ASGITransport(app=guarded_app), base_url='http://localhost') as client:
            response = await client.post('/api/import/upload', headers={'content-type': 'multipart/form-data; boundary=boundary'}, content=chunks())
            assert response.status_code == 413
    asyncio.run(check())
    assert spooled and all(file.closed for file in spooled)
    assert guarded_app.state.calls == 0


def test_upload_limit_checks_file_size_before_import(monkeypatch, tmp_path: Path):
    monkeypatch.setenv('KOSTATS_DATA_DIR', str(tmp_path / 'data'))
    monkeypatch.setattr(main, 'MAX_UPLOAD_BYTES', 10)
    client = TestClient(main.app, base_url='http://localhost')
    response = client.post('/api/import/upload', files={'file': ('db.sqlite3', b'x' * 11)}, data={'new_device_label': 'Test'})
    assert response.status_code == 413
    assert not (tmp_path / 'data' / 'manifest.json').exists()


def test_stream_copy_limit_cleans_up_partial_file(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(main, 'MAX_UPLOAD_BYTES', 10)
    original = main.tempfile.NamedTemporaryFile
    paths = []

    def tracked(**kwargs):
        file = original(dir=tmp_path, **kwargs)
        paths.append(Path(file.name))
        return file
    monkeypatch.setattr(main.tempfile, 'NamedTemporaryFile', tracked)
    with pytest.raises(main.HTTPException) as exc:
        main.post_import_upload(UploadFile(BytesIO(b'x' * 11), filename='db'), device_id=None, new_device_label='Test')
    assert exc.value.status_code == 413
    assert paths and all(not path.exists() for path in paths)
