import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  autoImportFromKobo,
  createKoboBackup,
  getBackups,
  getDashboard,
  getDeviceStatus,
  getRestorePreview,
  getSnapshots,
  importFromKobo,
  restoreBackup,
  uploadDatabase,
} from "./api";
import type {
  BookStats,
  Dashboard,
  DeviceStatus,
  RecoveryBackup,
  RestorePreview,
  RestoreResult,
  Snapshot,
} from "./types";

type View = "dashboard" | "snapshots" | "backups" | "books" | "calendar" | "export" | "settings";
type BookSortKey = "last_open" | "time_seconds" | "pages" | "progress" | "title";
type BookProgressFilter = "all" | "reading" | "finished" | "abandoned" | "unknown";

const tableViewportSideInset = 16;
const tableViewportBottomInset = 37;
const tableMinimumHeight = 240;
const chartColumnGap = 4;
const dailyBarMinimumWidth = 18;
const chartLabelMinimumSpacing = 72;
const monthlyBarMinimumWidth = chartLabelMinimumSpacing;

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
    finished_books: 0,
    reading_books: 0,
    abandoned_books: 0,
    highlights: 0,
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
};

function chartItemLimit(width: number, minimumItemWidth: number) {
  if (width <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor((width + chartColumnGap) / (minimumItemWidth + chartColumnGap)));
}

function chartLabelIndexes(itemCount: number, width: number) {
  if (itemCount <= 0) return new Set<number>();
  if (itemCount === 1 || width <= 0) return new Set([0]);

  const maximumLabels = Math.max(2, Math.floor(width / chartLabelMinimumSpacing));
  if (itemCount <= maximumLabels) {
    return new Set(Array.from({ length: itemCount }, (_, index) => index));
  }

  const step = Math.ceil((itemCount - 1) / (maximumLabels - 1));
  const indexes = new Set<number>();
  for (let index = 0; index < itemCount - 1; index += step) {
    indexes.add(index);
  }
  indexes.add(itemCount - 1);
  return indexes;
}

function useElementWidth<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = (nextWidth = element.getBoundingClientRect().width) => {
      const roundedWidth = Math.round(nextWidth);
      if (roundedWidth > 0) {
        setWidth((currentWidth) => (currentWidth === roundedWidth ? currentWidth : roundedWidth));
      }
    };

    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => updateWidth();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  return { ref, width };
}

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

function calendarLevel(minutes: number, maxMinutes: number): CalendarDay["level"] {
  if (minutes <= 0 || maxMinutes <= 0) return 0;
  const ratio = minutes / maxMinutes;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentWeekStart = addDays(today, -today.getDay());
  const start = addDays(currentWeekStart, -52 * 7);
  const visibleDays = calendar.days.filter((day) => {
    const date = parseCalendarDate(day.date);
    return date >= start && date <= today;
  });
  const maxMinutes = Math.max(0, ...visibleDays.map((day) => day.minutes));
  const dayMap = new Map(
    visibleDays.map((day) => [
      day.date,
      { ...day, level: calendarLevel(day.minutes, maxMinutes) },
    ]),
  );
  const cells: CalendarCell[] = [];

  for (let date = start; date <= today; date = addDays(date, 1)) {
    const key = formatCalendarDate(date);
    cells.push({
      date: key,
      day: dayMap.get(key) ?? null,
    });
  }

  const weeks = Math.ceil(cells.length / 7);
  const monthLabels: Array<{ week: number; label: string }> = [];
  let lastMonth = "";
  for (let week = 0; week < weeks; week += 1) {
    const weekCells = cells.slice(week * 7, week * 7 + 7);
    const monthCell =
      week === 0
        ? weekCells[0]
        : weekCells.find((cell) => parseCalendarDate(cell.date).getDate() <= 7);
    if (!monthCell) continue;
    const monthKey = monthCell.date.slice(0, 7);
    if (monthKey === lastMonth) continue;
    lastMonth = monthKey;
    monthLabels.push({
      week,
      label: parseCalendarDate(monthCell.date).toLocaleDateString(undefined, { month: "short" }),
    });
  }

  return {
    cells,
    weeks,
    monthLabels,
    startDate: formatCalendarDate(start),
    endDate: formatCalendarDate(today),
    totalDays: visibleDays.length,
    maxMinutes,
  };
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatProgress(book: BookStats) {
  if (book.percent_finished != null) {
    const value = Math.round(book.percent_finished * 1000) / 10;
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  }
  return book.progress == null ? "N/A" : `${book.progress}%`;
}

function effectiveStatus(book: BookStats) {
  if (book.status != null) return book.status;
  if (book.progress == null) return null;
  return book.progress >= 100 ? "complete" : "reading";
}

function formatStatus(book: BookStats) {
  const status = effectiveStatus(book);
  if (status === "complete") return "Finished";
  if (status === "reading") return "Reading";
  if (status === "abandoned") return "Abandoned";
  return "Unknown";
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
  const status = effectiveStatus(book);
  if (filter === "unknown") return status == null;
  if (filter === "finished") return status === "complete";
  return status === filter;
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

function TooltipTarget({
  label,
  valueLabel,
  className,
  style,
  children,
  role,
  ariaLabel,
  tabIndex = 0,
}: {
  label: string;
  valueLabel: string;
  className: string;
  style?: CSSProperties;
  children?: ReactNode;
  role?: string;
  ariaLabel?: string;
  tabIndex?: number;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>({});
  const tooltipId = useId();
  const targetRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const accessibleLabel = ariaLabel ?? `${label}: ${valueLabel}`;

  useLayoutEffect(() => {
    if (!showTooltip) return;

    function positionTooltip() {
      const target = targetRef.current;
      const tooltip = tooltipRef.current;
      if (!target || !tooltip) return;

      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 8;
      const centeredLeft = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
      const left = Math.min(
        window.innerWidth - tooltipRect.width - viewportPadding,
        Math.max(viewportPadding, centeredLeft),
      );
      const aboveTop = targetRect.top - tooltipRect.height - gap;
      const top =
        aboveTop >= viewportPadding
          ? aboveTop
          : Math.min(
              window.innerHeight - tooltipRect.height - viewportPadding,
              targetRect.bottom + gap,
            );
      const arrowLeft = Math.min(
        tooltipRect.width - viewportPadding,
        Math.max(viewportPadding, targetRect.left + targetRect.width / 2 - left),
      );

      setTooltipStyle({
        left,
        top,
        "--tooltip-arrow-left": `${arrowLeft}px`,
        "--tooltip-arrow-edge": aboveTop >= viewportPadding ? "100%" : "auto",
        "--tooltip-arrow-bottom": aboveTop >= viewportPadding ? "auto" : "100%",
        "--tooltip-arrow-color": aboveTop >= viewportPadding ? "var(--ink)" : "transparent",
        "--tooltip-arrow-bottom-color":
          aboveTop >= viewportPadding ? "transparent" : "var(--ink)",
      } as CSSProperties);
    }

    positionTooltip();
    window.addEventListener("resize", positionTooltip);
    window.addEventListener("scroll", positionTooltip, true);
    return () => {
      window.removeEventListener("resize", positionTooltip);
      window.removeEventListener("scroll", positionTooltip, true);
    };
  }, [showTooltip]);

  return (
    <span
      ref={targetRef}
      className={`${className} chart-bar-target`}
      style={style}
      tabIndex={tabIndex}
      role={role}
      aria-label={accessibleLabel}
      aria-describedby={showTooltip ? tooltipId : undefined}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
    >
      {children}
      {showTooltip
        ? createPortal(
            <span
              ref={tooltipRef}
              className="chart-tooltip"
              id={tooltipId}
              role="tooltip"
              style={tooltipStyle}
            >
              <span>{label}</span>
              <strong>{valueLabel}</strong>
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

function VerticalBars({
  title,
  data,
  valueKey,
  formatValue,
  minimumItemWidth,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  valueKey: string;
  formatValue: (value: number) => string;
  minimumItemWidth?: number;
}) {
  const { ref: chartRef, width: chartWidth } = useElementWidth<HTMLDivElement>(data.length > 0);
  const itemWidth = minimumItemWidth ?? dailyBarMinimumWidth;
  const itemLimit =
    minimumItemWidth == null ? Number.POSITIVE_INFINITY : chartItemLimit(chartWidth, minimumItemWidth);
  const visibleData = data.slice(-itemLimit);
  const visibleLabels = chartLabelIndexes(visibleData.length, chartWidth);
  const max = Math.max(1, ...visibleData.map((item) => Number(item[valueKey])));
  return (
    <section className="chart-panel">
      <header>
        <h3>{title}</h3>
      </header>
      {data.length === 0 ? (
        <div className="empty-chart">No reading data yet</div>
      ) : (
        <div
          className="bar-chart"
          ref={chartRef}
          role="img"
          aria-label={`${title} chart`}
          style={{ "--bar-column-width": `${itemWidth}px` } as CSSProperties}
        >
          {visibleData.map((item, index) => {
            const value = Number(item[valueKey]);
            const label = String(item.label);
            return (
              <div className="bar-column" key={label}>
                <TooltipTarget
                  label={label}
                  valueLabel={formatValue(value)}
                  className="bar"
                  style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
                />
                <small className={visibleLabels.has(index) ? "show-label" : undefined}>{label}</small>
              </div>
            );
          })}
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
              <span className="top-book-title">{item.title}</span>
              <TooltipTarget
                label={item.title}
                valueLabel={formatDurationLabel(item.hours * 3600)}
                className="track"
              >
                <span
                  className="track-fill"
                  style={{ width: `${(item.hours / max) * 100}%` }}
                />
              </TooltipTarget>
              <em>{item.hours.toFixed(1)}h</em>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ViewportTableScrollArea({
  ariaLabel,
  children,
  className = "",
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const content = event.currentTarget;
    const pageStep = Math.max(40, content.clientHeight - 40);
    const scrollSteps: Partial<Record<string, number>> = {
      ArrowDown: 40,
      ArrowUp: -40,
      PageDown: pageStep,
      PageUp: -pageStep,
    };

    if (event.key === "Home") {
      content.scrollTop = 0;
    } else if (event.key === "End") {
      content.scrollTop = content.scrollHeight;
    } else if (scrollSteps[event.key] != null) {
      content.scrollTop += scrollSteps[event.key] ?? 0;
    } else {
      return;
    }
    event.preventDefault();
  }

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const updateMaxHeight = () => {
      const documentTop = content.getBoundingClientRect().top + window.scrollY;
      const availableHeight =
        window.innerHeight - Math.max(documentTop, tableViewportSideInset) - tableViewportBottomInset;
      const viewportCap = Math.max(0, window.innerHeight - tableViewportSideInset - tableViewportBottomInset);
      // Prefer a usable minimum even when it requires page scrolling, but keep the table short enough
      // to fit entirely within the viewport once the user scrolls it into view.
      setMaxHeight(Math.min(Math.max(tableMinimumHeight, availableHeight), viewportCap));
    };

    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);

    return () => {
      window.removeEventListener("resize", updateMaxHeight);
    };
  }, []);

  return (
    <div
      aria-label={ariaLabel}
      className={`table-wrap${className ? ` ${className}` : ""}`}
      onKeyDown={handleKeyDown}
      ref={contentRef}
      role="region"
      style={maxHeight == null ? undefined : { maxHeight }}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

function RecentBooks({ books }: { books: Dashboard["recent_books"] }) {
  return (
    <section className="recent-panel">
      <header>
        <h3>Recent books</h3>
      </header>
      <ViewportTableScrollArea ariaLabel="Recent books table" className="viewport-table-wrap">
        <table className="data-table recent-books-table">
          <colgroup>
            <col className="book-col" />
            <col className="author-col" />
            <col className="date-col" />
            <col className="time-col" />
            <col className="pages-col" />
            <col className="status-col" />
            <col className="progress-col" />
          </colgroup>
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Last opened</th>
              <th>Time</th>
              <th>Pages</th>
              <th>Status</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {books.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-row">
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
                  <td>{formatStatus(book)}</td>
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
      </ViewportTableScrollArea>
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
        const haystack = `${book.title} ${book.authors} ${book.series} ${book.language}`.toLocaleLowerCase();
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
  const totalHighlights = filteredBooks.reduce((total, book) => total + book.highlight_count, 0);

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
          <span>
            <strong>{totalHighlights.toLocaleString()}</strong> highlights
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
          Status
          <select value={progressFilter} onChange={(event) => setProgressFilter(event.target.value as BookProgressFilter)}>
            <option value="all">All books</option>
            <option value="reading">Reading</option>
            <option value="finished">Finished</option>
            <option value="abandoned">Abandoned</option>
            <option value="unknown">Unknown</option>
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
      <ViewportTableScrollArea ariaLabel="Books table" className="viewport-table-wrap">
        <table className="data-table books-table">
          <colgroup>
            <col className="book-col" />
            <col className="author-col" />
            <col className="time-col" />
            <col className="pages-col" />
            <col className="position-col" />
            <col className="status-col" />
            <col className="progress-col" />
            <col className="highlights-col" />
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
              <th>Status</th>
              <th>Progress</th>
              <th>Highlights</th>
              <th>Last opened</th>
              <th>Records</th>
            </tr>
          </thead>
          <tbody>
            {filteredBooks.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty-row">
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
                  <td>{formatStatus(book)}</td>
                  <td>
                    <div className="progress-cell">
                      <span>
                        <b style={{ width: `${book.progress ?? 0}%` }} />
                      </span>
                      <em>{formatProgress(book)}</em>
                    </div>
                  </td>
                  <td>{book.highlight_count.toLocaleString()}</td>
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
      </ViewportTableScrollArea>
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
        <MetricCard label="Finished" value={dashboard.summary.finished_books} />
        <MetricCard label="Reading" value={dashboard.summary.reading_books} />
        <MetricCard label="Abandoned" value={dashboard.summary.abandoned_books} />
        <MetricCard label="Highlights" value={dashboard.summary.highlights} />
      </section>

      <section className="charts-grid">
        <VerticalBars
          title="Daily reading"
          data={dashboard.charts.daily}
          valueKey="minutes"
          formatValue={(minutes) => formatDurationLabel(minutes * 60)}
          minimumItemWidth={dailyBarMinimumWidth}
        />
        <VerticalBars
          title="Monthly reading"
          data={dashboard.charts.monthly}
          valueKey="hours"
          formatValue={(hours) => formatDurationLabel(hours * 3600)}
          minimumItemWidth={monthlyBarMinimumWidth}
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
      <ViewportTableScrollArea ariaLabel="Snapshots table" className="viewport-table-wrap">
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
      </ViewportTableScrollArea>
    </section>
  );
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function BackupCounts({ counts }: { counts: Record<string, number> }) {
  const labels = [
    ["sidecars", "sidecar files"],
    ["settings", "settings files"],
    ["databases", "databases"],
    ["dictionaries", "dictionary files"],
    ["extensions", "extension files"],
  ] as const;
  return (
    <div className="backup-counts">
      {labels.map(([key, label]) => (
        <span key={key}>
          <strong>{counts[key] ?? 0}</strong> {label}
        </span>
      ))}
    </div>
  );
}

function BackupsView({
  backups,
  device,
  busy,
  onCreate,
  onPreview,
  onRestore,
}: {
  backups: RecoveryBackup[];
  device: DeviceStatus | null;
  busy: boolean;
  onCreate: () => Promise<void>;
  onPreview: (id: string) => Promise<RestorePreview>;
  onRestore: (id: string, extensions: boolean) => Promise<RestoreResult>;
}) {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoreExtensions, setRestoreExtensions] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function previewBackup(id: string) {
    setLoadingPreview(true);
    setLocalError(null);
    setResult(null);
    setConfirmed(false);
    setRestoreExtensions(false);
    try {
      setPreview(await onPreview(id));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not preview recovery backup");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function runRestore() {
    if (!preview || !confirmed) return;
    setLocalError(null);
    try {
      const nextResult = await onRestore(preview.backup.id, restoreExtensions);
      setResult(nextResult);
      setPreview(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not restore recovery backup");
    }
  }

  return (
    <section className="backups-panel">
      <header>
        <div>
          <h3>Recovery backups</h3>
          <span className="panel-note">Books are excluded. Credentials may be included.</span>
        </div>
        <button
          className="primary"
          disabled={busy || !device?.mounted}
          onClick={() => onCreate().catch((err: Error) => setLocalError(err.message))}
        >
          {busy ? "Working..." : "Back up now"}
        </button>
      </header>

      {localError ? <div className="alert error">{localError}</div> : null}
      {result ? (
        <div className="restore-result">
          <h4>Restore complete</h4>
          <p>
            Restored {countLabel(result.restored.sidecars ?? 0, "sidecar")}; skipped{" "}
            {countLabel(result.skipped.sidecars ?? 0, "sidecar")}; failed{" "}
            {countLabel(result.failed.length, "item")}.
          </p>
          <p>
            Safety backup: <code>{result.safety_backup_id}</code>. Eject the Kobo and restart KOReader.
          </p>
        </div>
      ) : null}

      <div className="backup-list">
        {backups.length === 0 ? (
          <div className="empty-row">No recovery backups have been created yet.</div>
        ) : (
          backups.map((backup) => (
            <article
              aria-label={`Recovery backup ${formatDateTime(backup.created_at)}`}
              className="backup-card"
              key={backup.id}
            >
              <div className="backup-card-main">
                <div>
                  <strong>{formatDateTime(backup.created_at)}</strong>
                  <span>
                    {backup.koreader_version ?? "Unknown KOReader version"} ·{" "}
                    {backup.device_model ?? "Unknown device"} · {formatBytes(backup.archive_size)}
                  </span>
                  <code>{backup.source_mount}</code>
                </div>
                {backup.credentials_included ? (
                  <span className="credential-warning">Contains credentials</span>
                ) : null}
              </div>
              <BackupCounts counts={backup.counts} />
              <button
                className="table-action backup-card-action"
                disabled={busy || loadingPreview || !device?.mounted}
                onClick={() => previewBackup(backup.id)}
              >
                {loadingPreview ? "Scanning..." : "Restore"}
              </button>
            </article>
          ))
        )}
      </div>

      {preview ? (
        <div className="restore-preview" role="dialog" aria-label="Restore preview">
          <header>
            <div>
              <h4>Restore preview</h4>
              <span className="panel-note">{formatDateTime(preview.backup.created_at)}</span>
            </div>
            <button className="secondary" onClick={() => setPreview(null)}>Close</button>
          </header>
          {preview.version_warning ? (
            <div className="alert error">
              Backup KOReader version {preview.backup.koreader_version} differs from the installed{" "}
              {preview.current_koreader_version}.
            </div>
          ) : null}
          {preview.backup.credentials_included ? (
            <div className="alert info">
              This backup contains credentials and will restore them to the Kobo.
            </div>
          ) : null}
          <div className="preview-metrics">
            <MetricCard label="Matched" value={preview.exact_matches.length} />
            <MetricCard label="Missing" value={preview.missing_matches.length} />
            <MetricCard label="Ambiguous" value={preview.ambiguous_matches.length} />
            <MetricCard label="Books scanned" value={preview.book_count} />
          </div>
          <BackupCounts counts={preview.counts} />
          <p className="space-check">
            Requires {formatBytes(preview.required_bytes)}; {formatBytes(preview.available_bytes)} available.
          </p>
          {preview.missing_matches.length > 0 || preview.ambiguous_matches.length > 0 ? (
            <div className="unmatched-list">
              {[...preview.missing_matches, ...preview.ambiguous_matches].map((match, index) => (
                <div key={`${match.source_path}-${index}`}>
                  <strong>{match.title ?? match.old_doc_path ?? "Unknown book"}</strong>
                  <span>
                    {match.candidates?.length
                      ? `${match.candidates.length} exact file candidates; skipped as ambiguous`
                      : "No byte-identical book found; skipped"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <label className="restore-option">
            <input
              type="checkbox"
              checked={restoreExtensions}
              onChange={(event) => setRestoreExtensions(event.target.checked)}
            />
            Restore optional extensions and missing custom patches
          </label>
          <label className="restore-option confirm-option">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I understand this will modify the mounted Kobo
          </label>
          <button className="primary" disabled={busy || !confirmed} onClick={runRestore}>
            {busy ? "Restoring..." : "Restore backup"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CalendarView({ calendar }: { calendar: Dashboard["charts"]["calendar"] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { cells, weeks, monthLabels, startDate, endDate, totalDays, maxMinutes } = useMemo(
    () => buildCalendarCells(calendar),
    [calendar],
  );
  const dateRange = `${parseCalendarDate(startDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} - ${parseCalendarDate(endDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
  const peakLabel = maxMinutes > 0 ? formatMinutes(maxMinutes) : "0 min";

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
  }, [endDate, startDate]);

  return (
    <section className="calendar-panel">
      <header>
        <div>
          <h3>Calendar</h3>
          <span className="panel-note">{dateRange}</span>
        </div>
        <div className="calendar-summary" aria-label="Calendar summary">
          <span>
            <strong>{totalDays.toLocaleString()}</strong> days
          </span>
          <span>
            <strong>{peakLabel}</strong> peak
          </span>
        </div>
      </header>
      <div
        ref={scrollRef}
        className="calendar-scroll"
        tabIndex={0}
        aria-label="Scrollable reading calendar heatmap"
      >
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
                  <TooltipTarget
                    key={cell.date}
                    role="gridcell"
                    label={label}
                    valueLabel={day ? `${day.time_label} read` : "No reading"}
                    ariaLabel={cellLabel}
                    tabIndex={-1}
                    className={`calendar-day level-${day?.level ?? 0}`}
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
    </section>
  );
}

function ExportView({ dashboard }: { dashboard: Dashboard }) {
  function exportJson() {
    downloadText("kostats-dashboard.json", JSON.stringify(dashboard, null, 2), "application/json");
  }

  function exportBooksCsv() {
    const header = [
      "Title",
      "Author",
      "Series",
      "Series index",
      "Language",
      "Status",
      "Status modified",
      "Last opened",
      "Time",
      "Pages seen",
      "Position",
      "Progress",
      "Highlights",
      "Notes",
      "Records",
      "Source book IDs",
    ];
    const rows = dashboard.books.map((book) => [
      book.title,
      book.authors,
      book.series,
      book.series_index,
      book.language,
      formatStatus(book),
      book.status_modified ?? "",
      book.last_open ?? "",
      book.time_label,
      book.pages,
      formatPageProgress(book),
      formatProgress(book),
      book.highlight_count,
      book.note_count,
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
          <dd>{device?.mount_path ?? "Auto-detect"}</dd>
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
  const [backups, setBackups] = useState<RecoveryBackup[]>([]);
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
    const [dashboardData, snapshotData, backupData] = await Promise.all([
      getDashboard(dashboardSnapshotId),
      getSnapshots(),
      getBackups().catch(() => null),
    ]);
    setDevice(deviceStatus);
    setDashboard(dashboardData);
    setSnapshots(snapshotData.snapshots);
    if (backupData && Array.isArray(backupData.backups)) {
      setBackups(backupData.backups);
    }
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

  async function handleBackup() {
    setBusy(true);
    setError(null);
    try {
      const created = await createKoboBackup();
      setBackups((current) => [
        created.backup,
        ...current.filter((backup) => backup.id !== created.backup.id),
      ]);
      getBackups()
        .then((backupData) => setBackups(backupData.backups))
        .catch(() => undefined);
    } catch (err) {
      throw err instanceof Error ? err : new Error("Recovery backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(backupId: string, extensions: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await restoreBackup(backupId, extensions);
      getBackups()
        .then((backupData) => setBackups(backupData.backups))
        .catch(() => undefined);
      return result;
    } finally {
      setBusy(false);
    }
  }

  const latestSnapshot = snapshots[0] ?? dashboard.snapshot ?? null;
  const activeSnapshot = dashboard.snapshot ?? latestSnapshot;
  const navItems: Array<{ id: View; label: string; icon: string }> = [
    { id: "dashboard", label: "Dashboard", icon: "⌂" },
    { id: "snapshots", label: "Snapshots", icon: "◎" },
    { id: "backups", label: "Backups", icon: "↻" },
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
          <span>{backups.length} recovery backups</span>
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
            The app could not read the KOReader database. Use Upload DB or grant this app permission to read the Kobo volume.
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
        {activeView === "backups" ? (
          <BackupsView
            backups={backups}
            device={device}
            busy={busy}
            onCreate={handleBackup}
            onPreview={getRestorePreview}
            onRestore={handleRestore}
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
