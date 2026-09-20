from __future__ import annotations

import argparse

import uvicorn

from .logging import uvicorn_log_config


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the kostats API server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    uvicorn.run(
        "backend.app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_config=uvicorn_log_config(),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
