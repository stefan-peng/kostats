from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"


def require_command(name: str) -> str | None:
    return shutil.which(name)


class ManagedProcess:
    def __init__(self, name: str, command: list[str]) -> None:
        self.name = name
        self.command = command
        self.process: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        kwargs: dict[str, object] = {
            "cwd": ROOT,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "text": True,
            "bufsize": 1,
        }
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

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
        for line in self.process.stdout:
            print(f"[{self.name}] {line}", end="", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the kostats backend and frontend dev servers.")
    parser.add_argument(
        "--smoke-seconds",
        type=float,
        default=None,
        help="Start both dev servers, keep them alive for the given number of seconds, then stop cleanly.",
    )
    args = parser.parse_args()

    npm = require_command("npm")
    if npm is None:
        print("npm is required to run the frontend dev server.", file=sys.stderr)
        return 1

    uv = require_command("uv")
    if uv is None:
        print("uv is required to run the backend dev server.", file=sys.stderr)
        return 1

    if not (FRONTEND / "node_modules").exists():
        print("Frontend dependencies are missing.", file=sys.stderr)
        print("Run: npm install --prefix frontend", file=sys.stderr)
        return 1

    processes = [
        ManagedProcess(
            "backend",
            [
                uv,
                "run",
                "uvicorn",
                "backend.app.main:app",
                "--reload",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
        ),
        ManagedProcess("frontend", [npm, "run", "dev", "--prefix", "frontend"]),
    ]
    stopping = False

    def stop_processes(_signum: int | None = None, _frame: object | None = None) -> None:
        nonlocal stopping
        stopping = True
        for process in processes:
            process.terminate()

    signal.signal(signal.SIGTERM, stop_processes)
    if os.name != "nt":
        signal.signal(signal.SIGINT, stop_processes)

    try:
        for process in processes:
            process.start()

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
                    print(
                        f"[dev] {process.name} exited with code {exit_code}; stopping remaining processes.",
                        file=sys.stderr,
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
                process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
