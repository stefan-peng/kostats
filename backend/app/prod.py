from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .dev import FRONTEND, ROOT
from .logging import configure_logging, uvicorn_log_config
from .main import app


DIST = FRONTEND / "dist"
logger = logging.getLogger(__name__)


def configure_static_files(target: FastAPI, dist: Path = DIST) -> None:
    if not (dist / "index.html").is_file():
        raise FileNotFoundError(f"Frontend build output is missing: {dist / 'index.html'}")
    target.mount("/", StaticFiles(directory=dist, html=True), name="frontend")


def build_frontend() -> int:
    npm = shutil.which("npm")
    if npm is None:
        logger.error("npm is required to build the frontend.")
        return 1
    if not (FRONTEND / "node_modules").is_dir():
        logger.error("Frontend dependencies are missing. Run: npm install --prefix frontend")
        return 1

    logger.info("Building the frontend")
    try:
        result = subprocess.run(
            [npm, "run", "build", "--prefix", "frontend"],
            cwd=ROOT,
            check=False,
        )
    except OSError as exc:
        logger.error("Unable to start the frontend build: %s", exc)
        return 1
    if result.returncode != 0:
        logger.error("Frontend build failed with exit code %s.", result.returncode)
        return result.returncode or 1
    if not (DIST / "index.html").is_file():
        logger.error("Frontend build did not create %s.", DIST / "index.html")
        return 1
    logger.info("Frontend build complete")
    return 0


def main() -> int:
    configure_logging()
    exit_code = build_frontend()
    if exit_code != 0:
        return exit_code
    configure_static_files(app)
    logger.info("Serving kostats at http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False, log_config=uvicorn_log_config())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
