"""Private, bounded local diagnostics; never mounted or returned by the API."""
from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import sys
import threading
import time
import uuid
from contextlib import closing
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

from starlette.concurrency import run_in_threadpool

from .config import data_dir

MAX_RECORDS = 20_000
RETENTION_SECONDS = 30 * 86400
RUN_ID = uuid.uuid4().hex
_creation_lock = threading.Lock()
_last_warning = float('-inf')


def database_path() -> Path:
    return data_dir() / 'diagnostics' / 'events.sqlite3'


def record(kind: str, name: str, **fields: object) -> None:
    """Best effort writes with bounded payloads and no recursive logging."""
    global _last_warning
    try:
        path = database_path()
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Closing a non-SQLite descriptor for an existing database releases
        # other connections' process-wide POSIX locks. Only open a new file,
        # and serialize creation so no thread races the initial close.
        with _creation_lock:
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
        payload = json.dumps(fields, default=str, ensure_ascii=True)
        if len(payload) > 8192:
            payload = json.dumps({'truncated': True, 'original_bytes': len(payload)})
        with closing(sqlite3.connect(path, timeout=0.1)) as connection, connection:
            connection.execute('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, timestamp REAL NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, fields TEXT NOT NULL)')
            connection.execute('CREATE INDEX IF NOT EXISTS events_timestamp ON events(timestamp)')
            now = time.time()
            connection.execute('INSERT INTO events(timestamp,run_id,kind,name,fields) VALUES (?,?,?,?,?)', (now, RUN_ID, kind, name, payload))
            connection.execute('DELETE FROM events WHERE id <= (SELECT MAX(id) - ? FROM events)', (MAX_RECORDS,))
            connection.execute('DELETE FROM events WHERE timestamp < ?', (now - RETENTION_SECONDS,))
    except (OSError, sqlite3.Error, ValueError) as exc:
        now = time.monotonic()
        if now - _last_warning >= 60:
            _last_warning = now
            code = getattr(exc, 'sqlite_errorname', None)
            detail = f' ({code})' if code else ''
            print(f'kostats diagnostics unavailable: {type(exc).__name__}{detail}', file=sys.stderr)


class PersistentHandler(logging.Handler):
    def emit(self, entry: logging.LogRecord) -> None:
        if entry.name == 'uvicorn.access':
            return  # Request metrics omit raw URLs and client addresses.
        fields = {'level': entry.levelname, 'message': entry.getMessage()[:4000]}
        if entry.exc_info:
            # Frames locate defects without persisting locals or exception values.
            tb = entry.exc_info[2]
            frames = []
            while tb is not None:
                frames.append({'file': Path(tb.tb_frame.f_code.co_filename).name, 'function': tb.tb_frame.f_code.co_name, 'line': tb.tb_lineno})
                tb = tb.tb_next
            fields['exception_type'] = entry.exc_info[0].__name__
            fields['frames'] = frames
        record('log', entry.name, **fields)


def observed(name: str):
    """Measure synchronous core operations, including callers outside HTTP."""
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            start = time.perf_counter()
            fields = {}
            try:
                result = function(*args, **kwargs)
                fields['outcome'] = 'success'
                if isinstance(result, dict):
                    for key in ('imported', 'reason'):
                        if key in result:
                            fields[key] = result[key]
                    if isinstance(result.get('books'), list):
                        books = result['books']
                        fields['book_count'] = len(books)
                        summary = result.get('summary', {})
                        known = sum(summary.get(key, 0) for key in ('finished_books', 'reading_books', 'unread_books', 'abandoned_books'))
                        fields['unknown_status_count'] = max(0, len(books) - known)
                return result
            except BaseException as exc:
                fields.update(outcome='error', exception_type=type(exc).__name__)
                raise
            finally:
                record('operation', name, duration_ms=round((time.perf_counter() - start) * 1000, 3), **fields)
        return wrapped
    return decorate


class RequestDiagnostics:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        start = time.perf_counter()
        status = 500
        error = None

        async def tracked_send(message):
            nonlocal status
            if message['type'] == 'http.response.start':
                status = message['status']
            await send(message)

        try:
            await self.app(scope, receive, tracked_send)
        except BaseException as exc:
            error = type(exc).__name__
            raise
        finally:
            route = scope.get('route')
            duration_ms = round((time.perf_counter() - start) * 1000, 3)
            await run_in_threadpool(record, 'request', getattr(route, 'path', 'unmatched'), method=scope['method'], status=status, exception_type=error, duration_ms=duration_ms)


def main() -> int:
    """Read-only agent summary, invoked with python -m backend.app.diagnostics."""
    path = database_path()
    if not path.exists():
        print(json.dumps({'records': 0, 'groups': []}))
        return 0
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
        rows = connection.execute('SELECT timestamp, kind, name, fields FROM events ORDER BY id').fetchall()
    groups = {}
    for timestamp, kind, name, payload in rows:
        fields = json.loads(payload)
        key = (kind, name, fields.get('status', fields.get('outcome', fields.get('level'))))
        group = groups.setdefault(key, {'kind': kind, 'name': name, 'result': key[2], 'count': 0, 'durations': []})
        group['count'] += 1
        if 'duration_ms' in fields:
            group['durations'].append(fields['duration_ms'])
    for group in groups.values():
        durations = sorted(group.pop('durations'))
        if durations:
            group.update(mean_ms=round(sum(durations) / len(durations), 3), p95_ms=durations[math.ceil(len(durations) * .95) - 1], max_ms=max(durations))
    print(json.dumps({'records': len(rows), 'oldest_utc': datetime.fromtimestamp(rows[0][0], timezone.utc).isoformat() if rows else None, 'groups': list(groups.values())}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
