from contextlib import closing
from pathlib import Path
import json
import sqlite3

import pytest

from backend.app.sqlite_stats import SnapshotMeta, aggregate_dashboards, build_dashboard


def reading_db(path: Path, visits: list[tuple], total=100):
    with closing(sqlite3.connect(path)) as conn:
        conn.executescript('''
            CREATE TABLE book (id INTEGER PRIMARY KEY, title TEXT, authors TEXT, last_open INTEGER, pages INTEGER);
            CREATE TABLE page_stat_data (id_book INTEGER, page INTEGER, start_time INTEGER, duration INTEGER, total_pages INTEGER);
        ''')
        conn.executemany('INSERT INTO book VALUES (?, ?, ?, ?, ?)', [
            (1, 'Book One', 'Author', 1767261600, total), (2, 'Book Two', 'Author', 1767261600, total),
        ])
        conn.executemany('INSERT INTO page_stat_data VALUES (?, ?, 1767261600 + ?, ?, ?)', visits)
        conn.commit()


def first_book(dashboard):
    return next(book for book in dashboard['books'] if book['title'] == 'Book One')


def test_weighted_session_pace_uses_coverage_not_jump_distance(tmp_path):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, 20, 0, 30, 100), (1, 21, 30, 30, 100), (1, 80, 2000, 120, 100)])
    d = build_dashboard(path)
    b = first_book(d)
    assert b['reading_coverage_percent'] == pytest.approx(3)
    assert b['pace_seconds_per_percent'] == pytest.approx(60)
    assert b['estimated_remaining_seconds'] == 1200
    assert [s['coverage_percent'] for s in b['recent_sessions']] == pytest.approx([1, 2])
    assert [s['active_seconds'] for s in b['recent_sessions']] == [120, 60]
    assert sum(point['pages'] for point in d['charts']['daily']) == pytest.approx(3)
    assert sum(point['pages'] for point in d['charts']['monthly']) == pytest.approx(3)


def test_saved_position_controls_remaining_percent(tmp_path):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, 80, 0, 60, 100)])
    sidecars = tmp_path / 'sidecars.json'
    sidecars.write_text(json.dumps({'records': [{'title': 'Book One', 'authors': 'Author',
        'percent_finished': .4, 'status': 'reading'}]}))
    snapshot = SnapshotMeta('one', '', 'upload', None, str(path), 1, 0, '0', sidecar_path=str(sidecars))
    b = first_book(build_dashboard(path, snapshot))
    assert b['progress'] == 40
    assert b['max_page'] == 40
    assert b['estimated_remaining_seconds'] == 3600


def test_reflow_and_repeated_visits_do_not_double_count_session_coverage(tmp_path):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, 1, 0, 30, 100), (1, 1, 30, 30, 200), (1, 2, 60, 30, 200)], total=200)
    b = first_book(build_dashboard(path))
    assert b['pages'] == 2
    assert b['reading_coverage_percent'] == pytest.approx(1)
    assert b['pace_seconds_per_percent'] == pytest.approx(90)
    assert b['recent_sessions'][0]['pages'] == 2
    assert b['recent_sessions'][0]['coverage_percent'] == pytest.approx(1)


def test_rereading_in_another_session_contributes_another_pace_sample(tmp_path):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, 80, 0, 30, 100), (1, 2, 2000, 60, 100), (1, 2, 4000, 90, 100)])
    b = first_book(build_dashboard(path))
    assert b['pages'] == 2
    assert b['max_page'] == 2  # latest observed position, not the furthest jump
    assert b['reading_coverage_percent'] == pytest.approx(3)
    assert b['pace_seconds_per_percent'] == pytest.approx(60)
    assert b['estimated_remaining_seconds'] == 5880


def test_book_sessions_exclude_time_and_gaps_in_other_books(tmp_path):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, 10, 0, 60, 100), (2, 40, 60, 120, 100)])
    d = build_dashboard(path)
    sitting = d['insights']['sessions']['recent'][0]
    assert sitting['active_seconds'] == 180
    assert sitting['coverage_percent'] is None  # percentages of different books aren't additive
    assert sitting['pages'] == 2
    b = first_book(d)
    assert b['recent_sessions'][0]['active_seconds'] == 60
    assert b['recent_sessions'][0]['elapsed_seconds'] == 60
    assert b['recent_sessions'][0]['coverage_percent'] == pytest.approx(1)


def test_unknown_coverage_preserves_time_without_inventing_pace(tmp_path):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, None, 0, 60, 100), (1, 10, 60, 60, 100)])
    b = first_book(build_dashboard(path))
    assert b['time_seconds'] == 120
    assert b['recent_sessions'][0]['coverage_percent'] is None
    assert b['recent_sessions'][0]['pages'] is None
    assert b['pace_seconds_per_percent'] is None
    assert b['estimated_remaining_seconds'] is None


def test_multidevice_pace_and_sessions_use_consistent_book_pagination(tmp_path):
    dashboards = []
    snapshots = []
    for device, total, page, duration in [('one', 100, 20, 30), ('two', 200, 80, 60)]:
        path = tmp_path / f'{device}.sqlite3'
        reading_db(path, [(1, page, 2000 if device == "two" else 0, duration, total)], total=total)
        snapshot = SnapshotMeta(device, device, 'upload', None, str(path), 1, 0, '0',
            device_id=device, device_label=device)
        snapshots.append(snapshot)
        dashboards.append(build_dashboard(path, snapshot, include_all_sessions=True))
    d = aggregate_dashboards(dashboards, snapshots=snapshots)
    b = first_book(d)
    assert b['total_pages'] == 200
    assert b['pace_seconds_per_percent'] == pytest.approx(60)  # 90 seconds / 1.5 percentage points
    assert b['estimated_remaining_seconds'] == 3600
    assert sorted(s['pages'] for s in b['recent_sessions']) == [1, 2]
    assert sum(point['pages'] for point in d['charts']['daily']) == 3
    assert b['recent_activity'][-1]['pages'] == 3
    assert all(s['book_ids'] == [b['id']] for s in b['recent_sessions'])
    assert not any(key.startswith('_') for key in b)


@pytest.mark.parametrize('total', [None, 0, -1, 'unknown'])
def test_missing_event_pagination_does_not_assume_current_layout(tmp_path, total):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, 10, 0, 60, total)])
    b = first_book(build_dashboard(path))
    assert b['time_seconds'] == 60
    assert b['estimated_remaining_seconds'] is None
    assert b['recent_sessions'][0]['coverage_percent'] is None


def test_invalid_catalog_total_falls_back_to_valid_event_total(tmp_path):
    path = tmp_path / 'stats.sqlite3'
    reading_db(path, [(1, 10, 0, 60, 100)], total='unknown')
    b = first_book(build_dashboard(path))
    assert b['total_pages'] == 100
    assert b['estimated_remaining_seconds'] == 5400
