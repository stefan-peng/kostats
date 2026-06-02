import type { Dashboard, DeviceStatus, Snapshot } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getDeviceStatus(): Promise<DeviceStatus> {
  return request<DeviceStatus>("/api/device/status");
}

export function getDashboard(snapshotId = "latest"): Promise<Dashboard> {
  return request<Dashboard>(`/api/dashboard?snapshot_id=${encodeURIComponent(snapshotId)}`);
}

export function getSnapshots(): Promise<{ snapshots: Snapshot[] }> {
  return request<{ snapshots: Snapshot[] }>("/api/snapshots");
}

export function importFromKobo(): Promise<{ snapshot: Snapshot; dashboard: Dashboard }> {
  return request<{ snapshot: Snapshot; dashboard: Dashboard }>("/api/import/kobo", {
    method: "POST",
  });
}

export function uploadDatabase(file: File): Promise<{ snapshot: Snapshot; dashboard: Dashboard }> {
  const body = new FormData();
  body.append("file", file);
  return request<{ snapshot: Snapshot; dashboard: Dashboard }>("/api/import/upload", {
    method: "POST",
    body,
  });
}
