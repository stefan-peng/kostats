from __future__ import annotations

import calendar
import hashlib
import re
import sqlite3
import unicodedata
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from .errors import UnsupportedSchemaError
from .sidecars import load_sidecar_snapshot


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
    content_hash: str | None = None
    sidecar_path: str | None = None
    sidecar_hash: str | None = None


def quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


@contextmanager
def open_readonly(path: Path) -> Iterator[sqlite3.Connection]:
    uri = f"file:{path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


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


def day_label(key: str, *, include_year: bool = False) -> str:
    value = datetime.strptime(key, "%Y-%m-%d")
    suffix = f", {value.year}" if include_year else ""
    return f"{calendar.month_abbr[value.month]} {value.day}{suffix}"


def seconds_to_minutes(seconds: float) -> float:
    return round(seconds / 60, 2)


def seconds_to_hours(seconds: float) -> float:
    return round(seconds / 3600, 2)


def calendar_level(seconds: float, max_seconds: float) -> int:
    if seconds <= 0 or max_seconds <= 0:
        return 0
    ratio = seconds / max_seconds
    if ratio <= 0.25:
        return 1
    if ratio <= 0.5:
        return 2
    if ratio <= 0.75:
        return 3
    return 4


def format_duration(seconds: float) -> str:
    total_minutes = int(round(seconds / 60))
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    return f"{minutes}m"


PLACEHOLDER_BOOK_KEYS = {
    "n/a",
    "na",
    "none",
    "unknown",
    "unknown author",
    "untitled",
}


def display_text(value: Any, fallback: str) -> str:
    if value is None:
        return fallback
    text = str(value).strip()
    return text or fallback


def normalized_identity_text(value: Any) -> str | None:
    if value is None:
        return None
    text = unicodedata.normalize("NFKC", str(value))
    text = re.sub(r"\s+", " ", text).strip().casefold()
    return text or None


def real_book_identity_key(value: Any) -> str | None:
    key = normalized_identity_text(value)
    if key is None or key in PLACEHOLDER_BOOK_KEYS:
        return None
    return key


def optional_metadata_key(value: Any) -> str | None:
    return normalized_identity_text(value)


def book_id_sort_key(value: str) -> tuple[int, int | str]:
    try:
        return (0, int(value))
    except ValueError:
        return (1, value)


def stable_merged_book_id(source_book_ids: list[str]) -> str:
    key = "\x1f".join(sorted(source_book_ids, key=book_id_sort_key))
    return f"merged:{hashlib.sha1(key.encode('utf-8')).hexdigest()[:12]}"


class UnionFind:
    def __init__(self, values: list[str]) -> None:
        self.parents = {value: value for value in values}

    def find(self, value: str) -> str:
        parent = self.parents[value]
        if parent != value:
            self.parents[value] = self.find(parent)
        return self.parents[value]

    def union(self, first: str, second: str) -> None:
        first_root = self.find(first)
        second_root = self.find(second)
        if first_root == second_root:
            return
        self.parents[second_root] = first_root


def current_streak(day_keys: set[str], today: date | None = None) -> int:
    if not day_keys:
        return 0
    reference_day = today or datetime.now().astimezone().date()
    latest_day = datetime.strptime(max(day_keys), "%Y-%m-%d").date()
    if latest_day not in {reference_day, reference_day - timedelta(days=1)}:
        return 0
    current = latest_day
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


def sidecar_sort_key(record: dict[str, Any]) -> tuple[str, str]:
    return (
        str(record.get("status_modified") or ""),
        str(record.get("source_path") or ""),
    )


def build_sidecar_indexes(
    records: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], dict[tuple[str, str], dict[str, Any]]]:
    md5_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        md5 = display_text(record.get("partial_md5_checksum"), "")
        if md5:
            md5_groups[md5].append(record)

    ambiguous_md5s = {md5 for md5, group in md5_groups.items() if len(group) > 1}
    by_md5 = {
        md5: group[0]
        for md5, group in md5_groups.items()
        if len(group) == 1
    }
    fallback_groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        md5 = display_text(record.get("partial_md5_checksum"), "")
        if md5 in ambiguous_md5s:
            continue
        title = real_book_identity_key(record.get("title"))
        authors = real_book_identity_key(record.get("authors"))
        if title and authors:
            fallback_groups[(title, authors)].append(record)

    unique_fallbacks = {
        key: group[0]
        for key, group in fallback_groups.items()
        if len(group) == 1
    }
    return by_md5, unique_fallbacks


def effective_book_status(book: dict[str, Any]) -> str | None:
    status = book.get("status")
    if status in {"complete", "reading", "abandoned"}:
        return status
    progress = book.get("progress")
    if progress is None:
        return None
    return "complete" if progress >= 100 else "reading"


def build_dashboard(
    path: Path,
    snapshot: SnapshotMeta | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(path)

    sidecar_records = load_sidecar_snapshot(Path(snapshot.sidecar_path) if snapshot and snapshot.sidecar_path else None)
    sidecars_by_md5, sidecars_by_title_author = build_sidecar_indexes(sidecar_records)

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
        md5_col = pick(book_columns, ["md5"], required=False)
        series_col = pick(book_columns, ["series"], required=False)
        language_col = pick(book_columns, ["language"], required=False)

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
        select_parts.append(
            f"b.{quote_identifier(md5_col)} AS md5" if md5_col else "NULL AS md5"
        )
        select_parts.append(
            f"b.{quote_identifier(series_col)} AS series" if series_col else "NULL AS series"
        )
        select_parts.append(
            f"b.{quote_identifier(language_col)} AS language" if language_col else "NULL AS language"
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
    day_source_book_ids: dict[str, set[str]] = defaultdict(set)
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
        reading_date = started.date().isoformat()
        total_seconds += duration
        day_seconds[reading_date] += duration
        day_source_book_ids[reading_date].add(book_id)
        month_seconds[month_key(started)] += duration

        book = books.setdefault(
            book_id,
            {
                "id": book_id,
                "title": display_text(row["title"], "Untitled"),
                "authors": display_text(row["authors"], "Unknown author"),
                "title_key": real_book_identity_key(row["title"]),
                "authors_key": real_book_identity_key(row["authors"]),
                "md5": display_text(row["md5"], ""),
                "series_key": optional_metadata_key(row["series"]),
                "language_key": optional_metadata_key(row["language"]),
                "series": display_text(row["series"], ""),
                "language": display_text(row["language"], ""),
                "last_open_timestamp": 0.0,
                "time_seconds": 0.0,
                "pages_seen": set(),
                "max_page": None,
                "total_pages": None,
                "sidecar": None,
            },
        )
        if book["sidecar"] is None and book["md5"]:
            book["sidecar"] = sidecars_by_md5.get(book["md5"])
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

    fallback_book_groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for book in books.values():
        if book["sidecar"] is None and book["title_key"] and book["authors_key"]:
            fallback_book_groups[(book["title_key"], book["authors_key"])].append(book)
    for key, group in fallback_book_groups.items():
        sidecar = sidecars_by_title_author.get(key)
        if sidecar is not None and len(group) == 1:
            group[0]["sidecar"] = sidecar

    merger = UnionFind(list(books))
    md5_groups: dict[str, list[str]] = defaultdict(list)
    title_author_groups: dict[tuple[str, str], list[str]] = defaultdict(list)

    for book_id, book in books.items():
        md5 = book["md5"]
        if md5:
            md5_groups[md5].append(book_id)
        if book["title_key"] and book["authors_key"]:
            title_author_groups[(book["title_key"], book["authors_key"])].append(book_id)

    for group in md5_groups.values():
        for book_id in group[1:]:
            merger.union(group[0], book_id)

    for group in title_author_groups.values():
        if len(group) < 2:
            continue
        series_keys = {books[book_id]["series_key"] for book_id in group if books[book_id]["series_key"]}
        language_keys = {books[book_id]["language_key"] for book_id in group if books[book_id]["language_key"]}
        if len(series_keys) > 1 or len(language_keys) > 1:
            continue
        for book_id in group[1:]:
            merger.union(group[0], book_id)

    work_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for book_id, book in books.items():
        work_groups[merger.find(book_id)].append(book)

    book_stats = []
    merged_book_ids_by_source: dict[str, str] = {}
    for group in work_groups.values():
        source_book_ids = sorted((book["id"] for book in group), key=book_id_sort_key)
        merged_book_id = (
            source_book_ids[0]
            if len(source_book_ids) == 1
            else stable_merged_book_id(source_book_ids)
        )
        for source_book_id in source_book_ids:
            merged_book_ids_by_source[source_book_id] = merged_book_id
        source_md5s = sorted({book["md5"] for book in group if book["md5"]})
        latest_book = max(group, key=lambda item: (item["last_open_timestamp"], item["id"]))
        matched_sidecars = [book["sidecar"] for book in group if book["sidecar"] is not None]
        sidecar = max(matched_sidecars, key=sidecar_sort_key) if matched_sidecars else None
        pages_seen = set()
        for book in group:
            pages_seen.update(book["pages_seen"])

        pages_read = len(pages_seen)
        max_page = latest_book["max_page"]
        total_pages = latest_book["total_pages"]
        page_progress = None
        if total_pages and max_page:
            page_progress = min(100, round((max_page / total_pages) * 100))
        percent_finished = sidecar.get("percent_finished") if sidecar else None
        progress = round(float(percent_finished) * 100) if percent_finished is not None else page_progress
        last_open = (
            datetime.fromtimestamp(latest_book["last_open_timestamp"]).astimezone().isoformat()
            if latest_book["last_open_timestamp"]
            else None
        )
        time_seconds = sum(book["time_seconds"] for book in group)
        book_stats.append(
            {
                "id": merged_book_id,
                "title": latest_book["title"],
                "authors": latest_book["authors"],
                "last_open": last_open,
                "time_seconds": round(time_seconds, 2),
                "time_label": format_duration(time_seconds),
                "pages": pages_read,
                "max_page": max_page,
                "total_pages": total_pages,
                "progress": progress,
                "percent_finished": percent_finished,
                "status": sidecar.get("status") if sidecar else None,
                "status_modified": sidecar.get("status_modified") if sidecar else None,
                "highlight_count": int(sidecar.get("highlight_count") or 0) if sidecar else 0,
                "note_count": int(sidecar.get("note_count") or 0) if sidecar else 0,
                "series": display_text(sidecar.get("series"), latest_book["series"]) if sidecar else latest_book["series"],
                "series_index": sidecar.get("series_index") if sidecar else None,
                "language": display_text(sidecar.get("language"), latest_book["language"]) if sidecar else latest_book["language"],
                "metadata_available": sidecar is not None,
                "source_book_ids": source_book_ids,
                "source_md5s": source_md5s,
                "merged_count": len(source_book_ids),
            }
        )

    book_stats = sorted(book_stats, key=lambda item: item["last_open"] or "", reverse=True)
    recent_books = book_stats[:20]
    top_books = sorted(book_stats, key=lambda item: item["time_seconds"], reverse=True)[:10]
    status_counts = {
        status: sum(1 for book in book_stats if effective_book_status(book) == status)
        for status in ("complete", "reading", "abandoned")
    }

    sorted_days = sorted(day_seconds)
    sorted_months = sorted(month_seconds)
    latest_days = sorted_days[-30:]
    latest_months = sorted_months[-12:]
    max_day_seconds = max(day_seconds.values(), default=0.0)

    return {
        "has_data": True,
        "snapshot": snapshot.__dict__ if snapshot else None,
        "summary": {
            "total_time_seconds": round(total_seconds, 2),
            "total_time_label": format_duration(total_seconds),
            "reading_days": len(day_seconds),
            "books": len(book_stats),
            "pages": sum(book["pages"] for book in book_stats),
            "current_streak": current_streak(set(day_seconds), today=today),
            "finished_books": status_counts["complete"],
            "reading_books": status_counts["reading"],
            "abandoned_books": status_counts["abandoned"],
            "highlights": sum(book["highlight_count"] for book in book_stats),
        },
        "charts": {
            "daily": [
                {
                    "date": key,
                    "label": day_label(key),
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
            "calendar": {
                "start_date": sorted_days[0] if sorted_days else None,
                "end_date": sorted_days[-1] if sorted_days else None,
                "max_minutes": seconds_to_minutes(max_day_seconds),
                "total_days": len(sorted_days),
                "days": [
                    {
                        "date": key,
                        "label": day_label(key, include_year=True),
                        "minutes": seconds_to_minutes(day_seconds[key]),
                        "time_label": format_duration(day_seconds[key]),
                        "level": calendar_level(day_seconds[key], max_day_seconds),
                        "book_ids": sorted(
                            {
                                merged_book_ids_by_source[source_book_id]
                                for source_book_id in day_source_book_ids[key]
                            },
                            key=book_id_sort_key,
                        ),
                    }
                    for key in sorted_days
                ],
            },
        },
        "books": book_stats,
        "recent_books": recent_books,
    }
