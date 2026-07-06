from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

import backend.app.main as main_module
from backend.app.backups import partial_md5
from backend.app.devices import DeviceRegistry
from backend.app.main import app
from backend.app.sqlite_stats import build_dashboard
from backend.app.storage import SnapshotStore


def create_api_fixture(
    path: Path,
    *,
    title: str = "Kindred",
    authors: str = "Octavia E. Butler",
    start_time: int = 1769904000,
    duration: int = 1200,
    md5: str | None = None,
) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE book (
            id INTEGER PRIMARY KEY,
            title TEXT,
            authors TEXT,
            last_open INTEGER,
            pages INTEGER,
            md5 TEXT
        );
        CREATE TABLE page_stat (
            id_book INTEGER,
            page INTEGER NOT NULL,
            start_time INTEGER NOT NULL,
            period INTEGER NOT NULL
        );
        """
    )
    conn.execute("INSERT INTO book VALUES (1, ?, ?, ?, 288, ?)", (title, authors, start_time, md5))
    conn.execute("INSERT INTO page_stat VALUES (1, 1, ?, ?)", (start_time, duration))
    conn.commit()
    conn.close()


def write_kobo_identity(volume: Path, *, model: str, device_id: str) -> None:
    koreader = volume / ".adds/koreader"
    koreader.mkdir(parents=True, exist_ok=True)
    (koreader / "settings.reader.lua").write_text(
        f'return {{ ["device_model"] = "{model}", ["device_id"] = "{device_id}" }}\n',
        encoding="utf-8",
    )


def test_empty_dashboard_without_snapshot(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    client = TestClient(app)

    response = client.get("/api/dashboard")

    assert response.status_code == 200
    assert response.json()["has_data"] is False
    assert response.json()["books"] == []


def test_upload_import_and_dashboard(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    client = TestClient(app)

    response = client.post(
        "/api/import/upload",
        files={"file": ("statistics.sqlite3", source.read_bytes(), "application/octet-stream")},
        data={"new_device_label": "Primary Kobo"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["snapshot"]["source"] == "upload"
    assert payload["dashboard"]["summary"]["total_time_label"] == "20m"

    dashboard = client.get("/api/dashboard").json()
    assert dashboard["books"][0]["title"] == "Kindred"
    assert dashboard["recent_books"][0]["title"] == "Kindred"


def test_dashboard_endpoint_reuses_cached_snapshot_summary(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    SnapshotStore(data_root).import_file(
        source,
        source_kind="upload",
        source_path="statistics.sqlite3",
        device={"id": "device-a", "label": "Desk Kobo", "model": None},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    main_module.cached_dashboard.cache_clear()
    calls = 0

    def counted_build_dashboard(*args, **kwargs):
        nonlocal calls
        calls += 1
        return build_dashboard(*args, **kwargs)

    monkeypatch.setattr(main_module, "build_dashboard", counted_build_dashboard)
    client = TestClient(app)

    first = client.get("/api/dashboard")
    second = client.get("/api/dashboard")

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls == 1


def test_dashboard_cache_misses_when_snapshot_file_changes(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source, title="Kindred")
    snapshot = SnapshotStore(data_root).import_file(
        source,
        source_kind="upload",
        source_path="statistics.sqlite3",
        device={"id": "device-a", "label": "Desk Kobo", "model": None},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    main_module.cached_dashboard.cache_clear()
    client = TestClient(app)

    first = client.get("/api/dashboard", params={"snapshot_id": snapshot.id})
    Path(snapshot.path).unlink()
    create_api_fixture(Path(snapshot.path), title="Parable")
    second = client.get("/api/dashboard", params={"snapshot_id": snapshot.id})

    assert first.status_code == 200
    assert first.json()["books"][0]["title"] == "Kindred"
    assert second.status_code == 200
    assert second.json()["books"][0]["title"] == "Parable"


def test_dashboard_cache_does_not_hide_deleted_snapshot_file(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    snapshot = SnapshotStore(data_root).import_file(
        source,
        source_kind="upload",
        source_path="statistics.sqlite3",
        device={"id": "device-a", "label": "Desk Kobo", "model": None},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    main_module.cached_dashboard.cache_clear()
    client = TestClient(app)

    first = client.get("/api/dashboard", params={"snapshot_id": snapshot.id})
    Path(snapshot.path).unlink()
    second = client.get("/api/dashboard", params={"snapshot_id": snapshot.id})

    assert first.status_code == 200
    assert first.json()["books"][0]["title"] == "Kindred"
    assert second.status_code == 404
    assert second.json()["detail"] == f"Snapshot file is missing: {snapshot.id}"


def test_dashboard_cache_misses_when_current_local_date_changes(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source = tmp_path / "statistics.sqlite3"
    read_at = int(datetime(2026, 6, 3, 12, tzinfo=timezone.utc).timestamp())
    create_api_fixture(source, start_time=read_at)
    snapshot = SnapshotStore(data_root).import_file(
        source,
        source_kind="upload",
        source_path="statistics.sqlite3",
        device={"id": "device-a", "label": "Desk Kobo", "model": None},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    main_module.cached_dashboard.cache_clear()
    client = TestClient(app)

    monkeypatch.setattr(main_module, "current_local_date", lambda: "2026-06-04")
    first = client.get("/api/dashboard", params={"snapshot_id": snapshot.id})
    monkeypatch.setattr(main_module, "current_local_date", lambda: "2026-06-05")
    second = client.get("/api/dashboard", params={"snapshot_id": snapshot.id})

    assert first.status_code == 200
    assert first.json()["summary"]["current_streak"] == 1
    assert second.status_code == 200
    assert second.json()["summary"]["current_streak"] == 0


def test_upload_requires_device_assignment(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    client = TestClient(app)

    response = client.post(
        "/api/import/upload",
        files={"file": ("statistics.sqlite3", source.read_bytes(), "application/octet-stream")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Choose an existing device or enter a device name before uploading."
    assert client.get("/api/snapshots").json() == {"snapshots": []}


def test_upload_can_create_named_device(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    client = TestClient(app)

    response = client.post(
        "/api/import/upload",
        files={"file": ("statistics.sqlite3", source.read_bytes(), "application/octet-stream")},
        data={"new_device_label": "Travel Kobo"},
    )

    assert response.status_code == 200
    assert response.json()["snapshot"]["device_label"] == "Travel Kobo"
    assert client.get("/api/devices").json()["devices"][0]["label"] == "Travel Kobo"


def test_new_device_label_matching_existing_device_reuses_it(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    client = TestClient(app)
    first = client.post(
        "/api/import/upload",
        files={"file": ("first.sqlite3", source.read_bytes(), "application/octet-stream")},
        data={"new_device_label": "Travel Kobo"},
    )

    second = client.post(
        "/api/import/upload",
        files={"file": ("second.sqlite3", source.read_bytes(), "application/octet-stream")},
        data={"new_device_label": " travel   kobo "},
    )

    assert second.status_code == 200
    assert second.json()["snapshot"]["device_id"] == first.json()["snapshot"]["device_id"]
    assert len(client.get("/api/devices").json()["devices"]) == 1


def test_new_device_label_matching_synthetic_device_reuses_it(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    SnapshotStore(data_root).import_file(source, source_kind="kobo", source_path="legacy.sqlite3")
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    response = client.post(
        "/api/import/upload",
        files={"file": ("statistics.sqlite3", source.read_bytes(), "application/octet-stream")},
        data={"new_device_label": " primary   kobo "},
    )

    assert response.status_code == 200
    assert response.json()["snapshot"]["device_id"] == "primary-kobo"
    assert len(client.get("/api/devices").json()["devices"]) == 1


def test_upload_rejects_unsupported_sqlite_without_snapshot(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path / "data"))
    source = tmp_path / "not-koreader.sqlite3"
    sqlite3.connect(source).execute("CREATE TABLE nope (id INTEGER)").connection.close()
    client = TestClient(app)

    response = client.post(
        "/api/import/upload",
        files={"file": ("not-koreader.sqlite3", source.read_bytes(), "application/octet-stream")},
        data={"new_device_label": "Primary Kobo"},
    )

    assert response.status_code == 422
    assert client.get("/api/snapshots").json() == {"snapshots": []}


def test_auto_kobo_import_endpoint_skips_unchanged_database(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    volume = tmp_path / "KOBOeReader"
    source = volume / ".adds/koreader/settings/statistics.sqlite3"
    source.parent.mkdir(parents=True, exist_ok=True)
    create_api_fixture(source)
    write_kobo_identity(volume, model="Kobo Clara", device_id="clara-a")
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(volume))
    DeviceRegistry(data_root).ensure_for_volume(volume)
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


def test_devices_and_dashboard_can_filter_multiple_kobos(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    first_volume = tmp_path / "KOBO-A"
    first_source = first_volume / ".adds/koreader/settings/statistics.sqlite3"
    first_source.parent.mkdir(parents=True, exist_ok=True)
    create_api_fixture(first_source, title="Kindred", duration=1200)
    write_kobo_identity(first_volume, model="Kobo Clara", device_id="clara-a")

    second_volume = tmp_path / "KOBO-B"
    second_source = second_volume / ".adds/koreader/settings/statistics.sqlite3"
    second_source.parent.mkdir(parents=True, exist_ok=True)
    create_api_fixture(second_source, title="Parable", duration=1800)
    write_kobo_identity(second_volume, model="Kobo Libra", device_id="libra-b")

    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(first_volume))
    client = TestClient(app)

    first = client.post("/api/import/kobo")
    assert first.status_code == 200
    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(second_volume))
    second = client.post("/api/import/kobo")
    assert second.status_code == 200

    devices = client.get("/api/devices").json()["devices"]
    assert {device["label"] for device in devices} == {"Kobo Clara", "Kobo Libra"}
    first_device = next(device for device in devices if device["label"] == "Kobo Clara")
    second_device = next(device for device in devices if device["label"] == "Kobo Libra")

    aggregate = client.get("/api/dashboard").json()
    assert aggregate["summary"]["total_time_label"] == "50m"
    assert {book["title"] for book in aggregate["books"]} == {"Kindred", "Parable"}
    assert aggregate["charts"]["devices"] == [
        {"id": first_device["id"], "label": "Kobo Clara"},
        {"id": second_device["id"], "label": "Kobo Libra"},
    ]
    assert aggregate["charts"]["monthly_by_device"][0][first_device["id"]] == 0.33
    assert aggregate["charts"]["monthly_by_device"][0][second_device["id"]] == 0.5

    renamed = client.patch(f"/api/devices/{first_device['id']}", json={"label": "Desk Kobo"})
    assert renamed.status_code == 200
    renamed_aggregate = client.get("/api/dashboard").json()
    assert {"id": first_device["id"], "label": "Desk Kobo"} in renamed_aggregate["charts"]["devices"]
    assert {"id": first_device["id"], "label": "Kobo Clara"} not in renamed_aggregate["charts"]["devices"]

    filtered = client.get(f"/api/dashboard?device_id={first_device['id']}").json()
    assert filtered["summary"]["total_time_label"] == "20m"
    assert [book["title"] for book in filtered["books"]] == ["Kindred"]
    assert len(client.get(f"/api/snapshots?device_id={first_device['id']}").json()["snapshots"]) == 1


def test_aggregate_books_merge_different_md5_versions_by_identity(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    first_source = tmp_path / "first.sqlite3"
    create_api_fixture(first_source, title="Kindred", duration=1200, md5="first-version")
    second_source = tmp_path / "second.sqlite3"
    create_api_fixture(second_source, title="Kindred", duration=1800, md5="second-version")
    SnapshotStore(data_root).import_file(
        first_source,
        source_kind="kobo",
        source_path="first.sqlite3",
        device={"id": "device-a", "label": "Kobo A", "model": None},
    )
    SnapshotStore(data_root).import_file(
        second_source,
        source_kind="kobo",
        source_path="second.sqlite3",
        device={"id": "device-b", "label": "Kobo B", "model": None},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    dashboard = client.get("/api/dashboard").json()

    assert dashboard["summary"]["total_time_label"] == "50m"
    assert len(dashboard["books"]) == 1
    assert dashboard["books"][0]["title"] == "Kindred"
    assert dashboard["books"][0]["source_md5s"] == ["first-version", "second-version"]
    assert dashboard["books"][0]["merged_count"] == 2
    assert not {
        "_aggregate_device_id",
        "title_key",
        "authors_key",
        "series_key",
        "language_key",
    } & set(dashboard["books"][0])


def test_aggregate_device_charts_merge_duplicate_labels(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    first_source = tmp_path / "first.sqlite3"
    create_api_fixture(first_source, title="Kindred", duration=1200)
    second_source = tmp_path / "second.sqlite3"
    create_api_fixture(second_source, title="Parable", duration=1800)
    SnapshotStore(data_root).import_file(
        first_source,
        source_kind="upload",
        source_path="first.sqlite3",
        device={"id": "device-a", "label": "Travel Kobo", "model": None},
    )
    SnapshotStore(data_root).import_file(
        second_source,
        source_kind="upload",
        source_path="second.sqlite3",
        device={"id": "device-b", "label": " travel   kobo ", "model": None},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    dashboard = client.get("/api/dashboard").json()

    assert dashboard["summary"]["total_time_label"] == "30m"
    assert [book["title"] for book in dashboard["books"]] == ["Parable"]
    assert dashboard["snapshot"]["device_label"] == "Travel Kobo"


def test_aggregate_device_charts_merge_historical_ids_by_manual_label(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    first_source = tmp_path / "first.sqlite3"
    create_api_fixture(first_source, title="Kindred", duration=1200)
    second_source = tmp_path / "second.sqlite3"
    create_api_fixture(second_source, title="Parable", duration=1800)
    SnapshotStore(data_root).import_file(first_source, source_kind="kobo", source_path="first.sqlite3")
    SnapshotStore(data_root).import_file(second_source, source_kind="upload", source_path="second.sqlite3")
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    dashboard = client.get("/api/dashboard").json()

    assert dashboard["charts"]["devices"] == [
        {"id": "primary-kobo", "label": "Primary Kobo"},
        {"id": "uploaded-databases", "label": "Uploaded databases"},
    ]

    assert client.patch("/api/devices/primary-kobo", json={"label": "Travel Kobo"}).status_code == 200
    assert client.patch("/api/devices/uploaded-databases", json={"label": "Travel Kobo"}).status_code == 200
    dashboard = client.get("/api/dashboard").json()

    assert dashboard["summary"]["total_time_label"] == "30m"
    assert [book["title"] for book in dashboard["books"]] == ["Parable"]
    assert dashboard["snapshot"]["device_label"] == "Travel Kobo"


def test_devices_filter_merges_manual_label_and_keeps_tablet_separate(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    first_kobo = tmp_path / "first-kobo.sqlite3"
    create_api_fixture(first_kobo, title="Kindred", duration=1200)
    second_kobo = tmp_path / "second-kobo.sqlite3"
    create_api_fixture(second_kobo, title="Parable", duration=1800)
    tablet = tmp_path / "tablet.sqlite3"
    create_api_fixture(tablet, title="Tablet Book", duration=600)
    SnapshotStore(data_root).import_file(
        first_kobo,
        source_kind="kobo",
        source_path="first-kobo.sqlite3",
        device={"id": "kobo-a", "label": "Kobo Libra Color", "model": None},
    )
    SnapshotStore(data_root).import_file(
        second_kobo,
        source_kind="kobo",
        source_path="second-kobo.sqlite3",
        device={"id": "kobo-b", "label": "Kobo Libra Color", "model": None},
    )
    SnapshotStore(data_root).import_file(
        tablet,
        source_kind="upload",
        source_path="tablet.sqlite3",
        device={"id": "tablet", "label": "Tablet", "model": None},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    devices = client.get("/api/devices").json()["devices"]
    assert [(device["label"], device["snapshot_count"]) for device in devices] == [
        ("Kobo Libra Color", 2),
        ("Tablet", 1),
    ]
    kobo_id = devices[0]["id"]
    tablet_id = devices[1]["id"]

    kobo_snapshots = client.get(f"/api/snapshots?device_id={kobo_id}").json()["snapshots"]
    assert {snapshot["device_label"] for snapshot in kobo_snapshots} == {"Kobo Libra Color"}
    assert len(kobo_snapshots) == 2
    tablet_snapshots = client.get(f"/api/snapshots?device_id={tablet_id}").json()["snapshots"]
    assert [snapshot["device_label"] for snapshot in tablet_snapshots] == ["Tablet"]

    dashboard = client.get(f"/api/dashboard?device_id={kobo_id}").json()
    assert dashboard["summary"]["total_time_label"] == "30m"
    assert [book["title"] for book in dashboard["books"]] == ["Parable"]

    renamed = client.patch(f"/api/devices/{kobo_id}", json={"label": "Reading Kobo"})
    assert renamed.status_code == 200
    renamed_devices = client.get("/api/devices").json()["devices"]
    assert [(device["label"], device["snapshot_count"]) for device in renamed_devices] == [
        ("Reading Kobo", 2),
        ("Tablet", 1),
    ]


def test_auto_detected_same_model_devices_do_not_merge_by_label(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    first_source = tmp_path / "first-kobo.sqlite3"
    create_api_fixture(first_source, title="Kindred", duration=1200)
    second_source = tmp_path / "second-kobo.sqlite3"
    create_api_fixture(second_source, title="Parable", duration=1800)
    SnapshotStore(data_root).import_file(
        first_source,
        source_kind="kobo",
        source_path="first-kobo.sqlite3",
        device={"id": "kobo-a", "label": "Kobo Libra Color", "model": "Kobo Libra Color"},
    )
    SnapshotStore(data_root).import_file(
        second_source,
        source_kind="kobo",
        source_path="second-kobo.sqlite3",
        device={"id": "kobo-b", "label": "Kobo Libra Color", "model": "Kobo Libra Color"},
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    devices = client.get("/api/devices").json()["devices"]
    assert [(device["id"], device["label"], device["snapshot_count"]) for device in devices] == [
        ("kobo-a", "Kobo Libra Color", 1),
        ("kobo-b", "Kobo Libra Color", 1),
    ]
    dashboard = client.get("/api/dashboard").json()
    assert dashboard["summary"]["total_time_label"] == "50m"
    assert len(dashboard["charts"]["devices"]) == 2


def test_dashboard_charts_merge_legacy_kobo_rows_with_manual_label(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    legacy_kobo = tmp_path / "legacy-kobo.sqlite3"
    create_api_fixture(legacy_kobo, title="Kindred", duration=1200)
    detected_kobo = tmp_path / "detected-kobo.sqlite3"
    create_api_fixture(detected_kobo, title="Parable", duration=1800)
    tablet = tmp_path / "tablet.sqlite3"
    create_api_fixture(tablet, title="Tablet Book", duration=600)
    store = SnapshotStore(data_root)
    legacy = store.import_file(legacy_kobo, source_kind="kobo", source_path="legacy-kobo.sqlite3")
    store.import_file(
        detected_kobo,
        source_kind="kobo",
        source_path="detected-kobo.sqlite3",
        device={"id": "kobo-detected", "label": "Kobo Libra Color", "model": None},
    )
    store.import_file(
        tablet,
        source_kind="upload",
        source_path="tablet.sqlite3",
        device={"id": "tablet", "label": "Tablet", "model": None},
    )
    manifest = store.load_manifest()
    legacy_row = next(row for row in manifest["snapshots"] if row["id"] == legacy.id)
    legacy_row["device_id"] = None
    legacy_row["device_label"] = None
    legacy_row["device_model"] = None
    store.save_manifest(manifest)
    DeviceRegistry(data_root).upsert(
        device_id="primary-kobo",
        label="Kobo Libra Color",
        model=None,
        koreader_version=None,
        source="legacy",
        label_source="manual",
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    dashboard = client.get("/api/dashboard").json()

    assert [device["label"] for device in dashboard["charts"]["devices"]] == ["Kobo Libra Color", "Tablet"]
    kobo_key = next(device["id"] for device in dashboard["charts"]["devices"] if device["label"] == "Kobo Libra Color")
    tablet_key = next(device["id"] for device in dashboard["charts"]["devices"] if device["label"] == "Tablet")
    assert dashboard["charts"]["monthly_by_device"][0][kobo_key] == 0.5
    assert dashboard["charts"]["monthly_by_device"][0][tablet_key] == 0.17


def test_legacy_synthetic_device_can_be_renamed(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    SnapshotStore(data_root).import_file(source, source_kind="kobo", source_path="legacy.sqlite3")
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)

    assert client.get("/api/devices").json()["devices"][0]["label"] == "Primary Kobo"
    renamed = client.patch("/api/devices/primary-kobo", json={"label": "Travel Kobo"})

    assert renamed.status_code == 200
    assert client.get("/api/devices").json()["devices"][0]["label"] == "Travel Kobo"
    assert client.get("/api/snapshots").json()["snapshots"][0]["device_label"] == "Travel Kobo"


def test_snapshot_device_can_be_reassigned(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source = tmp_path / "statistics.sqlite3"
    create_api_fixture(source)
    snapshot = SnapshotStore(data_root).import_file(source, source_kind="upload", source_path="source.sqlite3")
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    client = TestClient(app)
    created = client.post("/api/import/upload", files={"file": ("copy.sqlite3", source.read_bytes(), "application/octet-stream")}, data={"new_device_label": "Desk Kobo"})
    device_id = created.json()["snapshot"]["device_id"]

    reassigned = client.patch(f"/api/snapshots/{snapshot.id}/device", json={"device_id": device_id})

    assert reassigned.status_code == 200
    assert reassigned.json()["snapshot"]["device_label"] == "Desk Kobo"


def test_recovery_backup_preview_and_restore_endpoints(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    volume = tmp_path / "KOBOeReader"
    koreader = volume / ".adds/koreader"
    settings = koreader / "settings"
    settings.mkdir(parents=True)
    create_api_fixture(settings / "statistics.sqlite3")
    create_api_fixture(settings / "vocabulary_builder.sqlite3")
    write_kobo_identity(volume, model="Kobo Clara", device_id="clara-a")
    (koreader / "settings.reader.lua").write_text(
        'return { ["document_metadata_folder"] = "doc", ["device_model"] = "Kobo Clara", ["device_id"] = "clara-a" }\n',
        encoding="utf-8",
    )
    book = volume / "Books/Kindred.epub"
    book.parent.mkdir()
    book.write_bytes(b"x" * 2048 + b"kindred")
    sidecar = volume / "Books/Kindred.sdr/metadata.epub.lua"
    sidecar.parent.mkdir()
    sidecar.write_text(
        f"""
        return {{
            ["doc_path"] = "/mnt/onboard/Books/Kindred.epub",
            ["partial_md5_checksum"] = "{partial_md5(book)}",
            ["doc_props"] = {{ ["title"] = "Kindred", ["authors"] = "Octavia Butler" }},
        }}
        """,
        encoding="utf-8",
    )
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(volume))
    client = TestClient(app)

    created = client.post("/api/backups/kobo")
    assert created.status_code == 200
    backup_id = created.json()["backup"]["id"]
    device_id = created.json()["backup"]["device_id"]
    assert client.get("/api/backups").json()["backups"][0]["id"] == backup_id

    renamed = client.patch(f"/api/devices/{device_id}", json={"label": "Bedside Kobo"})
    assert renamed.status_code == 200
    assert client.get("/api/backups").json()["backups"][0]["device_label"] == "Bedside Kobo"

    preview = client.get(f"/api/backups/{backup_id}/restore-preview")
    assert preview.status_code == 200
    assert len(preview.json()["exact_matches"]) == 1

    unconfirmed = client.post(
        f"/api/backups/{backup_id}/restore",
        json={"confirmed": False, "restore_optional_extensions": False},
    )
    assert unconfirmed.status_code == 409

    restored = client.post(
        f"/api/backups/{backup_id}/restore",
        json={"confirmed": True, "restore_optional_extensions": False},
    )
    assert restored.status_code == 200
    assert restored.json()["restored"]["sidecars"] == 1
    assert restored.json()["safety_backup_id"]


def test_restore_preview_warns_when_backup_device_differs(monkeypatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    source_volume = tmp_path / "KOBO-A"
    source_settings = source_volume / ".adds/koreader/settings"
    source_settings.mkdir(parents=True)
    create_api_fixture(source_settings / "statistics.sqlite3")
    write_kobo_identity(source_volume, model="Kobo Clara", device_id="clara-a")

    target_volume = tmp_path / "KOBO-B"
    target_settings = target_volume / ".adds/koreader/settings"
    target_settings.mkdir(parents=True)
    create_api_fixture(target_settings / "statistics.sqlite3")
    write_kobo_identity(target_volume, model="Kobo Libra", device_id="libra-b")

    monkeypatch.setenv("KOSTATS_DATA_DIR", str(data_root))
    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(source_volume))
    client = TestClient(app)
    created = client.post("/api/backups/kobo")
    assert created.status_code == 200
    backup_id = created.json()["backup"]["id"]

    monkeypatch.setenv("KOSTATS_KOBO_VOLUME", str(target_volume))
    preview = client.get(f"/api/backups/{backup_id}/restore-preview")

    assert preview.status_code == 200
    assert preview.json()["device_warning"] is True
