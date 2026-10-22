from pathlib import Path

import pytest
from hypothesis import given, strategies as st

import backend.app.lua_table as lua
from backend.app.sidecars import normalize_sidecar


@pytest.mark.parametrize('source', [
    'return { [nil] = 1 }', 'return { [{}] = 1 }',
    'return 1e999', 'return -1e999', 'return "\\999"',
    'return { 1 "," 2 }', 'return { [1 "]" = 2 }',
    'return { broken = function() end }', 'return os.execute("nope")',
])
def test_invalid_data_raises_parser_error(source):
    with pytest.raises(lua.LuaTableError):
        lua.parse_lua_table(source)


@pytest.mark.parametrize('value', ['{', '}', '[', ']', ',', ';', '=', 'return'])
def test_quoted_syntax_is_data(value):
    assert lua.parse_lua_table(f'return "{value}"') == value
    assert lua.parse_lua_table(f'return {{ "{value}" }}') == [value]


def test_lua_resource_boundaries(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(lua, 'MAX_SOURCE_BYTES', 16)
    path = tmp_path / 'metadata.lua'
    path.write_text(' ' * 16)
    assert lua.read_lua_source(path) == ' ' * 16
    path.write_text(' ' * 17)
    with pytest.raises(lua.LuaTableError, match='source size'):
        lua.read_lua_source(path)
    with pytest.raises(lua.LuaTableError, match='source size'):
        lua.parse_lua_table('"' + 'é' * 8 + '"')
    monkeypatch.setattr(lua, 'MAX_SOURCE_BYTES', 1024)
    monkeypatch.setattr(lua, 'MAX_TOKENS', 4)
    assert lua.parse_lua_table('return { 1 }') == [1]
    with pytest.raises(lua.LuaTableError, match='token limit'):
        lua.parse_lua_table('return { 1, 2 }')
    monkeypatch.setattr(lua, 'MAX_TOKENS', 100)
    monkeypatch.setattr(lua, 'MAX_DEPTH', 3)
    assert lua.parse_lua_table('{{{}}}') == [[[]]]
    with pytest.raises(lua.LuaTableError, match='nesting'):
        lua.parse_lua_table('{{{{}}}}')
    monkeypatch.setattr(lua, 'MAX_NUMBER_LENGTH', 3)
    assert lua.parse_lua_table('123') == 123
    with pytest.raises(lua.LuaTableError, match='number size'):
        lua.parse_lua_table('1234')


def test_bad_sidecars_and_overflow_are_contained(tmp_path: Path):
    path = tmp_path / 'metadata.lua'
    for source in ['return { [nil] = 1 }', 'return { [{}] = 1 }', 'return { a = 1e999 }']:
        path.write_text(source)
        assert normalize_sidecar(path) is None
    path.write_text('return { percent_finished = ' + '9' * 400 + ', doc_props = {series_index = ' + '9' * 400 + '} }')
    parsed = normalize_sidecar(path)
    assert parsed['percent_finished'] is None
    assert parsed['series_index'] is None


@given(st.text(max_size=500))
def test_arbitrary_input_returns_data_or_domain_error(source):
    try:
        lua.parse_lua_table(source)
    except lua.LuaTableError:
        pass


@given(st.lists(st.integers(min_value=-10**12, max_value=10**12), max_size=100))
def test_integer_arrays_round_trip(values):
    assert lua.parse_lua_table('return {' + ','.join(map(str, values)) + '}') == values
