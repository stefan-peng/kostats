import logging

from backend.app.logging import configure_logging, log_level, uvicorn_log_config


def test_log_level_uses_environment(monkeypatch) -> None:
    monkeypatch.setenv("KOSTATS_LOG_LEVEL", "debug")

    assert log_level() == "DEBUG"


def test_log_level_ignores_invalid_value(monkeypatch) -> None:
    monkeypatch.setenv("KOSTATS_LOG_LEVEL", "chatty")

    assert log_level() == "INFO"


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
