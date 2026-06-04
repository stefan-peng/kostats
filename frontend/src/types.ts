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
};

export type AutoImportResult = {
  imported: boolean;
  reason: "changed" | "unchanged" | "not_mounted" | "database_missing" | "access_blocked";
  snapshot: Snapshot | null;
  device: DeviceStatus;
  dashboard?: Dashboard;
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
