import { afterEach, describe, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { createQueryClient, dashboardQuery } from "../src/queries";

const clients: ReturnType<typeof createQueryClient>[] = [];
function client() { const value = createQueryClient(); clients.push(value); return value; }
function mockReads() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () =>
    url.includes("/devices") ? { devices: [] } : url.includes("/snapshots") ? { snapshots: [] } :
      url.includes("/backups") ? { backups: [] } : { has_data: true },
  })));
}
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); onlineManager.setOnline(true); vi.unstubAllGlobals(); });

describe("local server queries", () => {
  it("shares concurrent reads for one selection and separates snapshots/devices", async () => {
    mockReads();
    const cache = client();
    const options = dashboardQuery("primary", "old");
    const [first, second] = await Promise.all([cache.fetchQuery(options), cache.fetchQuery(options)]);
    expect(first).toBe(second);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(cache.getQueryData(dashboardQuery("travel", "old").queryKey)).toBeUndefined();
    expect(cache.getQueryData(dashboardQuery("primary", "latest").queryKey)).toBeUndefined();
  });

  it("reads localhost while the browser reports offline", async () => {
    mockReads();
    onlineManager.setOnline(false);
    expect((await client().fetchQuery(dashboardQuery("all"))).dashboard.has_data).toBe(true);
  });

  it("cancels every read in a bundle through its fetch signal", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      signals.push(init.signal);
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const cache = client();
    const read = cache.fetchQuery(dashboardQuery("all")).catch(() => undefined);
    await cache.cancelQueries({ queryKey: ["dashboard-data"] });
    await read;
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("keeps successful data after a failed refresh and does not retry", async () => {
    mockReads();
    const cache = client();
    const options = dashboardQuery("all");
    const before = await cache.fetchQuery(options);
    vi.mocked(fetch).mockRejectedValue(new Error("Unavailable"));
    await expect(cache.fetchQuery(options)).rejects.toThrow("Unavailable");
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(cache.getQueryData(options.queryKey)).toBe(before);
  });

  it("does not retry writes or pause them offline", async () => {
    const cache = client();
    onlineManager.setOnline(false);
    const write = vi.fn().mockRejectedValue(new Error("Restore failed"));
    const mutation = cache.getMutationCache().build(cache, { mutationFn: write });
    await expect(mutation.execute(undefined)).rejects.toThrow("Restore failed");
    expect(write).toHaveBeenCalledOnce();
  });
});
