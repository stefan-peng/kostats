import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const emptyDashboard = {
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

function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function calendarFixture(days: Array<{ date: string; label: string; minutes: number; time_label: string; level: 1 | 2 | 3 | 4 }>) {
  return {
    start_date: days[0]?.date ?? null,
    end_date: days.at(-1)?.date ?? null,
    max_minutes: Math.max(0, ...days.map((day) => day.minutes)),
    total_days: days.length,
    days,
  };
}

const fullCalendar = calendarFixture([
  { date: "2024-01-01", label: "Jan 1, 2024", minutes: 900, time_label: "15h", level: 4 },
  { date: "2026-04-20", label: "Apr 20, 2026", minutes: 15, time_label: "15m", level: 1 },
  { date: "2026-04-21", label: "Apr 21, 2026", minutes: 20, time_label: "20m", level: 1 },
  { date: "2026-04-22", label: "Apr 22, 2026", minutes: 25, time_label: "25m", level: 2 },
  { date: "2026-04-23", label: "Apr 23, 2026", minutes: 30, time_label: "30m", level: 2 },
  { date: "2026-04-24", label: "Apr 24, 2026", minutes: 35, time_label: "35m", level: 2 },
  { date: "2026-04-25", label: "Apr 25, 2026", minutes: 40, time_label: "40m", level: 2 },
  { date: "2026-04-26", label: "Apr 26, 2026", minutes: 45, time_label: "45m", level: 2 },
  { date: "2026-04-27", label: "Apr 27, 2026", minutes: 50, time_label: "50m", level: 3 },
  { date: "2026-04-28", label: "Apr 28, 2026", minutes: 55, time_label: "55m", level: 3 },
  { date: "2026-04-29", label: "Apr 29, 2026", minutes: 60, time_label: "1h", level: 3 },
  { date: "2026-04-30", label: "Apr 30, 2026", minutes: 65, time_label: "1h 05m", level: 3 },
  { date: "2026-05-01", label: "May 1, 2026", minutes: 70, time_label: "1h 10m", level: 3 },
  { date: "2026-05-02", label: "May 2, 2026", minutes: 75, time_label: "1h 15m", level: 4 },
  { date: "2026-05-03", label: "May 3, 2026", minutes: 80, time_label: "1h 20m", level: 4 },
  { date: "2026-05-04", label: "May 4, 2026", minutes: 90, time_label: "1h 30m", level: 4 },
]);

const populatedDashboard = {
  has_data: true,
  snapshot: {
    id: "20260531T120000Z",
    imported_at: "2026-05-31T12:00:00Z",
    source: "upload",
    source_path: "statistics.sqlite3",
    path: "/tmp/statistics.sqlite3",
    file_size: 4096,
    user_version: 24,
    schema_version: "24",
  },
  summary: {
    total_time_seconds: 5400,
    total_time_label: "1h 30m",
    reading_days: 15,
    books: 1,
    pages: 8,
    current_streak: 2,
    finished_books: 1,
    reading_books: 1,
    abandoned_books: 0,
    highlights: 2,
  },
  charts: {
    daily: [{ date: "2026-05-30", label: "May 30", minutes: 90 }],
    monthly: [{ month: "2026-05", label: "May 26", hours: 1.5 }],
    top_books: [{ id: "1", title: "Piranesi", hours: 1.5 }],
    calendar: fullCalendar,
  },
  books: [
    {
      id: "1",
      title: "Piranesi",
      authors: "Susanna Clarke",
      last_open: "2026-05-31T12:00:00Z",
      time_seconds: 5400,
      time_label: "1h 30m",
      pages: 8,
      max_page: 80,
      total_pages: 200,
      progress: 40,
      percent_finished: 0.4,
      status: "reading",
      status_modified: "2026-05-31",
      highlight_count: 2,
      note_count: 0,
      series: "",
      series_index: null,
      language: "en",
      metadata_available: true,
      source_book_ids: ["1", "4"],
      source_md5s: ["piranesi-a", "piranesi-b"],
      merged_count: 2,
    },
    {
      id: "2",
      title: "A Wizard of Earthsea",
      authors: "Ursula K. Le Guin",
      last_open: "2026-05-28T10:00:00Z",
      time_seconds: 7200,
      time_label: "2h 00m",
      pages: 34,
      max_page: 180,
      total_pages: 180,
      progress: 100,
      percent_finished: 0.75,
      status: "complete",
      status_modified: "2026-05-28",
      highlight_count: 0,
      note_count: 0,
      series: "Earthsea Cycle",
      series_index: 1,
      language: "en",
      metadata_available: true,
      source_book_ids: ["2"],
      source_md5s: ["earthsea-md5"],
      merged_count: 1,
    },
    {
      id: "3",
      title: "Notes on a Small Planet",
      authors: "Unknown author",
      last_open: null,
      time_seconds: 600,
      time_label: "10m",
      pages: 2,
      max_page: null,
      total_pages: null,
      progress: 20,
      percent_finished: null,
      status: null,
      status_modified: null,
      highlight_count: 0,
      note_count: 0,
      series: "",
      series_index: null,
      language: "",
      metadata_available: false,
      source_book_ids: ["3"],
      source_md5s: [],
      merged_count: 1,
    },
  ],
  recent_books: [
    {
      id: "1",
      title: "Piranesi",
      authors: "Susanna Clarke",
      last_open: "2026-05-31T12:00:00Z",
      time_seconds: 5400,
      time_label: "1h 30m",
      pages: 8,
      max_page: 80,
      total_pages: 200,
      progress: 40,
      percent_finished: 0.4,
      status: "reading",
      status_modified: "2026-05-31",
      highlight_count: 2,
      note_count: 0,
      series: "",
      series_index: null,
      language: "en",
      metadata_available: true,
      source_book_ids: ["1", "4"],
      source_md5s: ["piranesi-a", "piranesi-b"],
      merged_count: 2,
    },
  ],
};

const olderSnapshot = {
  ...populatedDashboard.snapshot,
  id: "20260501T090000Z",
  imported_at: "2026-05-01T09:00:00Z",
  source_path: "older-statistics.sqlite3",
  path: "/tmp/older-statistics.sqlite3",
};

const olderDashboard = {
  ...populatedDashboard,
  snapshot: olderSnapshot,
  summary: {
    ...populatedDashboard.summary,
    total_time_seconds: 1800,
    total_time_label: "30m",
    reading_days: 1,
  },
  charts: {
    daily: [{ date: "2026-05-01", label: "May 1", minutes: 30 }],
    monthly: [{ month: "2026-05", label: "May 26", hours: 0.5 }],
    top_books: [{ id: "2", title: "Older Book", hours: 0.5 }],
    calendar: calendarFixture([
      { date: "2026-05-01", label: "May 1, 2026", minutes: 30, time_label: "30m", level: 4 },
    ]),
  },
  recent_books: [
    {
      ...populatedDashboard.recent_books[0],
      id: "2",
      title: "Older Book",
      last_open: "2026-05-01T09:00:00Z",
      time_seconds: 1800,
      time_label: "30m",
      progress: 10,
    },
  ],
};

const autoSnapshot = {
  ...populatedDashboard.snapshot,
  id: "20260601T120000Z",
  imported_at: "2026-06-01T12:00:00Z",
  source: "kobo-auto",
  source_path: "/Volumes/KOBOeReader/.adds/koreader/settings/statistics.sqlite3",
  path: "/tmp/auto-statistics.sqlite3",
};

const autoDashboard = {
  ...populatedDashboard,
  snapshot: autoSnapshot,
};

const windowsAutoSnapshot = {
  ...autoSnapshot,
  source_path: "E:\\.adds\\koreader\\settings\\statistics.sqlite3",
};

const recoveryBackup = {
  id: "20260610T120000Z",
  created_at: "2026-06-10T12:00:00Z",
  source: "kobo",
  source_mount: "/Volumes/KOBOeReader",
  archive_path: "/tmp/20260610T120000Z.zip",
  archive_size: 8192,
  content_hash: "backup-hash",
  koreader_version: "v2026.03",
  device_model: "Kobo_monza",
  document_metadata_folder: "doc",
  credentials_included: true,
  counts: {
    sidecars: 3,
    settings: 4,
    databases: 2,
    dictionaries: 1,
    extensions: 2,
  },
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const result = handler(url, init);
    if (result instanceof Error) {
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ detail: result.message }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(result),
    });
  }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 7, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows empty state before the first import", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [] };
      return emptyDashboard;
    });

    render(<App />);

    expect(await screen.findByText("No database yet")).toBeInTheDocument();
    expect(screen.getByText("Kobo not mounted")).toBeInTheDocument();
  });

  it("renders latest snapshot data when Kobo is not mounted", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);

    expect((await screen.findAllByText("1h 30m")).length).toBeGreaterThan(0);
    expect(screen.getByText("Kobo not mounted")).toBeInTheDocument();
    expect(screen.getAllByText("Piranesi").length).toBeGreaterThan(0);
  });

  it("shows dashboard bar values on hover and keyboard focus", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);

    const dailyBar = await screen.findByLabelText("May 30: 1h 30m");
    await userEvent.hover(dailyBar);
    expect(screen.getByRole("tooltip")).toHaveTextContent("May 301h 30m");
    await userEvent.unhover(dailyBar);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const monthlyBar = screen.getByLabelText("May 26: 1h 30m");
    act(() => monthlyBar.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("May 261h 30m");
    act(() => monthlyBar.blur());
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const topBookBar = screen.getByLabelText("Piranesi: 1h 30m");
    await userEvent.hover(topBookBar);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Piranesi1h 30m");
  });

  it("shows calendar heatmap values on hover", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Calendar/i }));

    const readingDay = screen.getByLabelText(
      "Monday, May 4, 2026: 1h 30m read, intensity 4 of 4",
    );
    await userEvent.hover(readingDay);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Monday, May 4, 20261h 30m read");
    await userEvent.unhover(readingDay);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    const emptyDay = screen.getByLabelText("Sunday, June 7, 2026: no reading");
    await userEvent.hover(emptyDay);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Sunday, June 7, 2026No reading");
  });

  it("shows manual fallback when Kobo import fails", async () => {
    const mountedStatus = {
      mount_path: "/Volumes/KOBOeReader",
      mounted: true,
      database_found: true,
      selected_path: "/Volumes/KOBOeReader/.adds/koreader/settings/statistics.sqlite3",
      permission_error: null,
      candidates: [],
    };
    mockFetch((url, init) => {
      if (url.startsWith("/api/import/kobo/auto")) {
        return {
          imported: false,
          reason: "unchanged",
          snapshot: null,
          device: mountedStatus,
        };
      }
      if (url.startsWith("/api/import/kobo") && init?.method === "POST") {
        return new Error("Kobo is mounted, but the app could not read the KOReader database.");
      }
      if (url.startsWith("/api/device/status")) {
        return mountedStatus;
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [] };
      return emptyDashboard;
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Import from Kobo/i }));

    await waitFor(() => {
      expect(screen.getByText(/could not read the KOReader database/)).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: /Upload DB/i }).length).toBeGreaterThan(0);
  });

  it("renders Windows Kobo paths and still auto-imports on startup", async () => {
    const mountedStatus = {
      mount_path: "E:\\",
      mounted: true,
      database_found: true,
      selected_path: "E:\\.adds\\koreader\\settings\\statistics.sqlite3",
      permission_error: null,
      candidates: [],
      searched_mount_paths: ["C:\\", "E:\\"],
    };
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) return mountedStatus;
      if (url.startsWith("/api/import/kobo/auto")) {
        return {
          imported: true,
          reason: "changed",
          snapshot: windowsAutoSnapshot,
          device: mountedStatus,
          dashboard: { ...autoDashboard, snapshot: windowsAutoSnapshot },
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [windowsAutoSnapshot] };
      return { ...autoDashboard, snapshot: windowsAutoSnapshot };
    });

    render(<App />);

    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(await deviceBanner.findByText("Ready to import")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Snapshots/i }));
    expect(screen.getByText(/E:\\.adds\\koreader\\settings\\statistics.sqlite3/)).toBeInTheDocument();
  });

  it("shows an automatic Kobo import during startup sync", async () => {
    const mountedStatus = {
      mount_path: "/Volumes/KOBOeReader",
      mounted: true,
      database_found: true,
      selected_path: "/Volumes/KOBOeReader/.adds/koreader/settings/statistics.sqlite3",
      permission_error: null,
      candidates: [],
    };
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) return mountedStatus;
      if (url.startsWith("/api/import/kobo/auto")) {
        return {
          imported: true,
          reason: "changed",
          snapshot: autoSnapshot,
          device: mountedStatus,
          dashboard: autoDashboard,
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [autoSnapshot] };
      return autoDashboard;
    });

    render(<App />);

    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(await deviceBanner.findByText("Ready to import")).toBeInTheDocument();
    expect(deviceBanner.getByText(/Jun 1, 2026/)).toBeInTheDocument();
  });

  it("continues showing local snapshot data when startup auto-import fails", async () => {
    const mountedStatus = {
      mount_path: "/Volumes/KOBOeReader",
      mounted: true,
      database_found: true,
      selected_path: "/Volumes/KOBOeReader/.adds/koreader/settings/statistics.sqlite3",
      permission_error: null,
      candidates: [],
    };
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) return mountedStatus;
      if (url.startsWith("/api/import/kobo/auto")) {
        return new Error("Unsupported KOReader statistics schema: missing book table");
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);

    expect(await screen.findByText(/Auto-import failed:/)).toBeInTheDocument();
    expect(screen.getByText(/Unsupported KOReader statistics schema/)).toBeInTheDocument();
    expect(screen.getAllByText("Piranesi").length).toBeGreaterThan(0);
    expect(screen.getByText("1 snapshots")).toBeInTheDocument();
  });

  it("makes sidebar sections navigable", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [
            {
              path: "/Volumes/KOBOeReader/.adds/koreader/settings/statistics.sqlite3",
              exists: false,
              readable: false,
              error: null,
            },
          ],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);

    expect(screen.queryByRole("button", { name: /Statistics/i })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: /Snapshots/i }));
    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeInTheDocument();
    expect(screen.getAllByText("20260531T120000Z").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /Calendar/i }));
    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell")).toHaveLength(365);
    expect(screen.getByLabelText(/Sunday, June 8, 2025: no reading/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Monday, April 20, 2026: 15m read, intensity 1 of 4/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Monday, May 4, 2026: 1h 30m read, intensity 4 of 4/)).toBeInTheDocument();
    const calendarSummary = within(screen.getByLabelText("Calendar summary"));
    expect(calendarSummary.getByText("15")).toBeInTheDocument();
    expect(calendarSummary.getByText("1h 30m")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Monday, January 1, 2024/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Settings/i }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Kobo mount path")).toBeInTheDocument();
    expect(screen.getByText("Local snapshots")).toBeInTheDocument();
  });

  it("shows a filterable and sortable full Books view", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /Books/i }));
    expect(screen.getByRole("heading", { name: "Books" })).toBeInTheDocument();
    expect(screen.getByText("3 of 3 books")).toBeInTheDocument();
    expect(screen.getByText("3h 40m")).toBeInTheDocument();
    expect(screen.getByText("A Wizard of Earthsea")).toBeInTheDocument();
    expect(screen.getByText("80 / 200")).toBeInTheDocument();
    expect(screen.getByText("2 records")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search"), "le guin");
    expect(screen.getByText("1 of 3 books")).toBeInTheDocument();
    expect(screen.getByText("A Wizard of Earthsea")).toBeInTheDocument();
    expect(screen.queryByText("Piranesi")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search"));
    await userEvent.selectOptions(screen.getByLabelText("Status"), "finished");
    expect(screen.getByText("A Wizard of Earthsea")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByText("Piranesi")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "reading");
    expect(screen.getByText("Piranesi")).toBeInTheDocument();
    expect(screen.getByText("Notes on a Small Planet")).toBeInTheDocument();
    expect(screen.queryByText("A Wizard of Earthsea")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "unknown");
    expect(screen.queryByText("Notes on a Small Planet")).not.toBeInTheDocument();
    expect(screen.queryByText("A Wizard of Earthsea")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "all");
    await userEvent.selectOptions(screen.getByLabelText("Sort"), "title");
    await userEvent.click(screen.getByRole("button", { name: "Descending" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[1]).getByText("A Wizard of Earthsea")).toBeInTheDocument();
  });

  it("keeps sparse page panels from stretching to fill the viewport", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Calendar/i }));

    expect(document.querySelector("main")).toHaveStyle({ alignContent: "start" });
  });

  it("renders a trailing-year grid when there are no reading days", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [] };
      return emptyDashboard;
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Calendar/i }));

    const heatmap = screen.getByLabelText("Scrollable reading calendar heatmap");
    expect(within(heatmap).getAllByRole("gridcell")).toHaveLength(365);
    expect(screen.getByLabelText(/Sunday, June 8, 2025: no reading/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sunday, June 7, 2026: no reading/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Calendar summary")).getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("No reading days yet")).not.toBeInTheDocument();
  });

  it("opens an overflowing calendar at the current week without resetting after polling", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("calendar-scroll") ? 828 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("calendar-scroll") ? 340 : 0;
    });
    let dashboardRequests = 0;
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      dashboardRequests += 1;
      return {
        ...populatedDashboard,
        charts: {
          ...populatedDashboard.charts,
          calendar: { ...populatedDashboard.charts.calendar },
        },
      };
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Calendar/i }));

    const heatmap = screen.getByLabelText("Scrollable reading calendar heatmap");
    expect(heatmap).toHaveProperty("scrollLeft", 488);

    heatmap.scrollLeft = 120;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(dashboardRequests).toBeGreaterThan(1);
    expect(heatmap).toHaveProperty("scrollLeft", 120);
  });

  it("keeps latest import metadata separate from the selected snapshot", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot, olderSnapshot] };
      if (url.includes(`snapshot_id=${olderSnapshot.id}`)) return olderDashboard;
      return populatedDashboard;
    });

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /Snapshots/i }));
    await userEvent.click(screen.getAllByRole("button", { name: "View" })[0]);

    expect((await screen.findAllByText("Older Book")).length).toBeGreaterThan(0);
    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(deviceBanner.getByText("Viewing")).toBeInTheDocument();
    expect(deviceBanner.getByText(/May 1, 2026/)).toBeInTheDocument();
    expect(deviceBanner.getByText("Latest")).toBeInTheDocument();
    expect(deviceBanner.getByText(/May 31, 2026/)).toBeInTheDocument();
  });

  it("preserves a selected snapshot when refresh auto-imports a newer database", async () => {
    const mountedStatus = {
      mount_path: "/Volumes/KOBOeReader",
      mounted: true,
      database_found: true,
      selected_path: "/Volumes/KOBOeReader/.adds/koreader/settings/statistics.sqlite3",
      permission_error: null,
      candidates: [],
    };
    let autoImportChanged = false;
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) return mountedStatus;
      if (url.startsWith("/api/import/kobo/auto")) {
        return autoImportChanged
          ? {
              imported: true,
              reason: "changed",
              snapshot: autoSnapshot,
              device: mountedStatus,
              dashboard: autoDashboard,
            }
          : {
              imported: false,
              reason: "unchanged",
              snapshot: populatedDashboard.snapshot,
              device: mountedStatus,
            };
      }
      if (url.startsWith("/api/snapshots")) {
        return {
          snapshots: autoImportChanged
            ? [autoSnapshot, populatedDashboard.snapshot, olderSnapshot]
            : [populatedDashboard.snapshot, olderSnapshot],
        };
      }
      if (url.includes(`snapshot_id=${olderSnapshot.id}`)) return olderDashboard;
      return populatedDashboard;
    });

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /Snapshots/i }));
    await userEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect((await screen.findAllByText("Older Book")).length).toBeGreaterThan(0);

    autoImportChanged = true;
    await userEvent.click(screen.getByRole("button", { name: /Settings/i }));
    await userEvent.click(screen.getByRole("button", { name: /Refresh now/i }));

    await userEvent.click(screen.getByRole("button", { name: /Dashboard/i }));
    expect((await screen.findAllByText("Older Book")).length).toBeGreaterThan(0);
    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(deviceBanner.getByText("Viewing")).toBeInTheDocument();
    expect(deviceBanner.getByText(/May 1, 2026/)).toBeInTheDocument();
    expect(deviceBanner.getByText("Latest")).toBeInTheDocument();
    expect(deviceBanner.getByText(/Jun 1, 2026/)).toBeInTheDocument();
  });

  it("creates, previews, confirms, and reports a recovery restore", async () => {
    const mountedStatus = {
      mount_path: "/Volumes/KOBOeReader",
      mounted: true,
      database_found: true,
      selected_path: "/Volumes/KOBOeReader/.adds/koreader/settings/statistics.sqlite3",
      permission_error: null,
      candidates: [],
    };
    let restoreBody: Record<string, unknown> | null = null;
    mockFetch((url, init) => {
      if (url.startsWith("/api/device/status")) return mountedStatus;
      if (url.startsWith("/api/import/kobo/auto")) {
        return {
          imported: false,
          reason: "unchanged",
          snapshot: populatedDashboard.snapshot,
          device: mountedStatus,
        };
      }
      if (url === "/api/backups") return { backups: [recoveryBackup] };
      if (url === "/api/backups/kobo") return { created: false, backup: recoveryBackup };
      if (url.endsWith("/restore-preview")) {
        return {
          backup: recoveryBackup,
          device: mountedStatus,
          current_koreader_version: "v2026.04",
          version_warning: true,
          required_bytes: 4096,
          available_bytes: 1024 * 1024,
          counts: recoveryBackup.counts,
          exact_matches: [{ title: "Matched Book", source_path: "Book.sdr" }],
          missing_matches: [{ title: "Missing Book", source_path: "Missing.sdr" }],
          ambiguous_matches: [],
          book_count: 2,
        };
      }
      if (url.endsWith("/restore") && init?.method === "POST") {
        restoreBody = JSON.parse(String(init.body));
        return {
          restored: { settings: 4, databases: 2, sidecars: 1 },
          skipped: { sidecars: 1, extensions: 0 },
          failed: [],
          safety_backup_id: "20260611T120000Z",
          restart_required: true,
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Backups/i }));

    expect(screen.getByText("Contains credentials")).toBeInTheDocument();
    expect(screen.getByText("sidecar files")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Back up now/i }));
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    const preview = await screen.findByRole("dialog", { name: "Restore preview" });
    expect(within(preview).getByText(/differs from the installed/)).toBeInTheDocument();
    expect(within(preview).getByText("Missing Book")).toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "Restore backup" })).toBeDisabled();

    await userEvent.click(
      within(preview).getByRole("checkbox", { name: /Restore optional extensions/i }),
    );
    await userEvent.click(
      within(preview).getByRole("checkbox", { name: /I understand this will modify/i }),
    );
    await userEvent.click(within(preview).getByRole("button", { name: "Restore backup" }));

    expect(await screen.findByRole("heading", { name: "Restore complete" })).toBeInTheDocument();
    expect(screen.getByText(/20260611T120000Z/)).toBeInTheDocument();
    expect(screen.getByText(/Eject the Kobo and restart KOReader/)).toBeInTheDocument();
    expect(restoreBody).toEqual({
      confirmed: true,
      restore_optional_extensions: true,
    });
  });

  it("exports selected dashboard data", async () => {
    const clickSpy = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "a") {
        element.click = clickSpy;
      }
      return element;
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:kostats"),
      revokeObjectURL: vi.fn(),
    });
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return {
          mount_path: "/Volumes/KOBOeReader",
          mounted: false,
          database_found: false,
          selected_path: null,
          permission_error: null,
          candidates: [],
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /Export/i }));
    await userEvent.click(screen.getByRole("button", { name: /Export dashboard JSON/i }));
    await userEvent.click(screen.getByRole("button", { name: /Export books CSV/i }));

    expect(clickSpy).toHaveBeenCalledTimes(2);
    const csvBlob = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob;
    const csv = await readBlobText(csvBlob);
    expect(csv).toContain("Notes,Records,Source book IDs");
    expect(csv).toContain("Earthsea Cycle,1,en,Finished");
    expect(csv).toContain("2,1; 4");
  });
});
