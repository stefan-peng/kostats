import { keepPreviousData, QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getBackups, getDashboard, getDevices, getDeviceStatus, getSnapshots } from "./api";
import type { Dashboard, DeviceSummary, RecoveryBackup, Snapshot } from "./types";

export function createQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: { retry: false, networkMode: "always", staleTime: 0, gcTime: 60_000,
      refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false },
    mutations: { retry: false, networkMode: "always", gcTime: 0 },
  } });
}

export const deviceQuery = queryOptions({
  queryKey: ["device-status"],
  queryFn: ({ signal }) => getDeviceStatus(signal),
});

export function dashboardQuery(deviceId: string, snapshotId = "latest") {
  return queryOptions({
    queryKey: ["dashboard-data", deviceId, snapshotId],
    queryFn: async ({ signal }) => {
      const [devices, dashboard, snapshots, backups] = await Promise.all([
        getDevices(signal), getDashboard(snapshotId, deviceId, signal),
        getSnapshots(deviceId, signal), getBackups(deviceId, signal),
      ]);
      return { devices: devices.devices, dashboard, snapshots: snapshots.snapshots, backups: backups.backups };
    },
  });
}

type ServerData = { devices: DeviceSummary[]; dashboard: Dashboard; snapshots: Snapshot[]; backups: RecoveryBackup[] };

export function useServerData(deviceId: string, snapshotId: string, emptyDashboard: Dashboard) {
  const client = useQueryClient();
  const options = dashboardQuery(deviceId, snapshotId);
  // Device import remains an explicit workflow. Reads start after that workflow
  // completes, so an older response cannot overwrite a newly imported snapshot.
  const query = useQuery({ ...options, enabled: false, placeholderData: keepPreviousData });
  const status = useQuery({ ...deviceQuery, enabled: false });
  const lastSuccessful = useRef<ServerData | null>(null);
  useEffect(() => { if (query.data) lastSuccessful.current = query.data; }, [query.data]);
  const data = query.data ?? lastSuccessful.current ?? { devices: [], dashboard: emptyDashboard, snapshots: [], backups: [] };
  function setter<K extends keyof ServerData>(field: K): Dispatch<SetStateAction<ServerData[K]>> {
    return (update) => client.setQueryData(options.queryKey, (previous: ServerData | undefined) => {
      const current = previous ?? data;
      const next = typeof update === "function" ? (update as (value: ServerData[K]) => ServerData[K])(current[field]) : update;
      return { ...current, [field]: next };
    });
  }
  return { ...data, device: status.data ?? null, client,
    setDashboard: (dashboard: Dashboard, snapshot = snapshotId, device = deviceId) =>
      client.setQueryData(dashboardQuery(device, snapshot).queryKey, (previous: ServerData | undefined) => ({ ...(previous ?? data), dashboard })),
    setDevices: setter("devices"),
    setSnapshots: setter("snapshots"), setBackups: setter("backups"),
    fetchData: (device = deviceId, snapshot = snapshotId) => client.fetchQuery(dashboardQuery(device, snapshot)),
    fetchDevice: () => client.fetchQuery(deviceQuery),
  };
}
