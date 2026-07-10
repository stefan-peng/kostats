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
    device_id: str | None = None
    device_label: str | None = None
    device_model: str | None = None


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


def iter_month_keys(start: str, end: str) -> list[str]:
    start_year, start_month = [int(part) for part in start.split("-")]
    end_year, end_month = [int(part) for part in end.split("-")]
    year = start_year
    month = start_month
    keys: list[str] = []
    while (year, month) <= (end_year, end_month):
        keys.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            year += 1
            month = 1
    return keys


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


def trailing_day_keys(sorted_days: list[str], *, limit: int = 30) -> list[str]:
    if not sorted_days:
        return []
    end = datetime.strptime(sorted_days[-1], "%Y-%m-%d").date()
    start = max(datetime.strptime(sorted_days[0], "%Y-%m-%d").date(), end - timedelta(days=limit - 1))
    total_days = (end - start).days + 1
    return [(start + timedelta(days=offset)).isoformat() for offset in range(total_days)]


def trailing_month_keys(sorted_months: list[str], *, limit: int = 12) -> list[str]:
    if not sorted_months:
        return []
    end = datetime.strptime(f"{sorted_months[-1]}-01", "%Y-%m-%d").date()
    earliest = datetime.strptime(f"{sorted_months[0]}-01", "%Y-%m-%d").date()
    start_year = end.year
    start_month = end.month - (limit - 1)
    while start_month <= 0:
        start_year -= 1
        start_month += 12
    start = max(earliest, date(start_year, start_month, 1))
    return iter_month_keys(f"{start.year:04d}-{start.month:02d}", f"{end.year:04d}-{end.month:02d}")


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
    "<unknown>",
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
    return real_book_identity_key(value)


def language_identity_key(value: Any) -> str | None:
    key = optional_metadata_key(value)
    if key is None:
        return None
    return key.split("-", 1)[0].split("_", 1)[0] or None


def can_merge_title_group(group: list[str], books: dict[str, dict[str, Any]]) -> bool:
    real_author_keys = {books[book_id]["authors_key"] for book_id in group if books[book_id]["authors_key"]}
    if len(real_author_keys) != 1:
        return False
    series_keys = {books[book_id]["series_key"] for book_id in group if books[book_id]["series_key"]}
    language_keys = {books[book_id]["language_key"] for book_id in group if books[book_id]["language_key"]}
    return len(series_keys) <= 1 and len(language_keys) <= 1


def book_identity_fields(book: dict[str, Any]) -> dict[str, Any]:
    return {
        "title_key": real_book_identity_key(book.get("title")),
        "authors_key": real_book_identity_key(book.get("authors")),
        "series_key": optional_metadata_key(book.get("series")),
        "language_key": language_identity_key(book.get("language")),
    }


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


SESSION_GAP_SECONDS = 15 * 60


def build_sessions(
    events: list[dict[str, Any]],
    merged_book_ids_by_source: dict[str, str],
) -> list[dict[str, Any]]:
    """Group valid KOReader page events into global reading sessions."""
    sessions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for event in sorted(events, key=lambda item: (item["started_at"], item["book_id"])):
        started_at = event["started_at"]
        ended_at = event["ended_at"]
        if current is None or (started_at - current["ended_at"]).total_seconds() > SESSION_GAP_SECONDS:
            if current is not None:
                sessions.append(current)
            current = {
                "started_at": started_at,
                "ended_at": ended_at,
                "active_seconds": 0.0,
                "event_count": 0,
                "book_ids": set(),
            }

        current["ended_at"] = max(current["ended_at"], ended_at)
        current["active_seconds"] += event["duration"]
        current["event_count"] += 1
        current["book_ids"].add(merged_book_ids_by_source[event["book_id"]])

    if current is not None:
        sessions.append(current)

    return [
        {
            "started_at": session["started_at"].isoformat(),
            "ended_at": session["ended_at"].isoformat(),
            "active_seconds": round(session["active_seconds"], 2),
            "elapsed_seconds": round((session["ended_at"] - session["started_at"]).total_seconds(), 2),
            "event_count": session["event_count"],
            "book_ids": sorted(session["book_ids"], key=book_id_sort_key),
            "book_count": len(session["book_ids"]),
        }
        for session in sessions
    ]


def recent_book_activity(
    day_seconds: dict[str, float],
    *,
    today: date | None = None,
    days: int = 5,
) -> list[dict[str, Any]]:
    end = today or (datetime.strptime(max(day_seconds), "%Y-%m-%d").date() if day_seconds else date.today())
    start = end - timedelta(days=days - 1)
    return [
        {
            "date": value.isoformat(),
            "label": f"{calendar.month_abbr[value.month]} {value.day}",
            "minutes": seconds_to_minutes(day_seconds.get(value.isoformat(), 0)),
        }
        for value in (start + timedelta(days=offset) for offset in range(days))
    ]


def build_dashboard(
    path: Path,
    snapshot: SnapshotMeta | None = None,
    today: date | None = None,
    *,
    include_all_sessions: bool = False,
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
    session_events: list[dict[str, Any]] = []
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
        session_events.append(
            {
                "book_id": book_id,
                "started_at": started,
                "ended_at": started + timedelta(seconds=duration),
                "duration": duration,
            }
        )

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
                "language_key": language_identity_key(row["language"]),
                "series": display_text(row["series"], ""),
                "language": display_text(row["language"], ""),
                "last_open_timestamp": 0.0,
                "time_seconds": 0.0,
                "day_seconds": defaultdict(float),
                "pages_seen": set(),
                "max_page": None,
                "total_pages": None,
                "sidecar": None,
            },
        )
        if book["sidecar"] is None and book["md5"]:
            book["sidecar"] = sidecars_by_md5.get(book["md5"])
        book["time_seconds"] += duration
        book["day_seconds"][reading_date] += duration

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
    title_groups: dict[str, list[str]] = defaultdict(list)

    for book_id, book in books.items():
        md5 = book["md5"]
        if md5:
            md5_groups[md5].append(book_id)
        if book["title_key"]:
            title_groups[book["title_key"]].append(book_id)
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

    for group in title_groups.values():
        if len(group) < 2 or not can_merge_title_group(group, books):
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
        book_day_seconds: dict[str, float] = defaultdict(float)
        for book in group:
            for day, seconds in book["day_seconds"].items():
                book_day_seconds[day] += seconds
        pace_seconds_per_page = time_seconds / pages_read if pages_read else None
        remaining_pages = max(total_pages - max_page, 0) if total_pages and max_page else None
        estimated_remaining_seconds = None
        if (
            effective_book_status({"status": sidecar.get("status") if sidecar else None, "progress": progress}) == "reading"
            and pace_seconds_per_page is not None
            and remaining_pages is not None
        ):
            estimated_remaining_seconds = round(remaining_pages * pace_seconds_per_page, 2)
        recent_activity = recent_book_activity(book_day_seconds, today=today)
        activity_devices: list[dict[str, str]] = []
        if snapshot and snapshot.device_id:
            device_id = str(snapshot.device_id)
            for activity in recent_activity:
                activity[device_id] = activity["minutes"]
            activity_devices.append({"id": device_id, "label": snapshot.device_label or device_id})

        book_stat = {
            "id": merged_book_id,
            "title": latest_book["title"],
            "authors": latest_book["authors"],
            "last_open": last_open,
            "time_seconds": round(time_seconds, 2),
            "time_label": format_duration(time_seconds),
            "pace_seconds_per_page": round(pace_seconds_per_page, 2) if pace_seconds_per_page is not None else None,
            "estimated_remaining_seconds": estimated_remaining_seconds,
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
            "recent_sessions": [],
            "recent_activity": recent_activity,
            "recent_activity_devices": activity_devices,
        }
        if include_all_sessions:
            book_stat["_page_numbers"] = sorted(
                {page for source_book in group for page in source_book["pages_seen"]}
            )
        book_stats.append(book_stat)

    sessions = build_sessions(session_events, merged_book_ids_by_source)
    sessions_by_book: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for session in sessions:
        for book_id in session["book_ids"]:
            sessions_by_book[book_id].append(session)
    for book in book_stats:
        book["recent_sessions"] = list(reversed(sessions_by_book.get(book["id"], [])))[:10]

    book_stats = sorted(book_stats, key=lambda item: item["last_open"] or "", reverse=True)
    recent_books = book_stats[:20]
    top_books = sorted(book_stats, key=lambda item: item["time_seconds"], reverse=True)[:10]
    status_counts = {
        status: sum(1 for book in book_stats if effective_book_status(book) == status)
        for status in ("complete", "reading", "abandoned")
    }

    sorted_days = sorted(day_seconds)
    sorted_months = sorted(month_seconds)
    latest_days = trailing_day_keys(sorted_days)
    latest_months = trailing_month_keys(sorted_months)
    max_day_seconds = max(day_seconds.values(), default=0.0)

    dashboard = {
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
        "insights": {
            "sessions": {
                "available": True,
                "total": len(sessions),
                "average_active_seconds": round(total_seconds / len(sessions), 2) if sessions else 0,
                "longest_active_seconds": max((session["active_seconds"] for session in sessions), default=0),
                "recent": list(reversed(sessions))[:30],
            }
        },
        "charts": {
            "daily": [
                {
                    "date": key,
                    "label": day_label(key),
                    "minutes": seconds_to_minutes(day_seconds.get(key, 0.0)),
                }
                for key in latest_days
            ],
            "monthly": [
                {
                    "month": key,
                    "label": month_label(key),
                    "hours": seconds_to_hours(month_seconds.get(key, 0.0)),
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
    if include_all_sessions:
        dashboard["_all_sessions"] = sessions
    return dashboard


def empty_dashboard() -> dict[str, Any]:
    return {
        "has_data": False,
        "snapshot": None,
        "summary": {
            "total_time_seconds": 0,
            "total_time_label": "0m",
            "reading_days": 0,
            "books": 0,
            "pages": 0,
            "current_streak": 0,
            "finished_books": 0,
            "reading_books": 0,
            "abandoned_books": 0,
            "highlights": 0,
        },
        "insights": {
            "sessions": {
                "available": False,
                "total": 0,
                "average_active_seconds": 0,
                "longest_active_seconds": 0,
                "recent": [],
            }
        },
        "charts": {
            "daily": [],
            "monthly": [],
            "top_books": [],
            "calendar": {
                "start_date": None,
                "end_date": None,
                "max_minutes": 0,
                "total_days": 0,
                "days": [],
            },
        },
        "books": [],
        "recent_books": [],
    }


def aggregate_dashboards(
    dashboards: list[dict[str, Any]],
    *,
    snapshots: list[SnapshotMeta],
    today: date | None = None,
) -> dict[str, Any]:
    dashboards = [dashboard for dashboard in dashboards if dashboard.get("has_data")]
    if not dashboards:
        return empty_dashboard()
    if len(dashboards) == 1:
        dashboard = dashboards[0]
        return {
            **{key: value for key, value in dashboard.items() if key != "_all_sessions"},
            "books": [{key: value for key, value in book.items() if not key.startswith("_")} for book in dashboard["books"]],
            "recent_books": [
                {key: value for key, value in book.items() if not key.startswith("_")}
                for book in dashboard["recent_books"]
            ],
        }

    total_seconds = sum(float(dashboard["summary"]["total_time_seconds"]) for dashboard in dashboards)
    day_minutes: dict[str, float] = defaultdict(float)
    day_book_ids: dict[str, set[str]] = defaultdict(set)
    day_device_minutes: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    month_hours: dict[str, float] = defaultdict(float)
    month_device_hours: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    aggregate_books: list[dict[str, Any]] = []
    device_labels: dict[str, str] = {}
    device_sessions: list[tuple[str, str, dict[str, Any]]] = []

    for dashboard in dashboards:
        snapshot = dashboard.get("snapshot") or {}
        raw_device_id = str(snapshot.get("device_id") or "unknown")
        device_label = re.sub(r"\s+", " ", str(snapshot.get("device_label") or raw_device_id)).strip() or raw_device_id
        device_id = raw_device_id
        device_labels[device_id] = device_label
        for item in dashboard["charts"]["calendar"]["days"]:
            date_key = item["date"]
            day_minutes[date_key] += float(item["minutes"])
            day_device_minutes[date_key][device_id] += float(item["minutes"])
            day_book_ids[date_key].update(f"{raw_device_id}:{book_id}" for book_id in item.get("book_ids", []))
        for item in dashboard["charts"]["monthly"]:
            month_hours[item["month"]] += float(item["hours"])
            month_device_hours[item["month"]][device_id] += float(item["hours"])
        for book in dashboard["books"]:
            aggregate_books.append({**book, **book_identity_fields(book), "_aggregate_device_id": raw_device_id})
        for session in dashboard.get("_all_sessions", dashboard.get("insights", {}).get("sessions", {}).get("recent", [])):
            if isinstance(session, dict):
                device_sessions.append((raw_device_id, device_label, session))

    aggregate_ids = [str(index) for index in range(len(aggregate_books))]
    aggregate_merger = UnionFind(aggregate_ids)
    md5_groups: dict[str, list[str]] = defaultdict(list)
    title_author_groups: dict[tuple[str, str], list[str]] = defaultdict(list)
    title_groups: dict[str, list[str]] = defaultdict(list)

    for index, book in enumerate(aggregate_books):
        book_id = str(index)
        for md5 in book.get("source_md5s", []):
            if md5:
                md5_groups[str(md5)].append(book_id)
        if book["title_key"]:
            title_groups[book["title_key"]].append(book_id)
        if book["title_key"] and book["authors_key"]:
            title_author_groups[(book["title_key"], book["authors_key"])].append(book_id)

    aggregate_books_by_id = {str(index): book for index, book in enumerate(aggregate_books)}

    for group in md5_groups.values():
        for book_id in group[1:]:
            aggregate_merger.union(group[0], book_id)
    for group in title_author_groups.values():
        if len(group) < 2 or not can_merge_title_group(group, aggregate_books_by_id):
            continue
        for book_id in group[1:]:
            aggregate_merger.union(group[0], book_id)
    for group in title_groups.values():
        if len(group) < 2 or not can_merge_title_group(group, aggregate_books_by_id):
            continue
        for book_id in group[1:]:
            aggregate_merger.union(group[0], book_id)

    books_by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for book_id, book in zip(aggregate_ids, aggregate_books):
        books_by_key[aggregate_merger.find(book_id)].append(book)

    merged_books: list[dict[str, Any]] = []
    aggregate_id_by_device_book_id: dict[str, str] = {}
    for group in books_by_key.values():
        latest = max(group, key=lambda item: (item.get("last_open") or "", item.get("id") or ""))
        time_seconds = sum(float(item.get("time_seconds") or 0) for item in group)
        has_page_numbers = any("_page_numbers" in item for item in group)
        page_numbers = {page for item in group for page in item.get("_page_numbers", [])}
        pages_seen = len(page_numbers) if has_page_numbers else sum(int(item.get("pages") or 0) for item in group)
        pace_seconds_per_page = time_seconds / pages_seen if pages_seen else None
        latest_total_pages = latest.get("total_pages")
        latest_max_page = latest.get("max_page")
        remaining_pages = (
            max(int(latest_total_pages) - int(latest_max_page), 0)
            if latest_total_pages and latest_max_page
            else None
        )
        estimated_remaining_seconds = None
        if (
            effective_book_status(latest) == "reading"
            and pace_seconds_per_page is not None
            and remaining_pages is not None
        ):
            estimated_remaining_seconds = round(remaining_pages * pace_seconds_per_page, 2)
        source_book_ids = sorted(
            {
                f"{item.get('_aggregate_device_id', 'unknown')}:{book_id}"
                for item in group
                for book_id in item.get("source_book_ids", [])
            },
            key=book_id_sort_key,
        )
        source_md5s = sorted({str(md5) for item in group for md5 in item.get("source_md5s", []) if md5})
        activity_seconds: dict[str, float] = defaultdict(float)
        activity_device_seconds: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for item in group:
            for activity in item.get("recent_activity", []):
                activity_date = str(activity.get("date"))
                seconds = float(activity.get("minutes") or 0) * 60
                activity_seconds[activity_date] += seconds
                activity_device_seconds[activity_date][str(item["_aggregate_device_id"])] += seconds
        activity_end = datetime.strptime(max(activity_seconds), "%Y-%m-%d").date() if activity_seconds else None
        recent_activity = recent_book_activity(activity_seconds, today=activity_end)
        activity_device_ids = sorted(
            {device_id for values in activity_device_seconds.values() for device_id, seconds in values.items() if seconds > 0},
            key=lambda device_id: device_labels[device_id],
        )
        for activity in recent_activity:
            for device_id in activity_device_ids:
                activity[device_id] = seconds_to_minutes(activity_device_seconds[activity["date"]].get(device_id, 0.0))
        merged = {
            **latest,
            "id": source_book_ids[0] if len(source_book_ids) <= 1 else stable_merged_book_id(source_book_ids),
            "time_seconds": round(time_seconds, 2),
            "time_label": format_duration(time_seconds),
            "pages": pages_seen,
            "highlight_count": max(int(item.get("highlight_count") or 0) for item in group),
            "note_count": max(int(item.get("note_count") or 0) for item in group),
            "source_book_ids": source_book_ids,
            "source_md5s": source_md5s,
            "merged_count": sum(int(item.get("merged_count") or 1) for item in group),
            "pace_seconds_per_page": round(pace_seconds_per_page, 2) if pace_seconds_per_page is not None else None,
            "estimated_remaining_seconds": estimated_remaining_seconds,
            "recent_sessions": [],
            "recent_activity": recent_activity,
            "recent_activity_devices": [
                {"id": device_id, "label": device_labels[device_id]}
                for device_id in activity_device_ids
            ],
        }
        for key in ("_aggregate_device_id", "_page_numbers", "title_key", "authors_key", "series_key", "language_key"):
            merged.pop(key, None)
        merged_books.append(merged)
        for item in group:
            aggregate_id_by_device_book_id[f"{item['_aggregate_device_id']}:{item['id']}"] = merged["id"]

    merged_books = sorted(merged_books, key=lambda item: item.get("last_open") or "", reverse=True)
    merged_id_by_source: dict[str, str] = {}
    for book in merged_books:
        for source_book_id in book.get("source_book_ids", []):
            merged_id_by_source[str(source_book_id)] = book["id"]

    aggregate_sessions: list[dict[str, Any]] = []
    for device_id, device_label, session in device_sessions:
        book_ids = sorted(
            {
                aggregate_id_by_device_book_id[f"{device_id}:{book_id}"]
                for book_id in session.get("book_ids", [])
                if f"{device_id}:{book_id}" in aggregate_id_by_device_book_id
            },
            key=book_id_sort_key,
        )
        aggregate_sessions.append({
            **session,
            "book_ids": book_ids,
            "book_count": len(book_ids),
            "device_id": device_id,
            "device_label": device_label,
        })
    aggregate_sessions.sort(key=lambda item: str(item.get("started_at") or ""), reverse=True)
    aggregate_sessions_by_book: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for session in aggregate_sessions:
        for book_id in session["book_ids"]:
            aggregate_sessions_by_book[book_id].append(session)
    for book in merged_books:
        book["recent_sessions"] = aggregate_sessions_by_book.get(book["id"], [])[:10]

    total_sessions = sum(
        int(dashboard.get("insights", {}).get("sessions", {}).get("total") or 0)
        for dashboard in dashboards
    )
    total_session_active_seconds = sum(
        float(dashboard.get("insights", {}).get("sessions", {}).get("average_active_seconds") or 0)
        * int(dashboard.get("insights", {}).get("sessions", {}).get("total") or 0)
        for dashboard in dashboards
    )

    day_seconds = {key: value * 60 for key, value in day_minutes.items()}
    sorted_days = sorted(day_seconds)
    sorted_months = sorted(month_hours)
    latest_days = trailing_day_keys(sorted_days)
    latest_months = trailing_month_keys(sorted_months)
    max_day_seconds = max(day_seconds.values(), default=0.0)
    status_counts = {
        status: sum(1 for book in merged_books if effective_book_status(book) == status)
        for status in ("complete", "reading", "abandoned")
    }
    latest_snapshot = max(snapshots, key=lambda item: item.imported_at)

    return {
        "has_data": True,
        "snapshot": {
            **latest_snapshot.__dict__,
            "id": "aggregate",
            "source": "aggregate",
            "source_path": "All devices",
            "device_id": "all",
            "device_label": "All devices",
        },
        "summary": {
            "total_time_seconds": round(total_seconds, 2),
            "total_time_label": format_duration(total_seconds),
            "reading_days": len(day_seconds),
            "books": len(merged_books),
            "pages": sum(int(book.get("pages") or 0) for book in merged_books),
            "current_streak": current_streak(set(day_seconds), today=today),
            "finished_books": status_counts["complete"],
            "reading_books": status_counts["reading"],
            "abandoned_books": status_counts["abandoned"],
            "highlights": sum(int(book.get("highlight_count") or 0) for book in merged_books),
        },
        "insights": {
            "sessions": {
                "available": True,
                "total": total_sessions,
                "average_active_seconds": round(total_session_active_seconds / total_sessions, 2) if total_sessions else 0,
                "longest_active_seconds": max(
                    (float(dashboard.get("insights", {}).get("sessions", {}).get("longest_active_seconds") or 0) for dashboard in dashboards),
                    default=0,
                ),
                "recent": aggregate_sessions[:30],
            }
        },
        "charts": {
            "daily": [
                {
                    "date": key,
                    "label": day_label(key),
                    "minutes": seconds_to_minutes(day_seconds.get(key, 0.0)),
                }
                for key in latest_days
            ],
            "monthly": [
                {
                    "month": key,
                    "label": month_label(key),
                    "hours": month_hours.get(key, 0.0),
                }
                for key in latest_months
            ],
            "daily_by_device": [
                {
                    "date": key,
                    "label": day_label(key),
                    **{
                        device_id: round(day_device_minutes[key].get(device_id, 0.0), 2)
                        for device_id in sorted(device_labels)
                    },
                }
                for key in latest_days
            ],
            "monthly_by_device": [
                {
                    "month": key,
                    "label": month_label(key),
                    **{
                        device_id: round(month_device_hours[key].get(device_id, 0.0), 2)
                        for device_id in sorted(device_labels)
                    },
                }
                for key in latest_months
            ],
            "devices": [
                {"id": device_id, "label": device_labels[device_id]}
                for device_id in sorted(device_labels, key=lambda key: device_labels[key])
            ],
            "top_books": [
                {
                    "id": item["id"],
                    "title": item["title"],
                    "hours": seconds_to_hours(float(item.get("time_seconds") or 0)),
                }
                for item in sorted(merged_books, key=lambda item: item["time_seconds"], reverse=True)[:10]
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
                                merged_id_by_source.get(source_book_id, source_book_id)
                                for source_book_id in day_book_ids[key]
                            },
                            key=book_id_sort_key,
                        ),
                    }
                    for key in sorted_days
                ],
            },
        },
        "books": merged_books,
        "recent_books": merged_books[:20],
    }
