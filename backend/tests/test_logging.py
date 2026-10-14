import logging
import logging.config
import sqlite3

import pytest

from backend.app.diagnostics import database_path
from backend.app.logging import configure_logging, log_level, uvicorn_log_config, watcher_log_level


@pytest.fixture(autouse=True)
def restore_logging_level():
    root = logging.getLogger()
    previous = root.level
    yield
    root.setLevel(previous)


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


@pytest.mark.parametrize("reload_worker", [False, True])
@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
def test_polling_access_logs_require_debug(reload_worker, level, monkeypatch, tmp_path, capsys) -> None:
    monkeypatch.setenv("KOSTATS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("KOSTATS_LOG_LEVEL", level)
    if reload_worker:
        logging.config.dictConfig(uvicorn_log_config())
    else:
        configure_logging(show_time=False)

    access = logging.getLogger("uvicorn.access")
    for method, path, status in [
        ("GET", "/api/device/status?check=1", 200),
        ("POST", "/api/import/kobo/auto", 200),
        ("GET", "/api/device/status", 500),
        ("POST", "/api/import/kobo/auto", 409),
        ("GET", "/api/devices", 200),
        ("POST", "/api/import/kobo", 200),
    ]:
        access.info('%s - "%s %s HTTP/%s" %d', "client", method, path, "1.1", status)

    access.warning('%s - "%s %s HTTP/%s" %d', "client", "GET", "/api/device/status?warning=1", "1.1", 200)

    output = capsys.readouterr().err
    assert "/api/device/status?warning=1" in output
    assert "WARNING" in output
    assert ("/api/device/status?check=1" in output) == (level == "DEBUG")
    assert ('/api/import/kobo/auto HTTP/1.1" 200' in output) == (level == "DEBUG")
    assert '/api/device/status HTTP/1.1" 500' in output
    assert '/api/import/kobo/auto HTTP/1.1" 409' in output
    assert "/api/devices" in output
    assert '/api/import/kobo HTTP/1.1" 200' in output
    assert ("DEBUG" in output) == (level == "DEBUG")


def test_device_state_logs_only_changes(monkeypatch, caplog) -> None:
    from backend.app import device

    monkeypatch.setattr(device, "_last_device_state", None)
    status = {"mounted": False, "database_found": False, "permission_error": None}
    with caplog.at_level(logging.INFO, logger=device.__name__):
        device.log_device_state(status)
        device.log_device_state(status)
        device.log_device_state({**status, "mounted": True, "database_found": True})
        device.log_device_state({**status, "mounted": True, "permission_error": "blocked"})
        device.log_device_state(status)
    assert len([entry for entry in caplog.records if entry.name == device.__name__]) == 4


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
