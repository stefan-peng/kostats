from __future__ import annotations

import argparse
import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import time
from pathlib import Path

from .logging import configure_logging


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
logger = logging.getLogger(__name__)
LOG_LINE = re.compile(r"^\s*(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(.*)$")
ERROR_PREFIXES = ("error", "traceback", "permissionerror", "exception")


def require_command(name: str) -> str | None:
    return shutil.which(name)


def parse_output(message: str, current_level: int) -> tuple[int, str]:
    if match := LOG_LINE.match(message):
        return logging.getLevelNamesMapping()[match.group(1)], match.group(2)
    if message.lstrip().lower().startswith(ERROR_PREFIXES):
        return logging.ERROR, message
    return current_level, message


class ManagedProcess:
    def __init__(self, name: str, command: list[str], environment: dict[str, str] | None = None) -> None:
        self.name = name
        self.command = command
        self.environment = environment or {}
        self.process: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        kwargs: dict[str, object] = {
            "cwd": ROOT,
            "env": {**os.environ, "KOSTATS_MANAGED_PROCESS": "1", **self.environment},
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "text": True,
            "bufsize": 1,
        }
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

        logger.info("Starting %s", self.name)
        self.process = subprocess.Popen(self.command, **kwargs)
        self._thread = threading.Thread(target=self._stream_output, daemon=True)
        self._thread.start()

    def poll(self) -> int | None:
        if self.process is None:
            return None
        return self.process.poll()

    def terminate(self) -> None:
        if self.process is None or self.process.poll() is not None:
            return

        if os.name == "nt":
            self.process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            self.process.terminate()

    def kill(self) -> None:
        if self.process is None or self.process.poll() is not None:
            return

        self.process.kill()

    def wait(self, timeout: float | None = None) -> int | None:
        if self.process is None:
            return None
        return self.process.wait(timeout=timeout)

    def _stream_output(self) -> None:
        assert self.process is not None
        assert self.process.stdout is not None
        level = logging.INFO
        for line in self.process.stdout:
            if message := line.rstrip():
                level, message = parse_output(message, level)
                logger.log(level, "%-8s | %s", self.name, message)


def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description="Run the kostats backend and frontend dev servers.")
    parser.add_argument(
        "--smoke-seconds",
        type=float,
        default=None,
        help="Start both dev servers, keep them alive for the given number of seconds, then stop cleanly.",
    )
    parser.add_argument("--backend-port", type=int, default=8000)
    parser.add_argument("--frontend-port", type=int, default=5173)
    args = parser.parse_args()

    npm = require_command("npm")
    if npm is None:
        logger.error("npm is required to run the frontend dev server.")
        return 1

    uv = require_command("uv")
    if uv is None:
        logger.error("uv is required to run the backend dev server.")
        return 1

    if not (FRONTEND / "node_modules").exists():
        logger.error("Frontend dependencies are missing. Run: npm install --prefix frontend")
        return 1

    processes = [
        ManagedProcess(
            "backend",
            [
                uv,
                "run",
                "python",
                "-m",
                "backend.app.server",
                "--reload",
                "--host",
                "127.0.0.1",
                "--port",
                str(args.backend_port),
            ],
            {"KOSTATS_FRONTEND_ORIGIN": f"http://127.0.0.1:{args.frontend_port}"},
        ),
        ManagedProcess(
            "frontend",
            [
                npm,
                "run",
                "dev",
                "--prefix",
                "frontend",
                "--",
                "--port",
                str(args.frontend_port),
                "--strictPort",
            ],
        ),
    ]
    stopping = False

    def stop_processes(_signum: int | None = None, _frame: object | None = None) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        logger.info("Stopping development servers")
        for process in processes:
            process.terminate()

    signal.signal(signal.SIGTERM, stop_processes)
    if os.name != "nt":
        signal.signal(signal.SIGINT, stop_processes)

    try:
        for process in processes:
            try:
                process.start()
            except OSError:
                logger.exception("Unable to start %s", process.name)
                stop_processes()
                return 1

        logger.info("Development UI: http://127.0.0.1:%s", args.frontend_port)
        logger.info("API: http://127.0.0.1:%s", args.backend_port)

        smoke_deadline = None
        if args.smoke_seconds is not None:
            smoke_deadline = time.monotonic() + max(args.smoke_seconds, 0.0)

        while True:
            if smoke_deadline is not None and time.monotonic() >= smoke_deadline:
                stop_processes()
                return 0
            for process in processes:
                exit_code = process.poll()
                if exit_code is not None:
                    if stopping:
                        return 0
                    logger.error(
                        "%s exited with code %s; stopping remaining processes.",
                        process.name,
                        exit_code,
                    )
                    stop_processes()
                    return exit_code or 1
            time.sleep(0.2)
    except KeyboardInterrupt:
        stop_processes()
        return 0
    finally:
        deadline = time.monotonic() + 5
        for process in processes:
            remaining = max(0.0, deadline - time.monotonic())
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                logger.warning("%s did not stop in time; killing it", process.name)
                process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
