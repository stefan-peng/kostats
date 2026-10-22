import type {
  AutoImportResult,
  Dashboard,
  DeviceAssignment,
  DeviceRecord,
  DeviceSummary,
  DeviceStatus,
  RecoveryBackup,
  RestorePreview,
  RestoreResult,
  Snapshot,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getDeviceStatus(signal?: AbortSignal): Promise<DeviceStatus> {
  return request<DeviceStatus>("/api/device/status", { signal });
}

export function getDevices(signal?: AbortSignal): Promise<{ devices: DeviceSummary[] }> {
  return request<{ devices: DeviceSummary[] }>("/api/devices", { signal });
}

export function renameDevice(deviceId: string, label: string): Promise<{ device: DeviceRecord }> {
  return request<{ device: DeviceRecord }>(`/api/devices/${encodeURIComponent(deviceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
}

export function reassignSnapshot(snapshotId: string, assignment: DeviceAssignment): Promise<{ snapshot: Snapshot }> {
  return request<{ snapshot: Snapshot }>(`/api/snapshots/${encodeURIComponent(snapshotId)}/device`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignment),
  });
}

export function getDashboard(snapshotId = "latest", deviceId = "all", signal?: AbortSignal): Promise<Dashboard> {
  return request<Dashboard>(
    `/api/dashboard?snapshot_id=${encodeURIComponent(snapshotId)}&device_id=${encodeURIComponent(deviceId)}`,
    { signal },
  );
}

export function getSnapshots(deviceId = "all", signal?: AbortSignal): Promise<{ snapshots: Snapshot[] }> {
  return request<{ snapshots: Snapshot[] }>(`/api/snapshots?device_id=${encodeURIComponent(deviceId)}`, { signal });
}

export function getBackups(deviceId = "all", signal?: AbortSignal): Promise<{ backups: RecoveryBackup[] }> {
  return request<{ backups: RecoveryBackup[] }>(`/api/backups?device_id=${encodeURIComponent(deviceId)}`, { signal });
}

export function createKoboBackup(): Promise<{ created: boolean; backup: RecoveryBackup }> {
  return request<{ created: boolean; backup: RecoveryBackup }>("/api/backups/kobo", {
    method: "POST",
  });
}

export function getRestorePreview(backupId: string): Promise<RestorePreview> {
  return request<RestorePreview>(
    `/api/backups/${encodeURIComponent(backupId)}/restore-preview`,
  );
}

export function restoreBackup(
  backupId: string,
  restoreOptionalExtensions: boolean,
): Promise<RestoreResult> {
  return request<RestoreResult>(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmed: true,
      restore_optional_extensions: restoreOptionalExtensions,
    }),
  });
}

export function importFromKobo(assignment?: DeviceAssignment): Promise<{ snapshot: Snapshot; dashboard: Dashboard }> {
  return request<{ snapshot: Snapshot; dashboard: Dashboard }>("/api/import/kobo", {
    method: "POST",
    headers: assignment ? { "Content-Type": "application/json" } : undefined,
    body: assignment ? JSON.stringify(assignment) : undefined,
  });
}

export function autoImportFromKobo(): Promise<AutoImportResult> {
  return request<AutoImportResult>("/api/import/kobo/auto", {
    method: "POST",
  });
}

export function uploadDatabase(file: File, assignment?: DeviceAssignment): Promise<{ snapshot: Snapshot; dashboard: Dashboard }> {
  const body = new FormData();
  body.append("file", file);
  if (assignment?.device_id) body.append("device_id", assignment.device_id);
  if (assignment?.new_device_label) body.append("new_device_label", assignment.new_device_label);
  return request<{ snapshot: Snapshot; dashboard: Dashboard }>("/api/import/upload", {
    method: "POST",
    body,
  });
}
