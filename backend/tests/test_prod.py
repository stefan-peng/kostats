from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.app.prod as prod


def test_build_frontend_requires_npm(monkeypatch, capsys) -> None:
    monkeypatch.setattr(prod.shutil, "which", lambda _name: None)

    assert prod.build_frontend() == 1
    assert "npm is required" in capsys.readouterr().err


def test_build_frontend_requires_dependencies(monkeypatch, tmp_path: Path, capsys) -> None:
    monkeypatch.setattr(prod.shutil, "which", lambda _name: "npm")
    monkeypatch.setattr(prod, "FRONTEND", tmp_path / "frontend")

    assert prod.build_frontend() == 1
    assert "Frontend dependencies are missing" in capsys.readouterr().err


def test_build_frontend_propagates_build_failure(monkeypatch, tmp_path: Path, capsys) -> None:
    frontend = tmp_path / "frontend"
    (frontend / "node_modules").mkdir(parents=True)
    monkeypatch.setattr(prod.shutil, "which", lambda _name: "npm")
    monkeypatch.setattr(prod, "FRONTEND", frontend)
    monkeypatch.setattr(prod.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(returncode=7))

    assert prod.build_frontend() == 7
    assert "Frontend build failed with exit code 7" in capsys.readouterr().err


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
