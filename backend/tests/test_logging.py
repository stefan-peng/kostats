import logging
import logging.config
import sqlite3

import pytest

from backend.app.diagnostics import database_path
from backend.app.logging import configure_logging, log_level, uvicorn_log_config, watcher_log_level


def test_log_level_uses_environment(monkeypatch) -> None:
    monkeypatch.setenv("KOSTATS_LOG_LEVEL", "debug")

    assert log_level() == "DEBUG"


def test_log_level_ignores_invalid_value(monkeypatch) -> None:
    monkeypatch.setenv("KOSTATS_LOG_LEVEL", "chatty")

    assert log_level() == "INFO"


@pytest.mark.parametrize("level", ["NOTSET", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])
def test_watcher_level_preserves_explicit_verbosity(level, monkeypatch) -> None:
    monkeypatch.setenv("KOSTATS_LOG_LEVEL", level)

    assert watcher_log_level() == ("WARNING" if level == "INFO" else level)


def test_configure_logging_writes_rich_output_to_stderr(capsys, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path))
    configure_logging(show_time=False)

    logging.getLogger("kostats.test").warning("A useful warning")

    output = capsys.readouterr()
    assert output.out == ""
    assert "WARNING" in output.err
    assert "A useful warning" in output.err


def test_uvicorn_logging_is_safe_for_reload_workers() -> None:
    config = uvicorn_log_config()

    assert config["handlers"]["rich"]["()"] == "backend.app.logging.make_rich_handler"
    assert config["root"]["handlers"] == ["rich", "persistent"]


@pytest.mark.parametrize("reload_worker", [False, True])
@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
def test_watcher_noise_requires_debug(reload_worker, level, monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("KOSTATS_LOG_LEVEL", level)
    if reload_worker:
        logging.config.dictConfig(uvicorn_log_config())
    else:
        configure_logging(show_time=False)

    watcher = logging.getLogger("watchfiles.main")
    watcher.info("3 changes detected")
    watcher.warning("Watcher warning")
    logging.getLogger("uvicorn.error").info("Reloading application")

    output = capsys.readouterr().err
    assert ("3 changes detected" in output) == (level == "DEBUG")
    assert "Watcher warning" in output
    assert "Reloading application" in output
    with sqlite3.connect(database_path()) as connection:
        messages = [row[0] for row in connection.execute("SELECT fields FROM events")]
    assert any("3 changes detected" in message for message in messages) == (level == "DEBUG")
    assert any("Watcher warning" in message for message in messages)
