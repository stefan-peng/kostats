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


def test_unsupported_schema_reports_clear_error(tmp_path: Path) -> None:
    db_path = tmp_path / "statistics.sqlite3"
    sqlite3.connect(db_path).execute("CREATE TABLE something_else (id INTEGER)").connection.close()

    with pytest.raises(UnsupportedSchemaError, match="missing book table"):
        build_dashboard(db_path)
