# kostats

Local KOReader reading statistics dashboard for Kobo devices.

`kostats` copies KOReader's `settings/statistics.sqlite3` database and normalized `.sdr` book metadata from a mounted Kobo into local timestamped snapshots, then reads only the local snapshots for dashboard views.

Device snapshots also inventory supported book files outside hidden/system directories, without copying their contents. The Books view includes inventory-only, metadata-only, and statistics-only books. **Unread** means a scanned file has no known opening or reading evidence; missing or unreadable metadata remains **Unknown**. Zero reading time or 0% progress alone does not mean unread. Reading evidence from another device takes precedence over an unopened copy.

EPUB titles and authors come from embedded metadata; other formats use filenames when no KOReader metadata exists. Inventory changes trigger a new snapshot. Reading time, sessions, calendar activity, and recent/top books remain based on recorded activity. Existing snapshots and database-only uploads cannot discover never-opened files; connect and import the device to populate unread books.

EPUB metadata reads reject DTDs/entities and archive paths that escape the ZIP.
Container XML is limited to 1 MiB and package XML to 4 MiB, with at most 64 levels
and 50,000 elements. Lua sidecars are read as data only: quoted strings, decimal
numbers, booleans, nil, tables, and line comments. Source files are limited to
8 MiB, 250,000 tokens, and 64 nested tables. Invalid metadata is ignored for the
affected book.

Recovery backups use format v2 by default. They preserve KOReader settings, statistics, vocabulary, dictionaries, sidecars, and optional extensions without copying EPUB, PDF, or other book payloads. Format v2 stores dictionary payloads in the local content-addressed store alongside the ZIP archives, so the `data/` directory must stay together. Existing format v1 backups, which store dictionaries inside each ZIP, remain restorable. Restoring a recovery backup modifies the mounted Kobo only after an explicit preview and confirmation, and first creates a safety backup of the device's current state.

The theme defaults to **Auto**, following the browser's reported light/dark preference, including changes while the page is open. Choose **Auto**, **Light**, or **Dark** in **Settings → Appearance**; the choice is saved in that browser. Firefox's website appearance setting can override the desktop theme.

## Development

```bash
uv sync
npm install --prefix frontend
uv run dev
```

For a bounded startup smoke check that tears both servers down automatically:

```bash
uv run dev --smoke-seconds 15
```

Use `--frontend-port` or `--backend-port` when the default ports are occupied.

Open `http://127.0.0.1:5173`.

The development command runs the Vite frontend and reload-enabled FastAPI backend together.
Logs use Rich formatting when attached to a terminal. Set `KOSTATS_LOG_LEVEL` to a standard
Python logging level such as `DEBUG` or `WARNING` to adjust verbosity.

## Production

```bash
uv sync
npm ci --include=dev --prefix frontend
uv run build-frontend
uv run prod
```

`build-frontend` builds the UI; `prod` only serves the prebuilt UI and API from a single
non-reloading server at `http://127.0.0.1:8000`. Rebuild after frontend changes.

For a serving-only deployment, copy `frontend/dist/` from the build machine and run
`uv sync --no-dev` followed by `uv run --no-dev prod`. Node, npm, and `node_modules` are
not needed on the serving machine. Set `KOSTATS_FRONTEND_DIR` to serve assets from a
different directory. Frontend builds must include npm dev dependencies.

Keep the server on loopback. Requests must use `localhost`, `127.0.0.1`, or
`[::1]`; browser writes require the server's own origin or an allowed frontend
origin. Development allows ports at `http://localhost:5173` and
`http://127.0.0.1:5173`; set `KOSTATS_FRONTEND_ORIGIN` when using another frontend
port. Database uploads are limited to 512 MiB, with 1 MiB of multipart overhead;
other request bodies are limited to 64 KiB. Limits apply while receiving data,
including requests without a Content-Length header.

Statistics databases are opened read-only with untrusted-schema mode. Each read
connection has a 10-second / 100-million SQLite instruction budget; dashboard
queries accept at most 500,000 catalog rows and 500,000 event rows. Imports that
exceed these bounds are rejected without recording a snapshot. Invalid event
timestamps/durations are skipped, and page totals above 1,000,000 are treated as
unknown pagination.

The app works when the Kobo is not connected. On startup and while open, it checks a mounted Kobo every 15 seconds and imports a new local snapshot when the KOReader database or normalized book metadata has changed; it also refreshes changed EPUB cover art without creating an otherwise identical snapshot. The device status shows whether the connected Kobo matches the latest imported snapshot, and the app continues showing the latest local snapshot if no device is present. macOS uses `/Volumes/KOBOeReader`; Linux checks active mounts under `/media`, `/run/media`, and `/mnt`; Windows scans mounted drive letters such as `E:\` for a Kobo volume or KOReader statistics database.

Set `KOSTATS_KOBO_VOLUME` to override auto-detection, for example `KOSTATS_KOBO_VOLUME=E:\` on Windows, `KOSTATS_KOBO_VOLUME=/Volumes/KOBOeReader` on macOS, or `KOSTATS_KOBO_VOLUME=/media/$USER/KOBOeReader` on Linux.

## Tests

```bash
uv run pytest
npm test --prefix frontend
```

## Local data

Imported database and sidecar metadata snapshots are stored under `data/snapshots/`, with metadata in `data/manifest.json`. Recovery archives and v2 dictionary objects are stored under `data/backups/` with restrictive local permissions. Archives may contain credentials from KOReader integrations. The entire `data/` directory is ignored by Git.

Manifest updates use unique temporary files, flush contents before atomic
replacement, and serialize read/modify/write operations across threads and
processes. Device import, backup, and restore operations also share a process
lock within the same data directory. Keep all processes that access one device
on the same `KOSTATS_DATA_DIR`; different data directories do not share locks.
Restore still uses a safety backup rather than transactional rollback.

## Internal diagnostics for agents

The backend records private diagnostics in `data/diagnostics/events.sqlite3`
(or beneath `KOSTATS_DATA_DIR`). No diagnostics routes or UI controls exist, and
nothing is sent externally. Run `uv run python -m backend.app.diagnostics` for a
read-only JSON summary of operation outcomes, request status counts, and mean,
p95, and maximum timings. Agents can query the SQLite `events` table directly
for timestamps, process run IDs, log records, import reasons, and dashboard
book/unknown-status counts. Compare slow routes and recurring errors with the
corresponding operations before proposing fixes or features; route counts show
backend usage, not browser interactions or user intent.

Retention is the latest 20,000 records and 30 days, pruned on each write. Payloads
are capped at 8 KiB; SQLite reuses freed pages, so the database can retain its
high-water size. Each record includes a run ID to distinguish server restarts.
The directory and database are created with private permissions on POSIX.
Request records use route templates and exclude client addresses, query strings,
headers, bodies, and responses. Operation metrics exclude book titles, paths,
and device labels. Persistent application logs retain their existing messages;
exception frames exclude locals and exception values. Do not add credentials or
book metadata to log messages. Raw Uvicorn access logs remain console-only.
Diagnostic write failures produce a throttled stderr warning and do not fail
application operations. Writes are serialized within each process, and WAL mode
allows agent readers to run alongside writes. External write locks still have a
100 ms timeout. Metrics cover backend requests, imports, backup/restore
operations, and dashboard builds; frontend-only failures are not collected.

## Reading coverage and estimates

Session coverage measures the portion of a book represented by KOReader's recorded
page visits. Skipped pages do not count. Visits are mapped to fractions of the book,
so font and layout changes do not count the same text twice within a session.
Repeated visits within that session share coverage; rereading in a later session
contributes another pace sample. Sessions follow the existing 15-minute inactivity
gap, with separate active time and coverage for each book in a sitting.

Average pace is total active time from sessions with known coverage divided by their
summed percentage points covered. Remaining time applies that pace to the unread
fraction at the saved KOReader position, falling back to the latest recorded page.
A jump forward does not supply reading coverage. Missing page information preserves
recorded time but excludes that book-session from the pace estimate. KOReader has
already filtered quick visits and capped long visits before saving these events;
kostats does not apply a second guessed duration limit.

Pages covered are fractional equivalents in the book's latest known pagination.
Daily charts count distinct coverage per book and device on each day; monthly charts
sum those daily values. Pages seen in the library count distinct normalized pages
across the book's history. These counts can change after pagination changes and are
not printed-edition page numbers. Coverage percentages are shown only for individual
books, since percentages of different books cannot be added meaningfully.
