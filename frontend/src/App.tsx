import { useEffect, useRef, useState } from "react";
import {
  autoImportFromKobo,
  getDashboard,
  getDeviceStatus,
  getSnapshots,
  importFromKobo,
  uploadDatabase,
} from "./api";
import type { Dashboard, DeviceStatus, Snapshot } from "./types";

type View = "dashboard" | "snapshots" | "books" | "statistics" | "calendar" | "export" | "settings";

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
  charts: { daily: [], monthly: [], top_books: [] },
  recent_books: [],
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

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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
  latestSnapshot,
  onImport,
  onUploadClick,
  lastAutoImport,
  busy,
}: {
  status: DeviceStatus | null;
  latestSnapshot: Snapshot | null;
  onImport: () => void;
  onUploadClick: () => void;
  lastAutoImport: Snapshot | null;
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
          <p>
            <span className={stateClass}>{stateLabel}</span>
            <span className="path">{status?.mount_path ?? "/Volumes/KOBOeReader"}</span>
          </p>
        </div>
      </div>
      <div className="device-meta">
        <span>Latest import</span>
        <strong>{latestSnapshot ? formatDateTime(latestSnapshot.imported_at) : "No snapshots"}</strong>
      </div>
      <div className="device-meta">
        <span>Status</span>
        <strong>
          {lastAutoImport
            ? `Auto-imported ${formatDateTime(lastAutoImport.imported_at)}`
            : latestSnapshot
              ? "Latest local snapshot available"
              : "Waiting for first import"}
        </strong>
      </div>
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

function SnapshotPanel({ snapshot }: { snapshot: Snapshot | null }) {
  return (
    <section className="snapshot-panel">
      <div className="snapshot-icon">◉</div>
      <dl>
        <div>
          <dt>Snapshot</dt>
          <dd>{snapshot ? formatDateTime(snapshot.imported_at) : "None imported"}</dd>
        </div>
        <div>
          <dt>Snapshot ID</dt>
          <dd>{snapshot?.id ?? "No local database yet"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{formatSnapshotSource(snapshot)}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{snapshot ? formatBytes(snapshot.file_size) : "0 B"}</dd>
        </div>
        <div>
          <dt>Schema version</dt>
          <dd>{snapshot?.schema_version ?? "Unknown"}</dd>
        </div>
      </dl>
    </section>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

function VerticalBars({
  title,
  subtitle,
  data,
  valueKey,
}: {
  title: string;
  subtitle: string;
  data: Array<Record<string, string | number>>;
  valueKey: string;
}) {
  const max = Math.max(1, ...data.map((item) => Number(item[valueKey])));
  return (
    <section className="chart-panel">
      <header>
        <h3>{title}</h3>
        <span>{subtitle}</span>
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
        <span>By time read</span>
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
                  Import a KOReader statistics database to populate recent books.
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
                      <em>{book.progress == null ? "N/A" : `${book.progress}%`}</em>
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

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const streakLabel =
    dashboard.summary.current_streak === 1
      ? "1 day"
      : `${dashboard.summary.current_streak} days`;

  return (
    <>
      {!dashboard.has_data ? (
        <section className="empty-state">
          <h2>No local KOReader database yet</h2>
          <p>Connect your Kobo and import from KOReader, or upload a copied statistics.sqlite3 file.</p>
        </section>
      ) : null}

      <section className="metrics-grid">
        <MetricCard label="Total time" value={dashboard.summary.total_time_label} note="Across imported stats" />
        <MetricCard label="Reading days" value={dashboard.summary.reading_days} note="Days with activity" />
        <MetricCard label="Books" value={dashboard.summary.books} note="Books with reading time" />
        <MetricCard label="Pages" value={dashboard.summary.pages.toLocaleString()} note="Distinct pages seen" />
        <MetricCard label="Current streak" value={streakLabel} note="Through latest activity" />
      </section>

      <section className="charts-grid">
        <VerticalBars
          title="Daily reading"
          subtitle="Last 30 active days"
          data={dashboard.charts.daily}
          valueKey="minutes"
        />
        <VerticalBars
          title="Monthly reading"
          subtitle="Last 12 active months"
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
        <span className="panel-note">Timestamped local copies</span>
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

function StatisticsView({ dashboard }: { dashboard: Dashboard }) {
  return (
    <>
      <DashboardView dashboard={dashboard} />
    </>
  );
}

function CalendarView({ daily }: { daily: Dashboard["charts"]["daily"] }) {
  return (
    <section className="calendar-panel">
      <header>
        <h3>Calendar</h3>
        <span className="panel-note">Last 30 active reading days</span>
      </header>
      {daily.length === 0 ? (
        <div className="empty-chart">No reading days yet</div>
      ) : (
        <div className="calendar-grid">
          {daily.map((day) => (
            <article key={day.date}>
              <strong>{day.label}</strong>
              <span>{day.minutes.toFixed(0)} min</span>
            </article>
          ))}
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
    const header = ["Title", "Author", "Last opened", "Time", "Pages", "Progress"];
    const rows = dashboard.recent_books.map((book) => [
      book.title,
      book.authors,
      book.last_open ?? "",
      book.time_label,
      book.pages,
      book.progress == null ? "" : `${book.progress}%`,
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
    downloadText("kostats-books.csv", `${csv}\n`, "text/csv");
  }

  return (
    <section className="empty-state">
      <h2>Export</h2>
      <p>Download the currently selected local snapshot analysis. Exports are generated in your browser.</p>
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
          <dt>Device polling</dt>
          <dd>Every 15 seconds while the app is open</dd>
        </div>
        <div>
          <dt>Local snapshots</dt>
          <dd>{snapshots.length}</dd>
        </div>
        <div>
          <dt>Privacy</dt>
          <dd>Local only. No data leaves this Mac.</dd>
        </div>
      </dl>
      <h4>KOReader database candidates</h4>
      <div className="candidate-list">
        {(device?.candidates ?? []).map((candidate) => (
          <div key={candidate.path}>
            <span>{candidate.readable ? "Readable" : candidate.exists ? "Blocked" : "Missing"}</span>
            <code>{candidate.path}</code>
            {candidate.error ? <em>{candidate.error}</em> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [lastAutoImport, setLastAutoImport] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedSnapshotId = useRef<string | null>(null);

  async function refresh() {
    let deviceStatus = await getDeviceStatus();
    if (deviceStatus.mounted && deviceStatus.database_found && !deviceStatus.permission_error) {
      const autoResult = await autoImportFromKobo();
      deviceStatus = autoResult.device;
      if (autoResult.imported) {
        setLastAutoImport(autoResult.snapshot);
      }
    }
    const dashboardSnapshotId = selectedSnapshotId.current ?? "latest";
    const [dashboardData, snapshotData] = await Promise.all([getDashboard(dashboardSnapshotId), getSnapshots()]);
    setDevice(deviceStatus);
    setDashboard(dashboardData);
    setSnapshots(snapshotData.snapshots);
  }

  async function loadSnapshot(snapshotId: string) {
    setBusy(true);
    setError(null);
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
    try {
      const result = await importFromKobo();
      selectedSnapshotId.current = null;
      setLastAutoImport(null);
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
    try {
      const result = await uploadDatabase(file);
      selectedSnapshotId.current = null;
      setLastAutoImport(null);
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
  const isViewingLatest = Boolean(latestSnapshot && activeSnapshot?.id === latestSnapshot.id);
  const noKoboWithData = device && !device.mounted && dashboard.has_data;
  const navItems: Array<{ id: View; label: string; icon: string }> = [
    { id: "dashboard", label: "Dashboard", icon: "⌂" },
    { id: "snapshots", label: "Snapshots", icon: "◎" },
    { id: "books", label: "Books", icon: "□" },
    { id: "statistics", label: "Statistics", icon: "▥" },
    { id: "calendar", label: "Calendar", icon: "◷" },
    { id: "export", label: "Export", icon: "⇩" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>kostats</h1>
          <p>KOReader reading statistics</p>
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
          <strong>Storage</strong>
          <span>Snapshots: {snapshots.length}</span>
          <span>Local only</span>
          <span>No data leaves this Mac</span>
        </div>
      </aside>

      <main>
        <DeviceBanner
          status={device}
          latestSnapshot={latestSnapshot}
          onImport={handleImport}
          onUploadClick={() => fileInput.current?.click()}
          lastAutoImport={lastAutoImport}
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
        {device?.permission_error ? (
          <div className="alert error">
            macOS denied direct access to the Kobo database. Use Upload DB or grant this app permission to read the Kobo volume.
          </div>
        ) : null}
        {noKoboWithData ? (
          <div className="alert info">
            Kobo is not mounted. Showing stats from the {isViewingLatest ? "latest" : "selected"} local snapshot.
          </div>
        ) : null}
        {lastAutoImport ? (
          <div className="alert success">
            Auto-imported Kobo database at {formatDateTime(lastAutoImport.imported_at)}.{" "}
            {isViewingLatest ? "Showing the newest local snapshot." : "Selected snapshot remains open."}
          </div>
        ) : null}

        <SnapshotPanel snapshot={activeSnapshot} />

        {activeView === "dashboard" ? <DashboardView dashboard={dashboard} /> : null}
        {activeView === "snapshots" ? (
          <SnapshotsView
            snapshots={snapshots}
            activeSnapshotId={activeSnapshot?.id ?? null}
            onSelectSnapshot={loadSnapshot}
          />
        ) : null}
        {activeView === "books" ? <RecentBooks books={dashboard.recent_books} /> : null}
        {activeView === "statistics" ? <StatisticsView dashboard={dashboard} /> : null}
        {activeView === "calendar" ? <CalendarView daily={dashboard.charts.daily} /> : null}
        {activeView === "export" ? <ExportView dashboard={dashboard} /> : null}
        {activeView === "settings" ? (
          <SettingsView device={device} snapshots={snapshots} onRefresh={() => refresh().catch((err: Error) => setError(err.message))} />
        ) : null}
      </main>
    </div>
  );
}
