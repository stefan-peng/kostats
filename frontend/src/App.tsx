import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  type ColumnSizingState,
  type SortingState,
  type Table as TanStackTable,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  XAxis,
  YAxis,
  type BarShapeProps,
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
  SlidersHorizontal,
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ReadingSession,
  Snapshot,
} from "./types";

type View = "dashboard" | "snapshots" | "backups" | "books" | "calendar" | "export" | "settings";
type BusyAction = "snapshot" | "import" | "upload" | "backup" | "restore";
type ActionErrorKey = "import" | "upload" | "snapshot" | "rename";
type UiError = { message: string; details?: string };
type BookProgressFilter = "all" | "reading" | "finished" | "abandoned" | "unknown";
type NavItem = { id: View; label: string; icon: typeof Home; badge?: number };
type ReadingDateFilter = { date: string; bookIds: string[] };
type DeviceFilter = "all" | string;

const views = new Set<View>(["dashboard", "snapshots", "backups", "books", "calendar", "export", "settings"]);
const tablePageSize = 20;
const deviceStatusPollMs = 15_000;
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const supportedBackupFormatVersion = 2;
const supportedBackupFormatVersions = new Set([1, supportedBackupFormatVersion]);

function BookCover({
  book,
  className,
  eager = false,
}: {
  book: Pick<BookStats, "title" | "cover_url">;
  className?: string;
  eager?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = book.cover_url != null && failedUrl !== book.cover_url;
  return (
    <span
      aria-label={showImage ? undefined : `No cover available for ${book.title}`}
      className={cn(
        "flex aspect-[2/3] items-center justify-center overflow-hidden rounded-sm border bg-muted text-muted-foreground",
        className,
      )}
      role={showImage ? undefined : "img"}
    >
      {showImage ? (
        <img
          alt={`Cover of ${book.title}`}
          className="size-full object-cover"
          decoding="async"
          loading={eager ? "eager" : "lazy"}
          onError={() => setFailedUrl(book.cover_url)}
          src={book.cover_url ?? undefined}
        />
      ) : (
        <BookOpen aria-hidden="true" />
      )}
    </span>
  );
}

function BookTitle({ book }: { book: BookStats }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <BookCover book={book} className="w-8 shrink-0" />
      <span className="whitespace-normal font-medium" title={book.title}>{book.title}</span>
    </span>
  );
}

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
  insights: {
    sessions: {
      available: false,
      total: 0,
      average_active_seconds: 0,
      longest_active_seconds: 0,
      recent: [],
    },
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

const verticalBarSizing = {
  compact: 16,
  monthly: 28,
  categoryGap: "20%",
} as const;

const bookColumnLabels: Record<string, string> = {
  authors: "Author",
  highlight_count: "Highlights",
  last_open: "Last opened",
  pages: "Pages seen",
  position: "Position",
  progress: "Progress",
  records: "Records",
  status: "Status",
  time_seconds: "Time",
  title: "Title",
  details: "Details",
};

function tableColumnLabel<TData>(column: Column<TData, unknown>) {
  if (typeof column.columnDef.header === "string") return column.columnDef.header;
  return bookColumnLabels[column.id] ?? column.id;
}

function TableColumnPicker<TData>({ table }: { table: TanStackTable<TData> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full">
          <SlidersHorizontal data-icon="inline-start" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(value === true)}
            >
              {tableColumnLabel(column)}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ResizableDataTable<TData>({ table, emptyMessage }: { table: TanStackTable<TData>; emptyMessage: string }) {
  const rows = table.getRowModel().rows;
  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>, column: Column<TData, unknown>) {
    const step = event.shiftKey ? 40 : 16;
    const minSize = column.columnDef.minSize ?? 20;
    const maxSize = column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER;
    const currentSize = column.getSize();
    const nextSize = event.key === "ArrowLeft" ? currentSize - step
      : event.key === "ArrowRight" ? currentSize + step
        : event.key === "Home" ? minSize
          : event.key === "End" ? maxSize
            : null;

    if (nextSize == null) return;
    event.preventDefault();
    table.setColumnSizing((sizes) => ({
      ...sizes,
      [column.id]: Math.min(maxSize, Math.max(minSize, nextSize)),
    }));
  }

  return (
    <Table className="min-w-full table-fixed" style={{ width: table.getTotalSize() }}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                aria-sort={ariaSortValue(header.column.getIsSorted())}
                className="relative"
                style={{ width: header.getSize() }}
              >
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getCanResize() ? (
                  <div
                    aria-label={`Resize ${tableColumnLabel(header.column)} column`}
                    aria-orientation="vertical"
                    aria-valuemax={header.column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER}
                    aria-valuemin={header.column.columnDef.minSize ?? 20}
                    aria-valuenow={header.getSize()}
                    aria-valuetext={`${header.getSize()} pixels`}
                    className="absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:top-2 after:bottom-2 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:bg-primary focus-visible:after:bg-primary"
                    onDoubleClick={() => header.column.resetSize()}
                    onKeyDown={(event) => resizeWithKeyboard(event, header.column)}
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                    role="separator"
                    tabIndex={0}
                  />
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} style={{ width: cell.column.getSize() }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function PaginatedTable<TData>({
  ariaLabel,
  table,
  emptyMessage,
}: {
  ariaLabel: string;
  table: TanStackTable<TData>;
  emptyMessage: string;
}) {
  const regionRef = useRef<HTMLDivElement>(null);
  const rowCount = table.getPrePaginationRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const firstRow = rowCount === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, rowCount);

  function changePage(direction: "previous" | "next") {
    if (direction === "previous") table.previousPage();
    else table.nextPage();
    regionRef.current?.scrollIntoView({ block: "start" });
  }

  return (
    <div className="min-w-0">
      <div
        aria-label={ariaLabel}
        className={cn(
          "min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable] [&_[data-slot=table-container]]:min-w-0 [&_[data-slot=table-container]]:!overflow-visible",
          pageCount <= 1 && "rounded-b-xl",
        )}
        ref={regionRef}
        role="region"
        tabIndex={0}
      >
        <ResizableDataTable table={table} emptyMessage={emptyMessage} />
      </div>
      {pageCount > 1 ? (
        <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-sm text-muted-foreground">
            {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {rowCount.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <Button
              aria-label="Previous page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => changePage("previous")}
              size="sm"
              variant="outline"
            >
              Previous
            </Button>
            <span aria-live="polite" className="text-sm text-muted-foreground">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <Button
              aria-label="Next page"
              disabled={!table.getCanNextPage()}
              onClick={() => changePage("next")}
              size="sm"
              variant="outline"
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const deviceChartColors = [
  "var(--device-chart-1)",
  "var(--device-chart-2)",
  "var(--device-chart-3)",
  "var(--device-chart-4)",
  "var(--device-chart-5)",
  "var(--device-chart-6)",
];

function deviceColor(deviceId: string) {
  let hash = 0;
  for (let index = 0; index < deviceId.length; index += 1) {
    hash = (hash * 31 + deviceId.charCodeAt(index)) | 0;
  }
  return deviceChartColors[(hash >>> 0) % deviceChartColors.length];
}

function deviceColorStyle(deviceId: string): CSSProperties {
  return { "--device-color": deviceColor(deviceId) } as CSSProperties;
}

const STACKED_BAR_RADIUS = 4;
const MIN_STACKED_BAR_HEIGHT = STACKED_BAR_RADIUS * 2;

export function isVisibleStackedBarSegment(
  payload: Record<string, string | number> | undefined,
  dataKey: string | number | undefined,
  height: number,
) {
  if (dataKey === undefined || height < MIN_STACKED_BAR_HEIGHT) return false;
  return Number(payload?.[String(dataKey)] ?? 0) > 0;
}

export function isTopStackedBarSegment(
  payload: Record<string, string | number> | undefined,
  dataKey: string | number | undefined,
  stackKeys: readonly string[],
  height: number,
) {
  const key = dataKey === undefined ? undefined : String(dataKey);
  const stackIndex = key === undefined ? -1 : stackKeys.indexOf(key);
  if (stackIndex < 0 || !isVisibleStackedBarSegment(payload, dataKey, height)) return false;

  const value = Number(payload?.[key!] ?? 0);
  const pixelsPerUnit = height / value;
  return stackKeys.slice(stackIndex + 1).every((stackKey) => {
    const higherValue = Number(payload?.[stackKey] ?? 0);
    return higherValue <= 0 || higherValue * pixelsPerUnit < MIN_STACKED_BAR_HEIGHT;
  });
}

function stackedBarShape(stackKeys: readonly string[]) {
  return (props: BarShapeProps & { dataKey?: string | number }) => {
    const { dataKey, payload, ...rectangleProps } = props;
    if (!isVisibleStackedBarSegment(payload, dataKey, props.height)) return null;

    return (
      <Rectangle
        {...rectangleProps}
        radius={isTopStackedBarSegment(payload, dataKey, stackKeys, props.height)
          ? [STACKED_BAR_RADIUS, STACKED_BAR_RADIUS, 0, 0]
          : 0}
      />
    );
  };
}

function DevicePill({ id, label }: { id: string; label: string }) {
  return <Badge className="device-pill" style={deviceColorStyle(id)} variant="outline">{label}</Badge>;
}

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

function formatPace(seconds: number | null) {
  if (seconds == null) return "—";
  return `${Math.max(1, Math.round(seconds / 60))} min/page`;
}

function estimateDescription(book: BookStats) {
  if (book.estimated_remaining_seconds != null) return `~${formatDurationLabel(book.estimated_remaining_seconds)} left`;
  if (effectiveStatus(book) !== "reading") return "Only shown for books in progress";
  if (!book.total_pages || !book.max_page) return "Need a page total and current page";
  return "Not enough data for an estimate";
}

function SessionTable({
  sessions,
  ariaLabel = "Reading sessions table",
  showBooks = true,
  showColumnPicker = true,
}: {
  sessions: ReadingSession[];
  ariaLabel?: string;
  showBooks?: boolean;
  showColumnPicker?: boolean;
}) {
  const showsDevice = sessions.some((session) => session.device_label);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const columns = useMemo<ColumnDef<ReadingSession>[]>(
    () => [
      {
        accessorKey: "started_at",
        header: "Started",
        cell: ({ row }) => formatDateTime(row.original.started_at),
        size: 180,
        minSize: 150,
        maxSize: 260,
      },
      {
        accessorKey: "active_seconds",
        header: "Active",
        cell: ({ row }) => formatDurationLabel(row.original.active_seconds),
        size: 110,
        minSize: 90,
        maxSize: 180,
      },
      {
        accessorKey: "elapsed_seconds",
        header: "Elapsed",
        cell: ({ row }) => formatDurationLabel(row.original.elapsed_seconds),
        size: 110,
        minSize: 90,
        maxSize: 180,
      },
      ...(showBooks ? [{
        accessorKey: "book_count" as const,
        header: "Books",
        cell: ({ row }: { row: { original: ReadingSession } }) => row.original.book_count.toLocaleString(),
        size: 100,
        minSize: 80,
        maxSize: 160,
      }] : []),
      ...(showsDevice ? [{
        accessorKey: "device_label" as const,
        header: "Device",
        cell: ({ row }: { row: { original: ReadingSession } }) => {
          const { device_id: deviceId, device_label: deviceLabel } = row.original;
          return deviceLabel ? <DevicePill id={deviceId ?? deviceLabel} label={deviceLabel} /> : "—";
        },
        size: 160,
        minSize: 120,
        maxSize: 280,
      }] : []),
    ],
    [showBooks, showsDevice],
  );
  const table = useReactTable({
    data: sessions,
    columns,
    state: { columnVisibility, columnSizing },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: tablePageSize } },
    columnResizeMode: "onChange",
  });
  return (
    <div className="grid min-w-0 gap-2">
      {showColumnPicker ? (
        <div className="flex justify-end pr-4"><div className="w-32"><TableColumnPicker table={table} /></div></div>
      ) : null}
      <PaginatedTable ariaLabel={ariaLabel} table={table} emptyMessage="No sessions yet." />
    </div>
  );
}

function BookActivityChart({
  activity,
  devices,
}: {
  activity: BookStats["recent_activity"] | undefined;
  devices: BookStats["recent_activity_devices"];
}) {
  const data = activity ?? [];
  const activityDevices = devices ?? [];
  const config = Object.fromEntries(
    activityDevices.map((device) => [device.id, { label: device.label, color: deviceColor(device.id) }]),
  ) satisfies ChartConfig;
  const splitByDevice = activityDevices.length > 0;
  const stackKeys = activityDevices.map((device) => device.id);
  const shape = stackedBarShape(stackKeys);
  return (
    <ChartContainer config={splitByDevice ? config : chartConfig} className="h-56 w-full">
      <BarChart
        accessibilityLayer
        data={data}
        margin={{ left: 12, right: 32, top: 8, bottom: 8 }}
        barCategoryGap={verticalBarSizing.categoryGap}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
        <YAxis hide domain={[0, "dataMax"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              hideIndicator
              hideZeroValues
              formatter={(value, _name, item) => (
                <div className="grid gap-1">
                  <span className="text-muted-foreground">{String(item.payload.label)}</span>
                  <span className="font-medium">
                    {splitByDevice
                      ? `${config[String(_name)]?.label ?? String(_name)} · ${formatMinutes(Number(value))}`
                      : formatMinutes(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        {splitByDevice ? activityDevices.map((device) => (
          <Bar
            key={device.id}
            dataKey={device.id}
            stackId="device"
            barSize={verticalBarSizing.compact}
            fill={deviceColor(device.id)}
            isAnimationActive={false}
            shape={shape}
          />
        )) : <Bar dataKey="minutes" barSize={verticalBarSizing.compact} fill="var(--color-minutes)" isAnimationActive={false} radius={4} />}
      </BarChart>
    </ChartContainer>
  );
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
  if (effectiveStatus(book) === "complete") return "100%";
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

function WarningAlert({
  title,
  message,
  details,
  children,
}: {
  title: string;
  message: string;
  details?: string;
  children?: ReactNode;
}) {
  return (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <div>{message}</div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
        {details ? (
          <details>
            <summary className="cursor-pointer font-medium">Technical details</summary>
            <code className="mt-1 block whitespace-pre-wrap break-words text-xs">{details}</code>
          </details>
        ) : null}
      </AlertDescription>
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
  busyAction,
  deviceFilter,
  onDeviceFilterChange,
  latestSnapshotMatchesDevice,
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
  busyAction: BusyAction | null;
  deviceFilter?: DeviceFilter;
  onDeviceFilterChange?: (value: DeviceFilter) => void;
  latestSnapshotMatchesDevice: boolean;
  compact?: boolean;
}) {
  const mounted = status?.mounted ?? false;
  const found = status?.database_found ?? false;
  const blocked = Boolean(status?.permission_error);
  const stateLabel = blocked
    ? "Access blocked"
    : mounted && found
      ? latestSnapshotMatchesDevice
        ? "Device matches latest snapshot"
        : "Device update pending"
      : mounted
        ? "Database not found"
        : "Kobo not mounted";
  const stateVariant = mounted && found && !blocked ? "default" : mounted || blocked ? "destructive" : "outline";
  const snapshotLabel = activeSnapshot?.id === latestSnapshot?.id ? "Snapshot" : "Viewing";
  const showLatest = Boolean(latestSnapshot && activeSnapshot?.id !== latestSnapshot.id);
  const importing = busyAction === "import";

  if (compact) {
    return (
      <div
        aria-label="Device import status"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm"
      >
        <Badge variant={stateVariant}>{stateLabel}</Badge>
        <span className="font-medium">{activeSnapshot ? formatDateTime(activeSnapshot.imported_at) : "None"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {deviceFilter != null && onDeviceFilterChange ? (
            <DeviceSelector devices={devices} value={deviceFilter} onChange={onDeviceFilterChange} />
          ) : null}
          <Button size="sm" aria-label="Import from Kobo" disabled={busy || !found} onClick={onImport}>
            {importing ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {importing ? "Importing..." : "Import"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onUploadClick}>
            <Upload data-icon="inline-start" />
            Upload DB
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card aria-label="Device import status">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HardDrive />
          </div>
          <div className="min-w-0">
            <CardTitle>Kobo / KOReader</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge variant={stateVariant}>{stateLabel}</Badge>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
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

function PrimaryMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 border-border/70 py-1 sm:border-l sm:pl-6 sm:first:border-l-0 sm:first:pl-0">
      <div className="font-heading text-3xl leading-none text-primary tabular-nums lg:text-4xl">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{label}</div>
    </div>
  );
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
  dominant = false,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  valueKey: "minutes" | "hours";
  formatValue: (value: number) => string;
  dominant?: boolean;
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
          <ChartContainer config={chartConfig} className={cn(dominant ? "h-[17rem]" : "h-64", "w-full")}>
            <BarChart
              accessibilityLayer
              data={data}
              margin={{ left: 0, right: 0, top: 8 }}
              barCategoryGap={verticalBarSizing.categoryGap}
            >
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
                barSize={valueKey === "hours" ? verticalBarSizing.monthly : verticalBarSizing.compact}
                fill={`var(--color-${valueKey})`}
                isAnimationActive={false}
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
  dominant = false,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  devices: Array<{ id: string; label: string }>;
  unit: "minutes" | "hours";
  dominant?: boolean;
}) {
  const config = Object.fromEntries(
    devices.map((device) => [
      device.id,
      {
        label: device.label,
        color: deviceColor(device.id),
      },
    ]),
  ) satisfies ChartConfig;
  const formatValue = unit === "minutes"
    ? (value: number) => formatDurationLabel(value * 60)
    : (value: number) => formatDurationLabel(value * 3600);
  const stackKeys = devices.map((device) => device.id);
  const shape = stackedBarShape(stackKeys);
  const barSize = unit === "hours" ? verticalBarSizing.monthly : verticalBarSizing.compact;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 || devices.length === 0 ? (
          <EmptyPanel icon={<CalendarDays />} title="No reading data yet" />
        ) : (
          <ChartContainer config={config} className={cn(dominant ? "h-[17rem]" : "h-64", "w-full")}>
            <BarChart
              accessibilityLayer
              data={data}
              margin={{ left: 0, right: 0, top: 8 }}
              barCategoryGap={verticalBarSizing.categoryGap}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
              <YAxis hide domain={[0, "dataMax"]} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideZeroValues
                    formatter={(value, name) => (
                      <div className="grid gap-1">
                        <span className="text-muted-foreground">{config[String(name)]?.label ?? String(name)}</span>
                        <span className="font-medium">{formatValue(Number(value))}</span>
                      </div>
                    )}
                  />
                }
              />
              {devices.map((device) => (
                <Bar
                  key={device.id}
                  dataKey={device.id}
                  stackId="device"
                  barSize={barSize}
                  fill={deviceColor(device.id)}
                  isAnimationActive={false}
                  shape={shape}
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
              <Bar dataKey="hours" barSize={18} fill="var(--color-hours)" isAnimationActive={false} radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function RecentBooks({ books, onSelectBook }: { books: Dashboard["recent_books"]; onSelectBook: (book: BookStats) => void }) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const columns = useMemo<ColumnDef<BookStats>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => <BookTitle book={row.original} />,
        enableHiding: false,
        size: 300,
        minSize: 180,
        maxSize: 600,
      },
      {
        accessorKey: "authors",
        header: "Author",
        cell: ({ row }) => <span className="whitespace-normal" title={row.original.authors}>{row.original.authors}</span>,
        size: 200,
        minSize: 120,
        maxSize: 400,
      },
      {
        id: "last_open",
        accessorFn: (book) => book.last_open ?? "",
        header: "Last opened",
        cell: ({ row }) => <span title={formatDateTime(row.original.last_open)}>{formatDateTime(row.original.last_open)}</span>,
        size: 180,
        minSize: 150,
        maxSize: 260,
      },
      { accessorKey: "time_label", header: "Time", size: 100, minSize: 80, maxSize: 160 },
      {
        accessorKey: "pages",
        header: "Pages",
        cell: ({ row }) => row.original.pages.toLocaleString(),
        size: 100,
        minSize: 80,
        maxSize: 160,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <Badge variant={statusBadgeVariant(row.original)}>{formatStatus(row.original)}</Badge>,
        size: 120,
        minSize: 100,
        maxSize: 180,
      },
      {
        id: "progress",
        header: "Progress",
        cell: ({ row }) => (
          <div className="flex min-w-32 items-center gap-2">
            <Progress value={row.original.progress ?? 0} />
            <span className="w-12 text-xs text-muted-foreground">{formatProgress(row.original)}</span>
          </div>
        ),
        size: 200,
        minSize: 160,
        maxSize: 320,
      },
      {
        id: "details",
        header: "",
        cell: ({ row }) => <Button variant="outline" size="sm" onClick={() => onSelectBook(row.original)}>Details</Button>,
        enableHiding: false,
        enableSorting: false,
        enableResizing: false,
        size: 96,
        minSize: 84,
        maxSize: 120,
      },
    ],
    [onSelectBook],
  );
  const table = useReactTable({
    data: books,
    columns,
    state: { columnVisibility, columnSizing },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: tablePageSize } },
    columnResizeMode: "onChange",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent books</CardTitle>
        <CardAction className="w-32"><TableColumnPicker table={table} /></CardAction>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <PaginatedTable ariaLabel="Recent books table" table={table} emptyMessage="No books yet." />
      </CardContent>
    </Card>
  );
}

function BookDetailDialog({ book, onOpenChange }: { book: BookStats | null; onOpenChange: (open: boolean) => void }) {
  const recentSessions = book?.recent_sessions ?? [];
  return (
    <Dialog open={book != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,780px)] overflow-y-auto sm:max-w-5xl">
        {book ? (
          <>
            <div className="flex items-start gap-4">
              <BookCover book={book} className="w-20 shrink-0" eager />
              <DialogHeader className="min-w-0 flex-1 text-left">
                <DialogTitle>{book.title}</DialogTitle>
                <DialogDescription>{book.authors}</DialogDescription>
              </DialogHeader>
            </div>
            <div className="flex flex-col gap-3 rounded-lg border p-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center">
              <Badge className="w-fit" variant={statusBadgeVariant(book)}>{formatStatus(book)}</Badge>
              <Progress value={book.progress ?? 0} />
              <span className="font-medium">{formatProgress(book)}</span>
              <span className="text-sm text-muted-foreground">
                {estimateDescription(book)}
              </span>
            </div>
            <Card size="sm">
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div><p className="text-xs text-muted-foreground">Reading time</p><p className="font-medium">{book.time_label}</p></div>
                <div><p className="text-xs text-muted-foreground">Pages</p><p className="font-medium">{formatPageProgress(book)}</p></div>
                <div><p className="text-xs text-muted-foreground">Current pace</p><p className="font-medium">{formatPace(book.pace_seconds_per_page)}</p></div>
                <div><p className="text-xs text-muted-foreground">Annotations</p><p className="font-medium">{book.highlight_count + book.note_count}</p></div>
                <div><p className="text-xs text-muted-foreground">Last opened</p><p className="font-medium">{formatDateTime(book.last_open)}</p></div>
              </CardContent>
            </Card>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Recent reading</CardTitle>
                  <CardDescription>Last 5 days</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <BookActivityChart activity={book.recent_activity} devices={book.recent_activity_devices} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Recent sessions</CardTitle>
                  <CardDescription>Sessions that included this book.</CardDescription>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  {recentSessions.length ? (
                    <SessionTable ariaLabel="Book reading sessions" sessions={recentSessions} showBooks={false} />
                  ) : (
                    <Empty className="border-x">
                      <EmptyHeader>
                        <EmptyTitle>No qualifying sessions</EmptyTitle>
                        <EmptyDescription>This book has no recorded reading sessions yet.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
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
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [sorting, setSorting] = useState<SortingState>([{ id: "last_open", desc: true }]);
  const [selectedBook, setSelectedBook] = useState<BookStats | null>(null);
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
          <Button
            variant="ghost"
            size="sm"
            aria-label={row.original.title}
            className="h-auto justify-start p-0 text-left whitespace-normal"
            title={row.original.title}
            onClick={() => setSelectedBook(row.original)}
          >
            <BookTitle book={row.original} />
          </Button>
        ),
        enableHiding: false,
        size: 300,
        minSize: 180,
        maxSize: 600,
      },
      {
        accessorKey: "authors",
        header: "Author",
        cell: ({ row }) => <span className="whitespace-normal" title={row.original.authors}>{row.original.authors}</span>,
        size: 200,
        minSize: 120,
        maxSize: 400,
      },
      {
        accessorKey: "time_seconds",
        header: ({ column }) => sortableHeader(column, "Time"),
        cell: ({ row }) => row.original.time_label,
        size: 100,
        minSize: 80,
        maxSize: 160,
      },
      {
        accessorKey: "pages",
        header: ({ column }) => sortableHeader(column, "Pages seen"),
        cell: ({ row }) => row.original.pages.toLocaleString(),
        size: 110,
        minSize: 90,
        maxSize: 180,
      },
      {
        id: "position",
        header: "Position",
        cell: ({ row }) => formatPageProgress(row.original),
        size: 130,
        minSize: 110,
        maxSize: 200,
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
        size: 120,
        minSize: 100,
        maxSize: 180,
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
        size: 200,
        minSize: 160,
        maxSize: 320,
      },
      {
        accessorKey: "highlight_count",
        header: "Highlights",
        cell: ({ row }) => row.original.highlight_count.toLocaleString(),
        size: 110,
        minSize: 90,
        maxSize: 180,
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
        size: 180,
        minSize: 150,
        maxSize: 260,
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
        size: 100,
        minSize: 80,
        maxSize: 180,
      },
      {
        id: "details",
        header: "",
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => setSelectedBook(row.original)}>
            Details
          </Button>
        ),
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 96,
        minSize: 84,
        maxSize: 120,
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
      columnVisibility,
      columnSizing,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
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
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: tablePageSize } },
    columnResizeMode: "onChange",
  });

  const filteredRows = table.getFilteredRowModel().rows;
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
    <>
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
        <FieldGroup className="md:grid-cols-[minmax(220px,1fr)_180px_180px]" aria-label="Book table controls">
          <Field>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="book-search"
                aria-label="Search"
                className="pl-8"
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder="Title or author"
                type="search"
              />
            </div>
          </Field>
          <Field>
            <Select
              value={progressFilter}
              onValueChange={(value) => {
                table.getColumn("status")?.setFilterValue(value === "all" ? undefined : value);
              }}
            >
              <SelectTrigger id="book-status" aria-label="Status" className="w-full">
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
          <Field>
            <TableColumnPicker table={table} />
          </Field>
        </FieldGroup>
      </CardContent>
      <CardContent className="px-0 pb-0">
        <PaginatedTable ariaLabel="Books table" table={table} emptyMessage="No books match the current filters." />
      </CardContent>
    </Card>
    <BookDetailDialog book={selectedBook} onOpenChange={(open) => !open && setSelectedBook(null)} />
    </>
  );
}

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const [selectedBook, setSelectedBook] = useState<BookStats | null>(null);
  const streakLabel =
    dashboard.summary.current_streak === 1
      ? "1 day"
      : `${dashboard.summary.current_streak} days`;

  return (
    <>
      {!dashboard.has_data ? (
        <EmptyPanel icon={<Database />} title="No database yet" description="Import from Kobo or upload a KOReader database." />
      ) : null}

      <section className="grid gap-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <PrimaryMetric label="Total reading time" value={dashboard.summary.total_time_label} />
          <PrimaryMetric label="Days read" value={dashboard.summary.reading_days.toLocaleString()} />
          <PrimaryMetric label="Books in library" value={dashboard.summary.books.toLocaleString()} />
          <PrimaryMetric label="Pages read" value={dashboard.summary.pages.toLocaleString()} />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-sm" aria-label="Additional reading metrics">
          <span><span className="text-muted-foreground">Current streak</span> <strong className="ml-1 font-medium">{streakLabel}</strong></span>
          <span><span className="text-muted-foreground">Finished</span> <strong className="ml-1 font-medium">{dashboard.summary.finished_books.toLocaleString()}</strong></span>
          <span><span className="text-muted-foreground">Reading</span> <strong className="ml-1 font-medium">{dashboard.summary.reading_books.toLocaleString()}</strong></span>
          <span><span className="text-muted-foreground">Abandoned</span> <strong className="ml-1 font-medium">{dashboard.summary.abandoned_books.toLocaleString()}</strong></span>
          <span><span className="text-muted-foreground">Highlights</span> <strong className="ml-1 font-medium">{dashboard.summary.highlights.toLocaleString()}</strong></span>
        </div>
      </section>

      <section
        data-testid="dashboard-primary-insights"
        className="grid min-w-0 gap-4"
      >
        {dashboard.charts.devices?.length && dashboard.charts.daily_by_device?.length ? (
          <DeviceStackedBarChart
            title="Daily reading"
            data={dashboard.charts.daily_by_device}
            devices={dashboard.charts.devices}
            unit="minutes"
            dominant
          />
        ) : (
          <ReadingBarChart
            title="Daily reading"
            data={dashboard.charts.daily}
            valueKey="minutes"
            formatValue={(minutes) => formatDurationLabel(minutes * 60)}
            dominant
          />
        )}
      </section>

      <section className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-2">
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
        </div>
      </section>

      <RecentBooks books={dashboard.recent_books} onSelectBook={setSelectedBook} />
      <BookDetailDialog book={selectedBook} onOpenChange={(open) => !open && setSelectedBook(null)} />
    </>
  );
}

const MemoizedDashboardView = memo(DashboardView);

function SnapshotsView({
  snapshots,
  devices,
  activeSnapshotId,
  onSelectSnapshot,
  onReassignSnapshot,
  actionError,
}: {
  snapshots: Snapshot[];
  devices: DeviceSummary[];
  activeSnapshotId: string | null;
  onSelectSnapshot: (id: string) => void;
  onReassignSnapshot: (snapshotId: string, deviceId: string) => void;
  actionError?: UiError;
}) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const columns = useMemo<ColumnDef<Snapshot>[]>(
    () => [
      {
        accessorKey: "imported_at",
        header: "Imported",
        cell: ({ row }) => <span title={formatDateTime(row.original.imported_at)}>{formatDateTime(row.original.imported_at)}</span>,
        size: 180,
        minSize: 150,
        maxSize: 260,
      },
      {
        id: "device",
        header: "Device",
        cell: ({ row }) => (
          <Select value={row.original.device_id ?? ""} onValueChange={(deviceId) => onReassignSnapshot(row.original.id, deviceId)}>
            <SelectTrigger className="h-8" aria-label={`Device for ${row.original.id}`}>
              <SelectValue placeholder={row.original.device_label ?? "Unknown device"} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {devices.map((device) => <SelectItem key={device.id} value={device.id}>{device.label}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        ),
        size: 180,
        minSize: 140,
        maxSize: 280,
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }) => <code className="whitespace-normal" title={row.original.source_path ?? row.original.source}>{formatSnapshotSource(row.original)}</code>,
        size: 280,
        minSize: 180,
        maxSize: 520,
      },
      {
        accessorKey: "file_size",
        header: "Size",
        cell: ({ row }) => formatBytes(row.original.file_size),
        size: 100,
        minSize: 80,
        maxSize: 160,
      },
      { accessorKey: "schema_version", header: "Schema", size: 100, minSize: 80, maxSize: 160 },
      {
        accessorKey: "id",
        header: "Snapshot ID",
        cell: ({ row }) => <code className="whitespace-normal" title={row.original.id}>{row.original.id}</code>,
        size: 240,
        minSize: 160,
        maxSize: 480,
      },
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => (
          <Button size="sm" variant="outline" disabled={row.original.id === activeSnapshotId} onClick={() => onSelectSnapshot(row.original.id)}>
            {row.original.id === activeSnapshotId ? "Current" : "View"}
          </Button>
        ),
        enableHiding: false,
        enableSorting: false,
        enableResizing: false,
        size: 96,
        minSize: 84,
        maxSize: 120,
      },
    ],
    [activeSnapshotId, devices, onReassignSnapshot, onSelectSnapshot],
  );
  const table = useReactTable({
    data: snapshots,
    columns,
    state: { columnVisibility, columnSizing },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: tablePageSize } },
    columnResizeMode: "onChange",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Snapshots</CardTitle>
        <CardAction className="w-32"><TableColumnPicker table={table} /></CardAction>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {actionError ? (
          <div className="px-6 pb-4">
            <WarningAlert title="Snapshot action failed" {...actionError} />
          </div>
        ) : null}
        <PaginatedTable ariaLabel="Snapshots table" table={table} emptyMessage="No snapshots have been imported yet." />
      </CardContent>
    </Card>
  );
}

function BackupCounts({ counts, inline = false }: { counts: Record<string, number>; inline?: boolean }) {
  const labels = [
    ["sidecars", "sidecar files"],
    ["settings", "settings files"],
    ["databases", "databases"],
    ["dictionaries", "dictionary files"],
    ["extensions", "extension files"],
  ] as const;
  const badges = labels.map(([key, label]) => (
    <Badge variant="outline" key={key}>
      <span className="font-semibold">{counts[key] ?? 0}</span> {label}
    </Badge>
  ));
  return inline ? badges : <div className="flex flex-wrap gap-2">{badges}</div>;
}

function BackupCompatibility({ formatVersion }: { formatVersion: number | null }) {
  const supported = formatVersion != null && supportedBackupFormatVersions.has(formatVersion);
  const formatLabel = formatVersion == null ? "Unknown format" : `Format v${formatVersion}`;
  const compatibilityMessage = formatVersion === 2
    ? "Dictionary files are stored in kostats' local backup store; keep the data directory with this backup."
    : formatVersion === 1
      ? "Legacy format: dictionary files are stored inside the backup archive."
      : "This version of kostats can only restore format v1 or v2 backups.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge tabIndex={0} variant={supported ? "outline" : "destructive"}>
          {supported ? formatLabel : `${formatLabel} unsupported`}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{compatibilityMessage}</TooltipContent>
    </Tooltip>
  );
}

function BackupsView({
  backups,
  device,
  busy,
  busyAction,
  onCreate,
  onPreview,
  onRestore,
}: {
  backups: RecoveryBackup[];
  device: DeviceStatus | null;
  busy: boolean;
  busyAction: BusyAction | null;
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
  const backingUp = busyAction === "backup";
  const restoring = busyAction === "restore";

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
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recovery backups</CardTitle>
          <CardDescription>
            Books are excluded. Credentials may be included.
          </CardDescription>
        </div>
        <CardAction>
          <Button
            disabled={busy || !device?.mounted}
            onClick={() => onCreate().catch((err: Error) => {
              setLocalError(err.message);
            })}
          >
            {backingUp ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ArchiveRestore data-icon="inline-start" />}
            {backingUp ? "Working..." : "Back up now"}
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
                      {backup.device_label ?? "Unknown device"} / KOReader {backup.koreader_version ?? "unknown version"} / {formatBytes(backup.archive_size)}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || loadingPreview || !device?.mounted || backup.format_version == null || !supportedBackupFormatVersions.has(backup.format_version)}
                      onClick={() => previewBackup(backup.id)}
                    >
                      {loadingPreview ? "Scanning..." : "Restore"}
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <code className="truncate text-xs text-muted-foreground">{backup.source_mount}</code>
                  <div className="flex flex-wrap gap-2">
                    {backup.credentials_included ? (
                      <Badge variant="destructive">Contains credentials</Badge>
                    ) : null}
                    <BackupCompatibility formatVersion={backup.format_version} />
                    <BackupCounts counts={backup.counts} inline />
                  </div>
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
                  {restoring ? "Restoring..." : "Restore backup"}
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
  renameError,
}: {
  device: DeviceStatus | null;
  devices: DeviceSummary[];
  snapshots: Snapshot[];
  onRefresh: () => void;
  onRenameDevice: (deviceId: string, label: string) => Promise<void>;
  renameError?: UiError;
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
          {renameError ? <WarningAlert title="Could not save label" {...renameError} /> : null}
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
  const [criticalError, setCriticalError] = useState<UiError | null>(null);
  const [refreshError, setRefreshError] = useState<UiError | null>(null);
  const [autoImportError, setAutoImportError] = useState<UiError | null>(null);
  const [actionErrors, setActionErrors] = useState<Partial<Record<ActionErrorKey, UiError>>>({});
  const [latestSnapshotMatchesDevice, setLatestSnapshotMatchesDevice] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const busy = busyAction !== null;
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingUploadAssignment = useRef<DeviceAssignment | undefined>(undefined);
  const selectedSnapshotId = useRef<string | null>(null);
  const deviceStatusKey = useRef<string | null>(null);
  const latestDeviceStatus = useRef<DeviceStatus | null>(null);
  const deviceStatusRefreshInFlight = useRef(false);
  const hasUsableDashboard = useRef(false);

  function clearActionError(key: ActionErrorKey) {
    setActionErrors((current) => ({ ...current, [key]: undefined }));
  }

  function reportActionError(key: ActionErrorKey, err: unknown, fallback: string) {
    setActionErrors((current) => ({
      ...current,
      [key]: { message: fallback, details: err instanceof Error ? err.message : undefined },
    }));
  }

  function publishDashboard(nextDashboard: Dashboard) {
    hasUsableDashboard.current = nextDashboard.has_data;
    setDashboard(nextDashboard);
    setCriticalError(null);
    setRefreshError(null);
  }

  function reportRefreshError(err: unknown) {
    const details = err instanceof Error ? err.message : undefined;
    if (hasUsableDashboard.current) {
      setRefreshError({ message: "The dashboard could not be refreshed. The data already on screen is still available.", details });
    } else {
      setCriticalError({ message: "Dashboard data is unavailable. Check the connection and try again.", details });
    }
  }

  function publishDeviceStatus(nextDeviceStatus: DeviceStatus) {
    latestDeviceStatus.current = nextDeviceStatus;
    const nextKey = JSON.stringify(nextDeviceStatus);
    if (nextKey === deviceStatusKey.current) return;
    deviceStatusKey.current = nextKey;
    setDevice(nextDeviceStatus);
  }

  async function refreshDeviceStatus() {
    if (deviceStatusRefreshInFlight.current) return;
    deviceStatusRefreshInFlight.current = true;
    try {
      const nextDeviceStatus = await getDeviceStatus();
      publishDeviceStatus(nextDeviceStatus);
      const readyToImport =
        nextDeviceStatus.mounted &&
        nextDeviceStatus.database_found &&
        !nextDeviceStatus.permission_error;
      if (readyToImport) {
        const autoResult = await autoImportFromKobo();
        if (!autoResult.device) throw new Error("Auto-import response did not include device status");
        publishDeviceStatus(autoResult.device);
        const matchesDevice =
          autoResult.snapshot !== null && (autoResult.reason === "changed" || autoResult.reason === "unchanged");
        setLatestSnapshotMatchesDevice(matchesDevice);
        if (autoResult.imported || autoResult.covers_changed) {
          await refresh(true, matchesDevice);
        }
      } else {
        setLatestSnapshotMatchesDevice(false);
      }
    } finally {
      deviceStatusRefreshInFlight.current = false;
    }
  }

  async function refresh(skipAutoImport = false, knownDeviceMatch = false) {
    let deviceStatus = await getDeviceStatus();
    let nextAutoImportError: UiError | null = null;
    let nextLatestSnapshotMatchesDevice = knownDeviceMatch;
    if (!skipAutoImport && deviceStatus.mounted && deviceStatus.database_found && !deviceStatus.permission_error) {
      try {
        const autoResult = await autoImportFromKobo();
        if (!autoResult.device) throw new Error("Auto-import response did not include device status");
        deviceStatus = autoResult.device;
        nextLatestSnapshotMatchesDevice =
          autoResult.snapshot !== null && (autoResult.reason === "changed" || autoResult.reason === "unchanged");
      } catch (err) {
        // Background Kobo sync is a UI boundary: show the import failure while keeping local snapshots visible.
        nextAutoImportError = {
          message: "Kobo could not be updated. The last successful import is still being shown.",
          details: err instanceof Error ? err.message : "Could not import from Kobo",
        };
      }
    }
    const dashboardSnapshotId = selectedSnapshotId.current ?? "latest";
    const [deviceData, dashboardData, snapshotData, backupData] = await Promise.all([
      getDevices(),
      getDashboard(dashboardSnapshotId, deviceFilter),
      getSnapshots(deviceFilter),
      getBackups(deviceFilter),
    ]);
    const lastSuccessfulSnapshot = snapshotData.snapshots[0] ?? dashboardData.snapshot;
    if (nextAutoImportError && lastSuccessfulSnapshot) {
      nextAutoImportError.message = `Kobo could not be updated. The last successful import from ${formatDateTime(lastSuccessfulSnapshot.imported_at)} is still being shown.`;
    }
    publishDeviceStatus(deviceStatus);
    setDevices(deviceData.devices);
    publishDashboard(dashboardData);
    setSnapshots(snapshotData.snapshots);
    setBackups(backupData.backups);
    setAutoImportError(nextAutoImportError);
    setLatestSnapshotMatchesDevice(nextLatestSnapshotMatchesDevice);
  }

  async function loadSnapshot(snapshotId: string) {
    setBusyAction("snapshot");
    clearActionError("snapshot");
    setAutoImportError(null);
    try {
      const snapshotDevice = snapshots.find((snapshot) => snapshot.id === snapshotId)?.device_id ?? deviceFilter;
      const selectedDashboard = await getDashboard(snapshotId, snapshotDevice);
      selectedSnapshotId.current = snapshotId;
      setDeviceFilter(snapshotDevice);
      publishDashboard(selectedDashboard);
      setReadingDateFilter(null);
      selectView("dashboard");
    } catch (err) {
      reportActionError("snapshot", err, "Could not open this snapshot.");
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    refresh().catch(reportRefreshError);
    const id = window.setInterval(() => {
      refreshDeviceStatus().catch(reportRefreshError);
    }, deviceStatusPollMs);
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
    setBusyAction("import");
    clearActionError("import");
    setAutoImportError(null);
    try {
      const assignment = assignmentFromSelection(importDevice, importDeviceLabel);
      if (assignment?.new_device_label === "") throw new Error("Enter a device name before importing.");
      const result = await importFromKobo(assignment);
      selectedSnapshotId.current = null;
      publishDashboard(result.dashboard);
      setReadingDateFilter(null);
      selectView("dashboard");
      await refresh();
      toast.success("Imported from Kobo");
    } catch (err) {
      reportActionError("import", err, "Kobo could not be imported. You can retry or upload the database instead.");
    } finally {
      setBusyAction(null);
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
    setBusyAction("upload");
    clearActionError("upload");
    setAutoImportError(null);
    try {
      const assignment = pendingUploadAssignment.current ?? assignmentFromSelection(importDevice, importDeviceLabel);
      if (!assignment) throw new Error("Choose a device or enter a device name before uploading.");
      if (assignment?.new_device_label === "") throw new Error("Enter a device name before uploading.");
      const result = await uploadDatabase(file, assignment);
      selectedSnapshotId.current = null;
      publishDashboard(result.dashboard);
      setReadingDateFilter(null);
      selectView("dashboard");
      await refresh();
      setUploadDialogOpen(false);
      toast.success("Database uploaded");
    } catch (err) {
      reportActionError("upload", err, "The database could not be uploaded. Check the file and try again.");
    } finally {
      setBusyAction(null);
      pendingUploadAssignment.current = undefined;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleBackup() {
    setBusyAction("backup");
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
      setBusyAction(null);
    }
  }

  async function handleRestore(backupId: string, extensions: boolean) {
    setBusyAction("restore");
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
      setBusyAction(null);
    }
  }

  async function handleDeviceFilterChange(nextDeviceId: DeviceFilter) {
    setDeviceFilter(nextDeviceId);
    selectedSnapshotId.current = null;
    setReadingDateFilter(null);
  }

  async function handleRenameDevice(deviceId: string, label: string) {
    clearActionError("rename");
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
      publishDashboard(dashboardData);
      setSnapshots(snapshotData.snapshots);
      setBackups(backupData.backups);
      toast.success("Device label saved");
    } catch (err) {
      reportActionError("rename", err, "The device label could not be saved.");
    }
  }

  async function handleReassignSnapshot(snapshotId: string, targetDeviceId: string) {
    setBusyAction("snapshot");
    clearActionError("snapshot");
    try {
      const result = await reassignSnapshot(snapshotId, { device_id: targetDeviceId });
      setSnapshots((current) => current.map((snapshot) => (snapshot.id === snapshotId ? result.snapshot : snapshot)));
      if (dashboard.snapshot?.id === snapshotId) {
        setDeviceFilter(result.snapshot.device_id ?? "all");
        publishDashboard(await getDashboard(snapshotId, result.snapshot.device_id ?? "all"));
      }
      const deviceData = await getDevices();
      setDevices(deviceData.devices);
      toast.success("Snapshot reassigned");
    } catch (err) {
      reportActionError("snapshot", err, "The snapshot could not be reassigned.");
    } finally {
      setBusyAction(null);
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
    { id: "dashboard", label: "Overview", icon: Home },
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
          <header aria-label="Page toolbar" className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <span className="font-medium">{navItems.find((item) => item.id === activeView)?.label}</span>
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
              busyAction={busyAction}
              deviceFilter={deviceFilter}
              onDeviceFilterChange={handleDeviceFilterChange}
              latestSnapshotMatchesDevice={latestSnapshotMatchesDevice}
              compact
            />
          </header>
          <div className={cn("grid gap-4 p-4 md:p-6", activeView === "dashboard" && "overview-page gap-3 md:p-5")}>
            {activeView === "settings" ? (
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
                busyAction={busyAction}
                latestSnapshotMatchesDevice={latestSnapshotMatchesDevice}
              />
            ) : null}
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
                {actionErrors.upload ? (
                  <WarningAlert title="Upload failed" {...actionErrors.upload} />
                ) : null}
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

            {criticalError ? (
              <ErrorAlert title="Dashboard unavailable">
                <div>{criticalError.message}</div>
                <Button className="mt-2" size="sm" variant="outline" onClick={() => refresh().catch(reportRefreshError)}>Try again</Button>
                {criticalError.details ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-medium">Technical details</summary>
                    <code className="mt-1 block whitespace-pre-wrap break-words text-xs">{criticalError.details}</code>
                  </details>
                ) : null}
              </ErrorAlert>
            ) : null}
            {refreshError ? (
              <WarningAlert title="Showing existing data" {...refreshError}>
                <Button size="sm" variant="outline" onClick={() => refresh().catch(reportRefreshError)}>Retry refresh</Button>
              </WarningAlert>
            ) : null}
            {autoImportError ? (
              <WarningAlert title="Kobo update failed" {...autoImportError}>
                <Button size="sm" variant="outline" onClick={handleImport}>Retry Kobo import</Button>
                <Button size="sm" variant="outline" onClick={handleUploadRequest}>Upload DB</Button>
              </WarningAlert>
            ) : null}
            {actionErrors.import ? (
              <WarningAlert title="Import failed" {...actionErrors.import}>
                <Button size="sm" variant="outline" onClick={handleImport}>Try again</Button>
                <Button size="sm" variant="outline" onClick={handleUploadRequest}>Upload DB</Button>
              </WarningAlert>
            ) : null}
            {actionErrors.upload && !uploadDialogOpen ? (
              <WarningAlert title="Upload failed" {...actionErrors.upload}>
                <Button size="sm" variant="outline" onClick={handleUploadRequest}>Choose another database</Button>
              </WarningAlert>
            ) : null}
            {device?.permission_error ? (
              <WarningAlert
                title="Kobo access is blocked"
                message="kostats cannot read the Kobo database. Grant access to the Kobo volume or upload the database manually."
                details={device.permission_error}
              >
                <Button size="sm" variant="outline" onClick={() => refreshDeviceStatus().catch(reportRefreshError)}>Check access again</Button>
                <Button size="sm" variant="outline" onClick={handleUploadRequest}>Upload DB</Button>
              </WarningAlert>
            ) : null}

            {activeView === "dashboard" ? <MemoizedDashboardView dashboard={dashboard} /> : null}
            {activeView === "snapshots" ? (
              <SnapshotsView
                snapshots={snapshots}
                devices={devices}
                activeSnapshotId={activeSnapshot?.id ?? null}
                onSelectSnapshot={loadSnapshot}
                onReassignSnapshot={handleReassignSnapshot}
                actionError={actionErrors.snapshot}
              />
            ) : null}
            {activeView === "backups" ? (
              <BackupsView
                backups={backups}
                device={device}
                busy={busy}
                busyAction={busyAction}
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
                onRefresh={() => refresh().catch(reportRefreshError)}
                onRenameDevice={handleRenameDevice}
                renameError={actionErrors.rename}
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
