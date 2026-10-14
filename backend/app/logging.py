from __future__ import annotations

import logging
import os

from .diagnostics import PersistentHandler

from rich.console import Console
from rich.logging import RichHandler


DEFAULT_LOG_LEVEL = "INFO"


def log_level() -> str:
    value = os.environ.get("KOSTATS_LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    return value if value in logging.getLevelNamesMapping() else DEFAULT_LOG_LEVEL


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

    logging.captureWarnings(True)


def uvicorn_log_config() -> dict[str, object]:
    """Return a multiprocessing-safe Uvicorn configuration using Rich."""
    level = log_level()
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "handlers": {
            "persistent": {"()": "backend.app.diagnostics.PersistentHandler"},
            "rich": {
                "()": "backend.app.logging.make_rich_handler",
            },
        },
        "loggers": {
            "uvicorn": {"handlers": ["rich", "persistent"], "level": level, "propagate": False},
            "uvicorn.error": {"level": level},
            "uvicorn.access": {"handlers": ["rich", "persistent"], "level": level, "propagate": False},
        },
        "root": {"handlers": ["rich", "persistent"], "level": level},
    }
