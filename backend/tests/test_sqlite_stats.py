from __future__ import annotations

import sqlite3
import json
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

from backend.app.errors import UnsupportedSchemaError
from backend.app.sqlite_stats import SnapshotMeta, aggregate_dashboards, build_dashboard, current_streak


def ts(year: int, month: int, day: int, hour: int = 12) -> int:
    return int(datetime(year, month, day, hour).timestamp())


def create_current_db(path: Path) -> None:
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
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        INSERT INTO book VALUES
            (1, 'A Wizard of Earthsea', 'Ursula K. Le Guin', 1770000000, 180),
            (2, 'The Left Hand of Darkness', 'Ursula K. Le Guin', 1770086400, 240);
        INSERT INTO page_stat_data VALUES
            (1, 1, 1769904000, 1800, 180),
            (1, 2, 1769990400, 1200, 180),
            (2, 20, 1769994000, 3600, 240),
            (2, 21, 1770080400, 600, 240);
        """
    )
    conn.commit()
    conn.close()


def create_session_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE book (id INTEGER PRIMARY KEY, title TEXT, authors TEXT, last_open INTEGER, pages INTEGER);
        CREATE TABLE page_stat_data (id_book INTEGER, page INTEGER, start_time INTEGER, duration INTEGER, total_pages INTEGER);
        INSERT INTO book VALUES (1, 'Session One', 'Author', 1767261600, 100);
        INSERT INTO book VALUES (2, 'Session Two', 'Author', 1767261600, 100);
        INSERT INTO page_stat_data VALUES
            (1, 1, 1767261600, 2700, 100),
            (2, 1, 1767264300, 60, 100),
            (1, 10, 1767265260, 60, 100),
            (1, 11, 1767266221, 60, 100);
        """
    )
    conn.commit()
    conn.close()


def create_fallback_db(path: Path) -> None:
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
        CREATE VIEW page_stat AS
            SELECT 1 AS id_book, 12 AS page, 1769904000 AS start_time, 900 AS duration, 300 AS total_pages
            UNION ALL
            SELECT 1 AS id_book, 13 AS page, 1769990400 AS start_time, 900 AS duration, 300 AS total_pages;
        INSERT INTO book VALUES (1, 'Piranesi', 'Susanna Clarke', 1769990400, 300);
        """
    )
    conn.commit()
    conn.close()


def create_period_db(path: Path) -> None:
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
        INSERT INTO page_stat VALUES
            (1, 1, 1769904000, 600),
            (1, 2, 1769907600, 1200);
        """
    )
    conn.commit()
    conn.close()


def create_long_history_db(path: Path) -> None:
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
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        INSERT INTO book VALUES (1, 'The Dispossessed', 'Ursula K. Le Guin', 1769904000, 320);
        """
    )
    start = datetime(2026, 1, 1, 12)
    rows = [
        (1, day + 1, int((start + timedelta(days=day)).timestamp()), (day + 1) * 60, 320)
        for day in range(35)
    ]
    conn.executemany("INSERT INTO page_stat_data VALUES (?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()


def create_sparse_history_db(path: Path) -> None:
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
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        INSERT INTO book VALUES (1, 'Tehanu', 'Ursula K. Le Guin', 1780185600, 320);
        """
    )
    rows = [
        (1, 1, ts(2026, 5, 1), 1800, 320),
        (1, 2, ts(2026, 5, 3), 2700, 320),
        (1, 3, ts(2026, 5, 5), 3600, 320),
        (1, 4, ts(2026, 1, 1), 7200, 320),
        (1, 5, ts(2026, 3, 1), 10800, 320),
        (1, 6, ts(2026, 5, 1, 14), 14400, 320),
    ]
    conn.executemany("INSERT INTO page_stat_data VALUES (?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()


def create_sparse_trailing_year_db(path: Path) -> None:
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
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        INSERT INTO book VALUES (1, 'The Tombs of Atuan', 'Ursula K. Le Guin', 1767139200, 180);
        """
    )
    rows = [
        (1, 1, ts(2024, 1, 1), 3600, 180),
        (1, 2, ts(2024, 12, 1), 7200, 180),
        (1, 3, ts(2025, 12, 1), 10800, 180),
    ]
    conn.executemany("INSERT INTO page_stat_data VALUES (?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()


def create_exact_twelve_month_history_db(path: Path) -> None:
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
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        INSERT INTO book VALUES (1, 'A Fisherman of the Inland Sea', 'Ursula K. Le Guin', 1767139200, 220);
        """
    )
    rows = [
        (1, month, ts(2025, month, 1), month * 600, 220)
        for month in range(1, 13)
    ]
    conn.executemany("INSERT INTO page_stat_data VALUES (?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()


def create_many_books_db(path: Path, count: int = 25) -> None:
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
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        """
    )
    start = datetime(2026, 2, 1, 12)
    books = []
    page_stats = []
    for index in range(1, count + 1):
        timestamp = int((start + timedelta(days=index)).timestamp())
        books.append((index, f"Book {index:02d}", "Test Author", timestamp, 100))
        page_stats.append((index, index, timestamp, index * 60, 100))
    conn.executemany("INSERT INTO book VALUES (?, ?, ?, ?, ?)", books)
    conn.executemany("INSERT INTO page_stat_data VALUES (?, ?, ?, ?, ?)", page_stats)
    conn.commit()
    conn.close()


def create_duplicate_books_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE book (
            id INTEGER PRIMARY KEY,
            title TEXT,
            authors TEXT,
            last_open INTEGER,
            pages INTEGER,
            md5 TEXT,
            series TEXT,
            language TEXT
        );
        CREATE TABLE page_stat_data (
            id_book INTEGER,
            page INTEGER,
            start_time INTEGER,
            duration INTEGER,
            total_pages INTEGER
        );
        INSERT INTO book VALUES
            (1, 'Merged Work', 'Same Author', 1769904000, 100, 'aaa', 'Series A', 'en'),
            (2, 'Merged Work', 'Same Author', 1769990400, 120, 'bbb', 'Series A', 'en'),
            (3, 'Title Clash', 'Author One', 1770076800, 100, 'c1', NULL, 'en'),
            (4, 'Title Clash', 'Author Two', 1770076860, 100, 'c2', NULL, 'en'),
            (5, 'Placeholder Author', 'Unknown author', 1770076920, 100, 'p1', NULL, 'en'),
            (6, 'Placeholder Author', 'Unknown author', 1770076980, 100, 'p2', NULL, 'en'),
            (7, 'Language Conflict', 'Careful Writer', 1770077040, 100, 'l1', NULL, 'en'),
            (8, 'Language Conflict', 'Careful Writer', 1770077100, 100, 'l2', NULL, 'fr'),
            (9, 'Series Conflict', 'Careful Writer', 1770077160, 100, 's1', 'One', 'en'),
            (10, 'Series Conflict', 'Careful Writer', 1770077220, 100, 's2', 'Two', 'en'),
            (11, 'Similar Title', 'Same Author', 1770077280, 100, 't1', NULL, 'en'),
            (12, 'Similar Title: Subtitle', 'Same Author', 1770077340, 100, 't2', NULL, 'en'),
            (13, 'Unknown Author Duplicate', '<unknown>', 1770077400, 100, 'u1', 'N/A', 'en-US'),
            (14, 'Unknown Author Duplicate', 'Known Writer', 1770077460, 120, 'u2', NULL, 'en');
        INSERT INTO page_stat_data VALUES
            (1, 10, 1769904000, 100, 100),
            (1, 11, 1769904060, 200, 100),
            (2, 50, 1769990400, 300, 120),
            (2, 60, 1769990460, 400, 120),
            (3, 1, 1770076800, 60, 100),
            (4, 1, 1770076860, 60, 100),
            (5, 1, 1770076920, 60, 100),
            (6, 1, 1770076980, 60, 100),
            (7, 1, 1770077040, 60, 100),
            (8, 1, 1770077100, 60, 100),
            (9, 1, 1770077160, 60, 100),
            (10, 1, 1770077220, 60, 100),
            (11, 1, 1770077280, 60, 100),
            (12, 1, 1770077340, 60, 100),
            (13, 1, 1770077400, 60, 100),
            (14, 2, 1770077460, 120, 120);
        """
    )
    conn.commit()
    conn.close()


def write_sidecar_snapshot(path: Path, records: list[dict]) -> SnapshotMeta:
    sidecar_path = path.with_name("sidecars.json")
    sidecar_path.write_text(json.dumps({"version": 1, "records": records}), encoding="utf-8")
    return SnapshotMeta(
        id="sidecar-test",
        imported_at="2026-06-11T12:00:00+00:00",
        source="test",
        source_path=None,
        path=str(path),
        file_size=path.stat().st_size,
        user_version=0,
        schema_version="0",
        sidecar_path=str(sidecar_path),
    )


def test_build_dashboard_from_current_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_current_db(db_path)

    dashboard = build_dashboard(db_path, today=date(2026, 2, 2))

    assert dashboard["has_data"] is True
    assert dashboard["summary"]["total_time_seconds"] == 7200
    assert dashboard["summary"]["total_time_label"] == "2h 00m"
    assert dashboard["summary"]["reading_days"] == 3
    assert dashboard["summary"]["books"] == 2
    assert dashboard["summary"]["pages"] == 4
    assert dashboard["summary"]["current_streak"] == 3
    assert dashboard["charts"]["top_books"][0]["title"] == "The Left Hand of Darkness"
    assert len(dashboard["charts"]["daily"]) == 3
    assert dashboard["charts"]["calendar"]["total_days"] == 3
    assert dashboard["charts"]["calendar"]["days"][0]["date"] == "2026-01-31"
    assert dashboard["charts"]["calendar"]["days"][1]["book_ids"] == ["1", "2"]
    assert dashboard["charts"]["calendar"]["days"][-1]["level"] == 1
    assert dashboard["books"][0]["title"] == "The Left Hand of Darkness"
    assert dashboard["books"][0]["time_label"] == "1h 10m"
    assert dashboard["books"][0]["pages"] == 2
    assert dashboard["books"][0]["progress"] == 9
    assert dashboard["books"][0]["source_book_ids"] == ["2"]
    assert dashboard["books"][0]["source_md5s"] == []
    assert dashboard["books"][0]["merged_count"] == 1
    assert len(dashboard["books"][0]["recent_activity"]) == 5
    assert dashboard["books"][0]["recent_activity"][-1]["minutes"] == 10.0
    assert dashboard["recent_books"][0]["title"] == "The Left Hand of Darkness"


def test_sessions_and_book_pace_use_global_event_order(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_session_db(db_path)

    dashboard = build_dashboard(db_path)

    sessions = dashboard["insights"]["sessions"]
    assert sessions["available"] is True
    assert sessions["total"] == 2
    assert sessions["recent"][1]["event_count"] == 3
    assert sessions["recent"][1]["book_ids"] == ["1", "2"]
    assert sessions["recent"][1]["elapsed_seconds"] == 3720
    first_book = next(book for book in dashboard["books"] if book["id"] == "1")
    assert first_book["pace_seconds_per_page"] == 256.36
    assert first_book["estimated_remaining_seconds"] == 22816.36
    assert len(first_book["recent_sessions"]) == 2


def test_time_estimate_is_available_with_short_reading_history(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_session_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE page_stat_data SET duration = 60 WHERE id_book = 1")

    dashboard = build_dashboard(db_path)

    first_book = next(book for book in dashboard["books"] if book["id"] == "1")
    assert first_book["time_seconds"] == 180
    assert first_book["estimated_remaining_seconds"] == 1456.36


def test_time_estimate_uses_current_page_for_pace(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_session_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE page_stat_data SET page = 100, total_pages = 1000 WHERE id_book = 1 AND page = 10")
        conn.execute("UPDATE page_stat_data SET total_pages = 1000 WHERE id_book = 1")

    dashboard = build_dashboard(db_path)

    first_book = next(book for book in dashboard["books"] if book["id"] == "1")
    assert first_book["pages"] == 3
    assert first_book["max_page"] == 100
    assert first_book["pace_seconds_per_page"] == 28.2
    assert first_book["estimated_remaining_seconds"] == 25380


def test_aggregate_dashboard_keeps_device_sessions_visible(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_session_db(db_path)
    dashboard = build_dashboard(db_path, include_all_sessions=True)
    snapshot = SnapshotMeta("one", "2026-01-01T00:00:00+00:00", "upload", None, str(db_path), 1, 0, "0")

    aggregate = aggregate_dashboards([dashboard, dashboard], snapshots=[snapshot, snapshot])

    assert aggregate["insights"]["sessions"]["available"] is True
    assert aggregate["insights"]["sessions"]["total"] == 4
    assert aggregate["insights"]["sessions"]["recent"][0]["device_label"] == "unknown"
    aggregate_book = next(book for book in aggregate["books"] if book["title"] == "Session One")
    assert aggregate_book["pages"] == 3
    assert aggregate_book["pace_seconds_per_page"] == 512.73
    assert aggregate_book["estimated_remaining_seconds"] == 45632.73


def test_single_dashboard_aggregate_does_not_expose_internal_session_data(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_session_db(db_path)
    snapshot = SnapshotMeta("one", "2026-01-01T00:00:00+00:00", "upload", None, str(db_path), 1, 0, "0")

    dashboard = build_dashboard(db_path, snapshot, include_all_sessions=True)
    aggregate = aggregate_dashboards([dashboard], snapshots=[snapshot])

    assert "_all_sessions" not in aggregate
    assert all("_page_numbers" not in book for book in aggregate["books"])


def test_aggregate_book_sessions_use_full_device_history(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_session_db(db_path)
    first_snapshot = SnapshotMeta(
        "one", "2026-01-01T00:00:00+00:00", "upload", None, str(db_path), 1, 0, "0", device_id="one", device_label="Device One"
    )
    second_snapshot = SnapshotMeta(
        "two", "2026-01-02T00:00:00+00:00", "upload", None, str(db_path), 1, 0, "0", device_id="two", device_label="Device Two"
    )
    first = build_dashboard(db_path, first_snapshot, include_all_sessions=True)
    second = build_dashboard(db_path, second_snapshot, include_all_sessions=True)
    first_book = next(item for item in first["books"] if item["title"] == "Session One")
    first_book["id"] = "merged:device-one"
    for session in first["_all_sessions"]:
        session["book_ids"] = ["merged:device-one" if book_id == "1" else book_id for book_id in session["book_ids"]]
    expected_session = first["_all_sessions"][0]
    first["insights"]["sessions"]["recent"] = []

    aggregate = aggregate_dashboards([first, second], snapshots=[first_snapshot, second_snapshot])

    book = next(item for item in aggregate["books"] if item["title"] == "Session One")
    assert any(
        session["started_at"] == expected_session["started_at"] and session["device_label"] == "Device One"
        for session in book["recent_sessions"]
    )
    assert {device["label"] for device in book["recent_activity_devices"]} == {"Device One", "Device Two"}
    assert sum(book["recent_activity"][-1][device["id"]] for device in book["recent_activity_devices"]) == book["recent_activity"][-1]["minutes"]


def test_current_streak_counts_through_today() -> None:
    streak = current_streak(
        {"2026-06-01", "2026-06-02", "2026-06-03"},
        today=date(2026, 6, 3),
    )

    assert streak == 3


def test_current_streak_tolerates_latest_reading_yesterday() -> None:
    streak = current_streak(
        {"2026-06-01", "2026-06-02"},
        today=date(2026, 6, 3),
    )

    assert streak == 2


def test_current_streak_is_zero_for_stale_history() -> None:
    streak = current_streak(
        {"2026-05-29", "2026-05-30"},
        today=date(2026, 6, 3),
    )

    assert streak == 0


def test_current_streak_is_zero_without_reading_days() -> None:
    assert current_streak(set(), today=date(2026, 6, 3)) == 0


def test_build_dashboard_from_page_stat_fallback(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_fallback_db(db_path)

    dashboard = build_dashboard(db_path)

    assert dashboard["summary"]["total_time_seconds"] == 1800
    assert dashboard["summary"]["books"] == 1
    assert dashboard["recent_books"][0]["title"] == "Piranesi"


def test_build_dashboard_from_koreader_period_column(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_period_db(db_path)

    dashboard = build_dashboard(db_path)

    assert dashboard["summary"]["total_time_seconds"] == 1800
    assert dashboard["summary"]["total_time_label"] == "30m"
    assert dashboard["recent_books"][0]["title"] == "Kindred"


def test_calendar_keeps_all_reading_days_with_intensity(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_long_history_db(db_path)

    dashboard = build_dashboard(db_path)

    calendar = dashboard["charts"]["calendar"]
    assert len(dashboard["charts"]["daily"]) == 30
    assert len(calendar["days"]) == 35
    assert calendar["start_date"] == "2026-01-01"
    assert calendar["end_date"] == "2026-02-04"
    assert calendar["max_minutes"] == 35
    assert calendar["days"][0] == {
        "date": "2026-01-01",
        "label": "Jan 1, 2026",
        "minutes": 1,
        "time_label": "1m",
        "level": 1,
        "book_ids": ["1"],
    }
    assert calendar["days"][-1]["date"] == "2026-02-04"
    assert calendar["days"][-1]["minutes"] == 35
    assert calendar["days"][-1]["level"] == 4


def test_charts_include_gaps_for_missing_daily_and_monthly_reading(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_sparse_history_db(db_path)

    dashboard = build_dashboard(db_path, today=date(2026, 5, 5))

    assert len(dashboard["charts"]["daily"]) == 30
    assert dashboard["charts"]["daily"][0] == {"date": "2026-04-06", "label": "Apr 6", "minutes": 0.0}
    assert dashboard["charts"]["daily"][-5:] == [
        {"date": "2026-05-01", "label": "May 1", "minutes": 270.0},
        {"date": "2026-05-02", "label": "May 2", "minutes": 0.0},
        {"date": "2026-05-03", "label": "May 3", "minutes": 45.0},
        {"date": "2026-05-04", "label": "May 4", "minutes": 0.0},
        {"date": "2026-05-05", "label": "May 5", "minutes": 60.0},
    ]
    assert dashboard["charts"]["monthly"] == [
        {"month": "2026-01", "label": "Jan 26", "hours": 2.0},
        {"month": "2026-02", "label": "Feb 26", "hours": 0.0},
        {"month": "2026-03", "label": "Mar 26", "hours": 3.0},
        {"month": "2026-04", "label": "Apr 26", "hours": 0.0},
        {"month": "2026-05", "label": "May 26", "hours": 6.25},
    ]


def test_monthly_chart_stays_within_trailing_twelve_calendar_months(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_sparse_trailing_year_db(db_path)

    dashboard = build_dashboard(db_path, today=date(2025, 12, 15))

    monthly = dashboard["charts"]["monthly"]
    assert len(monthly) == 12
    assert monthly[0] == {"month": "2025-01", "label": "Jan 25", "hours": 0.0}
    assert monthly[-1] == {"month": "2025-12", "label": "Dec 25", "hours": 3.0}
    assert all(point["month"] >= "2025-01" for point in monthly)


def test_monthly_chart_keeps_exact_twelve_month_history(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_exact_twelve_month_history_db(db_path)

    dashboard = build_dashboard(db_path, today=date(2025, 12, 15))

    monthly = dashboard["charts"]["monthly"]
    assert len(monthly) == 12
    assert monthly[0]["month"] == "2025-01"
    assert monthly[-1]["month"] == "2025-12"


def test_full_books_list_is_not_limited_to_recent_preview(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_many_books_db(db_path)

    dashboard = build_dashboard(db_path)

    assert len(dashboard["books"]) == 25
    assert len(dashboard["recent_books"]) == 20
    assert dashboard["books"][0]["title"] == "Book 25"
    assert dashboard["books"][-1]["title"] == "Book 01"
    assert dashboard["books"][0]["progress"] == 25


def test_duplicate_book_records_merge_conservatively(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_duplicate_books_db(db_path)

    dashboard = build_dashboard(db_path)
    merged = next(book for book in dashboard["books"] if book["title"] == "Merged Work")

    assert dashboard["summary"]["books"] == 12
    assert len(dashboard["books"]) == 12
    assert len(dashboard["recent_books"]) == 12
    assert dashboard["summary"]["pages"] == 16
    assert dashboard["charts"]["top_books"][0]["id"] == merged["id"]
    merged_calendar_days = [
        day
        for day in dashboard["charts"]["calendar"]["days"]
        if day["date"] in {"2026-01-31", "2026-02-01"}
    ]
    assert [day["book_ids"] for day in merged_calendar_days] == [[merged["id"]], [merged["id"]]]
    assert merged["id"].startswith("merged:")
    assert merged["time_seconds"] == 1000
    assert merged["time_label"] == "17m"
    assert merged["pages"] == 4
    assert merged["max_page"] == 60
    assert merged["total_pages"] == 120
    assert merged["progress"] == 50
    assert merged["source_book_ids"] == ["1", "2"]
    assert merged["source_md5s"] == ["aaa", "bbb"]
    assert merged["merged_count"] == 2

    unknown_author = next(book for book in dashboard["books"] if book["title"] == "Unknown Author Duplicate")
    assert unknown_author["authors"] == "Known Writer"
    assert unknown_author["source_book_ids"] == ["13", "14"]
    assert unknown_author["source_md5s"] == ["u1", "u2"]
    assert unknown_author["merged_count"] == 2


def test_merged_book_estimate_uses_furthest_progress_not_latest_reopen(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_duplicate_books_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE book SET last_open = 1771000000 WHERE id = 1")

    dashboard = build_dashboard(db_path)

    merged = next(book for book in dashboard["books"] if book["title"] == "Merged Work")
    assert merged["max_page"] == 60
    assert merged["total_pages"] == 120
    assert merged["pace_seconds_per_page"] == 16.67
    assert merged["estimated_remaining_seconds"] == 1000


def test_duplicate_book_false_positive_controls(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_duplicate_books_db(db_path)

    dashboard = build_dashboard(db_path)
    groups = {}
    for book in dashboard["books"]:
        groups.setdefault((book["title"], book["authors"]), []).append(book)

    assert len(groups[("Title Clash", "Author One")]) == 1
    assert len(groups[("Title Clash", "Author Two")]) == 1
    assert len(groups[("Placeholder Author", "Unknown author")]) == 2
    assert len(groups[("Language Conflict", "Careful Writer")]) == 2
    assert len(groups[("Series Conflict", "Careful Writer")]) == 2
    assert len(groups[("Similar Title", "Same Author")]) == 1
    assert len(groups[("Similar Title: Subtitle", "Same Author")]) == 1
    assert all(
        book["merged_count"] == 1
        for books in groups.values()
        for book in books
        if book["title"] not in {"Merged Work", "Unknown Author Duplicate"}
    )


def test_sidecar_status_and_exact_progress_override_page_progress(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_duplicate_books_db(db_path)
    snapshot = write_sidecar_snapshot(
        db_path,
        [
            {
                "partial_md5_checksum": "c1",
                "title": "Title Clash",
                "authors": "Author One",
                "status": "complete",
                "percent_finished": 0.4666666667,
                "status_modified": "2026-06-10",
                "highlight_count": 3,
                "note_count": 1,
                "series": "Test Series",
                "series_index": 2,
                "language": "en",
            },
            {
                "partial_md5_checksum": "c2",
                "title": "Title Clash",
                "authors": "Author Two",
                "status": "abandoned",
                "percent_finished": 0.9,
                "status_modified": "2026-06-09",
                "highlight_count": 1,
                "note_count": 0,
                "series": None,
                "series_index": None,
                "language": "fr",
            },
        ],
    )

    dashboard = build_dashboard(db_path, snapshot)
    completed = next(book for book in dashboard["books"] if book["authors"] == "Author One")
    abandoned = next(book for book in dashboard["books"] if book["authors"] == "Author Two")

    assert completed["status"] == "complete"
    assert completed["progress"] == 100
    assert completed["percent_finished"] == pytest.approx(0.4666666667)
    assert completed["highlight_count"] == 3
    assert completed["note_count"] == 1
    assert completed["series"] == "Test Series"
    assert completed["series_index"] == 2
    assert completed["metadata_available"] is True
    assert abandoned["status"] == "abandoned"
    assert abandoned["progress"] == 90
    assert dashboard["summary"]["finished_books"] == 1
    assert dashboard["summary"]["abandoned_books"] == 1
    assert dashboard["summary"]["highlights"] == 4


def test_sidecar_unique_title_author_fallback_and_missing_metadata(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_current_db(db_path)
    snapshot = write_sidecar_snapshot(
        db_path,
        [
            {
                "partial_md5_checksum": None,
                "title": "A Wizard of Earthsea",
                "authors": "Ursula K. Le Guin",
                "status": "reading",
                "percent_finished": 0.25,
                "status_modified": "2026-06-01",
                "highlight_count": 0,
                "note_count": 0,
                "series": "Earthsea",
                "series_index": 1,
                "language": "en",
            }
        ],
    )

    dashboard = build_dashboard(db_path, snapshot)
    matched = next(book for book in dashboard["books"] if book["title"] == "A Wizard of Earthsea")
    unmatched = next(book for book in dashboard["books"] if book["title"] == "The Left Hand of Darkness")

    assert matched["status"] == "reading"
    assert matched["progress"] == 25
    assert unmatched["status"] is None
    assert unmatched["metadata_available"] is False
    assert unmatched["progress"] == 9


def test_missing_sidecar_status_uses_page_progress_for_summary_counts(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_current_db(db_path)
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE page_stat_data SET page = 180 WHERE id_book = 1")

    dashboard = build_dashboard(db_path)

    assert dashboard["summary"]["finished_books"] == 1
    assert dashboard["summary"]["reading_books"] == 1
    assert dashboard["summary"]["abandoned_books"] == 0


def test_duplicate_md5_sidecars_are_treated_as_ambiguous(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_duplicate_books_db(db_path)
    snapshot = write_sidecar_snapshot(
        db_path,
        [
            {
                "partial_md5_checksum": "c1",
                "title": "Title Clash",
                "authors": "Author One",
                "status": "complete",
                "percent_finished": 1,
                "status_modified": "2026-06-10",
            },
            {
                "partial_md5_checksum": "c1",
                "title": "Title Clash",
                "authors": "Author One",
                "status": "abandoned",
                "percent_finished": 0.2,
                "status_modified": "2026-06-11",
            },
        ],
    )

    book = next(
        item
        for item in build_dashboard(db_path, snapshot)["books"]
        if item["authors"] == "Author One"
    )

    assert book["status"] is None
    assert book["percent_finished"] is None
    assert book["metadata_available"] is False


def test_merged_books_select_latest_sidecar_state(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_duplicate_books_db(db_path)
    snapshot = write_sidecar_snapshot(
        db_path,
        [
            {
                "partial_md5_checksum": "aaa",
                "title": "Merged Work",
                "authors": "Same Author",
                "status": "complete",
                "percent_finished": 1,
                "status_modified": "2026-05-01",
                "highlight_count": 8,
                "note_count": 0,
            },
            {
                "partial_md5_checksum": "bbb",
                "title": "Merged Work",
                "authors": "Same Author",
                "status": "reading",
                "percent_finished": 0.6,
                "status_modified": "2026-06-01",
                "highlight_count": 2,
                "note_count": 0,
            },
        ],
    )

    merged = next(book for book in build_dashboard(db_path, snapshot)["books"] if book["title"] == "Merged Work")

    assert merged["status"] == "reading"
    assert merged["progress"] == 60
    assert merged["highlight_count"] == 2


def test_unsupported_schema_reports_clear_error(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    sqlite3.connect(db_path).execute("CREATE TABLE something_else (id INTEGER)").connection.close()

    with pytest.raises(UnsupportedSchemaError, match="missing book table"):
        build_dashboard(db_path)
