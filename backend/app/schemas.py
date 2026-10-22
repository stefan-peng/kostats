"""Public API contracts. Internal statistics and backup calculations stay dictionaries."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class CandidateStatus(BaseModel):
    path: str
    exists: bool
    readable: bool
    error: str | None


class DeviceStatus(BaseModel):
    mount_path: str
    mounted: bool
    database_found: bool
    selected_path: str | None
    permission_error: str | None
    candidates: list[CandidateStatus]
    searched_mount_paths: list[str] = []


class DeviceRecord(BaseModel):
    id: str
    label: str
    model: str | None
    koreader_version: str | None = None
    source: str
    first_seen: str | None = None
    last_seen: str | None = None


class DeviceSummary(DeviceRecord):
    snapshot_count: int
    backup_count: int
    last_snapshot_at: str | None
    last_backup_at: str | None


class Snapshot(BaseModel):
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


class AutoImportResult(BaseModel):
    imported: bool
    reason: Literal['changed', 'unchanged', 'not_mounted', 'database_missing', 'access_blocked', 'device_unassigned']
    snapshot: Snapshot | None
    device: DeviceStatus
    covers_changed: bool = False


class RecoveryBackup(BaseModel):
    id: str
    format_version: int | None
    created_at: str
    source: str
    source_mount: str
    archive_path: str
    archive_size: int
    content_hash: str
    koreader_version: str | None
    device_id: str | None = None
    device_label: str | None = None
    device_model: str | None
    document_metadata_folder: Literal['doc', 'dir', 'hash']
    credentials_included: bool
    counts: dict[str, int]


class RestoreCandidate(BaseModel):
    path: str
    doc_path: str
    partial_md5_checksum: str
    title: str
    authors: str | None


class RestoreMatch(BaseModel):
    source_path: str | None
    old_doc_path: str | None
    new_doc_path: str | None = None
    new_path: str | None = None
    title: str | None
    authors: str | None
    partial_md5_checksum: str | None
    candidates: list[RestoreCandidate] = []
    fallback_candidates: list[RestoreCandidate] = []


class RestorePreview(BaseModel):
    backup: RecoveryBackup
    device: DeviceStatus
    current_koreader_version: str | None
    version_warning: bool
    device_warning: bool = False
    current_device: DeviceRecord | None = None
    required_bytes: int
    available_bytes: int
    counts: dict[str, int]
    exact_matches: list[RestoreMatch]
    missing_matches: list[RestoreMatch]
    ambiguous_matches: list[RestoreMatch]
    book_count: int


class RestoreFailure(BaseModel):
    path: str
    error: str


class RestoreResult(BaseModel):
    restored: dict[str, int]
    skipped: dict[str, int]
    failed: list[RestoreFailure]
    safety_backup_id: str
    restart_required: bool


class ReadingSession(BaseModel):
    started_at: str
    ended_at: str
    active_seconds: float
    elapsed_seconds: float
    event_count: int
    coverage_percent: float | None
    pages: float | None
    book_ids: list[str]
    book_count: int
    device_label: str | None = None
    device_id: str | None = None


class DeviceLabel(BaseModel):
    id: str
    label: str


class RecentActivity(BaseModel):
    model_config = ConfigDict(extra='allow')
    __pydantic_extra__: dict[str, str | float]
    date: str
    label: str
    minutes: float
    pages: float


class BookStats(BaseModel):
    id: str
    title: str
    authors: str
    last_open: str | None
    time_seconds: float
    time_label: str
    pace_seconds_per_page: float | None
    pace_seconds_per_percent: float | None
    estimated_remaining_seconds: float | None
    pages: int
    max_page: int | None
    total_pages: int | None
    progress: float | None
    percent_finished: float | None
    status: Literal['reading', 'complete', 'abandoned', 'unread'] | None
    status_modified: str | None
    highlight_count: int
    note_count: int
    series: str
    series_index: float | None
    language: str
    metadata_available: bool
    source_book_ids: list[str]
    source_md5s: list[str]
    cover_url: str | None = None
    merged_count: int
    recent_sessions: list[ReadingSession]
    recent_activity: list[RecentActivity]
    recent_activity_devices: list[DeviceLabel] = []


class Summary(BaseModel):
    total_time_seconds: float
    total_time_label: str
    reading_days: int
    books: int
    pages: int
    current_streak: int
    finished_books: int
    reading_books: int
    unread_books: int
    abandoned_books: int
    highlights: int


class SessionInsights(BaseModel):
    available: bool
    total: int
    average_active_seconds: float
    longest_active_seconds: float
    recent: list[ReadingSession]


class Insights(BaseModel):
    sessions: SessionInsights


class MonthlyActivity(BaseModel):
    month: str
    label: str
    hours: float
    pages: float


class TopBook(BaseModel):
    id: str
    title: str
    hours: float


class CalendarDay(BaseModel):
    date: str
    label: str
    minutes: float
    pages: float
    time_label: str
    level: Literal[0, 1, 2, 3, 4]
    book_ids: list[str]


class Calendar(BaseModel):
    start_date: str | None
    end_date: str | None
    max_minutes: float
    total_days: int
    days: list[CalendarDay]


class Charts(BaseModel):
    daily: list[RecentActivity]
    monthly: list[MonthlyActivity]
    top_books: list[TopBook]
    devices: list[DeviceLabel] = []
    daily_by_device: list[dict[str, str | float]] = []
    monthly_by_device: list[dict[str, str | float]] = []
    calendar: Calendar


class Dashboard(BaseModel):
    has_data: bool
    snapshot: Snapshot | None
    summary: Summary
    insights: Insights
    charts: Charts
    books: list[BookStats]
    recent_books: list[BookStats]


class DevicesResponse(BaseModel):
    devices: list[DeviceSummary]


class DeviceResponse(BaseModel):
    device: DeviceRecord


class SnapshotsResponse(BaseModel):
    snapshots: list[Snapshot]


class SnapshotResponse(BaseModel):
    snapshot: Snapshot


class BackupsResponse(BaseModel):
    backups: list[RecoveryBackup]


class BackupResponse(BaseModel):
    created: bool
    backup: RecoveryBackup


class ImportResponse(BaseModel):
    snapshot: Snapshot
    dashboard: Dashboard
