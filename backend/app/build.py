"""Build frontend assets explicitly; never imported by production startup."""
from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

from .logging import configure_logging

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
DIST = FRONTEND / "dist"
logger = logging.getLogger(__name__)


def build_frontend() -> int:
    npm = shutil.which("npm")
    if npm is None:
        logger.error("npm is required to build the frontend.")
        return 1
    if not (FRONTEND / "node_modules").is_dir():
        logger.error("Frontend dependencies are missing. Run: npm ci --include=dev --prefix frontend")
        return 1

    logger.info("Building the frontend")
    try:
        result = subprocess.run(
            [npm, "run", "build", "--prefix", "frontend"], cwd=ROOT, check=False,
        )
    except OSError as exc:
        logger.error("Unable to start the frontend build: %s", exc)
        return 1
    if result.returncode != 0:
        logger.error("Frontend build failed with exit code %s.", result.returncode)
        return result.returncode
    if not (DIST / "index.html").is_file():
        logger.error("Frontend build did not create %s.", DIST / "index.html")
        return 1
    logger.info("Frontend build complete")
    return 0


def main() -> int:
    configure_logging()
    return build_frontend()


if __name__ == "__main__":
    raise SystemExit(main())
