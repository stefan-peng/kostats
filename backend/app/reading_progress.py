"""Reading coverage from accepted KOReader page visits, independent of layout."""

from __future__ import annotations

import math
from typing import Any


def page_interval(page: Any, total: Any) -> tuple[float, float] | None:
    try:
        page, total = int(page), int(total)
    except (TypeError, ValueError, OverflowError):
        return None
    if total <= 0 or not 1 <= page <= total:
        return None
    return ((page - 1) / total, page / total)


def merge_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1] + 1e-12:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def coverage(intervals: list[tuple[float, float]]) -> float:
    return sum(end - start for start, end in merge_intervals(intervals))


def normalized_pages(intervals: list[tuple[float, float]], total: int | None) -> set[int]:
    if not total:
        return set()
    return {
        page
        for start, end in merge_intervals(intervals)
        for page in range(math.floor(start * total + 1e-9) + 1, math.ceil(end * total - 1e-9) + 1)
    }


def estimate_book(book: dict[str, Any], sessions: list[dict[str, Any]]) -> None:
    """Weight session pace by coverage; unknown coverage never supplies pace time."""
    eligible = [s for s in sessions if s.get("coverage_percent")]
    percent = sum(s["coverage_percent"] for s in eligible)
    seconds = sum(s["active_seconds"] for s in eligible)
    pace = seconds / percent if percent > 0 else None
    book["reading_coverage_percent"] = percent
    book["pace_time_seconds"] = seconds
    book["pace_seconds_per_percent"] = pace
    book["pace_seconds_per_page"] = (
        round(pace * 100 / book["total_pages"], 2) if pace is not None and book.get("total_pages") else None
    )
    position = book.get("position_fraction")
    if position is None and book.get("progress") is not None:
        position = book["progress"] / 100
    status = book.get("status")
    reading = status == "reading" or (status is None and position is not None and position < 1)
    book["estimated_remaining_seconds"] = (
        round(pace * max(0, min(1, 1 - position)) * 100, 2)
        if reading and pace is not None and position is not None else None
    )
