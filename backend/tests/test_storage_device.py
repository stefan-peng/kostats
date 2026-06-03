from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

import pytest

from backend.app.device import auto_import_from_kobo, device_status, import_from_kobo
from backend.app.errors import ImportError, UnsupportedSchemaError
from backend.app.storage import SnapshotStore


def create_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        PRAGMA user_version = 24;
        CREATE TABLE book (id INTEGER PRIMARY KEY, title TEXT);
        CREATE TABLE page_stat_data (id_book INTEGER, page INTEGER, start_time INTEGER, duration INTEGER);
        """
    )
    conn.commit()
    conn.close()


def add_reading_row(path: Path, *, book_id: int, title: str, duration: int) -> None:
    conn = sqlite3.connect(path)
    conn.execute("INSERT INTO book (id, title) VALUES (?, ?)", (book_id, title))
    conn.execute(
        "INSERT INTO page_stat_data (id_book, page, start_time, duration) VALUES (?, ?, ?, ?)",
        (book_id, 1, 1769904000 + book_id, duration),
    )
    conn.commit()
    conn.close()


def test_snapshot_store_imports_timestamped_copy(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite3"
    create_db(source)
    store = SnapshotStore(tmp_path / "data")

    meta = store.import_file(source, source_kind="upload", source_path="source.sqlite3")

    assert Path(meta.path).exists()
    assert Path(meta.path) != source
    assert meta.user_version == 24
    assert store.latest() == meta
    assert store.list_snapshots()[0]["source"] == "upload"


def test_snapshot_store_persists_local_copy_for_subsequent_launches(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite3"
    data_root = tmp_path / "data"
    create_db(source)

    meta = SnapshotStore(data_root).import_file(source, source_kind="upload", source_path="source.sqlite3")
    relaunched_store = SnapshotStore(data_root)

    assert Path(meta.path).parent == data_root / "snapshots"
    assert Path(meta.path).exists()
    assert source.exists()
    assert relaunched_store.latest() == meta
    assert relaunched_store.resolve(meta.id) == meta


def test_snapshot_store_imports_wal_backed_database(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite3"
    conn = sqlite3.connect(source)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE book (
            id INTEGER PRIMARY KEY,
            title TEXT,
            authors TEXT,
            last_open INTEGER,
            pages INTEGER
        );
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        INSERT INTO book VALUES (1, 'Dune', 'Frank Herbert', 1769904000, 412);
        INSERT INTO page_stat_data VALUES (1, 1, 1769904000, 1200, 412);
        """
    )
    conn.commit()
    assert source.with_suffix(".sqlite3-wal").exists()

    store = SnapshotStore(tmp_path / "data")
    meta = store.import_file(source, source_kind="upload", source_path="source.sqlite3")
    conn.close()

    imported = sqlite3.connect(meta.path)
    try:
        title = imported.execute("SELECT title FROM book").fetchone()[0]
        duration = imported.execute("SELECT duration FROM page_stat_data").fetchone()[0]
    finally:
        imported.close()

    assert title == "Dune"
    assert duration == 1200


def test_snapshot_store_does_not_record_unsupported_database(tmp_path: Path) -> None:
    source = tmp_path / "bad.sqlite3"
    sqlite3.connect(source).execute("CREATE TABLE nope (id INTEGER)").connection.close()
    store = SnapshotStore(tmp_path / "data")

    with pytest.raises(UnsupportedSchemaError):
        store.import_file(source, source_kind="upload", source_path="bad.sqlite3")

    assert store.list_snapshots() == []
    assert list(store.snapshots_dir.glob("*.sqlite3")) == []


def test_device_status_reports_absent_volume(tmp_path: Path) -> None:
    missing = tmp_path / "KOBOeReader"

    status = device_status(missing)

    assert status["mounted"] is False
    assert status["database_found"] is False
    assert status["selected_path"] is None


def test_import_from_kobo_uses_koreader_settings_database(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    store = SnapshotStore(tmp_path / "data")

    result = import_from_kobo(store, volume)

    assert result["device"]["database_found"] is True
    assert result["snapshot"]["source"] == "kobo"
    assert result["snapshot"]["source_path"] == str(db_path)


def test_import_from_kobo_without_mount_is_clear(tmp_path: Path) -> None:
    with pytest.raises(ImportError, match="not mounted"):
        import_from_kobo(SnapshotStore(tmp_path / "data"), tmp_path / "missing")


def test_auto_import_from_kobo_imports_only_when_database_changes(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")

    first = auto_import_from_kobo(store, volume)
    second = auto_import_from_kobo(store, volume)
    add_reading_row(db_path, book_id=2, title="Kindred", duration=900)
    third = auto_import_from_kobo(store, volume)

    assert first["imported"] is True
    assert first["reason"] == "changed"
    assert first["snapshot"]["source"] == "kobo-auto"
    assert first["snapshot"]["content_hash"]
    assert second["imported"] is False
    assert second["reason"] == "unchanged"
    assert second["snapshot"]["id"] == first["snapshot"]["id"]
    assert third["imported"] is True
    assert third["snapshot"]["id"] != first["snapshot"]["id"]
    assert len(store.list_snapshots()) == 2


def test_auto_import_from_kobo_without_mount_does_not_create_snapshot(tmp_path: Path) -> None:
    store = SnapshotStore(tmp_path / "data")

    result = auto_import_from_kobo(store, tmp_path / "missing")

    assert result["imported"] is False
    assert result["reason"] == "not_mounted"
    assert result["snapshot"] is None
    assert store.list_snapshots() == []


def test_concurrent_auto_import_from_kobo_does_not_duplicate_snapshot(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")
    barrier = threading.Barrier(2)
    results = []
    errors = []

    def run_auto_import() -> None:
        try:
            barrier.wait(timeout=5)
            results.append(auto_import_from_kobo(store, volume))
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=run_auto_import), threading.Thread(target=run_auto_import)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert all(not thread.is_alive() for thread in threads)
    assert errors == []
    assert len(results) == 2
    assert sum(1 for result in results if result["imported"]) == 1
    assert sum(1 for result in results if result["reason"] == "unchanged") == 1
    assert len(store.list_snapshots()) == 1
