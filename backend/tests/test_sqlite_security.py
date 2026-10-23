import sqlite3
from pathlib import Path

import pytest

import backend.app.sqlite_stats as stats
from backend.app.errors import UnsupportedSchemaError
from backend.app.storage import SnapshotStore
from backend.tests.test_storage_device import create_db


def test_readonly_uri_preserves_question_marks_and_hashes(tmp_path: Path):
    path = tmp_path / 'statistics?#.sqlite3'
    create_db(path)
    assert stats.read_user_version(path) == 24
    with stats.open_readonly(path) as conn:
        assert conn.execute('PRAGMA query_only').fetchone()[0] == 1
        assert conn.execute('PRAGMA trusted_schema').fetchone()[0] == 0
        with pytest.raises(sqlite3.OperationalError, match='readonly'):
            conn.execute('CREATE TABLE forbidden (id)')
        with pytest.raises(sqlite3.OperationalError, match='not authorized'):
            conn.execute("SELECT load_extension('anything')")


def test_recursive_view_cannot_exhaust_query_budget(monkeypatch, tmp_path: Path):
    path = tmp_path / 'expensive.sqlite3'
    create_db(path)
    with sqlite3.connect(path) as conn:
        conn.execute('DROP TABLE page_stat_data')
        conn.execute('''CREATE VIEW page_stat AS WITH RECURSIVE
          numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers)
          SELECT 1 AS id_book, x AS page, 1769904000 AS start_time, 10 AS duration FROM numbers''')
    monkeypatch.setattr(stats, 'MAX_SQLITE_STEPS', 20_000)
    store = SnapshotStore(tmp_path / 'data')
    with pytest.raises(UnsupportedSchemaError, match='query budget'):
        store.import_file(path, source_kind='upload')
    assert store.list_snapshots() == []
    assert list(store.snapshots_dir.glob('*.sqlite3')) == []


def test_query_deadline_interrupts_work(monkeypatch, tmp_path: Path):
    path = tmp_path / 'database.sqlite3'
    create_db(path)
    monkeypatch.setattr(stats, 'MAX_SQLITE_SECONDS', -1)
    with pytest.raises(UnsupportedSchemaError, match='query budget'):
        with stats.open_readonly(path) as conn:
            conn.execute('WITH RECURSIVE numbers(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM numbers WHERE x<100000) SELECT sum(x) FROM numbers').fetchone()


def test_oversized_result_is_rejected_without_recording_snapshot(monkeypatch, tmp_path: Path):
    path = tmp_path / 'large.sqlite3'
    create_db(path)
    with sqlite3.connect(path) as conn:
        conn.executemany('INSERT INTO book VALUES (?, ?)', [(i, 'Book') for i in range(3)])
    monkeypatch.setattr(stats, 'MAX_DASHBOARD_ROWS', 2)
    store = SnapshotStore(tmp_path / 'data')
    with pytest.raises(UnsupportedSchemaError, match='row limit'):
        store.import_file(path, source_kind='upload')
    assert store.list_snapshots() == []
    assert list(store.snapshots_dir.glob('*.sqlite3')) == []


def test_broken_view_is_a_controlled_import_failure(tmp_path: Path):
    path = tmp_path / 'broken.sqlite3'
    create_db(path)
    with sqlite3.connect(path) as conn:
        conn.execute('DROP TABLE page_stat_data')
        conn.execute('CREATE VIEW page_stat AS SELECT * FROM missing')
    store = SnapshotStore(tmp_path / 'data')
    with pytest.raises(UnsupportedSchemaError):
        store.import_file(path, source_kind='upload', sidecar_payload=b'{}')
    assert list(store.snapshots_dir.iterdir()) == []


@pytest.mark.parametrize('timestamp,duration', [(float('inf'), 10), (1e300, 10), ('nan', 10), (1769904000, float('inf')), (1769904000, 1e300)])
def test_out_of_range_events_do_not_crash_import(tmp_path: Path, timestamp, duration):
    path = tmp_path / 'numeric.sqlite3'
    create_db(path)
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO book VALUES (1, 'Book')")
        conn.execute('INSERT INTO page_stat_data VALUES (1, 1, ?, ?)', (timestamp, duration))
    snapshot = SnapshotStore(tmp_path / 'data').import_file(path, source_kind='upload')
    assert stats.build_dashboard(Path(snapshot.path))['summary']['total_time_seconds'] == 0


def test_implausible_pagination_cannot_expand_a_huge_page_set(tmp_path: Path):
    path = tmp_path / 'pagination.sqlite3'
    create_db(path)
    with sqlite3.connect(path) as conn:
        conn.execute('ALTER TABLE book ADD COLUMN pages INTEGER')
        conn.execute("INSERT INTO book VALUES (1, 'Book', 1000000000000)")
        conn.execute('INSERT INTO page_stat_data VALUES (1, 1, 1769904000, 60)')
    dashboard = stats.build_dashboard(path)
    assert dashboard['summary']['total_time_seconds'] == 60
    assert dashboard['books'][0]['total_pages'] is None


def test_visit_rows_are_consumed_lazily_and_keep_the_row_limit(monkeypatch):
    consumed = []

    def cursor():
        for value in range(4):
            consumed.append(value)
            yield value

    monkeypatch.setattr(stats, 'MAX_DASHBOARD_ROWS', 2)
    rows = stats.iter_bounded_rows(cursor())
    assert consumed == []
    assert next(rows) == 0
    assert consumed == [0]
    assert next(rows) == 1
    with pytest.raises(UnsupportedSchemaError, match='row limit'):
        next(rows)
    assert consumed == [0, 1, 2]


def test_streamed_visit_limit_rejects_dashboard(monkeypatch, tmp_path):
    path = tmp_path / 'visits.sqlite3'
    create_db(path)
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO book VALUES (1, 'Book')")
        conn.executemany('INSERT INTO page_stat_data VALUES (1, 1, ?, 10)', [(1769904000 + i,) for i in range(3)])
    monkeypatch.setattr(stats, 'MAX_DASHBOARD_ROWS', 2)
    with pytest.raises(UnsupportedSchemaError, match='row limit'):
        stats.build_dashboard(path)
