from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .dev import FRONTEND, ROOT
from .main import app


DIST = FRONTEND / "dist"


def configure_static_files(target: FastAPI, dist: Path = DIST) -> None:
    if not (dist / "index.html").is_file():
        raise FileNotFoundError(f"Frontend build output is missing: {dist / 'index.html'}")
    target.mount("/", StaticFiles(directory=dist, html=True), name="frontend")


def build_frontend() -> int:
    npm = shutil.which("npm")
    if npm is None:
        print("npm is required to build the frontend.", file=sys.stderr)
        return 1
    if not (FRONTEND / "node_modules").is_dir():
        print("Frontend dependencies are missing.", file=sys.stderr)
        print("Run: npm install --prefix frontend", file=sys.stderr)
        return 1

    try:
        result = subprocess.run(
            [npm, "run", "build", "--prefix", "frontend"],
            cwd=ROOT,
            check=False,
        )
    except OSError as exc:
        print(f"Unable to start the frontend build: {exc}", file=sys.stderr)
        return 1
    if result.returncode != 0:
        print(f"Frontend build failed with exit code {result.returncode}.", file=sys.stderr)
        return result.returncode or 1
    if not (DIST / "index.html").is_file():
        print(f"Frontend build did not create {DIST / 'index.html'}.", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    exit_code = build_frontend()
    if exit_code != 0:
        return exit_code
    configure_static_files(app)
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
