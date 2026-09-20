import logging

from backend.app.dev import parse_output


def test_uvicorn_level_is_preserved_without_duplicate_prefix() -> None:
    assert parse_output("INFO     Server started", logging.ERROR) == (logging.INFO, "Server started")
    assert parse_output("WARNING  Reloading", logging.INFO) == (logging.WARNING, "Reloading")


def test_error_output_is_promoted() -> None:
    assert parse_output("Error: address in use", logging.INFO) == (logging.ERROR, "Error: address in use")
    assert parse_output("  traceback follows", logging.INFO) == (logging.ERROR, "  traceback follows")


def test_continuation_keeps_current_level() -> None:
    assert parse_output("    stack frame", logging.ERROR) == (logging.ERROR, "    stack frame")
