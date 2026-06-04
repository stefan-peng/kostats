import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  autoImportFromKobo,
  getDashboard,
  getDeviceStatus,
  getSnapshots,
  importFromKobo,
  uploadDatabase,
} from "./api";
import type { BookStats, Dashboard, DeviceStatus, Snapshot } from "./types";

type View = "dashboard" | "snapshots" | "books" | "calendar" | "export" | "settings";
type BookSortKey = "last_open" | "time_seconds" | "pages" | "progress" | "title";
type BookProgressFilter = "all" | "in-progress" | "finished" | "unknown";

const emptyDashboard: Dashboard = {
  has_data: false,
  snapshot: null,
  summary: {
    total_time_seconds: 0,
    total_time_label: "0m",
    reading_days: 0,
    books: 0,
    pages: 0,
    current_streak: 0,
  },
  charts: {
    daily: [],
    monthly: [],
    top_books: [],
    calendar: {
      start_date: null,
      end_date: null,
      max_minutes: 0,
      total_days: 0,
      days: [],
    },
  },
  books: [],
  recent_books: [],
};

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const mainLayoutStyle: CSSProperties = { alignContent: "start" };

type CalendarDay = Dashboard["charts"]["calendar"]["days"][number];

type CalendarCell = {
  date: string;
  day: CalendarDay | null;
  outsideRange: boolean;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatCalendarDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${hours}h`;
}

function formatDurationLabel(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

function buildCalendarCells(calendar: Dashboard["charts"]["calendar"]) {
  if (!calendar.start_date || !calendar.end_date || calendar.days.length === 0) {
    return { cells: [] as CalendarCell[], weeks: 0, monthLabels: [] as Array<{ week: number; label: string }> };
  }

  const dayMap = new Map(calendar.days.map((day) => [day.date, day]));
  const firstReadingDay = parseCalendarDate(calendar.start_date);
  const lastReadingDay = parseCalendarDate(calendar.end_date);
  const start = addDays(firstReadingDay, -firstReadingDay.getDay());
  const end = addDays(lastReadingDay, 6 - lastReadingDay.getDay());
  const cells: CalendarCell[] = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const key = formatCalendarDate(date);
    cells.push({
      date: key,
      day: dayMap.get(key) ?? null,
      outsideRange: date < firstReadingDay || date > lastReadingDay,
    });
  }

  const weeks = Math.ceil(cells.length / 7);
  const monthLabels: Array<{ week: number; label: string }> = [];
  let lastMonth = "";
  for (let week = 0; week < weeks; week += 1) {
    const weekCells = cells.slice(week * 7, week * 7 + 7);
    const monthCell = weekCells.find((cell) => week === 0 && !cell.outsideRange) ?? weekCells.find((cell) => {
      const day = parseCalendarDate(cell.date).getDate();
      return day <= 7 && !cell.outsideRange;
    });
    if (!monthCell) continue;
    const monthKey = monthCell.date.slice(0, 7);
    if (monthKey === lastMonth) continue;
    lastMonth = monthKey;
    monthLabels.push({
      week,
      label: parseCalendarDate(monthCell.date).toLocaleDateString(undefined, { month: "short" }),
    });
  }

  return { cells, weeks, monthLabels };
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatProgress(book: BookStats) {
  return book.progress == null ? "N/A" : `${book.progress}%`;
}

function formatPageProgress(book: BookStats) {
  if (book.max_page == null && book.total_pages == null) return "Unknown";
  if (book.total_pages == null) return `Page ${book.max_page?.toLocaleString() ?? "?"}`;
  return `${book.max_page?.toLocaleString() ?? "?"} / ${book.total_pages.toLocaleString()}`;
}

function formatSourceRecords(book: BookStats) {
  return book.merged_count === 1 ? "1 record" : `${book.merged_count} records`;
}

function matchesProgressFilter(book: BookStats, filter: BookProgressFilter) {
  if (filter === "all") return true;
  if (filter === "unknown") return book.progress == null;
  if (filter === "finished") return book.progress != null && book.progress >= 100;
  return book.progress != null && book.progress < 100;
}

function compareNullableNumbers(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a - b;
}

function escapeCsv(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatSnapshotSource(snapshot: Snapshot | null) {
  if (!snapshot) return "Connect Kobo or upload DB";
  const path = snapshot.source_path ?? snapshot.source;
  if (snapshot.source === "kobo-auto") return `Auto Kobo import: ${path}`;
  if (snapshot.source === "kobo") return `Kobo import: ${path}`;
  return path;
}

function Icon({ name }: { name: string }) {
  return (
    <span className="icon" aria-hidden="true">
      {name}
    </span>
  );
}

function DeviceBanner({
  status,
  activeSnapshot,
  latestSnapshot,
  onImport,
  onUploadClick,
  busy,
}: {
  status: DeviceStatus | null;
  activeSnapshot: Snapshot | null;
  latestSnapshot: Snapshot | null;
  onImport: () => void;
  onUploadClick: () => void;
  busy: boolean;
}) {
  const mounted = status?.mounted ?? false;
  const found = status?.database_found ?? false;
  const blocked = Boolean(status?.permission_error);
  const stateLabel = blocked
    ? "Access blocked"
    : mounted && found
      ? "Ready to import"
      : mounted
        ? "Database not found"
        : "Kobo not mounted";
  const stateClass = mounted && found && !blocked ? "good" : mounted || blocked ? "warn" : "quiet";

  return (
    <section className="device-banner" aria-label="Device import status">
      <div className="device-main">
        <span className={`status-dot ${stateClass}`} />
        <div className="device-icon">▯</div>
        <div>
          <h2>Kobo / KOReader</h2>
          <p className={stateClass}>{stateLabel}</p>
        </div>
      </div>
      {activeSnapshot ? (
        <SnapshotMeta label={activeSnapshot.id === latestSnapshot?.id ? "Snapshot" : "Viewing"} snapshot={activeSnapshot} />
      ) : null}
      {latestSnapshot && activeSnapshot?.id !== latestSnapshot.id ? (
        <SnapshotMeta label="Latest" snapshot={latestSnapshot} />
      ) : null}
      <div className="actions">
        <button className="primary" disabled={busy || !found} onClick={onImport}>
          <Icon name="↓" /> {busy ? "Importing..." : "Import from Kobo"}
        </button>
        <button className="secondary" disabled={busy} onClick={onUploadClick}>
          <Icon name="↑" /> Upload DB
        </button>
      </div>
    </section>
  );
}

function SnapshotMeta({ label, snapshot }: { label: string; snapshot: Snapshot | null }) {
  return (
    <div className="device-meta">
      <span>{label}</span>
      <strong>{snapshot ? formatDateTime(snapshot.imported_at) : "None"}</strong>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function VerticalBars({
  title,
  data,
  valueKey,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  valueKey: string;
}) {
  const max = Math.max(1, ...data.map((item) => Number(item[valueKey])));
  return (
    <section className="chart-panel">
      <header>
        <h3>{title}</h3>
      </header>
      {data.length === 0 ? (
        <div className="empty-chart">No reading data yet</div>
      ) : (
        <div className="bar-chart" role="img" aria-label={`${title} chart`}>
          {data.map((item) => (
            <div className="bar-column" key={String(item.label)}>
              <span
                className="bar"
                style={{ height: `${Math.max(4, (Number(item[valueKey]) / max) * 100)}%` }}
                title={`${item.label}: ${item[valueKey]}`}
              />
              <small>{item.label}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TopBooksChart({ data }: { data: Dashboard["charts"]["top_books"] }) {
  const max = Math.max(1, ...data.map((item) => item.hours));
  return (
    <section className="chart-panel top-books-panel">
      <header>
        <h3>Top books</h3>
      </header>
      {data.length === 0 ? (
        <div className="empty-chart">No books yet</div>
      ) : (
        <div className="top-books-list">
          {data.map((item) => (
            <div className="top-book-row" key={item.id}>
              <span>{item.title}</span>
              <div className="track">
                <b style={{ width: `${(item.hours / max) * 100}%` }} />
              </div>
              <em>{item.hours.toFixed(1)}h</em>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentBooks({ books }: { books: Dashboard["recent_books"] }) {
  return (
    <section className="recent-panel">
      <header>
        <h3>Recent books</h3>
      </header>
      <div className="table-wrap">
        <table className="data-table recent-books-table">
          <colgroup>
            <col className="book-col" />
            <col className="author-col" />
            <col className="date-col" />
            <col className="time-col" />
            <col className="pages-col" />
            <col className="progress-col" />
          </colgroup>
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Last opened</th>
              <th>Time</th>
              <th>Pages</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {books.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-row">
                  No books yet.
                </td>
              </tr>
            ) : (
              books.map((book) => (
                <tr key={book.id}>
                  <td className="book-title" title={book.title}>
                    <span className="cell-truncate">{book.title}</span>
                  </td>
                  <td title={book.authors}>
                    <span className="cell-truncate">{book.authors}</span>
                  </td>
                  <td title={formatDateTime(book.last_open)}>
                    <span className="cell-truncate">{formatDateTime(book.last_open)}</span>
                  </td>
                  <td>{book.time_label}</td>
                  <td>{book.pages.toLocaleString()}</td>
                  <td>
                    <div className="progress-cell">
                      <span>
                        <b style={{ width: `${book.progress ?? 0}%` }} />
                      </span>
                      <em>{formatProgress(book)}</em>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BooksView({ books }: { books: BookStats[] }) {
  const [query, setQuery] = useState("");
  const [progressFilter, setProgressFilter] = useState<BookProgressFilter>("all");
  const [sortKey, setSortKey] = useState<BookSortKey>("last_open");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const filteredBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const sorted = books
      .filter((book) => {
        const haystack = `${book.title} ${book.authors}`.toLocaleLowerCase();
        return (!normalizedQuery || haystack.includes(normalizedQuery)) && matchesProgressFilter(book, progressFilter);
      })
      .sort((a, b) => {
        let result = 0;
        if (sortKey === "title") {
          result = a.title.localeCompare(b.title);
        } else if (sortKey === "last_open") {
          result = (a.last_open ?? "").localeCompare(b.last_open ?? "");
        } else if (sortKey === "progress") {
          result = compareNullableNumbers(a.progress, b.progress);
        } else {
          result = a[sortKey] - b[sortKey];
        }
        if (result === 0) result = a.title.localeCompare(b.title);
        return sortDirection === "asc" ? result : -result;
      });
    return sorted;
  }, [books, progressFilter, query, sortDirection, sortKey]);

  const totalTimeSeconds = filteredBooks.reduce((total, book) => total + book.time_seconds, 0);
  const totalPages = filteredBooks.reduce((total, book) => total + book.pages, 0);

  return (
    <section className="recent-panel books-panel">
      <header>
        <div>
          <h3>Books</h3>
          <span className="panel-note">
            {filteredBooks.length.toLocaleString()} of {books.length.toLocaleString()} books
          </span>
        </div>
        <div className="books-summary" aria-label="Filtered book summary">
          <span>
            <strong>{formatDurationLabel(totalTimeSeconds)}</strong> total
          </span>
          <span>
            <strong>{totalPages.toLocaleString()}</strong> pages seen
          </span>
        </div>
      </header>
      <div className="books-controls" aria-label="Book table controls">
        <label>
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title or author"
            type="search"
          />
        </label>
        <label>
          Progress
          <select value={progressFilter} onChange={(event) => setProgressFilter(event.target.value as BookProgressFilter)}>
            <option value="all">All books</option>
            <option value="in-progress">In progress</option>
            <option value="finished">Finished</option>
            <option value="unknown">Unknown progress</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as BookSortKey)}>
            <option value="last_open">Last opened</option>
            <option value="time_seconds">Reading time</option>
            <option value="pages">Pages seen</option>
            <option value="progress">Progress</option>
            <option value="title">Title</option>
          </select>
        </label>
        <button
          className="secondary sort-direction"
          onClick={() => setSortDirection((value) => (value === "asc" ? "desc" : "asc"))}
          type="button"
        >
          {sortDirection === "asc" ? "Ascending" : "Descending"}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table books-table">
          <colgroup>
            <col className="book-col" />
            <col className="author-col" />
            <col className="time-col" />
            <col className="pages-col" />
            <col className="position-col" />
            <col className="progress-col" />
            <col className="date-col" />
            <col className="records-col" />
          </colgroup>
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Time</th>
              <th>Pages seen</th>
              <th>Position</th>
              <th>Progress</th>
              <th>Last opened</th>
              <th>Records</th>
            </tr>
          </thead>
          <tbody>
            {filteredBooks.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-row">
                  No books match the current filters.
                </td>
              </tr>
            ) : (
              filteredBooks.map((book) => (
                <tr key={book.id}>
                  <td className="book-title" title={book.title}>
                    <span className="cell-truncate">{book.title}</span>
                  </td>
                  <td title={book.authors}>
                    <span className="cell-truncate">{book.authors}</span>
                  </td>
                  <td>{book.time_label}</td>
                  <td>{book.pages.toLocaleString()}</td>
                  <td>{formatPageProgress(book)}</td>
                  <td>
                    <div className="progress-cell">
                      <span>
                        <b style={{ width: `${book.progress ?? 0}%` }} />
                      </span>
                      <em>{formatProgress(book)}</em>
                    </div>
                  </td>
                  <td title={formatDateTime(book.last_open)}>
                    <span className="cell-truncate">{formatDateTime(book.last_open)}</span>
                  </td>
                  <td title={`Book IDs: ${book.source_book_ids.join(", ")}`}>
                    {formatSourceRecords(book)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const streakLabel =
    dashboard.summary.current_streak === 1
      ? "1 day"
      : `${dashboard.summary.current_streak} days`;

  return (
    <>
      {!dashboard.has_data ? (
        <section className="empty-state">
          <h2>No database yet</h2>
        </section>
      ) : null}

      <section className="metrics-grid">
        <MetricCard label="Total time" value={dashboard.summary.total_time_label} />
        <MetricCard label="Reading days" value={dashboard.summary.reading_days} />
        <MetricCard label="Books" value={dashboard.summary.books} />
        <MetricCard label="Pages" value={dashboard.summary.pages.toLocaleString()} />
        <MetricCard label="Current streak" value={streakLabel} />
      </section>

      <section className="charts-grid">
        <VerticalBars
          title="Daily reading"
          data={dashboard.charts.daily}
          valueKey="minutes"
        />
        <VerticalBars
          title="Monthly reading"
          data={dashboard.charts.monthly}
          valueKey="hours"
        />
        <TopBooksChart data={dashboard.charts.top_books} />
      </section>

      <RecentBooks books={dashboard.recent_books} />
    </>
  );
}

function SnapshotsView({
  snapshots,
  activeSnapshotId,
  onSelectSnapshot,
}: {
  snapshots: Snapshot[];
  activeSnapshotId: string | null;
  onSelectSnapshot: (id: string) => void;
}) {
  return (
    <section className="recent-panel">
      <header>
        <h3>Snapshots</h3>
      </header>
      <div className="table-wrap">
        <table className="data-table snapshots-table">
          <colgroup>
            <col className="imported-col" />
            <col className="source-col" />
            <col className="size-col" />
            <col className="schema-col" />
            <col className="id-col" />
            <col className="action-col" />
          </colgroup>
          <thead>
            <tr>
              <th>Imported</th>
              <th>Source</th>
              <th>Size</th>
              <th>Schema</th>
              <th>Snapshot ID</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-row">
                  No snapshots have been imported yet.
                </td>
              </tr>
            ) : (
              snapshots.map((snapshot) => (
                <tr key={snapshot.id}>
                  <td title={formatDateTime(snapshot.imported_at)}>
                    <span className="cell-truncate">{formatDateTime(snapshot.imported_at)}</span>
                  </td>
                  <td title={snapshot.source_path ?? snapshot.source}>
                    <code className="cell-truncate table-code">{formatSnapshotSource(snapshot)}</code>
                  </td>
                  <td>{formatBytes(snapshot.file_size)}</td>
                  <td>{snapshot.schema_version}</td>
                  <td title={snapshot.id}>
                    <code className="cell-truncate table-code">{snapshot.id}</code>
                  </td>
                  <td>
                    <button
                      className="table-action"
                      disabled={snapshot.id === activeSnapshotId}
                      onClick={() => onSelectSnapshot(snapshot.id)}
                    >
                      {snapshot.id === activeSnapshotId ? "Current" : "View"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CalendarView({ calendar }: { calendar: Dashboard["charts"]["calendar"] }) {
  const { cells, weeks, monthLabels } = useMemo(() => buildCalendarCells(calendar), [calendar]);
  const dateRange =
    calendar.start_date && calendar.end_date
      ? `${parseCalendarDate(calendar.start_date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })} - ${parseCalendarDate(calendar.end_date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`
      : "No reading history";
  const peakLabel = calendar.max_minutes > 0 ? formatMinutes(calendar.max_minutes) : "0 min";

  return (
    <section className="calendar-panel">
      <header>
        <div>
          <h3>Calendar</h3>
          <span className="panel-note">{dateRange}</span>
        </div>
        <div className="calendar-summary" aria-label="Calendar summary">
          <span>
            <strong>{calendar.total_days.toLocaleString()}</strong> days
          </span>
          <span>
            <strong>{peakLabel}</strong> peak
          </span>
        </div>
      </header>
      {calendar.days.length === 0 ? (
        <div className="empty-chart">No reading days yet</div>
      ) : (
        <div className="calendar-scroll" tabIndex={0} aria-label="Scrollable reading calendar heatmap">
          <div
            className="calendar-heatmap"
            style={{ "--calendar-weeks": weeks } as CSSProperties}
          >
            <div className="calendar-months" aria-hidden="true">
              {monthLabels.map((month, index) => {
                const nextWeek = monthLabels[index + 1]?.week ?? weeks;
                const span = Math.max(1, Math.min(4, nextWeek - month.week));
                return (
                  <span
                    key={`${month.week}-${month.label}`}
                    style={{ gridColumn: `${month.week + 1} / span ${span}` }}
                  >
                    {month.label}
                  </span>
                );
              })}
            </div>
            <div className="calendar-body">
              <div className="calendar-weekdays" aria-hidden="true">
                {weekdayLabels.map((day) => (
                  <span key={day}>{day === "Mon" || day === "Wed" || day === "Fri" ? day : ""}</span>
                ))}
              </div>
              <div className="calendar-days" role="grid" aria-label="Reading days by week">
                {cells.map((cell) => {
                  const date = parseCalendarDate(cell.date);
                  const label = date.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  });
                  const day = cell.day;
                  const cellLabel = day
                    ? `${label}: ${day.time_label} read, intensity ${day.level} of 4`
                    : `${label}: no reading`;
                  return (
                    <span
                      key={cell.date}
                      role="gridcell"
                      aria-label={cellLabel}
                      title={cellLabel}
                      className={`calendar-day level-${day?.level ?? 0}${cell.outsideRange ? " outside-range" : ""}`}
                    />
                  );
                })}
              </div>
            </div>
            <div className="calendar-legend" aria-label="Reading intensity legend">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} className={`calendar-day level-${level}`} />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ExportView({ dashboard }: { dashboard: Dashboard }) {
  function exportJson() {
    downloadText("kostats-dashboard.json", JSON.stringify(dashboard, null, 2), "application/json");
  }

  function exportBooksCsv() {
    const header = ["Title", "Author", "Last opened", "Time", "Pages seen", "Position", "Progress", "Records", "Source book IDs"];
    const rows = dashboard.books.map((book) => [
      book.title,
      book.authors,
      book.last_open ?? "",
      book.time_label,
      book.pages,
      formatPageProgress(book),
      formatProgress(book),
      book.merged_count,
      book.source_book_ids.join("; "),
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    downloadText("kostats-books.csv", `${csv}\n`, "text/csv");
  }

  return (
    <section className="empty-state">
      <h2>Export</h2>
      <div className="actions">
        <button className="primary" disabled={!dashboard.has_data} onClick={exportJson}>
          Export dashboard JSON
        </button>
        <button className="secondary" disabled={!dashboard.has_data} onClick={exportBooksCsv}>
          Export books CSV
        </button>
      </div>
    </section>
  );
}

function SettingsView({
  device,
  snapshots,
  onRefresh,
}: {
  device: DeviceStatus | null;
  snapshots: Snapshot[];
  onRefresh: () => void;
}) {
  const candidateDiagnostics = (device?.candidates ?? []).filter(
    (candidate) => candidate.error || (candidate.exists && !candidate.readable),
  );

  return (
    <section className="settings-panel">
      <header>
        <h3>Settings</h3>
        <button className="secondary" onClick={onRefresh}>Refresh now</button>
      </header>
      <dl>
        <div>
          <dt>Kobo mount path</dt>
          <dd>{device?.mount_path ?? "/Volumes/KOBOeReader"}</dd>
        </div>
        <div>
          <dt>Local snapshots</dt>
          <dd>{snapshots.length}</dd>
        </div>
      </dl>
      {candidateDiagnostics.length > 0 ? (
        <>
          <h4>Access issues</h4>
          <div className="candidate-list">
            {candidateDiagnostics.map((candidate) => (
              <div key={candidate.path}>
                <span>{candidate.readable ? "Readable" : candidate.exists ? "Blocked" : "Missing"}</span>
                <code>{candidate.path}</code>
                {candidate.error ? <em>{candidate.error}</em> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

export default function App() {
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [autoImportError, setAutoImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedSnapshotId = useRef<string | null>(null);

  async function refresh() {
    let deviceStatus = await getDeviceStatus();
    let nextAutoImportError: string | null = null;
    if (deviceStatus.mounted && deviceStatus.database_found && !deviceStatus.permission_error) {
      try {
        const autoResult = await autoImportFromKobo();
        deviceStatus = autoResult.device;
      } catch (err) {
        nextAutoImportError = `Auto-import failed: ${err instanceof Error ? err.message : "Could not import from Kobo"}`;
      }
    }
    const dashboardSnapshotId = selectedSnapshotId.current ?? "latest";
    const [dashboardData, snapshotData] = await Promise.all([getDashboard(dashboardSnapshotId), getSnapshots()]);
    setDevice(deviceStatus);
    setDashboard(dashboardData);
    setSnapshots(snapshotData.snapshots);
    setAutoImportError(nextAutoImportError);
  }

  async function loadSnapshot(snapshotId: string) {
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const selectedDashboard = await getDashboard(snapshotId);
      selectedSnapshotId.current = snapshotId;
      setDashboard(selectedDashboard);
      setActiveView("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load snapshot");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
    const id = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  async function handleImport() {
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const result = await importFromKobo();
      selectedSnapshotId.current = null;
      setDashboard(result.dashboard);
      setActiveView("dashboard");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const result = await uploadDatabase(file);
      selectedSnapshotId.current = null;
      setDashboard(result.dashboard);
      setActiveView("dashboard");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const latestSnapshot = snapshots[0] ?? dashboard.snapshot ?? null;
  const activeSnapshot = dashboard.snapshot ?? latestSnapshot;
  const navItems: Array<{ id: View; label: string; icon: string }> = [
    { id: "dashboard", label: "Dashboard", icon: "⌂" },
    { id: "snapshots", label: "Snapshots", icon: "◎" },
    { id: "books", label: "Books", icon: "□" },
    { id: "calendar", label: "Calendar", icon: "◷" },
    { id: "export", label: "Export", icon: "⇩" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>kostats</h1>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              className={activeView === item.id ? "active" : ""}
              key={item.id}
              onClick={() => setActiveView(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="storage-card">
          <strong>{snapshots.length} snapshots</strong>
        </div>
      </aside>

      <main style={mainLayoutStyle}>
        <DeviceBanner
          status={device}
          activeSnapshot={activeSnapshot}
          latestSnapshot={latestSnapshot}
          onImport={handleImport}
          onUploadClick={() => fileInput.current?.click()}
          busy={busy}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/octet-stream"
          hidden
          onChange={(event) => handleUpload(event.target.files?.[0])}
        />

        {error ? <div className="alert error">{error}</div> : null}
        {autoImportError ? <div className="alert error">{autoImportError}</div> : null}
        {device?.permission_error ? (
          <div className="alert error">
            macOS denied direct access to the Kobo database. Use Upload DB or grant this app permission to read the Kobo volume.
          </div>
        ) : null}
        {activeView === "dashboard" ? <DashboardView dashboard={dashboard} /> : null}
        {activeView === "snapshots" ? (
          <SnapshotsView
            snapshots={snapshots}
            activeSnapshotId={activeSnapshot?.id ?? null}
            onSelectSnapshot={loadSnapshot}
          />
        ) : null}
        {activeView === "books" ? <BooksView books={dashboard.books} /> : null}
        {activeView === "calendar" ? <CalendarView calendar={dashboard.charts.calendar} /> : null}
        {activeView === "export" ? <ExportView dashboard={dashboard} /> : null}
        {activeView === "settings" ? (
          <SettingsView device={device} snapshots={snapshots} onRefresh={() => refresh().catch((err: Error) => setError(err.message))} />
        ) : null}
      </main>
    </div>
  );
}
