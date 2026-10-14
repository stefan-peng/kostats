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


def test_sidecar_cache_reuses_parsing_and_invalidates_rewrites(monkeypatch, tmp_path: Path) -> None:
    import os
    import backend.app.sidecars as sidecars

    path = tmp_path / 'metadata.lua'
    path.write_text('return { doc_props = { title = "First" } }')
    original_parse = sidecars.parse_lua_table
    calls = []
    def counted_parse(text):
        calls.append(text)
        return original_parse(text)
    monkeypatch.setattr(sidecars, 'parse_lua_table', counted_parse)
    first = normalize_sidecar(path)
    first['title'] = 'Mutated'
    assert normalize_sidecar(path)['title'] == 'First'
    assert len(calls) == 1
    stat = path.stat()
    path.write_text('return { doc_props = { title = "Other" } }')
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    assert normalize_sidecar(path)['title'] == 'Other'
    assert len(calls) == 2
    path.unlink()
    assert normalize_sidecar(path) is None
