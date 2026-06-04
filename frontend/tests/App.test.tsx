import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  recent_books: [],
};

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
  },
  charts: {
    daily: [{ date: "2026-05-30", label: "May 30", minutes: 90 }],
    monthly: [{ month: "2026-05", label: "May 26", hours: 1.5 }],
    top_books: [{ id: "1", title: "Piranesi", hours: 1.5 }],
    calendar: fullCalendar,
  },
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
        return new Error("Kobo is mounted, but macOS denied access to the KOReader database.");
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
      expect(screen.getByText(/macOS denied access/)).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: /Upload DB/i }).length).toBeGreaterThan(0);
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

    await userEvent.click(await screen.findByRole("button", { name: /Snapshots/i }));
    expect(screen.getByRole("heading", { name: "Snapshots" })).toBeInTheDocument();
    expect(screen.getAllByText("20260531T120000Z").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: /Calendar/i }));
    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Monday, April 20, 2026: 15m read, intensity 1 of 4/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Monday, May 4, 2026: 1h 30m read, intensity 4 of 4/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Calendar summary")).getByText("15")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Settings/i }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Kobo mount path")).toBeInTheDocument();
    expect(screen.getByText("Local snapshots")).toBeInTheDocument();
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
  });
});
