from __future__ import annotations

import logging
import os

from .diagnostics import PersistentHandler

from rich.console import Console
from rich.logging import RichHandler


DEFAULT_LOG_LEVEL = "INFO"


class PollingAccessFilter(logging.Filter):
    """Keep successful background checks out of INFO access output."""

    def filter(self, entry: logging.LogRecord) -> bool:
        if (
            entry.name == "uvicorn.access"
            and entry.levelno == logging.INFO
            and isinstance(entry.args, tuple)
            and len(entry.args) == 5
        ):
            _, method, target, _, status = entry.args
            path = target.partition("?")[0]
            if (method, path) in {
                ("GET", "/api/device/status"),
                ("POST", "/api/import/kobo/auto"),
            } and 200 <= status < 300:
                entry.levelno = logging.DEBUG
                entry.levelname = "DEBUG"
                return entry.levelno >= logging.getLevelNamesMapping()[log_level()]
        return True


def log_level() -> str:
    value = os.environ.get("KOSTATS_LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    return value if value in logging.getLevelNamesMapping() else DEFAULT_LOG_LEVEL


def watcher_log_level() -> str:
    # Raw filesystem event counts are useful only when debugging the watcher.
    level = log_level()
    return "WARNING" if logging.getLevelNamesMapping()[level] == logging.INFO else level


def make_rich_handler(*, show_time: bool | None = None) -> RichHandler:
    if show_time is None:
        show_time = os.environ.get("KOSTATS_MANAGED_PROCESS") != "1"
    return RichHandler(
        console=Console(stderr=True),
        markup=False,
        rich_tracebacks=True,
        show_path=False,
        show_time=show_time,
    )


def configure_logging(*, show_time: bool = True) -> None:
    """Configure application and Uvicorn logs with one terminal-friendly handler."""
    handler = make_rich_handler(show_time=show_time)
    logging.basicConfig(
        datefmt="[%X]",
        format="%(message)s",
        handlers=[handler, PersistentHandler()],
        level=log_level(),
        force=True,
    )

    # Keep any Uvicorn loggers created before programmatic startup on the same
    # Rich handler. uvicorn_log_config() also applies this inside reload workers.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True

    access = logging.getLogger("uvicorn.access")
    access.filters = [item for item in access.filters if not isinstance(item, PollingAccessFilter)]
    access.addFilter(PollingAccessFilter())
    logging.getLogger("watchfiles").setLevel(watcher_log_level())
    logging.captureWarnings(True)


def uvicorn_log_config() -> dict[str, object]:
    """Return a multiprocessing-safe Uvicorn configuration using Rich."""
    level = log_level()
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {"polling": {"()": "backend.app.logging.PollingAccessFilter"}},
        "handlers": {
            "persistent": {"()": "backend.app.diagnostics.PersistentHandler"},
            "rich": {
                "()": "backend.app.logging.make_rich_handler",
            },
        },
        "loggers": {
            "watchfiles": {"level": watcher_log_level()},
            "uvicorn": {"handlers": ["rich", "persistent"], "level": level, "propagate": False},
            "uvicorn.error": {"level": level},
            "uvicorn.access": {"handlers": ["rich", "persistent"], "filters": ["polling"], "level": level, "propagate": False},
        },
        "root": {"handlers": ["rich", "persistent"], "level": level},
    }
