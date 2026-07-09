import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function calendarFixture(days: Array<{
  date: string;
  label: string;
  minutes: number;
  time_label: string;
  level: 1 | 2 | 3 | 4;
  book_ids?: string[];
}>) {
  return {
    start_date: days[0]?.date ?? null,
    end_date: days.at(-1)?.date ?? null,
    max_minutes: Math.max(0, ...days.map((day) => day.minutes)),
    total_days: days.length,
    days: days.map((day) => ({ ...day, book_ids: day.book_ids ?? [] })),
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
  {
    date: "2026-05-04",
    label: "May 4, 2026",
    minutes: 90,
    time_label: "1h 30m",
    level: 4,
    book_ids: ["1", "2"],
  },
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
    device_id: "primary-kobo",
    device_label: "Primary Kobo",
    device_model: "Kobo_monza",
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
  insights: {
    sessions: {
      available: true,
      total: 2,
      average_active_seconds: 2700,
      longest_active_seconds: 3600,
      recent: [
        {
          started_at: "2026-05-31T10:00:00Z",
          ended_at: "2026-05-31T11:00:00Z",
          active_seconds: 2700,
          elapsed_seconds: 3600,
          event_count: 8,
          book_ids: ["1"],
          book_count: 1,
        },
      ],
    },
  },
  books: [
    {
      id: "1",
      title: "Piranesi",
      authors: "Susanna Clarke",
      last_open: "2026-05-31T12:00:00Z",
      time_seconds: 5400,
      time_label: "1h 30m",
      pace_seconds_per_page: 675,
      estimated_remaining_seconds: 81000,
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
      recent_sessions: [
        {
          started_at: "2026-05-31T10:00:00Z",
          ended_at: "2026-05-31T11:00:00Z",
          active_seconds: 2700,
          elapsed_seconds: 3600,
          event_count: 8,
          book_ids: ["1"],
          book_count: 1,
        },
      ],
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
  device_id: "travel-kobo",
  device_label: "Travel Kobo",
  device_model: "Kobo_libra",
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
  device_id: "primary-kobo",
  device_label: "Primary Kobo",
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

const deviceSummary = {
  id: "primary-kobo",
  label: "Primary Kobo",
  model: "Kobo_monza",
  koreader_version: "v2026.03",
  source: "kobo",
  first_seen: "2026-06-01T12:00:00Z",
  last_seen: "2026-06-01T12:00:00Z",
  snapshot_count: 1,
  backup_count: 1,
  last_snapshot_at: "2026-06-01T12:00:00Z",
  last_backup_at: "2026-06-10T12:00:00Z",
};

const travelDeviceSummary = {
  id: "travel-kobo",
  label: "Travel Kobo",
  model: "Kobo_libra",
  koreader_version: "v2026.03",
  source: "kobo",
  first_seen: "2026-05-01T09:00:00Z",
  last_seen: "2026-05-01T09:00:00Z",
  snapshot_count: 1,
  backup_count: 0,
  last_snapshot_at: "2026-05-01T09:00:00Z",
  last_backup_at: null,
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/devices")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ devices: [deviceSummary, travelDeviceSummary] }),
      });
    }
    const result = handler(url, init);
    if (
      url.startsWith("/api/backups?")
      && (result === undefined || !(typeof result === "object" && result !== null && "backups" in result))
    ) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ backups: [] }),
      });
    }
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

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function stubSystemMedia({ dark = false, width = 1024 }: { dark?: boolean; width?: number } = {}) {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-color-scheme")
      ? dark
      : query.includes("max-width")
        ? width <= Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? 0)
        : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

async function selectRadixOption(label: string, option: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

describe("App", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", window.location.pathname);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 7, 12));
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    stubSystemMedia();
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    }
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = vi.fn();
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = vi.fn();
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    vi.spyOn(console, "warn").mockImplementation((...args) => {
      if (String(args[0]).includes("width(0) and height(0) of chart")) return;
      console.info(...args);
    });
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

  it("opens device assignment before uploading from compact views", async () => {
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

    await screen.findByText("No database yet");
    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(deviceBanner.queryByText("Import as")).not.toBeInTheDocument();

    await userEvent.click(deviceBanner.getByRole("button", { name: /Upload DB/i }));

    const uploadDialog = await screen.findByRole("dialog");
    expect(within(uploadDialog).getByText("Choose which device this KOReader database belongs to.")).toBeInTheDocument();
    expect(within(uploadDialog).getByLabelText("Import device")).toHaveTextContent("Primary Kobo");
    expect(within(uploadDialog).getByRole("button", { name: /Upload DB/i })).toBeEnabled();

    await userEvent.click(within(uploadDialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("link", { name: /Settings/i }));

    expect(screen.getByLabelText("Import device")).toHaveTextContent("Auto-detected");
  });

  it("follows the system dark mode preference", async () => {
    stubSystemMedia({ dark: true });
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

    await screen.findByText("No database yet");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
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

  it("renders shadcn charts for dashboard reading data", async () => {
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

    expect(await screen.findByText("Daily reading")).toBeInTheDocument();
    expect(screen.getByText("Monthly reading")).toBeInTheDocument();
    expect(screen.getByText("Top books")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="chart"]')).toHaveLength(3);
    expect(screen.getAllByText("Piranesi").length).toBeGreaterThan(0);
  });

  it("renders daily chart bars through Recharts", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 210,
      left: 0,
      right: 327,
      top: 0,
      width: 327,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const daily = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-05-${String(index + 1).padStart(2, "0")}`,
      label: `Day ${index + 1}`,
      minutes: index + 1,
    }));

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
      return {
        ...populatedDashboard,
        charts: { ...populatedDashboard.charts, daily },
      };
    });

    render(<App />);

    expect(await screen.findByText("Daily reading")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="chart"]').length).toBeGreaterThan(0);
  });

  it("renders sparse monthly chart data through Recharts", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 210,
      left: 0,
      right: 224,
      top: 0,
      width: 224,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const monthly = Array.from({ length: 5 }, (_, index) => ({
      month: `2026-${String(index + 1).padStart(2, "0")}`,
      label: `Month ${index + 1}`,
      hours: index + 1,
    }));

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
      return {
        ...populatedDashboard,
        charts: {
          ...populatedDashboard.charts,
          monthly,
        },
      };
    });

    render(<App />);

    expect(await screen.findByText("Monthly reading")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="chart"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);
  });

  it("renders a label for every top book", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 210,
      left: 0,
      right: 327,
      top: 0,
      width: 327,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const topBooks = Array.from({ length: 10 }, (_, index) => ({
      id: String(index + 1),
      title: `Chart Book ${index + 1}`,
      hours: 10 - index,
    }));

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
      return {
        ...populatedDashboard,
        charts: {
          ...populatedDashboard.charts,
          top_books: topBooks,
        },
      };
    });

    render(<App />);

    expect(await screen.findByText("Top books")).toBeInTheDocument();
    for (const book of topBooks) {
      expect(screen.getAllByText(book.title).length).toBeGreaterThan(0);
    }
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
    await userEvent.click(await screen.findByRole("link", { name: /Calendar/i }));

    const readingDay = screen.getByLabelText(
      "Monday, May 4, 2026: 1h 30m read, intensity 4 of 4. View 2 books",
    );
    await userEvent.hover(readingDay);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Monday, May 4, 20261h 30m readView 2 books",
    );
    await userEvent.unhover(readingDay);

    expect(screen.getByLabelText("Sunday, June 7, 2026: no reading")).toBeInTheDocument();
  });

  it("opens Books filtered to the books contributing to a selected calendar day", async () => {
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
    await userEvent.click(await screen.findByRole("link", { name: /Calendar/i }));
    const readingDayButton = screen.getByRole("button", {
      name: "Monday, May 4, 2026: 1h 30m read, intensity 4 of 4. View 2 books",
    });
    expect(readingDayButton.closest('[role="gridcell"]')).toBeInTheDocument();
    await userEvent.click(readingDayButton);

    expect(screen.getByText(/Reading on Monday, May 4, 2026/)).toHaveTextContent(
      "Reading on Monday, May 4, 2026 · 2 of 2 books",
    );
    expect(screen.getByText("Piranesi")).toBeInTheDocument();
    expect(screen.getByText("A Wizard of Earthsea")).toBeInTheDocument();
    expect(screen.queryByText("Notes on a Small Planet")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(screen.getByText("3 of 3 books")).toBeInTheDocument();
    expect(screen.getByText("Notes on a Small Planet")).toBeInTheDocument();
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
    const autoImportUrls: string[] = [];
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) return mountedStatus;
      if (url.startsWith("/api/import/kobo/auto")) {
        autoImportUrls.push(url);
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
    await userEvent.click(screen.getByRole("link", { name: /Snapshots/i }));
    expect(screen.getAllByText(/E:\\.adds\\koreader\\settings\\statistics.sqlite3/).length).toBeGreaterThan(0);
    expect(autoImportUrls).toContain("/api/import/kobo/auto");
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
    const autoImportUrls: string[] = [];
    const dashboardUrls: string[] = [];
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) return mountedStatus;
      if (url.startsWith("/api/import/kobo/auto")) {
        autoImportUrls.push(url);
        return {
          imported: true,
          reason: "changed",
          snapshot: autoSnapshot,
          device: mountedStatus,
          dashboard: autoDashboard,
        };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [autoSnapshot] };
      if (url.startsWith("/api/dashboard")) dashboardUrls.push(url);
      return autoDashboard;
    });

    render(<App />);

    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(await deviceBanner.findByText("Ready to import")).toBeInTheDocument();
    expect(deviceBanner.getByText(/Jun 1, 2026/)).toBeInTheDocument();
    expect(autoImportUrls).toContain("/api/import/kobo/auto");
    expect(dashboardUrls).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(15000);
    });
    await waitFor(() => expect(autoImportUrls).toHaveLength(1));
    expect(dashboardUrls).toHaveLength(1);
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
    const snapshotsLink = screen.getByRole("link", { name: /Snapshots/i });
    expect(within(snapshotsLink.closest('[data-sidebar="menu-item"]') as HTMLElement).getByText("1")).toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole("link", { name: /Snapshots/i }));
    expect(screen.getAllByText("Snapshots").length).toBeGreaterThan(1);
    expect(screen.getAllByText("20260531T120000Z").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Snapshots table" })).toHaveAttribute("tabindex", "0");

    await userEvent.click(screen.getByRole("link", { name: /Calendar/i }));
    expect(screen.getAllByText("Calendar").length).toBeGreaterThan(1);
    expect(screen.getAllByRole("gridcell")).toHaveLength(365);
    expect(screen.getByLabelText(/Sunday, June 8, 2025: no reading/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Monday, April 20, 2026: 15m read, intensity 1 of 4/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Monday, May 4, 2026: 1h 30m read, intensity 4 of 4/)).toBeInTheDocument();
    const calendarSummary = within(screen.getByLabelText("Calendar summary"));
    expect(calendarSummary.getByText("15 days")).toBeInTheDocument();
    expect(calendarSummary.getByText("1h 30m peak")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Monday, January 1, 2024/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: /Settings/i }));
    expect(screen.getAllByText("Settings").length).toBeGreaterThan(1);
    expect(screen.getByText("Kobo mount path")).toBeInTheDocument();
    expect(screen.getByText("Local snapshots")).toBeInTheDocument();
  });

  it("closes the mobile sidebar after selecting a section", async () => {
    stubSystemMedia({ width: 390 });
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

    await screen.findByText("Recent books");
    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).not.toBeNull();
    await userEvent.click(trigger as HTMLElement);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("link", { name: /Books/i }));

    expect(screen.getByRole("region", { name: "Books table" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(trigger as HTMLElement);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: /kostats/i }));

    expect(screen.getByText("Recent books")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("collapses the desktop sidebar to its icon layout", async () => {
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

    await screen.findByText("Recent books");
    const dashboardItem = screen.getByRole("link", { name: /Dashboard/i });
    const booksItem = screen.getByRole("link", { name: /^Books$/i });
    expect(dashboardItem).toHaveAttribute("data-active", "true");
    expect(dashboardItem).toHaveAttribute("aria-current", "page");
    expect(booksItem).not.toHaveAttribute("data-active");
    expect(booksItem).not.toHaveAttribute("aria-current");
    expect(dashboardItem).toHaveAttribute("href", "#dashboard");
    expect(booksItem).toHaveAttribute("href", "#books");

    await userEvent.click(booksItem);

    expect(window.location.hash).toBe("#books");
    expect(dashboardItem).not.toHaveAttribute("data-active");
    expect(dashboardItem).not.toHaveAttribute("aria-current");
    expect(booksItem).toHaveAttribute("data-active", "true");
    expect(booksItem).toHaveAttribute("aria-current", "page");

    act(() => {
      window.history.pushState(null, "", "#dashboard");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(dashboardItem).toHaveAttribute("data-active", "true");
    expect(booksItem).not.toHaveAttribute("data-active");

    act(() => {
      window.location.hash = "books";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(dashboardItem).not.toHaveAttribute("data-active");
    expect(booksItem).toHaveAttribute("data-active", "true");

    const sidebar = document.querySelector('[data-slot="sidebar"][data-state]');
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    const trigger = document.querySelector('[data-sidebar="trigger"]');
    expect(trigger).not.toBeNull();
    await userEvent.click(trigger as HTMLElement);

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
    expect(sidebar).toHaveAttribute("data-collapsible", "icon");
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

    const expectedTableHeight = `${window.innerHeight - 53}px`;
    await screen.findByRole("table");
    const recentRegion = screen.getByRole("region", { name: "Recent books table" });
    expect(recentRegion).not.toHaveStyle({ height: expectedTableHeight });
    expect(screen.getByRole("region", { name: "Recent books table" })).toHaveAttribute("tabindex", "0");

    await userEvent.click(await screen.findByRole("link", { name: /Books/i }));
    expect(screen.getAllByText("Books").length).toBeGreaterThan(1);
    const booksTableRegion = screen.getByRole("region", { name: "Books table" });
    expect(booksTableRegion).toHaveStyle({ height: expectedTableHeight });
    expect(booksTableRegion).toHaveClass("overflow-hidden");
    expect(booksTableRegion).toHaveAttribute("tabindex", "0");
    Object.defineProperty(booksTableRegion, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(booksTableRegion, "scrollHeight", { configurable: true, value: 1_200 });
    fireEvent.keyDown(booksTableRegion, { key: "PageDown" });
    expect(booksTableRegion.scrollTop).toBe(360);
    fireEvent.keyDown(booksTableRegion, { key: "Home" });
    expect(booksTableRegion.scrollTop).toBe(0);
    expect(screen.getByText("3 of 3 books")).toBeInTheDocument();
    expect(screen.getByText(/3h 40m/)).toBeInTheDocument();
    expect(screen.getByText("A Wizard of Earthsea")).toBeInTheDocument();
    expect(screen.getByText("80 / 200")).toBeInTheDocument();
    expect(screen.getByText("2 records")).toBeInTheDocument();
    const titleResizer = screen.getByRole("separator", { name: "Resize Title column" });
    const initialTitleWidth = Number(titleResizer.getAttribute("aria-valuenow"));
    expect(titleResizer).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(titleResizer, { key: "ArrowRight" });
    expect(titleResizer).toHaveAttribute("aria-valuenow", String(initialTitleWidth + 16));

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    const authorColumn = screen.getByRole("menuitemcheckbox", { name: "Author" });
    expect(authorColumn).toHaveAttribute("data-state", "checked");
    await userEvent.click(authorColumn);
    expect(screen.queryByRole("columnheader", { name: /Author/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Ursula K. Le Guin")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Author" }));
    expect(await screen.findByRole("columnheader", { name: /Author/ })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search"), "le guin");
    expect(screen.getByText("1 of 3 books")).toBeInTheDocument();
    expect(screen.getByText("A Wizard of Earthsea")).toBeInTheDocument();
    expect(screen.queryByText("Piranesi")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search"));
    await selectRadixOption("Status", "Finished");
    expect(screen.getByText("A Wizard of Earthsea")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByText("Piranesi")).not.toBeInTheDocument();

    await selectRadixOption("Status", "Reading");
    expect(screen.getByText("Piranesi")).toBeInTheDocument();
    expect(screen.getByText("Notes on a Small Planet")).toBeInTheDocument();
    expect(screen.queryByText("A Wizard of Earthsea")).not.toBeInTheDocument();

    await selectRadixOption("Status", "Unknown");
    expect(screen.queryByText("Notes on a Small Planet")).not.toBeInTheDocument();
    expect(screen.queryByText("A Wizard of Earthsea")).not.toBeInTheDocument();

    await selectRadixOption("Status", "All books");
    const booksTable = screen.getByRole("table");
    const titleHeader = within(booksTable).getByRole("columnheader", { name: /Title/i });
    const timeHeader = within(booksTable).getByRole("columnheader", { name: /Time/i });
    const pagesHeader = within(booksTable).getByRole("columnheader", { name: /Pages seen/i });
    const progressHeader = within(booksTable).getByRole("columnheader", { name: /Progress/i });
    const lastOpenedHeader = within(booksTable).getByRole("columnheader", { name: /Last opened/i });
    expect(lastOpenedHeader).toHaveAttribute("aria-sort", "descending");

    await userEvent.click(within(titleHeader).getByRole("button", { name: /Title/i }));
    expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    let rows = within(booksTable).getAllByRole("row");
    expect(within(rows[1]).getByText("A Wizard of Earthsea")).toBeInTheDocument();

    await userEvent.click(within(titleHeader).getByRole("button", { name: /Title/i }));
    expect(titleHeader).toHaveAttribute("aria-sort", "descending");
    rows = within(booksTable).getAllByRole("row");
    expect(within(rows[1]).getByText("Piranesi")).toBeInTheDocument();

    await userEvent.click(within(timeHeader).getByRole("button", { name: /Time/i }));
    expect(timeHeader).toHaveAttribute("aria-sort", "ascending");
    rows = within(booksTable).getAllByRole("row");
    expect(within(rows[1]).getByText("Notes on a Small Planet")).toBeInTheDocument();

    await userEvent.click(within(timeHeader).getByRole("button", { name: /Time/i }));
    expect(timeHeader).toHaveAttribute("aria-sort", "descending");
    rows = within(booksTable).getAllByRole("row");
    expect(within(rows[1]).getByText("A Wizard of Earthsea")).toBeInTheDocument();

    await userEvent.click(within(pagesHeader).getByRole("button", { name: /Pages seen/i }));
    expect(pagesHeader).toHaveAttribute("aria-sort", "ascending");
    rows = within(booksTable).getAllByRole("row");
    expect(within(rows[1]).getByText("Notes on a Small Planet")).toBeInTheDocument();

    await userEvent.click(within(progressHeader).getByRole("button", { name: /Progress/i }));
    expect(progressHeader).toHaveAttribute("aria-sort", "ascending");
    rows = within(booksTable).getAllByRole("row");
    expect(within(rows[1]).getByText("Notes on a Small Planet")).toBeInTheDocument();

    await userEvent.click(within(lastOpenedHeader).getByRole("button", { name: /Last opened/i }));
    expect(lastOpenedHeader).toHaveAttribute("aria-sort", "ascending");
    rows = within(booksTable).getAllByRole("row");
    expect(within(rows[1]).getByText("Notes on a Small Planet")).toBeInTheDocument();
  });

  it("keeps recent books uncapped so its horizontal scrollbar stays at the table bottom", async () => {
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
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(375);
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 335,
      width: 0,
      x: 0,
      y: 335,
      toJSON: () => ({}),
    });

    render(<App />);

    await screen.findByRole("table");
    const tableRegion = screen.getByRole("region", { name: "Recent books table" });
    expect(tableRegion).not.toHaveStyle({ maxHeight: "322px" });

    rectSpy.mockReturnValue({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 100,
      width: 0,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    act(() => window.dispatchEvent(new Event("scroll")));

    expect(tableRegion).not.toHaveStyle({ maxHeight: "322px" });

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(200);
    act(() => window.dispatchEvent(new Event("resize")));

    expect(tableRegion).not.toHaveStyle({ maxHeight: "147px" });
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
    await userEvent.click(await screen.findByRole("link", { name: /Calendar/i }));

    expect(screen.getAllByText("Calendar").length).toBeGreaterThan(1);
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
    await userEvent.click(await screen.findByRole("link", { name: /Calendar/i }));

    const heatmap = screen.getByLabelText("Scrollable reading calendar heatmap");
    expect(within(heatmap).getAllByRole("gridcell")).toHaveLength(365);
    expect(screen.getByLabelText(/Sunday, June 8, 2025: no reading/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Sunday, June 7, 2026: no reading/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Calendar summary")).getByText("0 days")).toBeInTheDocument();
    expect(screen.queryByText("No reading days yet")).not.toBeInTheDocument();
  });

  it("opens an overflowing calendar at the current week without a dashboard refresh during status polling", async () => {
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
    await userEvent.click(await screen.findByRole("link", { name: /Calendar/i }));

    const heatmap = screen.getByLabelText("Scrollable reading calendar heatmap");
    expect(heatmap).toHaveProperty("scrollLeft", 488);
    const initialDashboardRequests = dashboardRequests;

    heatmap.scrollLeft = 120;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(dashboardRequests).toBe(initialDashboardRequests);
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

    await userEvent.click(await screen.findByRole("link", { name: /Snapshots/i }));
    await userEvent.click(screen.getAllByRole("button", { name: "View" })[0]);

    expect((await screen.findAllByText("Older Book")).length).toBeGreaterThan(0);
    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(deviceBanner.getByText("Viewing")).toBeInTheDocument();
    expect(deviceBanner.getByText(/May 1, 2026/)).toBeInTheDocument();
    expect(deviceBanner.getByText("Latest")).toBeInTheDocument();
    expect(deviceBanner.getByText(/May 31, 2026/)).toBeInTheDocument();
    expect(screen.getByLabelText("Device filter")).toHaveTextContent("Travel Kobo");
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

    await userEvent.click(await screen.findByRole("link", { name: /Snapshots/i }));
    await userEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect((await screen.findAllByText("Older Book")).length).toBeGreaterThan(0);

    autoImportChanged = true;
    await userEvent.click(screen.getByRole("link", { name: /Settings/i }));
    await userEvent.click(screen.getByRole("button", { name: /Refresh now/i }));

    await userEvent.click(screen.getByRole("link", { name: /Dashboard/i }));
    expect((await screen.findAllByText("Older Book")).length).toBeGreaterThan(0);
    const deviceBanner = within(screen.getByLabelText("Device import status"));
    expect(deviceBanner.getByText("Viewing")).toBeInTheDocument();
    expect(deviceBanner.getByText(/May 1, 2026/)).toBeInTheDocument();
    expect(deviceBanner.getByText("Latest")).toBeInTheDocument();
    expect(deviceBanner.getByText(/Jun 1, 2026/)).toBeInTheDocument();
  });

  it("refreshes merged dashboard data immediately after saving a device label", async () => {
    const initialDashboard = {
      ...populatedDashboard,
      charts: {
        ...populatedDashboard.charts,
        devices: [
          { id: "primary-kobo", label: "Primary Kobo" },
          { id: "travel-kobo", label: "Travel Kobo" },
        ],
        daily_by_device: [
          {
            date: "2026-05-30",
            label: "May 30",
            "primary-kobo": 90,
            "travel-kobo": 30,
          },
        ],
        monthly_by_device: [
          {
            month: "2026-05",
            label: "May 26",
            "primary-kobo": 1.5,
            "travel-kobo": 0.5,
          },
        ],
      },
    };
    const mergedDashboard = {
      ...populatedDashboard,
      summary: {
        ...populatedDashboard.summary,
        total_time_seconds: 7200,
        total_time_label: "2h 00m",
      },
      charts: {
        ...populatedDashboard.charts,
        devices: [{ id: "primary-kobo", label: "Primary Kobo" }],
        daily_by_device: [
          {
            date: "2026-05-30",
            label: "May 30",
            "primary-kobo": 120,
          },
        ],
        monthly_by_device: [
          {
            month: "2026-05",
            label: "May 26",
            "primary-kobo": 2,
          },
        ],
      },
    };
    const dashboardRequests: string[] = [];
    let labelSaved = false;

    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/device/status")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            mount_path: "/Volumes/KOBOeReader",
            mounted: false,
            database_found: false,
            selected_path: null,
            permission_error: null,
            candidates: [],
          }),
        });
      }
      if (url.startsWith("/api/devices/travel-kobo") && init?.method === "PATCH") {
        labelSaved = true;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ device: { ...travelDeviceSummary, label: "Primary Kobo" } }),
        });
      }
      if (url.startsWith("/api/devices")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            devices: labelSaved
              ? [{ ...deviceSummary, snapshot_count: 2 }]
              : [deviceSummary, travelDeviceSummary],
          }),
        });
      }
      if (url.startsWith("/api/snapshots")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ snapshots: [populatedDashboard.snapshot, olderSnapshot] }),
        });
      }
      if (url.startsWith("/api/backups?")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ backups: [] }),
        });
      }
      if (url.startsWith("/api/dashboard")) {
        dashboardRequests.push(url);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(labelSaved ? mergedDashboard : initialDashboard),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<App />);

    expect((await screen.findAllByText("1h 30m")).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("link", { name: /Settings/i }));
    await userEvent.clear(screen.getByLabelText("Label for Travel Kobo"));
    await userEvent.type(screen.getByLabelText("Label for Travel Kobo"), "Primary Kobo");
    const saveButton = screen.getAllByRole("button", { name: "Save label" }).find((button) => !button.hasAttribute("disabled"));
    expect(saveButton).toBeDefined();
    await userEvent.click(saveButton!);

    await waitFor(() => expect(screen.queryByLabelText("Label for Travel Kobo")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("link", { name: /Dashboard/i }));
    expect((await screen.findAllByText("2h 00m")).length).toBeGreaterThan(0);
    expect(dashboardRequests).toContain("/api/dashboard?snapshot_id=latest&device_id=all");
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
      if (url.startsWith("/api/backups?")) return { backups: [recoveryBackup] };
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
    await userEvent.click(await screen.findByRole("link", { name: /Backups/i }));

    const backupCard = screen.getByRole("article", { name: /Recovery backup/i });
    expect(within(backupCard).getByText("Contains credentials")).toBeInTheDocument();
    expect(within(backupCard).getByText("sidecar files")).toBeInTheDocument();
    expect(within(backupCard).getByRole("button", { name: "Restore" })).toBeInTheDocument();
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

    expect((await screen.findAllByText("Restore complete")).length).toBeGreaterThan(0);
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
    await userEvent.click(await screen.findByRole("link", { name: /Export/i }));
    await userEvent.click(screen.getByRole("button", { name: /Export dashboard JSON/i }));
    await userEvent.click(screen.getByRole("button", { name: /Export books CSV/i }));

    expect(clickSpy).toHaveBeenCalledTimes(2);
    const csvBlob = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob;
    const csv = await readBlobText(csvBlob);
    expect(csv).toContain("Notes,Records,Source book IDs");
    expect(csv).toContain("Earthsea Cycle,1,en,Finished");
    expect(csv).toContain("2,1; 4");
  });

  it("opens a detailed book dialog with related sessions", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return { mount_path: null, mounted: false, database_found: false, selected_path: null, permission_error: null, candidates: [] };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);
    await userEvent.click(await screen.findByRole("link", { name: /Books/i }));
    await userEvent.click(screen.getByRole("button", { name: "Piranesi" }));

    const dialog = await screen.findByRole("dialog", { name: "Piranesi" });
    expect(within(dialog).getByText("~22h 30m left")).toBeInTheDocument();
    expect(within(dialog).getByText("11 min/page")).toBeInTheDocument();
    expect(within(dialog).getByText("Recent sessions")).toBeInTheDocument();
    expect(within(dialog).getByText("45m")).toBeInTheDocument();
  });

  it("opens recent-book details from its explicit action", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return { mount_path: null, mounted: false, database_found: false, selected_path: null, permission_error: null, candidates: [] };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [populatedDashboard.snapshot] };
      return populatedDashboard;
    });

    render(<App />);
    await screen.findByText("Recent books");
    expect(screen.queryByRole("separator", { name: "Resize column" })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    expect(await screen.findByRole("dialog", { name: "Piranesi" })).toBeInTheDocument();
  });

  it("shows per-device session insights for the all-devices dashboard", async () => {
    const aggregateDashboard = {
      ...populatedDashboard,
      snapshot: { ...populatedDashboard.snapshot, id: "aggregate", source: "aggregate", device_id: "all" },
      insights: {
        sessions: {
          available: true,
          total: 2,
          average_active_seconds: 2700,
          longest_active_seconds: 3600,
          recent: [{ ...populatedDashboard.insights.sessions.recent[0], device_label: "Primary Kobo" }],
        },
      },
    };
    mockFetch((url) => {
      if (url.startsWith("/api/device/status")) {
        return { mount_path: null, mounted: false, database_found: false, selected_path: null, permission_error: null, candidates: [] };
      }
      if (url.startsWith("/api/snapshots")) return { snapshots: [aggregateDashboard.snapshot] };
      return aggregateDashboard;
    });

    render(<App />);
    await screen.findByText("Recent books");
    expect(screen.getByText("Reading sessions")).toBeInTheDocument();
    expect(screen.getByText("Primary Kobo")).toBeInTheDocument();
  });
});
