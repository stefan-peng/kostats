from __future__ import annotations

from pathlib import Path

from backend.app.lua_table import LuaTableError, parse_lua_table
from backend.app.sidecars import normalize_sidecar


def test_restricted_lua_parser_reads_koreader_tables() -> None:
    parsed = parse_lua_table(
        r'''
        -- metadata
        return {
            ["title"] = "Line\nBreak",
            ["enabled"] = true,
            ["values"] = { [1] = 10, [2] = 20 },
        }
        '''
    )

    assert parsed["title"] == "Line\nBreak"
    assert parsed["enabled"] is True
    assert parsed["values"] == {1: 10, 2: 20}


def test_restricted_lua_parser_rejects_executable_syntax() -> None:
    try:
        parse_lua_table('return os.execute("nope")')
    except LuaTableError:
        pass
    else:
        raise AssertionError("Executable Lua syntax was accepted")


def test_malformed_sidecar_is_ignored(tmp_path: Path) -> None:
    path = tmp_path / "Book.sdr/metadata.epub.lua"
    path.parent.mkdir()
    path.write_text("return { broken = function() end }", encoding="utf-8")

    assert normalize_sidecar(path) is None
