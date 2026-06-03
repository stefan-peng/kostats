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
  charts: { daily: [], monthly: [], top_books: [] },
  recent_books: [],
};

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
    reading_days: 2,
    books: 1,
    pages: 8,
    current_streak: 2,
  },
  charts: {
    daily: [{ date: "2026-05-30", label: "May 30", minutes: 90 }],
    monthly: [{ month: "2026-05", label: "May 26", hours: 1.5 }],
    top_books: [{ id: "1", title: "Piranesi", hours: 1.5 }],
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
  },
  charts: {
    daily: [{ date: "2026-05-01", label: "May 1", minutes: 30 }],
    monthly: [{ month: "2026-05", label: "May 26", hours: 0.5 }],
    top_books: [{ id: "2", title: "Older Book", hours: 0.5 }],
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

    expect(await screen.findByText("No local KOReader database yet")).toBeInTheDocument();
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
    expect(screen.getByText("Kobo is not mounted. Showing stats from the latest local snapshot.")).toBeInTheDocument();
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

  it("announces an automatic Kobo import during startup sync", async () => {
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

    expect(await screen.findByText(/Auto-imported Kobo database at/)).toBeInTheDocument();
    expect(screen.getAllByText(/Auto Kobo import:/).length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("Device import status")).getByText(/Auto-imported/)).toBeInTheDocument();
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
    expect(screen.getByText("90 min")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Settings/i }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Every 15 seconds while the app is open")).toBeInTheDocument();
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
    expect(screen.getByText("Kobo is not mounted. Showing stats from the selected local snapshot.")).toBeInTheDocument();
    expect(screen.getByText(olderSnapshot.id)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Device import status")).getByText(/May 31, 2026/)).toBeInTheDocument();
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
    expect(screen.getByText(/Selected snapshot remains open/)).toBeInTheDocument();
    expect(screen.getByText(olderSnapshot.id)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Device import status")).getAllByText(/Jun 1, 2026/).length).toBeGreaterThan(0);
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
