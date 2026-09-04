from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest

from backend.app.library import partial_md5
from backend.app.sidecars import build_sidecar_snapshot, serialize_sidecar_snapshot
from backend.app.sqlite_stats import aggregate_dashboards, build_dashboard
from backend.app.storage import SnapshotStore
from backend.app.device import auto_import_from_kobo
from backend.tests.test_storage_device import create_db, register_auto_import_device, write_sidecar


def test_inventory_unread_and_add_remove_detection(tmp_path: Path):
    volume = tmp_path / 'device'
    db = volume / '.adds/koreader/settings/statistics.sqlite3'
    create_db(db)
    store = SnapshotStore(tmp_path / 'data')
    register_auto_import_device(store, volume)
    auto_import_from_kobo(store, volume)
    book = volume / 'Never opened.txt'
    book.write_text('Unread content')
    added = auto_import_from_kobo(store, volume)
    assert added['reason'] == 'changed'
    snapshot = store.latest()
    dashboard = build_dashboard(Path(snapshot.path), snapshot)
    assert dashboard['summary']['unread_books'] == 1
    assert dashboard['summary']['total_time_seconds'] == 0
    assert dashboard['summary']['reading_days'] == 0
    assert dashboard['books'][0]['title'] == 'Never opened'
    assert dashboard['books'][0]['last_open'] is None
    assert dashboard['recent_books'] == []
    assert dashboard['charts']['top_books'] == []
    assert auto_import_from_kobo(store, volume)['reason'] == 'unchanged'
    book.unlink()
    assert auto_import_from_kobo(store, volume)['reason'] == 'changed'
    snapshot = store.latest()
    assert build_dashboard(Path(snapshot.path), snapshot)['books'] == []


def test_no_events_is_not_unread_and_sidecar_only_books_are_included(tmp_path: Path):
    volume = tmp_path / 'device'
    db = volume / '.adds/koreader/settings/statistics.sqlite3'
    create_db(db)
    with sqlite3.connect(db) as conn:
        conn.execute("INSERT INTO book VALUES (1, 'No statistics')")
    write_sidecar(volume, status='complete')
    store = SnapshotStore(tmp_path / 'data')
    snapshot = store.import_file(db, source_kind='test', sidecar_payload=serialize_sidecar_snapshot(build_sidecar_snapshot(volume)))
    dashboard = build_dashboard(Path(snapshot.path), snapshot)
    books = {book['title']: book for book in dashboard['books']}
    assert books['No statistics']['status'] is None
    assert books['Test Book']['status'] == 'complete'
    assert dashboard['summary']['unread_books'] == 0
    assert dashboard['summary']['finished_books'] == 1
    assert dashboard['recent_books'] == []


@pytest.mark.parametrize("status", ["reading", "complete", "abandoned"])
def test_reading_on_another_device_overrides_unopened_copy(tmp_path: Path, status: str):
    volume = tmp_path / 'device'
    db = volume / '.adds/koreader/settings/statistics.sqlite3'
    create_db(db)
    book = volume / 'Shared.txt'
    book.write_text('Same content on both devices')
    payload = build_sidecar_snapshot(volume)
    store = SnapshotStore(tmp_path / 'data')
    unread = store.import_file(db, source_kind='test', sidecar_payload=serialize_sidecar_snapshot(payload))
    unread = replace(unread, device_id='unread-device')
    read_payload = {'records': [{'source_path': 'Shared.sdr/metadata.lua', 'title': 'Shared', 'partial_md5_checksum': partial_md5(book), 'status': status}]}
    read = store.import_file(db, source_kind='test', sidecar_payload=serialize_sidecar_snapshot(read_payload))
    read = replace(read, device_id='read-device')
    for snapshots in ([unread, read], [read, unread]):
        dashboard = aggregate_dashboards([build_dashboard(Path(item.path), item) for item in snapshots], snapshots=snapshots)
        assert len(dashboard['books']) == 1
        assert dashboard['books'][0]['status'] == status
        assert dashboard['summary']['unread_books'] == 0


def test_corrupt_sidecar_does_not_imply_unread(tmp_path: Path):
    volume = tmp_path / 'device'
    volume.mkdir()
    (volume / 'Book.txt').write_text('content')
    sidecar = volume / 'Book.sdr/metadata.txt.lua'
    sidecar.parent.mkdir()
    sidecar.write_text('not lua')
    payload = build_sidecar_snapshot(volume)
    assert payload['library'][0]['status'] is None


def test_partial_checksum_matches_koreader_sampling(tmp_path: Path):
    content = bytes(range(251)) * 100
    path = tmp_path / 'book.pdf'
    path.write_bytes(content)
    expected = hashlib.md5(content[:1024] + content[1024:2048] + content[4096:5120] + content[16384:17408]).hexdigest()
    assert partial_md5(path) == expected


def test_epub_metadata_and_hidden_file_exclusion(tmp_path: Path):
    import zipfile
    from backend.app.library import inventory

    epub = tmp_path / 'Filename.epub'
    with zipfile.ZipFile(epub, 'w') as archive:
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf" /></rootfiles></container>')
        archive.writestr('book.opf', '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Actual title</dc:title><dc:creator>Author</dc:creator></metadata></package>')
    hidden = tmp_path / '.kobo'
    hidden.mkdir()
    (hidden / 'Hidden.epub').write_text('excluded')
    records = inventory(tmp_path)
    assert len(records) == 1
    assert records[0]['title'] == 'Actual title'
    assert records[0]['authors'] == 'Author'


@pytest.mark.parametrize('status', ['reading', 'complete', 'abandoned'])
@pytest.mark.parametrize('inventory_path', ['0-copy.epub', 'z-copy.epub'])
def test_local_editions_preserve_sidecar_evidence(tmp_path: Path, status: str, inventory_path: str):
    from backend.tests.test_sqlite_stats import write_sidecar_snapshot

    db = tmp_path / 'statistics.sqlite3'
    create_db(db)
    snapshot = write_sidecar_snapshot(db, [
        {'source_path': 'a.sdr/metadata.epub.lua', 'title': 'Same work', 'authors': 'Author',
         'partial_md5_checksum': 'opened', 'status': status, 'percent_finished': 0.5},
        {'source_path': inventory_path, 'title': 'Same work', 'authors': 'Author',
         'partial_md5_checksum': 'unopened', 'status': 'unread', 'inventory_only': True},
    ])
    dashboard = build_dashboard(db, snapshot)
    assert len(dashboard['books']) == 1
    book = dashboard['books'][0]
    assert book['status'] == status
    assert book['percent_finished'] == 0.5
    assert book['metadata_available'] is True
    assert dashboard['summary']['unread_books'] == 0


def test_aggregate_preserves_last_open_independently_of_status(tmp_path: Path):
    from copy import deepcopy
    from backend.tests.test_sqlite_stats import create_current_db, write_sidecar_snapshot

    db = tmp_path / 'statistics.sqlite3'
    create_current_db(db)
    snapshot = write_sidecar_snapshot(db, [])
    base = build_dashboard(db, snapshot)
    older, newer = deepcopy(base), deepcopy(base)
    older['snapshot']['device_id'] = 'older'
    newer['snapshot']['device_id'] = 'newer'
    for dashboard in (older, newer):
        dashboard['books'] = [dashboard['books'][0]]
    older['books'][0].update(status='complete', status_modified='2026-08-30',
                             last_open='2026-07-01T00:00:00+00:00', progress=100)
    newer['books'][0].update(status='reading', status_modified='2026-06-01',
                             last_open='2026-09-04T00:00:00+00:00', progress=25)
    for dashboards in ([older, newer], [newer, older]):
        merged = aggregate_dashboards(dashboards, snapshots=[snapshot, snapshot])
        book = merged['books'][0]
        assert book['last_open'] == '2026-09-04T00:00:00+00:00'
        assert book['status'] == 'complete'
        assert book['progress'] == 100
        assert book['estimated_remaining_seconds'] is None
        assert merged['recent_books'][0]['last_open'] == book['last_open']


@pytest.mark.parametrize('location', ['local', 'central', 'hash', 'history'])
def test_corrupt_sidecar_only_affects_its_book(tmp_path: Path, location: str):
    affected = tmp_path / 'Affected.txt'
    affected.write_text('affected content')
    (tmp_path / 'Unrelated.txt').write_text('unrelated content')
    checksum = partial_md5(affected)
    paths = {
        'local': tmp_path / 'Affected.sdr/metadata.txt.lua',
        'central': tmp_path / '.adds/koreader/docsettings/mnt/onboard/Affected.sdr/metadata.txt.lua',
        'hash': tmp_path / f'.adds/koreader/hashdocsettings/{checksum[:2]}/{checksum}.sdr/metadata.txt.lua',
        'history': tmp_path / '.adds/koreader/history/[#mnt#onboard#] Affected.txt.lua',
    }
    sidecar = paths[location]
    sidecar.parent.mkdir(parents=True)
    sidecar.write_text('invalid lua')
    payload = build_sidecar_snapshot(tmp_path)
    statuses = {book['title']: book['status'] for book in payload['library']}
    assert statuses == {'Affected': None, 'Unrelated': 'unread'}
    assert payload['malformed_count'] == 1
