import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type Column,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { ThemeProvider } from "next-themes";
import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  HardDrive,
  Home,
  Library,
  Loader2,
  RefreshCw,
  Search,
  Settings,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

import {
  autoImportFromKobo,
  createKoboBackup,
  getBackups,
  getDashboard,
  getDevices,
  getDeviceStatus,
  getRestorePreview,
  getSnapshots,
  importFromKobo,
  reassignSnapshot,
  renameDevice,
  restoreBackup,
  uploadDatabase,
} from "./api";
import type {
  BookStats,
  Dashboard,
  DeviceSummary,
  DeviceStatus,
  DeviceAssignment,
  RecoveryBackup,
  RestorePreview,
  RestoreResult,
  Snapshot,
} from "./types";

type View = "dashboard" | "snapshots" | "backups" | "books" | "calendar" | "export" | "settings";
type BookProgressFilter = "all" | "reading" | "finished" | "abandoned" | "unknown";
type NavItem = { id: View; label: string; icon: typeof Home; badge?: number };
type ReadingDateFilter = { date: string; bookIds: string[] };
type DeviceFilter = "all" | string;

const views = new Set<View>(["dashboard", "snapshots", "backups", "books", "calendar", "export", "settings"]);
const tableViewportSideInset = 16;
const tableViewportBottomInset = 37;
const tableMinimumHeight = 240;
const recentBooksTableMinimumHeight = 420;
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

type CalendarDay = Dashboard["charts"]["calendar"]["days"][number];

type CalendarCell = {
  date: string;
  day: CalendarDay | null;
};

const chartConfig = {
  minutes: {
    label: "Reading time",
    color: "var(--chart-1)",
  },
  hours: {
    label: "Reading time",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const topBooksChartConfig = {
  hours: {
    label: "Hours",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

const deviceChartColors = [
  "var(--device-chart-1)",
  "var(--device-chart-2)",
  "var(--device-chart-3)",
  "var(--device-chart-4)",
  "var(--device-chart-5)",
  "var(--device-chart-6)",
];

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

function viewFromHash() {
  const view = window.location.hash.slice(1) as View;
  return views.has(view) ? view : "dashboard";
}

function shouldHandleNavigation(event: ReactMouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
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

function statusBadgeVariant(book: BookStats) {
  const status = effectiveStatus(book);
  if (status === "complete") return "default";
  if (status === "reading") return "secondary";
  if (status === "abandoned") return "destructive";
  return "outline";
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

function sortableHeader(column: Column<BookStats, unknown>, label: string) {
  const sorted = column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2"
      onClick={() => column.toggleSorting(sorted === "asc")}
      type="button"
    >
      {label}
      <Icon data-icon="inline-end" />
    </Button>
  );
}

function ariaSortValue(sort: false | "asc" | "desc") {
  if (sort === "asc") return "ascending";
  if (sort === "desc") return "descending";
  return undefined;
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
  if (snapshot.source === "aggregate") return "All devices";
  if (snapshot.source === "kobo-auto") return `Auto Kobo import: ${path}`;
  if (snapshot.source === "kobo") return `Kobo import: ${path}`;
  return path;
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function ErrorAlert({ title = "Error", children }: { title?: string; children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function EmptyPanel({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  );
}

function DeviceBanner({
  status,
  devices,
  importDevice,
  importDeviceLabel,
  activeSnapshot,
  latestSnapshot,
  onImportDeviceChange,
  onImportDeviceLabelChange,
  onImport,
  onUploadClick,
  busy,
  compact = false,
}: {
  status: DeviceStatus | null;
  devices: DeviceSummary[];
  importDevice: string;
  importDeviceLabel: string;
  activeSnapshot: Snapshot | null;
  latestSnapshot: Snapshot | null;
  onImportDeviceChange: (value: string) => void;
  onImportDeviceLabelChange: (value: string) => void;
  onImport: () => void;
  onUploadClick: () => void;
  busy: boolean;
  compact?: boolean;
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
  const stateVariant = mounted && found && !blocked ? "default" : mounted || blocked ? "destructive" : "outline";
  const snapshotLabel = activeSnapshot?.id === latestSnapshot?.id ? "Snapshot" : "Viewing";
  const showLatest = Boolean(latestSnapshot && activeSnapshot?.id !== latestSnapshot.id);
  const uploadAssignmentReady = isUploadAssignmentReady(importDevice, importDeviceLabel);

  return (
    <Card aria-label="Device import status">
      <CardHeader className="items-start gap-3 md:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HardDrive />
          </div>
          <div className="min-w-0">
            <CardTitle>Kobo / KOReader</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge variant={stateVariant}>{stateLabel}</Badge>
              {compact ? (
                <>
                  <span>{snapshotLabel}</span>
                  <span>{activeSnapshot ? formatDateTime(activeSnapshot.imported_at) : "None"}</span>
                  {showLatest ? (
                    <>
                      <span>Latest</span>
                      <span>{formatDateTime(latestSnapshot!.imported_at)}</span>
                    </>
                  ) : null}
                  {activeSnapshot ? <span>{formatSnapshotSource(activeSnapshot)}</span> : null}
                </>
              ) : null}
            </CardDescription>
          </div>
        </div>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Button disabled={busy || !found} onClick={onImport}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {busy ? "Importing..." : "Import from Kobo"}
          </Button>
          <Button variant="outline" disabled={busy || (!compact && !uploadAssignmentReady)} onClick={onUploadClick}>
            <Upload data-icon="inline-start" />
            Upload DB
          </Button>
        </CardAction>
      </CardHeader>
      {!compact ? (
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-sm font-medium">Import as</div>
            <DeviceAssignmentControl
              devices={devices}
              value={importDevice}
              newLabel={importDeviceLabel}
              onValueChange={onImportDeviceChange}
              onNewLabelChange={onImportDeviceLabelChange}
              includeAuto
            />
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <SnapshotMeta label={snapshotLabel} snapshot={activeSnapshot} />
            {showLatest ? <SnapshotMeta label="Latest" snapshot={latestSnapshot} /> : null}
            <SnapshotMeta label="Source" snapshot={activeSnapshot} source />
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

function MetadataCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="min-w-0" size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="truncate font-medium">{value}</CardContent>
    </Card>
  );
}

function SnapshotMeta({ label, snapshot, source = false }: { label: string; snapshot: Snapshot | null; source?: boolean }) {
  return (
    <MetadataCard
      label={label}
      value={snapshot ? (source ? formatSnapshotSource(snapshot) : formatDateTime(snapshot.imported_at)) : "None"}
    />
  );
}

function DeviceSelector({
  devices,
  value,
  onChange,
}: {
  devices: DeviceSummary[];
  value: DeviceFilter;
  onChange: (value: DeviceFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[220px]" aria-label="Device filter">
        <SelectValue placeholder="All devices" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">All devices</SelectItem>
          {devices.map((device) => (
            <SelectItem key={device.id} value={device.id}>
              {device.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function DeviceAssignmentControl({
  devices,
  value,
  newLabel,
  onValueChange,
  onNewLabelChange,
  includeAuto = false,
}: {
  devices: DeviceSummary[];
  value: string;
  newLabel: string;
  onValueChange: (value: string) => void;
  onNewLabelChange: (value: string) => void;
  includeAuto?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(180px,240px)_minmax(180px,1fr)]">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label="Import device">
          <SelectValue placeholder="Choose device" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {includeAuto ? <SelectItem value="auto">Auto-detected</SelectItem> : null}
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.label}
              </SelectItem>
            ))}
            <SelectItem value="new">New device</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Input
        aria-label="New device name"
        placeholder="New device name"
        value={newLabel}
        disabled={value !== "new"}
        onChange={(event) => onNewLabelChange(event.target.value)}
      />
    </div>
  );
}

function assignmentFromSelection(value: string, label: string): DeviceAssignment | undefined {
  if (value === "auto") return undefined;
  if (value === "new") return { new_device_label: label.trim() };
  return { device_id: value };
}

function isUploadAssignmentReady(value: string, label: string) {
  if (value === "auto") return false;
  if (value === "new") return label.trim() !== "";
  return true;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="font-heading text-2xl leading-snug font-medium">{value}</div>
      </CardContent>
    </Card>
  );
}

function ReadingBarChart({
  title,
  data,
  valueKey,
  formatValue,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  valueKey: "minutes" | "hours";
  formatValue: (value: number) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyPanel icon={<CalendarDays />} title="No reading data yet" />
        ) : (
          <ChartContainer config={chartConfig} className="h-64 w-full">
            <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval="preserveStartEnd"
              />
              <YAxis hide domain={[0, "dataMax"]} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideIndicator
                    formatter={(value, _name, item) => (
                      <div className="grid gap-1">
                        <span className="text-muted-foreground">{String(item.payload.label)}</span>
                        <span className="font-medium">{formatValue(Number(value))}</span>
                      </div>
                    )}
                  />
                }
              />
              <Bar
                dataKey={valueKey}
                barSize={valueKey === "hours" ? 28 : 10}
                fill={`var(--color-${valueKey})`}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function DeviceStackedBarChart({
  title,
  data,
  devices,
  unit,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  devices: Array<{ id: string; label: string }>;
  unit: "minutes" | "hours";
}) {
  const config = Object.fromEntries(
    devices.map((device, index) => [
      device.id,
      {
        label: device.label,
        color: deviceChartColors[index % deviceChartColors.length],
      },
    ]),
  ) satisfies ChartConfig;
  const formatValue = unit === "minutes"
    ? (value: number) => formatDurationLabel(value * 60)
    : (value: number) => formatDurationLabel(value * 3600);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 || devices.length === 0 ? (
          <EmptyPanel icon={<CalendarDays />} title="No reading data yet" />
        ) : (
          <ChartContainer config={config} className="h-64 w-full">
            <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
              <YAxis hide domain={[0, "dataMax"]} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => (
                      <div className="grid gap-1">
                        <span className="text-muted-foreground">{config[String(name)]?.label ?? String(name)}</span>
                        <span className="font-medium">{formatValue(Number(value))}</span>
                      </div>
                    )}
                  />
                }
              />
              {devices.map((device, index) => (
                <Bar
                  key={device.id}
                  dataKey={device.id}
                  stackId="device"
                  fill={deviceChartColors[index % deviceChartColors.length]}
                  radius={index === devices.length - 1 ? [4, 4, 0, 0] : 0}
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TopBooksChart({ data }: { data: Dashboard["charts"]["top_books"] }) {
  const chartData = data.map((item) => ({ ...item, label: item.title }));

  function BookTitleTick({
    x = 0,
    y = 0,
    payload,
  }: {
    x?: number;
    y?: number;
    payload?: { value?: unknown };
  }) {
    const title = String(payload?.value ?? "");
    const label = title.length > 22 ? `${title.slice(0, 21).trimEnd()}…` : title;

    return (
      <text
        x={x - 10}
        y={y}
        dy="0.32em"
        textAnchor="end"
        className="fill-muted-foreground text-[11px]"
      >
        <title>{title}</title>
        {label}
      </text>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top books</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyPanel icon={<BookOpen />} title="No books yet" />
        ) : (
          <ChartContainer config={topBooksChartConfig} className="h-64 w-full">
            <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 8 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                dataKey="label"
                type="category"
                interval={0}
                tickLine={false}
                axisLine={false}
                width={168}
                tick={<BookTitleTick />}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideIndicator
                    formatter={(value, _name, item) => (
                      <div className="grid gap-1">
                        <span className="text-muted-foreground">{String(item.payload.title)}</span>
                        <span className="font-medium">{formatDurationLabel(Number(value) * 3600)}</span>
                      </div>
                    )}
                  />
                }
              />
              <Bar dataKey="hours" barSize={18} fill="var(--color-hours)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ViewportTableScrollArea({
  ariaLabel,
  children,
  constrainToViewport = true,
  minimumHeight = tableMinimumHeight,
}: {
  ariaLabel: string;
  children: ReactNode;
  constrainToViewport?: boolean;
  minimumHeight?: number;
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
    if (!constrainToViewport) {
      setMaxHeight(undefined);
      return;
    }

    const content = contentRef.current;
    if (!content) return;

    const updateMaxHeight = () => {
      const documentTop = content.getBoundingClientRect().top + window.scrollY;
      const availableHeight =
        window.innerHeight - Math.max(documentTop, tableViewportSideInset) - tableViewportBottomInset;
      const viewportCap = Math.max(0, window.innerHeight - tableViewportSideInset - tableViewportBottomInset);
      setMaxHeight(Math.min(Math.max(minimumHeight, availableHeight), viewportCap));
    };

    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);

    return () => {
      window.removeEventListener("resize", updateMaxHeight);
    };
  }, [constrainToViewport, minimumHeight]);

  return (
    <ScrollArea
      aria-label={ariaLabel}
      className="min-w-0 overflow-auto rounded-b-xl overscroll-contain [scrollbar-gutter:stable] [&_[data-slot=table-container]]:min-w-0 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card"
      onKeyDown={handleKeyDown}
      ref={contentRef}
      role="region"
      style={maxHeight == null ? undefined : { maxHeight }}
      tabIndex={0}
      type="auto"
    >
      {children}
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function RecentBooks({ books }: { books: Dashboard["recent_books"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent books</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ViewportTableScrollArea
          ariaLabel="Recent books table"
          constrainToViewport={false}
          minimumHeight={recentBooksTableMinimumHeight}
        >
          <Table className="min-w-[860px] table-fixed max-[560px]:min-w-[620px] [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden [&_th]:text-ellipsis">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Last opened</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {books.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No books yet.
                  </TableCell>
                </TableRow>
              ) : (
                books.map((book) => (
                  <TableRow key={book.id}>
                    <TableCell className="font-medium" title={book.title}>{book.title}</TableCell>
                    <TableCell title={book.authors}>{book.authors}</TableCell>
                    <TableCell title={formatDateTime(book.last_open)}>{formatDateTime(book.last_open)}</TableCell>
                    <TableCell>{book.time_label}</TableCell>
                    <TableCell>{book.pages.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(book)}>{formatStatus(book)}</Badge></TableCell>
                    <TableCell>
                      <div className="flex min-w-32 items-center gap-2">
                        <Progress value={book.progress ?? 0} />
                        <span className="w-12 text-xs text-muted-foreground">{formatProgress(book)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ViewportTableScrollArea>
      </CardContent>
    </Card>
  );
}

function BooksView({
  books,
  readingDate,
  onClearReadingDate,
}: {
  books: BookStats[];
  readingDate: ReadingDateFilter | null;
  onClearReadingDate: () => void;
}) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "last_open", desc: true }]);
  const dateFilteredBooks = useMemo(() => {
    if (!readingDate) return books;
    const selectedBookIds = new Set(readingDate.bookIds);
    return books.filter((book) => selectedBookIds.has(book.id));
  }, [books, readingDate]);

  const columns = useMemo<ColumnDef<BookStats>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => sortableHeader(column, "Title"),
        cell: ({ row }) => (
          <span className="font-medium" title={row.original.title}>
            {row.original.title}
          </span>
        ),
      },
      {
        accessorKey: "authors",
        header: "Author",
        cell: ({ row }) => <span title={row.original.authors}>{row.original.authors}</span>,
      },
      {
        accessorKey: "time_seconds",
        header: ({ column }) => sortableHeader(column, "Time"),
        cell: ({ row }) => row.original.time_label,
      },
      {
        accessorKey: "pages",
        header: ({ column }) => sortableHeader(column, "Pages seen"),
        cell: ({ row }) => row.original.pages.toLocaleString(),
      },
      {
        id: "position",
        header: "Position",
        cell: ({ row }) => formatPageProgress(row.original),
      },
      {
        id: "status",
        accessorFn: (book) => effectiveStatus(book) ?? "unknown",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={statusBadgeVariant(row.original)}>{formatStatus(row.original)}</Badge>
        ),
        filterFn: (row, _columnId, filterValue) =>
          matchesProgressFilter(row.original, filterValue as BookProgressFilter),
        enableSorting: false,
      },
      {
        id: "progress",
        accessorFn: (book) => book.progress ?? Number.NEGATIVE_INFINITY,
        header: ({ column }) => sortableHeader(column, "Progress"),
        cell: ({ row }) => (
          <div className="flex min-w-32 items-center gap-2">
            <Progress value={row.original.progress ?? 0} />
            <span className="w-12 text-xs text-muted-foreground">{formatProgress(row.original)}</span>
          </div>
        ),
      },
      {
        accessorKey: "highlight_count",
        header: "Highlights",
        cell: ({ row }) => row.original.highlight_count.toLocaleString(),
      },
      {
        id: "last_open",
        accessorFn: (book) => (book.last_open ? Date.parse(book.last_open) : 0),
        header: ({ column }) => sortableHeader(column, "Last opened"),
        cell: ({ row }) => (
          <span title={formatDateTime(row.original.last_open)}>
            {formatDateTime(row.original.last_open)}
          </span>
        ),
      },
      {
        id: "records",
        accessorKey: "merged_count",
        header: "Records",
        cell: ({ row }) => (
          <span title={`Book IDs: ${row.original.source_book_ids.join(", ")}`}>
            {formatSourceRecords(row.original)}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: dateFilteredBooks,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue ?? "").trim().toLocaleLowerCase();
      if (!query) return true;
      const book = row.original;
      const haystack = `${book.title} ${book.authors} ${book.series} ${book.language}`.toLocaleLowerCase();
      return haystack.includes(query);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const filteredRows = table.getFilteredRowModel().rows;
  const visibleRows = table.getRowModel().rows;
  const progressFilter =
    (table.getColumn("status")?.getFilterValue() as BookProgressFilter | undefined) ?? "all";
  const totalTimeSeconds = filteredRows.reduce((total, row) => total + row.original.time_seconds, 0);
  const totalPages = filteredRows.reduce((total, row) => total + row.original.pages, 0);
  const totalHighlights = filteredRows.reduce((total, row) => total + row.original.highlight_count, 0);
  const readingDateLabel = readingDate
    ? parseCalendarDate(readingDate.date).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Books</CardTitle>
          <CardDescription>
            {readingDateLabel ? `Reading on ${readingDateLabel} · ` : ""}
            {filteredRows.length.toLocaleString()} of {dateFilteredBooks.length.toLocaleString()} books
          </CardDescription>
        </div>
        <CardAction className="flex flex-wrap justify-end gap-2 text-sm text-muted-foreground" aria-label="Filtered book summary">
          {readingDate ? (
            <Button variant="outline" size="sm" onClick={onClearReadingDate}>
              Clear date
            </Button>
          ) : null}
          <div className="hidden flex-wrap justify-end gap-2 md:flex">
            <Badge variant="outline">{formatDurationLabel(totalTimeSeconds)} total</Badge>
            <Badge variant="outline">{totalPages.toLocaleString()} pages seen</Badge>
            <Badge variant="outline">{totalHighlights.toLocaleString()} highlights</Badge>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FieldGroup className="md:grid-cols-[minmax(220px,1fr)_180px]" aria-label="Book table controls">
          <Field>
            <FieldLabel htmlFor="book-search">Search</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="book-search"
                className="pl-8"
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder="Title or author"
                type="search"
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="book-status">Status</FieldLabel>
            <Select
              value={progressFilter}
              onValueChange={(value) => {
                table.getColumn("status")?.setFilterValue(value === "all" ? undefined : value);
              }}
            >
              <SelectTrigger id="book-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All books</SelectItem>
                  <SelectItem value="reading">Reading</SelectItem>
                  <SelectItem value="finished">Finished</SelectItem>
                  <SelectItem value="abandoned">Abandoned</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardContent className="px-0 pb-0">
        <ViewportTableScrollArea ariaLabel="Books table">
          <Table className="min-w-[1280px] table-fixed max-[560px]:min-w-[860px] [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden [&_th]:text-ellipsis">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} aria-sort={ariaSortValue(header.column.getIsSorted())}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                    No books match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ViewportTableScrollArea>
      </CardContent>
    </Card>
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
        <EmptyPanel icon={<Database />} title="No database yet" description="Import from Kobo or upload a KOReader database." />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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

      <section className="grid gap-4 xl:grid-cols-3">
        {dashboard.charts.devices?.length && dashboard.charts.daily_by_device?.length ? (
          <DeviceStackedBarChart
            title="Daily reading by device"
            data={dashboard.charts.daily_by_device}
            devices={dashboard.charts.devices}
            unit="minutes"
          />
        ) : (
          <ReadingBarChart
            title="Daily reading"
            data={dashboard.charts.daily}
            valueKey="minutes"
            formatValue={(minutes) => formatDurationLabel(minutes * 60)}
          />
        )}
        {dashboard.charts.devices?.length && dashboard.charts.monthly_by_device?.length ? (
          <DeviceStackedBarChart
            title="Monthly reading by device"
            data={dashboard.charts.monthly_by_device}
            devices={dashboard.charts.devices}
            unit="hours"
          />
        ) : (
          <ReadingBarChart
            title="Monthly reading"
            data={dashboard.charts.monthly}
            valueKey="hours"
            formatValue={(hours) => formatDurationLabel(hours * 3600)}
          />
        )}
        <TopBooksChart data={dashboard.charts.top_books} />
      </section>

      <RecentBooks books={dashboard.recent_books} />
    </>
  );
}

function SnapshotsView({
  snapshots,
  devices,
  activeSnapshotId,
  onSelectSnapshot,
  onReassignSnapshot,
}: {
  snapshots: Snapshot[];
  devices: DeviceSummary[];
  activeSnapshotId: string | null;
  onSelectSnapshot: (id: string) => void;
  onReassignSnapshot: (snapshotId: string, deviceId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Snapshots</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ViewportTableScrollArea ariaLabel="Snapshots table">
          <Table className="min-w-[1120px] table-fixed max-[560px]:min-w-[820px] [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden [&_th]:text-ellipsis">
            <TableHeader>
              <TableRow>
                <TableHead>Imported</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Schema</TableHead>
                <TableHead>Snapshot ID</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No snapshots have been imported yet.
                  </TableCell>
                </TableRow>
              ) : (
                snapshots.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell title={formatDateTime(snapshot.imported_at)}>{formatDateTime(snapshot.imported_at)}</TableCell>
                    <TableCell title={snapshot.device_label ?? undefined}>
                      <Select
                        value={snapshot.device_id ?? ""}
                        onValueChange={(deviceId) => onReassignSnapshot(snapshot.id, deviceId)}
                      >
                        <SelectTrigger className="h-8" aria-label={`Device for ${snapshot.id}`}>
                          <SelectValue placeholder={snapshot.device_label ?? "Unknown device"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {devices.map((device) => (
                              <SelectItem key={device.id} value={device.id}>
                                {device.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell title={snapshot.source_path ?? snapshot.source}>
                      <code>{formatSnapshotSource(snapshot)}</code>
                    </TableCell>
                    <TableCell>{formatBytes(snapshot.file_size)}</TableCell>
                    <TableCell>{snapshot.schema_version}</TableCell>
                    <TableCell title={snapshot.id}><code>{snapshot.id}</code></TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={snapshot.id === activeSnapshotId}
                        onClick={() => onSelectSnapshot(snapshot.id)}
                      >
                        {snapshot.id === activeSnapshotId ? "Current" : "View"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ViewportTableScrollArea>
      </CardContent>
    </Card>
  );
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
    <div className="flex flex-wrap gap-2">
      {labels.map(([key, label]) => (
        <Badge variant="outline" key={key}>
          <span className="font-semibold">{counts[key] ?? 0}</span> {label}
        </Badge>
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
      const message = err instanceof Error ? err.message : "Could not preview recovery backup";
      setLocalError(message);
      toast.error(message);
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
      toast.success("Restore complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not restore recovery backup";
      setLocalError(message);
      toast.error(message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recovery backups</CardTitle>
          <CardDescription>Books are excluded. Credentials may be included.</CardDescription>
        </div>
        <CardAction>
          <Button
            disabled={busy || !device?.mounted}
            onClick={() => onCreate().catch((err: Error) => {
              setLocalError(err.message);
              toast.error(err.message);
            })}
          >
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ArchiveRestore data-icon="inline-start" />}
            {busy ? "Working..." : "Back up now"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {localError ? <ErrorAlert>{localError}</ErrorAlert> : null}
        {result ? (
          <Alert>
            <CheckCircle2 />
            <AlertTitle>Restore complete</AlertTitle>
            <AlertDescription>
              Restored {countLabel(result.restored.sidecars ?? 0, "sidecar")}; skipped{" "}
              {countLabel(result.skipped.sidecars ?? 0, "sidecar")}; failed{" "}
              {countLabel(result.failed.length, "item")}. Safety backup: <code>{result.safety_backup_id}</code>.
              Eject the Kobo and restart KOReader.
            </AlertDescription>
          </Alert>
        ) : null}

        {backups.length === 0 ? (
          <EmptyPanel icon={<ArchiveRestore />} title="No recovery backups have been created yet." />
        ) : (
          <div className="grid gap-3">
            {backups.map((backup) => (
              <Card role="article" size="sm" key={backup.id} aria-label={`Recovery backup ${formatDateTime(backup.created_at)}`}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>{formatDateTime(backup.created_at)}</CardTitle>
                    <CardDescription className="truncate">
                      {backup.device_label ?? "Unknown device"} / {backup.koreader_version ?? "Unknown KOReader version"} / {formatBytes(backup.archive_size)}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || loadingPreview || !device?.mounted}
                      onClick={() => previewBackup(backup.id)}
                    >
                      {loadingPreview ? "Scanning..." : "Restore"}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <code className="truncate text-xs text-muted-foreground">{backup.source_mount}</code>
                  {backup.credentials_included ? (
                    <Badge variant="destructive">Contains credentials</Badge>
                  ) : null}
                  <BackupCounts counts={backup.counts} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={preview != null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[min(90vh,760px)] overflow-y-auto sm:max-w-3xl">
          {preview ? (
            <>
              <DialogHeader>
                <DialogTitle>Restore preview</DialogTitle>
                <DialogDescription>{formatDateTime(preview.backup.created_at)}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                {preview.version_warning ? (
                  <ErrorAlert title="Version mismatch">
                    Backup KOReader version {preview.backup.koreader_version} differs from the installed{" "}
                    {preview.current_koreader_version}.
                  </ErrorAlert>
                ) : null}
                {preview.device_warning ? (
                  <ErrorAlert title="Device mismatch">
                    This backup was created from {preview.backup.device_label ?? "another device"}; the mounted device is{" "}
                    {preview.current_device?.label ?? "a different device"}.
                  </ErrorAlert>
                ) : null}
                {preview.backup.credentials_included ? (
                  <Alert>
                    <AlertTriangle />
                    <AlertTitle>Credentials included</AlertTitle>
                    <AlertDescription>This backup contains credentials and will restore them to the Kobo.</AlertDescription>
                  </Alert>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard label="Matched" value={preview.exact_matches.length} />
                  <MetricCard label="Missing" value={preview.missing_matches.length} />
                  <MetricCard label="Ambiguous" value={preview.ambiguous_matches.length} />
                  <MetricCard label="Books scanned" value={preview.book_count} />
                </div>
                <BackupCounts counts={preview.counts} />
                <p className="text-sm text-muted-foreground">
                  Requires {formatBytes(preview.required_bytes)}; {formatBytes(preview.available_bytes)} available.
                </p>
                {preview.missing_matches.length > 0 || preview.ambiguous_matches.length > 0 ? (
                  <div className="grid gap-2">
                    {[...preview.missing_matches, ...preview.ambiguous_matches].map((match, index) => (
                      <Card size="sm" key={`${match.source_path}-${index}`}>
                        <CardHeader>
                          <CardTitle>{match.title ?? match.old_doc_path ?? "Unknown book"}</CardTitle>
                          <CardDescription>
                            {match.candidates?.length
                              ? `${match.candidates.length} exact file candidates; skipped as ambiguous`
                              : "No byte-identical book found; skipped"}
                          </CardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                ) : null}
                <FieldSet>
                  <FieldLegend>Restore options</FieldLegend>
                  <Field className="flex flex-row items-center gap-2">
                    <Checkbox
                      id="restore-extensions"
                      checked={restoreExtensions}
                      onCheckedChange={(value) => setRestoreExtensions(value === true)}
                    />
                    <FieldLabel htmlFor="restore-extensions" className="leading-normal">
                      Restore optional extensions and missing custom patches
                    </FieldLabel>
                  </Field>
                  <Field className="flex flex-row items-center gap-2">
                    <Checkbox
                      id="restore-confirmed"
                      checked={confirmed}
                      onCheckedChange={(value) => setConfirmed(value === true)}
                    />
                    <FieldLabel htmlFor="restore-confirmed" className="leading-normal">
                      I understand this will modify the mounted Kobo
                    </FieldLabel>
                  </Field>
                </FieldSet>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPreview(null)}>Close</Button>
                <Button disabled={busy || !confirmed} onClick={runRestore}>
                  {busy ? "Restoring..." : "Restore backup"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CalendarView({
  calendar,
  onSelectDate,
}: {
  calendar: Dashboard["charts"]["calendar"];
  onSelectDate: (day: CalendarDay) => void;
}) {
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
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Calendar</CardTitle>
          <CardDescription>{dateRange}</CardDescription>
        </div>
        <CardAction className="flex gap-2" aria-label="Calendar summary">
          <Badge variant="outline">{totalDays.toLocaleString()} days</Badge>
          <Badge variant="outline">{peakLabel} peak</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
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
                    ? `${label}: ${day.time_label} read, intensity ${day.level} of 4. View ${day.book_ids.length.toLocaleString()} ${day.book_ids.length === 1 ? "book" : "books"}`
                    : `${label}: no reading`;
                  return (
                    <Tooltip key={cell.date}>
                      <TooltipTrigger asChild>
                        {day ? (
                          <span role="gridcell">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={cellLabel}
                              className={cn("calendar-day", `level-${day.level}`)}
                              onClick={() => onSelectDate(day)}
                            />
                          </span>
                        ) : (
                          <span
                            role="gridcell"
                            aria-label={cellLabel}
                            tabIndex={-1}
                            className="calendar-day level-0"
                          />
                        )}
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="grid gap-1">
                          <span>{label}</span>
                          <strong>{day ? `${day.time_label} read` : "No reading"}</strong>
                          {day ? (
                            <span>
                              View {day.book_ids.length.toLocaleString()}{" "}
                              {day.book_ids.length === 1 ? "book" : "books"}
                            </span>
                          ) : null}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
            <div className="calendar-legend" aria-label="Reading intensity legend">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i key={level} className={cn("calendar-day", `level-${level}`)} />
              ))}
              <span>More</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
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
    <EmptyPanel icon={<FileUp />} title="Export" description="Download the current dashboard or book table data.">
      <div className="flex flex-wrap justify-center gap-2">
        <Button disabled={!dashboard.has_data} onClick={exportJson}>
          <Download data-icon="inline-start" />
          Export dashboard JSON
        </Button>
        <Button variant="outline" disabled={!dashboard.has_data} onClick={exportBooksCsv}>
          <Download data-icon="inline-start" />
          Export books CSV
        </Button>
      </div>
    </EmptyPanel>
  );
}

function SettingsView({
  device,
  devices,
  snapshots,
  onRefresh,
  onRenameDevice,
}: {
  device: DeviceStatus | null;
  devices: DeviceSummary[];
  snapshots: Snapshot[];
  onRefresh: () => void;
  onRenameDevice: (deviceId: string, label: string) => Promise<void>;
}) {
  const candidateDiagnostics = (device?.candidates ?? []).filter(
    (candidate) => candidate.error || (candidate.exists && !candidate.readable),
  );
  const [labels, setLabels] = useState<Record<string, string>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardAction>
          <Button variant="outline" onClick={onRefresh}>
            <RefreshCw data-icon="inline-start" />
            Refresh now
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetadataCard label="Kobo mount path" value={device?.mount_path ?? "Auto-detect"} />
          <MetadataCard label="Local snapshots" value={snapshots.length} />
        </div>
        <div className="grid gap-3">
          <h4 className="text-sm font-medium">Devices</h4>
          {devices.length === 0 ? (
            <EmptyPanel icon={<HardDrive />} title="No devices recorded yet" />
          ) : (
            <div className="grid gap-3">
              {devices.map((item) => {
                const draft = labels[item.id] ?? item.label;
                return (
                  <Card size="sm" key={item.id}>
                    <CardHeader>
                      <div className="min-w-0">
                        <CardTitle>{item.label}</CardTitle>
                        <CardDescription>
                          {item.model ?? "Unknown model"} / {item.snapshot_count} snapshots / {item.backup_count} backups
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <Input
                        value={draft}
                        aria-label={`Label for ${item.label}`}
                        onChange={(event) => setLabels((current) => ({ ...current, [item.id]: event.target.value }))}
                      />
                      <Button
                        variant="outline"
                        disabled={draft.trim() === "" || draft.trim() === item.label}
                        onClick={() => onRenameDevice(item.id, draft)}
                      >
                        Save label
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
        {candidateDiagnostics.length > 0 ? (
          <div className="grid gap-3">
            <h4 className="text-sm font-medium">Access issues</h4>
            {candidateDiagnostics.map((candidate) => (
              <Alert key={candidate.path} variant={candidate.error ? "destructive" : "default"}>
                <AlertTitle>{candidate.readable ? "Readable" : candidate.exists ? "Blocked" : "Missing"}</AlertTitle>
                <AlertDescription>
                  <code>{candidate.path}</code>
                  {candidate.error ? <div>{candidate.error}</div> : null}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AppSidebarNav({
  items,
  activeView,
  onSelect,
}: {
  items: NavItem[];
  activeView: View;
  onSelect: (view: View) => void;
}) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeView === item.id;
        return (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              asChild
              data-active={isActive ? true : undefined}
              isActive={isActive}
              tooltip={item.label}
            >
              <a
                aria-current={isActive ? "page" : undefined}
                href={`#${item.id}`}
                onClick={(event) => {
                  if (!shouldHandleNavigation(event)) return;
                  event.preventDefault();
                  onSelect(item.id);
                  setOpenMobile(false);
                }}
              >
                <Icon />
                <span>{item.label}</span>
              </a>
            </SidebarMenuButton>
            {item.badge != null ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

function AppSidebarBrand({ onSelect }: { onSelect: () => void }) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild data-active={undefined} size="lg">
          <a
            href="#dashboard"
            onClick={(event) => {
              if (!shouldHandleNavigation(event)) return;
              event.preventDefault();
              onSelect();
              setOpenMobile(false);
            }}
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <BookOpen />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">kostats</span>
              <span className="truncate text-xs">KOReader statistics</span>
            </div>
          </a>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export default function App() {
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [deviceFilter, setDeviceFilter] = useState<DeviceFilter>("all");
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [backups, setBackups] = useState<RecoveryBackup[]>([]);
  const [importDevice, setImportDevice] = useState("auto");
  const [importDeviceLabel, setImportDeviceLabel] = useState("");
  const [uploadDevice, setUploadDevice] = useState("new");
  const [uploadDeviceLabel, setUploadDeviceLabel] = useState("");
  const [activeView, setActiveView] = useState<View>(viewFromHash);
  const [readingDateFilter, setReadingDateFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoImportError, setAutoImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingUploadAssignment = useRef<DeviceAssignment | undefined>(undefined);
  const selectedSnapshotId = useRef<string | null>(null);

  async function refresh() {
    let deviceStatus = await getDeviceStatus();
    let nextAutoImportError: string | null = null;
    if (deviceStatus.mounted && deviceStatus.database_found && !deviceStatus.permission_error) {
      try {
        const autoResult = await autoImportFromKobo();
        if (!autoResult.device) throw new Error("Auto-import response did not include device status");
        deviceStatus = autoResult.device;
      } catch (err) {
        // Background Kobo sync is a UI boundary: show the import failure while keeping local snapshots visible.
        nextAutoImportError = `Auto-import failed: ${err instanceof Error ? err.message : "Could not import from Kobo"}`;
      }
    }
    const dashboardSnapshotId = selectedSnapshotId.current ?? "latest";
    const [deviceData, dashboardData, snapshotData, backupData] = await Promise.all([
      getDevices(),
      getDashboard(dashboardSnapshotId, deviceFilter),
      getSnapshots(deviceFilter),
      getBackups(deviceFilter),
    ]);
    setDevice(deviceStatus);
    setDevices(deviceData.devices);
    setDashboard(dashboardData);
    setSnapshots(snapshotData.snapshots);
    setBackups(backupData.backups);
    setAutoImportError(nextAutoImportError);
  }

  async function loadSnapshot(snapshotId: string) {
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const snapshotDevice = snapshots.find((snapshot) => snapshot.id === snapshotId)?.device_id ?? deviceFilter;
      const selectedDashboard = await getDashboard(snapshotId, snapshotDevice);
      selectedSnapshotId.current = snapshotId;
      setDeviceFilter(snapshotDevice);
      setDashboard(selectedDashboard);
      setReadingDateFilter(null);
      selectView("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load snapshot");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
    const id = window.setInterval(() => {
      refresh().catch((err: Error) => setError(err.message));
    }, 15000);
    return () => window.clearInterval(id);
  }, [deviceFilter]);

  useEffect(() => {
    const syncViewFromHistory = () => {
      setReadingDateFilter(null);
      setActiveView(viewFromHash());
    };
    window.addEventListener("hashchange", syncViewFromHistory);
    window.addEventListener("popstate", syncViewFromHistory);
    return () => {
      window.removeEventListener("hashchange", syncViewFromHistory);
      window.removeEventListener("popstate", syncViewFromHistory);
    };
  }, []);

  async function handleImport() {
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const assignment = assignmentFromSelection(importDevice, importDeviceLabel);
      if (assignment?.new_device_label === "") throw new Error("Enter a device name before importing.");
      const result = await importFromKobo(assignment);
      selectedSnapshotId.current = null;
      if (result.snapshot.device_id) setDeviceFilter(result.snapshot.device_id);
      setDashboard(result.dashboard);
      setReadingDateFilter(null);
      selectView("dashboard");
      await refresh();
      toast.success("Imported from Kobo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  function handleUploadRequest() {
    if (activeView !== "settings") {
      setUploadDevice(devices[0]?.id ?? "new");
      setUploadDeviceLabel("");
      setUploadDialogOpen(true);
      return;
    }
    pendingUploadAssignment.current = assignmentFromSelection(importDevice, importDeviceLabel);
    fileInput.current?.click();
  }

  function handleUploadDialogClick() {
    pendingUploadAssignment.current = assignmentFromSelection(uploadDevice, uploadDeviceLabel);
    fileInput.current?.click();
  }

  async function handleUpload(file: File | undefined) {
    if (!file) {
      pendingUploadAssignment.current = undefined;
      return;
    }
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const assignment = pendingUploadAssignment.current ?? assignmentFromSelection(importDevice, importDeviceLabel);
      if (!assignment) throw new Error("Choose a device or enter a device name before uploading.");
      if (assignment?.new_device_label === "") throw new Error("Enter a device name before uploading.");
      const result = await uploadDatabase(file, assignment);
      selectedSnapshotId.current = null;
      if (result.snapshot.device_id) setDeviceFilter(result.snapshot.device_id);
      setDashboard(result.dashboard);
      setReadingDateFilter(null);
      selectView("dashboard");
      await refresh();
      setUploadDialogOpen(false);
      toast.success("Database uploaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      pendingUploadAssignment.current = undefined;
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
      getBackups(deviceFilter)
        .then((backupData) => setBackups(backupData.backups))
        .catch(() => undefined);
      getDevices()
        .then((deviceData) => setDevices(deviceData.devices))
        .catch(() => undefined);
      toast.success("Recovery backup created");
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
      getBackups(deviceFilter)
        .then((backupData) => setBackups(backupData.backups))
        .catch(() => undefined);
      getDevices()
        .then((deviceData) => setDevices(deviceData.devices))
        .catch(() => undefined);
      return result;
    } finally {
      setBusy(false);
    }
  }

  async function handleDeviceFilterChange(nextDeviceId: DeviceFilter) {
    setDeviceFilter(nextDeviceId);
    selectedSnapshotId.current = null;
    setReadingDateFilter(null);
  }

  async function handleRenameDevice(deviceId: string, label: string) {
    setError(null);
    try {
      await renameDevice(deviceId, label.trim());
      const dashboardSnapshotId = selectedSnapshotId.current ?? "latest";
      const [deviceData, dashboardData, snapshotData, backupData] = await Promise.all([
        getDevices(),
        getDashboard(dashboardSnapshotId, deviceFilter),
        getSnapshots(deviceFilter),
        getBackups(deviceFilter),
      ]);
      setDevices(deviceData.devices);
      setDashboard(dashboardData);
      setSnapshots(snapshotData.snapshots);
      setBackups(backupData.backups);
      toast.success("Device label saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save device label");
    }
  }

  async function handleReassignSnapshot(snapshotId: string, targetDeviceId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await reassignSnapshot(snapshotId, { device_id: targetDeviceId });
      setSnapshots((current) => current.map((snapshot) => (snapshot.id === snapshotId ? result.snapshot : snapshot)));
      if (dashboard.snapshot?.id === snapshotId) {
        setDeviceFilter(result.snapshot.device_id ?? "all");
        setDashboard(await getDashboard(snapshotId, result.snapshot.device_id ?? "all"));
      }
      const deviceData = await getDevices();
      setDevices(deviceData.devices);
      toast.success("Snapshot reassigned");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reassign snapshot");
    } finally {
      setBusy(false);
    }
  }

  const latestSnapshot = snapshots[0] ?? dashboard.snapshot ?? null;
  const activeSnapshot = dashboard.snapshot ?? latestSnapshot;
  const uploadAssignmentReady = isUploadAssignmentReady(importDevice, importDeviceLabel);
  const dialogUploadAssignmentReady = isUploadAssignmentReady(uploadDevice, uploadDeviceLabel);
  const selectedReadingDate = useMemo<ReadingDateFilter | null>(() => {
    if (!readingDateFilter) return null;
    const day = dashboard.charts.calendar.days.find((item) => item.date === readingDateFilter);
    return {
      date: readingDateFilter,
      bookIds: day?.book_ids ?? [],
    };
  }, [dashboard.charts.calendar.days, readingDateFilter]);
  const navItems: NavItem[] = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "snapshots", label: "Snapshots", icon: Database, badge: snapshots.length },
    { id: "backups", label: "Backups", icon: ArchiveRestore, badge: backups.length },
    { id: "books", label: "Books", icon: Library },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "export", label: "Export", icon: FileUp },
    { id: "settings", label: "Settings", icon: Settings },
  ];
  function selectView(view: View) {
    setReadingDateFilter(null);
    setActiveView(view);
    if (window.location.hash !== `#${view}`) {
      window.history.pushState(null, "", `#${view}`);
    }
  }

  function selectCalendarDate(day: CalendarDay) {
    setReadingDateFilter(day.date);
    setActiveView("books");
    if (window.location.hash !== "#books") {
      window.history.pushState(null, "", "#books");
    }
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <SidebarProvider>
        <Sidebar collapsible="icon" variant="inset">
          <SidebarHeader>
            <AppSidebarBrand onSelect={() => selectView("dashboard")} />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Library</SidebarGroupLabel>
              <SidebarGroupContent>
                <AppSidebarNav items={navItems} activeView={activeView} onSelect={selectView} />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <span className="font-medium">{navItems.find((item) => item.id === activeView)?.label}</span>
            <div className="ml-auto">
              <DeviceSelector devices={devices} value={deviceFilter} onChange={handleDeviceFilterChange} />
            </div>
          </header>
          <div className="grid gap-4 p-4 md:p-6">
            <DeviceBanner
              status={device}
              devices={devices}
              importDevice={importDevice}
              importDeviceLabel={importDeviceLabel}
              activeSnapshot={activeSnapshot}
              latestSnapshot={latestSnapshot}
              onImportDeviceChange={setImportDevice}
              onImportDeviceLabelChange={setImportDeviceLabel}
              onImport={handleImport}
              onUploadClick={handleUploadRequest}
              busy={busy}
              compact={activeView !== "settings"}
            />
            <input
              ref={fileInput}
              type="file"
              accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/octet-stream"
              hidden
              onChange={(event) => handleUpload(event.target.files?.[0])}
            />
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Upload DB</DialogTitle>
                  <DialogDescription>Choose which device this KOReader database belongs to.</DialogDescription>
                </DialogHeader>
                <DeviceAssignmentControl
                  devices={devices}
                  value={uploadDevice}
                  newLabel={uploadDeviceLabel}
                  onValueChange={setUploadDevice}
                  onNewLabelChange={setUploadDeviceLabel}
                />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button disabled={busy || !dialogUploadAssignmentReady} onClick={handleUploadDialogClick}>
                    <Upload data-icon="inline-start" />
                    Upload DB
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {error ? <ErrorAlert>{error}</ErrorAlert> : null}
            {autoImportError ? <ErrorAlert>{autoImportError}</ErrorAlert> : null}
            {device?.permission_error ? (
              <ErrorAlert>
                The app could not read the KOReader database. Use Upload DB or grant this app permission to read the Kobo volume.
              </ErrorAlert>
            ) : null}

            {activeView === "dashboard" ? <DashboardView dashboard={dashboard} /> : null}
            {activeView === "snapshots" ? (
              <SnapshotsView
                snapshots={snapshots}
                devices={devices}
                activeSnapshotId={activeSnapshot?.id ?? null}
                onSelectSnapshot={loadSnapshot}
                onReassignSnapshot={handleReassignSnapshot}
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
            {activeView === "books" ? (
              <BooksView
                books={dashboard.books}
                readingDate={selectedReadingDate}
                onClearReadingDate={() => setReadingDateFilter(null)}
              />
            ) : null}
            {activeView === "calendar" ? (
              <CalendarView
                calendar={dashboard.charts.calendar}
                onSelectDate={selectCalendarDate}
              />
            ) : null}
            {activeView === "export" ? <ExportView dashboard={dashboard} /> : null}
            {activeView === "settings" ? (
              <SettingsView
                device={device}
                devices={devices}
                snapshots={snapshots}
                onRefresh={() => refresh().catch((err: Error) => setError(err.message))}
                onRenameDevice={handleRenameDevice}
              />
            ) : null}
          </div>
        </SidebarInset>
        <Toaster />
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
