export type CandidateStatus = {
  path: string;
  exists: boolean;
  readable: boolean;
  error: string | null;
};

export type DeviceStatus = {
  mount_path: string;
  mounted: boolean;
  database_found: boolean;
  selected_path: string | null;
  permission_error: string | null;
  candidates: CandidateStatus[];
  searched_mount_paths?: string[];
};

export type Snapshot = {
  id: string;
  imported_at: string;
  source: string;
  source_path: string | null;
  path: string;
  file_size: number;
  user_version: number;
  schema_version: string;
  content_hash?: string | null;
  sidecar_path?: string | null;
  sidecar_hash?: string | null;
};

export type AutoImportResult = {
  imported: boolean;
  reason: "changed" | "unchanged" | "not_mounted" | "database_missing" | "access_blocked";
  snapshot: Snapshot | null;
  device: DeviceStatus;
  dashboard?: Dashboard;
};

export type RecoveryBackup = {
  id: string;
  created_at: string;
  source: string;
  source_mount: string;
  archive_path: string;
  archive_size: number;
  content_hash: string;
  koreader_version: string | null;
  device_model: string | null;
  document_metadata_folder: "doc" | "dir" | "hash";
  credentials_included: boolean;
  counts: Record<string, number>;
};

export type RestoreMatch = {
  source_path: string | null;
  old_doc_path: string | null;
  new_doc_path?: string;
  new_path?: string;
  title: string | null;
  authors: string | null;
  partial_md5_checksum: string | null;
  candidates?: Array<{
    path: string;
    doc_path: string;
    partial_md5_checksum: string;
    title: string;
    authors: string | null;
  }>;
  fallback_candidates?: Array<{
    path: string;
    doc_path: string;
    partial_md5_checksum: string;
    title: string;
    authors: string | null;
  }>;
};

export type RestorePreview = {
  backup: RecoveryBackup;
  device: DeviceStatus;
  current_koreader_version: string | null;
  version_warning: boolean;
  required_bytes: number;
  available_bytes: number;
  counts: Record<string, number>;
  exact_matches: RestoreMatch[];
  missing_matches: RestoreMatch[];
  ambiguous_matches: RestoreMatch[];
  book_count: number;
};

export type RestoreResult = {
  restored: Record<string, number>;
  skipped: Record<string, number>;
  failed: Array<{ path: string; error: string }>;
  safety_backup_id: string;
  restart_required: boolean;
};

export type BookStats = {
  id: string;
  title: string;
  authors: string;
  last_open: string | null;
  time_seconds: number;
  time_label: string;
  pages: number;
  max_page: number | null;
  total_pages: number | null;
  progress: number | null;
  percent_finished: number | null;
  status: "reading" | "complete" | "abandoned" | null;
  status_modified: string | null;
  highlight_count: number;
  note_count: number;
  series: string;
  series_index: number | null;
  language: string;
  metadata_available: boolean;
  source_book_ids: string[];
  source_md5s: string[];
  merged_count: number;
};

export type Dashboard = {
  has_data: boolean;
  snapshot: Snapshot | null;
  summary: {
    total_time_seconds: number;
    total_time_label: string;
    reading_days: number;
    books: number;
    pages: number;
    current_streak: number;
    finished_books: number;
    reading_books: number;
    abandoned_books: number;
    highlights: number;
  };
  charts: {
    daily: Array<{ date: string; label: string; minutes: number }>;
    monthly: Array<{ month: string; label: string; hours: number }>;
    top_books: Array<{ id: string; title: string; hours: number }>;
    calendar: {
      start_date: string | null;
      end_date: string | null;
      max_minutes: number;
      total_days: number;
      days: Array<{
        date: string;
        label: string;
        minutes: number;
        time_label: string;
        level: 0 | 1 | 2 | 3 | 4;
      }>;
    };
  };
  books: BookStats[];
  recent_books: BookStats[];
};
