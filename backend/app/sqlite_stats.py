from __future__ import annotations

import calendar
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from .errors import UnsupportedSchemaError


@dataclass(frozen=True)
class SnapshotMeta:
    id: str
    imported_at: str
    source: str
    source_path: str | None
    path: str
    file_size: int
    user_version: int
    schema_version: str


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def open_readonly(path: Path) -> sqlite3.Connection:
    uri = f"file:{path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def read_user_version(path: Path) -> int:
    with open_readonly(path) as conn:
        row = conn.execute("PRAGMA user_version").fetchone()
    return int(row[0]) if row else 0


def table_names(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
    ).fetchall()
    return {str(row[0]) for row in rows}


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({quote_identifier(table)})").fetchall()
    return {str(row["name"]) for row in rows}


def pick(columns: set[str], candidates: list[str], *, required: bool = True) -> str | None:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    if required:
        raise UnsupportedSchemaError(
            f"Unsupported KOReader statistics schema: missing one of {', '.join(candidates)}"
        )
    return None


def local_dt(timestamp: Any) -> datetime | None:
    if timestamp is None:
        return None
    try:
        value = float(timestamp)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return datetime.fromtimestamp(value).astimezone()


def month_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def month_label(key: str) -> str:
    year, month = [int(part) for part in key.split("-")]
    return f"{calendar.month_abbr[month]} {str(year)[2:]}"


def seconds_to_minutes(seconds: float) -> float:
    return round(seconds / 60, 2)


def seconds_to_hours(seconds: float) -> float:
    return round(seconds / 3600, 2)


def format_duration(seconds: float) -> str:
    total_minutes = int(round(seconds / 60))
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    return f"{minutes}m"


def current_streak(day_keys: set[str]) -> int:
    if not day_keys:
        return 0
    current = datetime.strptime(max(day_keys), "%Y-%m-%d").date()
    streak = 0
    while current.isoformat() in day_keys:
        streak += 1
        current -= timedelta(days=1)
    return streak


def latest_snapshot_from_manifest(manifest: dict[str, Any]) -> SnapshotMeta | None:
    snapshots = manifest.get("snapshots", [])
    if not snapshots:
        return None
    latest = sorted(snapshots, key=lambda item: item["imported_at"], reverse=True)[0]
    return SnapshotMeta(**latest)


def build_dashboard(path: Path, snapshot: SnapshotMeta | None = None) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(path)

    with open_readonly(path) as conn:
        names = table_names(conn)
        if "book" not in names:
            raise UnsupportedSchemaError("Unsupported KOReader statistics schema: missing book table")

        source_table = "page_stat_data" if "page_stat_data" in names else None
        if source_table is None and "page_stat" in names:
            source_table = "page_stat"
        if source_table is None:
            raise UnsupportedSchemaError(
                "Unsupported KOReader statistics schema: missing page_stat_data table or page_stat view"
            )

        data_columns = table_columns(conn, source_table)
        book_columns = table_columns(conn, "book")
        book_id_col = pick(book_columns, ["id", "book_id"])
        data_book_id_col = pick(data_columns, ["id_book", "book_id", "id"])
        duration_col = pick(data_columns, ["duration", "period", "read"])
        timestamp_col = pick(
            data_columns,
            ["start_time", "start_ts", "timestamp", "time", "created_at", "date"],
        )
        page_col = pick(data_columns, ["page", "pages", "current_page"], required=False)
        total_pages_col = pick(data_columns, ["total_pages", "pages"], required=False)

        title_col = pick(book_columns, ["title", "name"], required=False)
        authors_col = pick(book_columns, ["authors", "author"], required=False)
        last_open_col = pick(book_columns, ["last_open", "last_opened", "mtime"], required=False)
        book_pages_col = pick(book_columns, ["pages", "total_pages"], required=False)

        select_parts = [
            f"d.{quote_identifier(data_book_id_col)} AS book_id",
            f"d.{quote_identifier(duration_col)} AS duration",
            f"d.{quote_identifier(timestamp_col)} AS started_at",
        ]
        select_parts.append(
            f"d.{quote_identifier(page_col)} AS page" if page_col else "NULL AS page"
        )
        select_parts.append(
            f"d.{quote_identifier(total_pages_col)} AS event_total_pages"
            if total_pages_col
            else "NULL AS event_total_pages"
        )
        select_parts.append(
            f"b.{quote_identifier(title_col)} AS title" if title_col else "NULL AS title"
        )
        select_parts.append(
            f"b.{quote_identifier(authors_col)} AS authors" if authors_col else "NULL AS authors"
        )
        select_parts.append(
            f"b.{quote_identifier(last_open_col)} AS last_open" if last_open_col else "NULL AS last_open"
        )
        select_parts.append(
            f"b.{quote_identifier(book_pages_col)} AS book_pages" if book_pages_col else "NULL AS book_pages"
        )

        rows = conn.execute(
            f"""
            SELECT {", ".join(select_parts)}
            FROM {quote_identifier(source_table)} d
            LEFT JOIN book b
              ON b.{quote_identifier(book_id_col)} = d.{quote_identifier(data_book_id_col)}
            WHERE d.{quote_identifier(duration_col)} IS NOT NULL
            """
        ).fetchall()

    day_seconds: dict[str, float] = defaultdict(float)
    month_seconds: dict[str, float] = defaultdict(float)
    books: dict[str, dict[str, Any]] = {}
    total_seconds = 0.0

    for row in rows:
        try:
            duration = float(row["duration"] or 0)
        except (TypeError, ValueError):
            continue
        if duration <= 0:
            continue

        started = local_dt(row["started_at"])
        if started is None:
            continue

        book_id = str(row["book_id"])
        total_seconds += duration
        day_seconds[started.date().isoformat()] += duration
        month_seconds[month_key(started)] += duration

        book = books.setdefault(
            book_id,
            {
                "id": book_id,
                "title": row["title"] or "Untitled",
                "authors": row["authors"] or "Unknown author",
                "last_open_timestamp": 0.0,
                "time_seconds": 0.0,
                "pages_seen": set(),
                "max_page": None,
                "total_pages": None,
            },
        )
        book["time_seconds"] += duration

        opened = local_dt(row["last_open"]) or started
        opened_ts = opened.timestamp()
        if opened_ts > book["last_open_timestamp"]:
            book["last_open_timestamp"] = opened_ts

        page = row["page"]
        if page is not None:
            try:
                page_int = int(page)
                if page_int > 0:
                    book["pages_seen"].add(page_int)
                    book["max_page"] = max(book["max_page"] or 0, page_int)
            except (TypeError, ValueError):
                pass

        for value in (row["event_total_pages"], row["book_pages"]):
            if value is None:
                continue
            try:
                pages = int(value)
            except (TypeError, ValueError):
                continue
            if pages > 0:
                book["total_pages"] = max(book["total_pages"] or 0, pages)

    recent_books = []
    for book in books.values():
        pages_read = len(book["pages_seen"])
        max_page = book["max_page"]
        total_pages = book["total_pages"]
        progress = None
        if total_pages and max_page:
            progress = min(100, round((max_page / total_pages) * 100))
        last_open = (
            datetime.fromtimestamp(book["last_open_timestamp"]).astimezone().isoformat()
            if book["last_open_timestamp"]
            else None
        )
        recent_books.append(
            {
                "id": book["id"],
                "title": book["title"],
                "authors": book["authors"],
                "last_open": last_open,
                "time_seconds": round(book["time_seconds"], 2),
                "time_label": format_duration(book["time_seconds"]),
                "pages": pages_read,
                "max_page": max_page,
                "total_pages": total_pages,
                "progress": progress,
            }
        )

    recent_books.sort(key=lambda item: item["last_open"] or "", reverse=True)
    top_books = sorted(recent_books, key=lambda item: item["time_seconds"], reverse=True)[:10]

    sorted_days = sorted(day_seconds)
    sorted_months = sorted(month_seconds)
    latest_days = sorted_days[-30:]
    latest_months = sorted_months[-12:]

    return {
        "has_data": True,
        "snapshot": snapshot.__dict__ if snapshot else None,
        "summary": {
            "total_time_seconds": round(total_seconds, 2),
            "total_time_label": format_duration(total_seconds),
            "reading_days": len(day_seconds),
            "books": len(books),
            "pages": sum(len(book["pages_seen"]) for book in books.values()),
            "current_streak": current_streak(set(day_seconds)),
        },
        "charts": {
            "daily": [
                {
                    "date": key,
                    "label": datetime.strptime(key, "%Y-%m-%d").strftime("%b %-d"),
                    "minutes": seconds_to_minutes(day_seconds[key]),
                }
                for key in latest_days
            ],
            "monthly": [
                {
                    "month": key,
                    "label": month_label(key),
                    "hours": seconds_to_hours(month_seconds[key]),
                }
                for key in latest_months
            ],
            "top_books": [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "hours": seconds_to_hours(item["time_seconds"]),
                }
                for item in top_books
            ],
        },
        "recent_books": recent_books[:20],
    }
