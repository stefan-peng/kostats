from __future__ import annotations

import logging
import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .logging import configure_logging, uvicorn_log_config
from .main import app


DIST = Path(os.environ.get("KOSTATS_FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
logger = logging.getLogger(__name__)


def configure_static_files(target: FastAPI, dist: Path = DIST) -> None:
    if not (dist / "index.html").is_file():
        raise FileNotFoundError(f"Frontend build output is missing: {dist / 'index.html'}. Run: uv run build-frontend")
    target.mount("/", StaticFiles(directory=dist, html=True), name="frontend")


def main() -> int:
    configure_logging()
    try:
        configure_static_files(app, DIST)
    except FileNotFoundError as exc:
        logger.error("%s", exc)
        return 1
    logger.info("Serving kostats at http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False, log_config=uvicorn_log_config())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
