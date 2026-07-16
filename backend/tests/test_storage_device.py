from __future__ import annotations

import sqlite3
import threading
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from backend.app import config
from backend.app.devices import DeviceRegistry
from backend.app.device import CandidateStatus, auto_import_from_kobo, device_status, import_from_kobo
from backend.app.errors import ImportError, UnsupportedSchemaError
from backend.app.storage import SnapshotStore, copy_sqlite_database


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


def register_auto_import_device(store: SnapshotStore, volume: Path) -> None:
    DeviceRegistry(store.root).ensure_for_volume(volume)


def write_sidecar(volume: Path, *, status: str, percent: float = 0.5) -> Path:
    path = volume / "books/Test Book.sdr/metadata.epub.lua"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"""
        return {{
            ["doc_path"] = "/mnt/onboard/books/Test Book.epub",
            ["partial_md5_checksum"] = "test-md5",
            ["percent_finished"] = {percent},
            ["summary"] = {{
                ["status"] = "{status}",
                ["modified"] = "2026-06-11",
            }},
            ["stats"] = {{
                ["title"] = "Test Book",
                ["authors"] = "Test Author",
                ["highlights"] = 2,
                ["notes"] = 0,
            }},
        }}
        """,
        encoding="utf-8",
    )
    return path


def write_cover_epub(volume: Path) -> None:
    image = BytesIO()
    Image.new("RGB", (20, 30), "red").save(image, format="PNG")
    path = volume / "books/Test Book.epub"
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="content.opf" /></rootfiles></container>')
        archive.writestr("content.opf", '<package><manifest><item id="cover" href="cover.png" properties="cover-image" /></manifest></package>')
        archive.writestr("cover.png", image.getvalue())


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
    assert status["searched_mount_paths"] == [str(missing)]


def test_device_status_discovers_kobo_on_windows_drive_candidates(monkeypatch, tmp_path: Path) -> None:
    other_drive = tmp_path / "C"
    kobo_drive = tmp_path / "E"
    other_drive.mkdir()
    db_path = kobo_drive / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    monkeypatch.setattr("backend.app.device.kobo_volume_candidates", lambda: [other_drive, kobo_drive])

    status = device_status()

    assert status["mounted"] is True
    assert status["database_found"] is True
    assert status["mount_path"] == str(kobo_drive)
    assert status["selected_path"] == str(db_path)
    assert status["searched_mount_paths"] == [str(other_drive), str(kobo_drive)]


def test_device_status_ignores_errors_from_unselected_scan_roots(monkeypatch, tmp_path: Path) -> None:
    blocked_drive = tmp_path / "C"
    kobo_drive = tmp_path / "E"
    blocked_drive.mkdir()
    db_path = kobo_drive / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    monkeypatch.setattr("backend.app.device.kobo_volume_candidates", lambda: [blocked_drive, kobo_drive])

    def fake_inspect_volume(root: Path) -> tuple[bool, list[CandidateStatus]]:
        if root == blocked_drive:
            return True, [CandidateStatus(str(root / ".adds/koreader/settings/statistics.sqlite3"), True, False, "denied")]
        return True, [CandidateStatus(str(db_path), True, True)]

    monkeypatch.setattr("backend.app.device.inspect_volume", fake_inspect_volume)

    status = device_status()

    assert status["database_found"] is True
    assert status["mount_path"] == str(kobo_drive)
    assert status["permission_error"] is None


def test_kobo_volume_candidates_prefers_configured_path(monkeypatch, tmp_path: Path) -> None:
    configured = tmp_path / "manual-kobo"
    auto_drive = tmp_path / "auto-kobo"
    auto_drive.mkdir()
    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(configured))
    monkeypatch.setattr(config.sys, "platform", "win32")
    monkeypatch.setattr(config, "windows_drive_roots", lambda: [auto_drive])
    monkeypatch.setattr(config, "windows_volume_label", lambda root: "KOBOeReader")

    assert config.kobo_volume_candidates() == [configured]


def test_kobo_volume_candidates_scans_existing_windows_drives(monkeypatch, tmp_path: Path) -> None:
    labeled_drive = tmp_path / "E"
    fallback_drive = tmp_path / "F"
    missing_drive = tmp_path / "G"
    labeled_drive.mkdir()
    fallback_drive.mkdir()
    monkeypatch.delenv("KOSTATS_KOBO_VOLUME", raising=False)
    monkeypatch.setattr(config.sys, "platform", "win32")
    monkeypatch.setattr(config, "windows_drive_roots", lambda: [fallback_drive, missing_drive, labeled_drive])
    monkeypatch.setattr(config, "windows_volume_label", lambda root: "KOBOeReader" if root == labeled_drive else None)

    assert config.kobo_volume_candidates() == [labeled_drive, fallback_drive]


def test_device_status_reports_windows_not_connected(monkeypatch, tmp_path: Path) -> None:
    drive = tmp_path / "C"
    drive.mkdir()
    monkeypatch.setattr("backend.app.device.kobo_volume_candidates", lambda: [drive])

    status = device_status()

    assert status["mounted"] is False
    assert status["database_found"] is False
    assert status["selected_path"] is None
    assert status["searched_mount_paths"] == [str(drive)]


def test_device_status_reports_default_mount_without_database(monkeypatch, tmp_path: Path) -> None:
    mounted_volume = tmp_path / "KOBOeReader"
    mounted_volume.mkdir()
    monkeypatch.setattr("backend.app.device.kobo_volume_candidates", lambda: [mounted_volume])
    monkeypatch.setattr("backend.app.device.kobo_volume_is_configured", lambda: False)
    monkeypatch.setattr("backend.app.device.kobo_volume_is_default_mount_path", lambda root: root == mounted_volume)

    status = device_status()

    assert status["mounted"] is True
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
    register_auto_import_device(store, volume)

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


def test_auto_import_from_kobo_compares_latest_same_device_snapshot(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")
    register_auto_import_device(store, volume)
    first = auto_import_from_kobo(store, volume)

    upload = tmp_path / "tablet.sqlite3"
    create_db(upload)
    add_reading_row(upload, book_id=2, title="Tablet", duration=600)
    store.import_file(
        upload,
        source_kind="upload",
        source_path="tablet.sqlite3",
        device={"id": "tablet", "label": "Tablet", "model": None},
    )
    other_volume = tmp_path / "TravelKOBO"
    other_db = other_volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(other_db)
    add_reading_row(other_db, book_id=3, title="Travel", duration=300)
    register_auto_import_device(store, other_volume)
    other = auto_import_from_kobo(store, other_volume)

    second = auto_import_from_kobo(store, volume)

    assert first["imported"] is True
    assert other["imported"] is True
    assert other["snapshot"]["device_id"] != first["snapshot"]["device_id"]
    assert second["imported"] is False
    assert second["reason"] == "unchanged"
    assert second["snapshot"]["id"] == first["snapshot"]["id"]
    assert len(store.list_snapshots()) == 3


def test_auto_import_from_kobo_continues_legacy_kobo_history(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")
    store.import_file(db_path, source_kind="kobo-auto", source_path=str(db_path))
    add_reading_row(db_path, book_id=2, title="Kindred", duration=900)

    result = auto_import_from_kobo(store, volume)

    assert result["imported"] is True
    assert result["reason"] == "changed"
    assert result["snapshot"]["device_id"] == "primary-kobo"
    assert len(store.list_snapshots()) == 2


def test_auto_import_from_kobo_continues_single_assigned_kobo_history(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")
    assigned = DeviceRegistry(store.root).create_manual("Travel Kobo", source="kobo")
    assert assigned is not None
    import_from_kobo(store, volume, device=assigned)
    add_reading_row(db_path, book_id=2, title="Kindred", duration=900)

    result = auto_import_from_kobo(store, volume)

    assert result["imported"] is True
    assert result["reason"] == "changed"
    assert result["snapshot"]["device_id"] == assigned["id"]
    assert len(store.list_snapshots()) == 2


def test_auto_import_from_kobo_prefers_registered_detected_device_over_single_history(tmp_path: Path) -> None:
    history_volume = tmp_path / "HistoryKOBO"
    history_db = history_volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(history_db)
    add_reading_row(history_db, book_id=1, title="Dune", duration=1200)
    current_volume = tmp_path / "CurrentKOBO"
    current_db = current_volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(current_db)
    add_reading_row(current_db, book_id=2, title="Kindred", duration=900)
    store = SnapshotStore(tmp_path / "data")
    registry = DeviceRegistry(store.root)
    assigned = registry.create_manual("Travel Kobo", source="kobo")
    assert assigned is not None
    import_from_kobo(store, history_volume, device=assigned)
    detected = registry.ensure_for_volume(current_volume)

    result = auto_import_from_kobo(store, current_volume)

    assert result["imported"] is True
    assert result["snapshot"]["device_id"] == detected["id"]
    assert result["snapshot"]["device_id"] != assigned["id"]
    assert len(store.list_snapshots()) == 2


def test_auto_import_from_kobo_detects_sidecar_only_changes(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Test Book", duration=1200)
    sidecar = write_sidecar(volume, status="reading")
    store = SnapshotStore(tmp_path / "data")
    register_auto_import_device(store, volume)

    first = auto_import_from_kobo(store, volume)
    second = auto_import_from_kobo(store, volume)
    sidecar.write_text(sidecar.read_text(encoding="utf-8").replace('"reading"', '"complete"'), encoding="utf-8")
    third = auto_import_from_kobo(store, volume)

    assert first["imported"] is True
    assert second["reason"] == "unchanged"
    assert third["imported"] is True
    assert third["snapshot"]["sidecar_path"]
    assert len(store.list_snapshots()) == 2


def test_manual_and_auto_import_populate_cover_cache(tmp_path: Path) -> None:
    for name, importer in (("manual", import_from_kobo), ("auto", auto_import_from_kobo)):
        volume = tmp_path / name / "KOBOeReader"
        db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
        create_db(db_path)
        add_reading_row(db_path, book_id=1, title="Test Book", duration=1200)
        write_sidecar(volume, status="reading")
        write_cover_epub(volume)
        store = SnapshotStore(tmp_path / name / "data")
        if name == "auto":
            register_auto_import_device(store, volume)

        importer(store, volume)

        manifest = (store.root / "covers/manifest.json").read_text(encoding="utf-8")
        assert "test-md5" in manifest


def test_unchanged_auto_import_repairs_cover_without_snapshot(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Test Book", duration=1200)
    write_sidecar(volume, status="reading")
    store = SnapshotStore(tmp_path / "data")
    register_auto_import_device(store, volume)
    first = auto_import_from_kobo(store, volume)
    write_cover_epub(volume)

    second = auto_import_from_kobo(store, volume)

    assert second["reason"] == "unchanged"
    assert second["snapshot"]["id"] == first["snapshot"]["id"]
    assert len(store.list_snapshots()) == 1
    assert (store.root / "covers/manifest.json").exists()


def test_cover_failure_never_fails_statistics_import(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    monkeypatch.setattr("backend.app.device.populate_cover_cache", lambda *args: (_ for _ in ()).throw(OSError("disk")))

    result = import_from_kobo(SnapshotStore(tmp_path / "data"), volume)

    assert result["snapshot"]["source"] == "kobo"


def test_auto_import_holds_device_lock_while_reading_kobo(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")
    register_auto_import_device(store, volume)
    lock_held = False

    class TrackingLock:
        def __enter__(self) -> None:
            nonlocal lock_held
            lock_held = True

        def __exit__(self, *args: object) -> None:
            nonlocal lock_held
            lock_held = False

    def checked_copy(source: Path, destination: Path) -> None:
        assert lock_held
        copy_sqlite_database(source, destination)

    monkeypatch.setattr("backend.app.device.AUTO_IMPORT_LOCK", TrackingLock())
    monkeypatch.setattr("backend.app.device.copy_sqlite_database", checked_copy)

    auto_import_from_kobo(store, volume)


def test_kobo_snapshots_keep_historical_sidecar_state(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    sidecar = write_sidecar(volume, status="reading", percent=0.25)
    store = SnapshotStore(tmp_path / "data")

    first = import_from_kobo(store, volume)["snapshot"]
    sidecar.write_text(sidecar.read_text(encoding="utf-8").replace('"reading"', '"complete"'), encoding="utf-8")

    stored_payload = Path(first["sidecar_path"]).read_text(encoding="utf-8")
    assert '"status": "reading"' in stored_payload
    assert '"status": "complete"' not in stored_payload


def test_auto_import_from_kobo_without_mount_does_not_create_snapshot(tmp_path: Path) -> None:
    store = SnapshotStore(tmp_path / "data")

    result = auto_import_from_kobo(store, tmp_path / "missing")

    assert result["imported"] is False
    assert result["reason"] == "not_mounted"
    assert result["snapshot"] is None
    assert store.list_snapshots() == []


def test_auto_import_from_unknown_device_waits_for_manual_assignment(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")

    result = auto_import_from_kobo(store, volume)

    assert result["imported"] is False
    assert result["reason"] == "device_unassigned"
    assert store.list_snapshots() == []


def test_concurrent_auto_import_from_kobo_does_not_duplicate_snapshot(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    db_path = volume / ".adds/koreader/settings/statistics.sqlite3"
    create_db(db_path)
    add_reading_row(db_path, book_id=1, title="Dune", duration=1200)
    store = SnapshotStore(tmp_path / "data")
    register_auto_import_device(store, volume)
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
