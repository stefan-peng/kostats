import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
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
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
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
  getDeviceStatus,
  getRestorePreview,
  getSnapshots,
  importFromKobo,
  restoreBackup,
  uploadDatabase,
} from "./api";
import type {
  BookStats,
  Dashboard,
  DeviceStatus,
  RecoveryBackup,
  RestorePreview,
  RestoreResult,
  Snapshot,
} from "./types";

type View = "dashboard" | "snapshots" | "backups" | "books" | "calendar" | "export" | "settings";
type BookSortKey = "last_open" | "time_seconds" | "pages" | "progress" | "title";
type BookProgressFilter = "all" | "reading" | "finished" | "abandoned" | "unknown";
type NavItem = { id: View; label: string; icon: typeof Home };

const tableViewportSideInset = 16;
const tableViewportBottomInset = 37;
const tableMinimumHeight = 240;
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
    color: "var(--chart-2)",
  },
  hours: {
    label: "Reading time",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

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

function compareNullableNumbers(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a - b;
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
  activeSnapshot,
  latestSnapshot,
  onImport,
  onUploadClick,
  busy,
}: {
  status: DeviceStatus | null;
  activeSnapshot: Snapshot | null;
  latestSnapshot: Snapshot | null;
  onImport: () => void;
  onUploadClick: () => void;
  busy: boolean;
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

  return (
    <Card aria-label="Device import status">
      <CardHeader className="items-start gap-3 md:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HardDrive />
          </div>
          <div className="min-w-0">
            <CardTitle>Kobo / KOReader</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Badge variant={stateVariant}>{stateLabel}</Badge>
            </CardDescription>
          </div>
        </div>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Button disabled={busy || !found} onClick={onImport}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {busy ? "Importing..." : "Import from Kobo"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onUploadClick}>
            <Upload data-icon="inline-start" />
            Upload DB
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotMeta label={activeSnapshot?.id === latestSnapshot?.id ? "Snapshot" : "Viewing"} snapshot={activeSnapshot} />
          {latestSnapshot && activeSnapshot?.id !== latestSnapshot.id ? (
            <SnapshotMeta label="Latest" snapshot={latestSnapshot} />
          ) : null}
          <SnapshotMeta label="Source" snapshot={activeSnapshot} source />
        </div>
      </CardContent>
    </Card>
  );
}

function SnapshotMeta({ label, snapshot, source = false }: { label: string; snapshot: Snapshot | null; source?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">
        {snapshot ? (source ? formatSnapshotSource(snapshot) : formatDateTime(snapshot.imported_at)) : "None"}
      </div>
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
              <Bar dataKey={valueKey} fill={`var(--color-${valueKey})`} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TopBooksChart({ data }: { data: Dashboard["charts"]["top_books"] }) {
  const chartData = data.map((item) => ({ ...item, label: item.title }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top books</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyPanel icon={<BookOpen />} title="No books yet" />
        ) : (
          <ChartContainer config={{ hours: { label: "Hours", color: "var(--chart-2)" } }} className="h-64 w-full">
            <BarChart accessibilityLayer data={chartData} layout="vertical" margin={{ left: 4, right: 24, top: 8 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                axisLine={false}
                width={110}
                tickFormatter={(value) => String(value).slice(0, 18)}
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
              <Bar dataKey="hours" fill="var(--color-hours)" radius={4} />
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
}: {
  ariaLabel: string;
  children: ReactNode;
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
    const content = contentRef.current;
    if (!content) return;

    const updateMaxHeight = () => {
      const documentTop = content.getBoundingClientRect().top + window.scrollY;
      const availableHeight =
        window.innerHeight - Math.max(documentTop, tableViewportSideInset) - tableViewportBottomInset;
      const viewportCap = Math.max(0, window.innerHeight - tableViewportSideInset - tableViewportBottomInset);
      setMaxHeight(Math.min(Math.max(tableMinimumHeight, availableHeight), viewportCap));
    };

    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);

    return () => {
      window.removeEventListener("resize", updateMaxHeight);
    };
  }, []);

  return (
    <ScrollArea
      aria-label={ariaLabel}
      className="viewport-table rounded-b-xl"
      onKeyDown={handleKeyDown}
      ref={contentRef}
      role="region"
      style={maxHeight == null ? undefined : { maxHeight }}
      tabIndex={0}
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
        <ViewportTableScrollArea ariaLabel="Recent books table">
          <Table className="data-table recent-books-table">
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

function BooksView({ books }: { books: BookStats[] }) {
  const [query, setQuery] = useState("");
  const [progressFilter, setProgressFilter] = useState<BookProgressFilter>("all");
  const [sortKey, setSortKey] = useState<BookSortKey>("last_open");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const filteredBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const sorted = books
      .filter((book) => {
        const haystack = `${book.title} ${book.authors} ${book.series} ${book.language}`.toLocaleLowerCase();
        return (!normalizedQuery || haystack.includes(normalizedQuery)) && matchesProgressFilter(book, progressFilter);
      })
      .sort((a, b) => {
        let result = 0;
        if (sortKey === "title") {
          result = a.title.localeCompare(b.title);
        } else if (sortKey === "last_open") {
          result = (a.last_open ?? "").localeCompare(b.last_open ?? "");
        } else if (sortKey === "progress") {
          result = compareNullableNumbers(a.progress, b.progress);
        } else {
          result = a[sortKey] - b[sortKey];
        }
        if (result === 0) result = a.title.localeCompare(b.title);
        return sortDirection === "asc" ? result : -result;
      });
    return sorted;
  }, [books, progressFilter, query, sortDirection, sortKey]);

  const totalTimeSeconds = filteredBooks.reduce((total, book) => total + book.time_seconds, 0);
  const totalPages = filteredBooks.reduce((total, book) => total + book.pages, 0);
  const totalHighlights = filteredBooks.reduce((total, book) => total + book.highlight_count, 0);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Books</CardTitle>
          <CardDescription>
            {filteredBooks.length.toLocaleString()} of {books.length.toLocaleString()} books
          </CardDescription>
        </div>
        <CardAction className="hidden flex-wrap justify-end gap-2 text-sm text-muted-foreground md:flex" aria-label="Filtered book summary">
          <Badge variant="outline">{formatDurationLabel(totalTimeSeconds)} total</Badge>
          <Badge variant="outline">{totalPages.toLocaleString()} pages seen</Badge>
          <Badge variant="outline">{totalHighlights.toLocaleString()} highlights</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FieldGroup className="md:grid-cols-[minmax(220px,1fr)_180px_180px_auto]" aria-label="Book table controls">
          <Field>
            <FieldLabel htmlFor="book-search">Search</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="book-search"
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Title or author"
                type="search"
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="book-status">Status</FieldLabel>
            <Select value={progressFilter} onValueChange={(value) => setProgressFilter(value as BookProgressFilter)}>
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
          <Field>
            <FieldLabel htmlFor="book-sort">Sort</FieldLabel>
            <Select value={sortKey} onValueChange={(value) => setSortKey(value as BookSortKey)}>
              <SelectTrigger id="book-sort" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="last_open">Last opened</SelectItem>
                  <SelectItem value="time_seconds">Reading time</SelectItem>
                  <SelectItem value="pages">Pages seen</SelectItem>
                  <SelectItem value="progress">Progress</SelectItem>
                  <SelectItem value="title">Title</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button
            className="self-end"
            variant="outline"
            onClick={() => setSortDirection((value) => (value === "asc" ? "desc" : "asc"))}
            type="button"
          >
            {sortDirection === "asc" ? "Ascending" : "Descending"}
          </Button>
        </FieldGroup>
      </CardContent>
      <CardContent className="px-0 pb-0">
        <ViewportTableScrollArea ariaLabel="Books table">
          <Table className="data-table books-table">
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Pages seen</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Highlights</TableHead>
                <TableHead>Last opened</TableHead>
                <TableHead>Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBooks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                    No books match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredBooks.map((book) => (
                  <TableRow key={book.id}>
                    <TableCell className="font-medium" title={book.title}>{book.title}</TableCell>
                    <TableCell title={book.authors}>{book.authors}</TableCell>
                    <TableCell>{book.time_label}</TableCell>
                    <TableCell>{book.pages.toLocaleString()}</TableCell>
                    <TableCell>{formatPageProgress(book)}</TableCell>
                    <TableCell><Badge variant={statusBadgeVariant(book)}>{formatStatus(book)}</Badge></TableCell>
                    <TableCell>
                      <div className="flex min-w-32 items-center gap-2">
                        <Progress value={book.progress ?? 0} />
                        <span className="w-12 text-xs text-muted-foreground">{formatProgress(book)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{book.highlight_count.toLocaleString()}</TableCell>
                    <TableCell title={formatDateTime(book.last_open)}>{formatDateTime(book.last_open)}</TableCell>
                    <TableCell title={`Book IDs: ${book.source_book_ids.join(", ")}`}>
                      {formatSourceRecords(book)}
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
        <ReadingBarChart
          title="Daily reading"
          data={dashboard.charts.daily}
          valueKey="minutes"
          formatValue={(minutes) => formatDurationLabel(minutes * 60)}
        />
        <ReadingBarChart
          title="Monthly reading"
          data={dashboard.charts.monthly}
          valueKey="hours"
          formatValue={(hours) => formatDurationLabel(hours * 3600)}
        />
        <TopBooksChart data={dashboard.charts.top_books} />
      </section>

      <RecentBooks books={dashboard.recent_books} />
    </>
  );
}

function SnapshotsView({
  snapshots,
  activeSnapshotId,
  onSelectSnapshot,
}: {
  snapshots: Snapshot[];
  activeSnapshotId: string | null;
  onSelectSnapshot: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Snapshots</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <ViewportTableScrollArea ariaLabel="Snapshots table">
          <Table className="data-table snapshots-table">
            <TableHeader>
              <TableRow>
                <TableHead>Imported</TableHead>
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
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No snapshots have been imported yet.
                  </TableCell>
                </TableRow>
              ) : (
                snapshots.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell title={formatDateTime(snapshot.imported_at)}>{formatDateTime(snapshot.imported_at)}</TableCell>
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
                      {backup.koreader_version ?? "Unknown KOReader version"} / {backup.device_model ?? "Unknown device"} / {formatBytes(backup.archive_size)}
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

function CalendarView({ calendar }: { calendar: Dashboard["charts"]["calendar"] }) {
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
                    ? `${label}: ${day.time_label} read, intensity ${day.level} of 4`
                    : `${label}: no reading`;
                  return (
                    <Tooltip key={cell.date}>
                      <TooltipTrigger asChild>
                        <span
                          role="gridcell"
                          aria-label={cellLabel}
                          tabIndex={-1}
                          className={cn("calendar-day", `level-${day?.level ?? 0}`)}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="grid gap-1">
                          <span>{label}</span>
                          <strong>{day ? `${day.time_label} read` : "No reading"}</strong>
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
  snapshots,
  onRefresh,
}: {
  device: DeviceStatus | null;
  snapshots: Snapshot[];
  onRefresh: () => void;
}) {
  const candidateDiagnostics = (device?.candidates ?? []).filter(
    (candidate) => candidate.error || (candidate.exists && !candidate.readable),
  );

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
          <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
            <div className="text-xs font-medium text-muted-foreground">Kobo mount path</div>
            <div className="mt-1 truncate font-medium">{device?.mount_path ?? "Auto-detect"}</div>
          </div>
          <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
            <div className="text-xs font-medium text-muted-foreground">Local snapshots</div>
            <div className="mt-1 truncate font-medium">{snapshots.length}</div>
          </div>
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
        return (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              isActive={activeView === item.id}
              onClick={() => {
                onSelect(item.id);
                setOpenMobile(false);
              }}
              tooltip={item.label}
            >
              <Icon />
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export default function App() {
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [backups, setBackups] = useState<RecoveryBackup[]>([]);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [autoImportError, setAutoImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedSnapshotId = useRef<string | null>(null);

  async function refresh() {
    let deviceStatus = await getDeviceStatus();
    let nextAutoImportError: string | null = null;
    if (deviceStatus.mounted && deviceStatus.database_found && !deviceStatus.permission_error) {
      try {
        const autoResult = await autoImportFromKobo();
        deviceStatus = autoResult.device;
      } catch (err) {
        nextAutoImportError = `Auto-import failed: ${err instanceof Error ? err.message : "Could not import from Kobo"}`;
      }
    }
    const dashboardSnapshotId = selectedSnapshotId.current ?? "latest";
    const [dashboardData, snapshotData, backupData] = await Promise.all([
      getDashboard(dashboardSnapshotId),
      getSnapshots(),
      getBackups().catch(() => null),
    ]);
    setDevice(deviceStatus);
    setDashboard(dashboardData);
    setSnapshots(snapshotData.snapshots);
    if (backupData && Array.isArray(backupData.backups)) {
      setBackups(backupData.backups);
    }
    setAutoImportError(nextAutoImportError);
  }

  async function loadSnapshot(snapshotId: string) {
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const selectedDashboard = await getDashboard(snapshotId);
      selectedSnapshotId.current = snapshotId;
      setDashboard(selectedDashboard);
      setActiveView("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load snapshot");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
    const id = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  async function handleImport() {
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const result = await importFromKobo();
      selectedSnapshotId.current = null;
      setDashboard(result.dashboard);
      setActiveView("dashboard");
      await refresh();
      toast.success("Imported from Kobo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setAutoImportError(null);
    try {
      const result = await uploadDatabase(file);
      selectedSnapshotId.current = null;
      setDashboard(result.dashboard);
      setActiveView("dashboard");
      await refresh();
      toast.success("Database uploaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
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
      getBackups()
        .then((backupData) => setBackups(backupData.backups))
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
      getBackups()
        .then((backupData) => setBackups(backupData.backups))
        .catch(() => undefined);
      return result;
    } finally {
      setBusy(false);
    }
  }

  const latestSnapshot = snapshots[0] ?? dashboard.snapshot ?? null;
  const activeSnapshot = dashboard.snapshot ?? latestSnapshot;
  const navItems: NavItem[] = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "snapshots", label: "Snapshots", icon: Database },
    { id: "backups", label: "Backups", icon: ArchiveRestore },
    { id: "books", label: "Books", icon: Library },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "export", label: "Export", icon: FileUp },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <SidebarProvider>
        <Sidebar collapsible="offcanvas">
          <SidebarHeader>
            <div className="px-2 py-1">
              <div className="font-heading text-lg font-semibold">kostats</div>
              <div className="text-xs text-muted-foreground">KOReader statistics</div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <AppSidebarNav items={navItems} activeView={activeView} onSelect={setActiveView} />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <Separator />
            <div className="grid gap-2 p-2 text-xs text-muted-foreground">
              <Badge variant="outline">{snapshots.length} snapshots</Badge>
              <Badge variant="outline">{backups.length} recovery backups</Badge>
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:hidden">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="font-medium">kostats</span>
          </header>
          <main className="grid gap-4 p-4 md:p-6">
            <DeviceBanner
              status={device}
              activeSnapshot={activeSnapshot}
              latestSnapshot={latestSnapshot}
              onImport={handleImport}
              onUploadClick={() => fileInput.current?.click()}
              busy={busy}
            />
            <input
              ref={fileInput}
              type="file"
              accept=".sqlite,.sqlite3,.db,application/vnd.sqlite3,application/octet-stream"
              hidden
              onChange={(event) => handleUpload(event.target.files?.[0])}
            />

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
                activeSnapshotId={activeSnapshot?.id ?? null}
                onSelectSnapshot={loadSnapshot}
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
            {activeView === "books" ? <BooksView books={dashboard.books} /> : null}
            {activeView === "calendar" ? <CalendarView calendar={dashboard.charts.calendar} /> : null}
            {activeView === "export" ? <ExportView dashboard={dashboard} /> : null}
            {activeView === "settings" ? (
              <SettingsView device={device} snapshots={snapshots} onRefresh={() => refresh().catch((err: Error) => setError(err.message))} />
            ) : null}
          </main>
        </SidebarInset>
        <Toaster />
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
