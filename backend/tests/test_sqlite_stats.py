from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from backend.app.errors import UnsupportedSchemaError
from backend.app.sqlite_stats import build_dashboard


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
            (12, 'Similar Title: Subtitle', 'Same Author', 1770077340, 100, 't2', NULL, 'en');
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
            (12, 1, 1770077340, 60, 100);
        """
    )
    conn.commit()
    conn.close()


def test_build_dashboard_from_current_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    create_current_db(db_path)

    dashboard = build_dashboard(db_path)

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
    assert dashboard["charts"]["calendar"]["days"][-1]["level"] == 1
    assert dashboard["books"][0]["title"] == "The Left Hand of Darkness"
    assert dashboard["books"][0]["time_label"] == "1h 10m"
    assert dashboard["books"][0]["pages"] == 2
    assert dashboard["books"][0]["progress"] == 9
    assert dashboard["books"][0]["source_book_ids"] == ["2"]
    assert dashboard["books"][0]["source_md5s"] == []
    assert dashboard["books"][0]["merged_count"] == 1
    assert dashboard["recent_books"][0]["title"] == "The Left Hand of Darkness"


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
    }
    assert calendar["days"][-1]["date"] == "2026-02-04"
    assert calendar["days"][-1]["minutes"] == 35
    assert calendar["days"][-1]["level"] == 4


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

    assert dashboard["summary"]["books"] == 11
    assert len(dashboard["books"]) == 11
    assert len(dashboard["recent_books"]) == 11
    assert dashboard["summary"]["pages"] == 14
    assert dashboard["charts"]["top_books"][0]["id"] == merged["id"]
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
    assert all(book["merged_count"] == 1 for books in groups.values() for book in books if book["title"] != "Merged Work")


def test_unsupported_schema_reports_clear_error(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    sqlite3.connect(db_path).execute("CREATE TABLE something_else (id INTEGER)").connection.close()

    with pytest.raises(UnsupportedSchemaError, match="missing book table"):
        build_dashboard(db_path)
