# kostats

Local KOReader reading statistics dashboard for Kobo devices.

`kostats` copies KOReader's `settings/statistics.sqlite3` database and normalized `.sdr` book metadata from a mounted Kobo into local timestamped snapshots, then reads only the local snapshots for dashboard views.

Recovery backups are separate immutable ZIP archives. They preserve KOReader settings, statistics, vocabulary, dictionaries, sidecars, and optional extensions without copying EPUB, PDF, or other book payloads. Restoring a recovery backup modifies the mounted Kobo only after an explicit preview and confirmation, and first creates a safety backup of the device's current state.

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

Open `http://127.0.0.1:5173`.

The development command runs the Vite frontend and reload-enabled FastAPI backend together.

## Production

```bash
uv sync
npm install --prefix frontend
uv run prod
```

The production command builds the frontend, then serves the compiled UI and API from a single
non-reloading server. Open `http://127.0.0.1:8000`.

The app works when the Kobo is not connected. On startup and while open, it looks for a mounted Kobo, imports a new local snapshot only when the KOReader database has changed, and continues showing the latest local snapshot if no device is present. macOS/Linux defaults to `/Volumes/KOBOeReader`; Windows scans mounted drive letters such as `E:\` for a Kobo volume or KOReader statistics database.

Set `KOSTATS_KOBO_VOLUME` to override auto-detection, for example `KOSTATS_KOBO_VOLUME=E:\` on Windows or `KOSTATS_KOBO_VOLUME=/Volumes/KOBOeReader` on macOS.

## Tests

```bash
uv run pytest
npm test --prefix frontend
```

## Local data

Imported database and sidecar metadata snapshots are stored under `data/snapshots/`, with metadata in `data/manifest.json`. Recovery archives are stored under `data/backups/` with restrictive local permissions. Archives may contain credentials from KOReader integrations. The entire `data/` directory is ignored by Git.
