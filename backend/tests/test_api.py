from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.main import app


def create_api_fixture(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE book (
            id INTEGER PRIMARY KEY,
            title TEXT,
            authors TEXT,
            last_open INTEGER,
            pages INTEGER
        );
        CREATE TABLE page_stat (
            id_book INTEGER,
            page INTEGER NOT NULL,
            start_time INTEGER NOT NULL,
            period INTEGER NOT NULL
        );
        INSERT INTO book VALUES (1, 'Kindred', 'Octavia E. Butler', 1769904000, 288);
        INSERT INTO page_stat VALUES (1, 1, 1769904000, 1200);
        """
    )
    conn.commit()
    conn.close()


def test_empty_dashboard_without_snapshot(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(app)

    response = client.get("/api/dashboard")

    assert response.status_code == 200
    assert response.json()["has_data"] is False


def test_upload_import_and_dashboard(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    client = TestClient(app)

    response = client.post(
        "/api/import/upload",
        files={"file": ("statistics.sqlite3", source.read_bytes(), "application/octet-stream")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["snapshot"]["source"] == "upload"
    assert payload["dashboard"]["summary"]["total_time_label"] == "20m"

    dashboard = client.get("/api/dashboard").json()
    assert dashboard["recent_books"][0]["title"] == "Kindred"


def test_upload_rejects_unsupported_sqlite_without_snapshot(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    source = tmp_path / "not-koreader.sqlite3"
    sqlite3.connect(source).execute("CREATE TABLE nope (id INTEGER)").connection.close()
    client = TestClient(app)

    response = client.post(
        "/api/import/upload",
        files={"file": ("not-koreader.sqlite3", source.read_bytes(), "application/octet-stream")},
    )

    assert response.status_code == 422
    assert client.get("/api/snapshots").json() == {"snapshots": []}


def test_auto_kobo_import_endpoint_skips_unchanged_database(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    volume = tmp_path / "KOBOeReader"
    source = volume / ".adds/koreader/settings/statistics.sqlite3"
    source.parent.mkdir(parents=True, exist_ok=True)
    create_api_fixture(source)
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(volume))
    client = TestClient(app)

    first = client.post("/api/import/kobo/auto")
    second = client.post("/api/import/kobo/auto")

    assert first.status_code == 200
    assert first.json()["imported"] is True
    assert first.json()["dashboard"]["recent_books"][0]["title"] == "Kindred"
    assert second.status_code == 200
    assert second.json()["imported"] is False
    assert second.json()["reason"] == "unchanged"
    assert len(client.get("/api/snapshots").json()["snapshots"]) == 1
