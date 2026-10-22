from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.app.build as build
import backend.app.prod as prod


def test_build_frontend_requires_npm(monkeypatch, caplog) -> None:
    monkeypatch.setattr(build.shutil, "which", lambda _name: None)

    assert build.build_frontend() == 1
    assert "npm is required" in caplog.text


def test_build_frontend_requires_dependencies(monkeypatch, tmp_path: Path, caplog) -> None:
    monkeypatch.setattr(build.shutil, "which", lambda _name: "npm")
    monkeypatch.setattr(build, "FRONTEND", tmp_path / "frontend")

    assert build.build_frontend() == 1
    assert "Frontend dependencies are missing" in caplog.text


def test_build_frontend_propagates_build_failure(monkeypatch, tmp_path: Path, caplog) -> None:
    frontend = tmp_path / "frontend"
    (frontend / "node_modules").mkdir(parents=True)
    monkeypatch.setattr(build.shutil, "which", lambda _name: "npm")
    monkeypatch.setattr(build, "FRONTEND", frontend)
    monkeypatch.setattr(build.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=7))

    assert build.build_frontend() == 7
    assert "Frontend build failed with exit code 7" in caplog.text


def test_static_frontend_preserves_api_routes(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<h1>kostats</h1>", encoding="utf-8")
    target = FastAPI()

    @target.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    prod.configure_static_files(target, dist)
    client = TestClient(target)

    assert client.get("/api/health").json() == {"status": "ok"}
    assert "kostats" in client.get("/").text


def test_static_frontend_requires_index(tmp_path: Path) -> None:
    target = FastAPI()

    try:
        prod.configure_static_files(target, tmp_path)
    except FileNotFoundError as exc:
        assert "index.html" in str(exc)
    else:
        raise AssertionError("Expected missing frontend output to fail")


def test_production_serves_prebuilt_assets_without_node(monkeypatch, tmp_path):
    (tmp_path / "index.html").write_text("prebuilt", encoding="utf-8")
    monkeypatch.setattr(prod, "DIST", tmp_path)
    monkeypatch.setattr(prod, "app", FastAPI())
    monkeypatch.setattr(prod, "configure_logging", lambda: None)
    monkeypatch.setenv("PATH", "")
    calls = []
    monkeypatch.setattr(prod.uvicorn, "run", lambda app, **kwargs: calls.append((app, kwargs)))

    assert prod.main() == 0
    assert calls[0][1]["host"] == "127.0.0.1"
    assert TestClient(calls[0][0]).get("/").text == "prebuilt"
    assert not (tmp_path / "node_modules").exists()


def test_production_missing_assets_does_not_start_server(monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(prod, "DIST", tmp_path)
    monkeypatch.setattr(prod, "configure_logging", lambda: None)
    monkeypatch.setattr(prod.uvicorn, "run", lambda *a, **kw: pytest.fail("server started"))

    assert prod.main() == 1
    assert "uv run build-frontend" in caplog.text
