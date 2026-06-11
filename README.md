# kostats

Local KOReader reading statistics dashboard for Kobo devices.

`kostats` copies KOReader's `settings/statistics.sqlite3` database and normalized `.sdr` book metadata from a mounted Kobo into local timestamped snapshots, then reads only the local snapshots for dashboard views. The Kobo is never modified.

## Run locally

```bash
uv sync
npm install --prefix frontend
uv run uvicorn backend.app.main:app --reload
npm run dev --prefix frontend
```

Open the Vite URL shown by npm, usually `http://127.0.0.1:5173`.

The app works when the Kobo is not connected. On startup and while open, it looks for a mounted Kobo, imports a new local snapshot only when the KOReader database has changed, and continues showing the latest local snapshot if no device is present. macOS/Linux defaults to `/Volumes/KOBOeReader`; Windows scans mounted drive letters such as `E:\` for a Kobo volume or KOReader statistics database.

Set `KOSTATS_KOBO_VOLUME` to override auto-detection, for example `KOSTATS_KOBO_VOLUME=E:\` on Windows or `KOSTATS_KOBO_VOLUME=/Volumes/KOBOeReader` on macOS.

## Tests

```bash
uv run pytest
npm test --prefix frontend
```

## Local data

Imported database and sidecar metadata snapshots are stored under `data/snapshots/`, with metadata in `data/manifest.json`. The entire `data/` directory is ignored by Git.
