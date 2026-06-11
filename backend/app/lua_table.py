from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


class LuaTableError(ValueError):
    pass


TOKEN_RE = re.compile(
    r"""
    (?P<space>\s+)
  | (?P<comment>--[^\n]*)
  | (?P<number>-?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)
  | (?P<string>"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')
  | (?P<name>[A-Za-z_][A-Za-z0-9_]*)
  | (?P<symbol>[\{\}\[\],;=])
    """,
    re.VERBOSE,
)


@dataclass(frozen=True)
class Token:
    kind: str
    value: str


def tokenize(source: str) -> list[Token]:
    tokens: list[Token] = []
    position = 0
    while position < len(source):
        match = TOKEN_RE.match(source, position)
        if match is None:
            raise LuaTableError(f"Unsupported Lua syntax at offset {position}")
        position = match.end()
        kind = match.lastgroup
        if kind not in {"space", "comment"}:
            tokens.append(Token(kind or "", match.group()))
    return tokens


class Parser:
    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.position = 0

    def parse(self) -> Any:
        if self.peek_value() == "return":
            self.position += 1
        value = self.parse_value()
        if self.position != len(self.tokens):
            raise LuaTableError("Unexpected trailing Lua data")
        return value

    def peek(self) -> Token | None:
        if self.position >= len(self.tokens):
            return None
        return self.tokens[self.position]

    def peek_value(self) -> str | None:
        token = self.peek()
        return token.value if token else None

    def take(self, expected: str | None = None) -> Token:
        token = self.peek()
        if token is None:
            raise LuaTableError("Unexpected end of Lua data")
        if expected is not None and token.value != expected:
            raise LuaTableError(f"Expected {expected!r}, got {token.value!r}")
        self.position += 1
        return token

    def parse_value(self) -> Any:
        token = self.peek()
        if token is None:
            raise LuaTableError("Missing Lua value")
        if token.value == "{":
            return self.parse_table()
        self.position += 1
        if token.kind == "string":
            return decode_string(token.value)
        if token.kind == "number":
            return float(token.value) if any(char in token.value for char in ".eE") else int(token.value)
        if token.kind == "name":
            if token.value == "true":
                return True
            if token.value == "false":
                return False
            if token.value == "nil":
                return None
        raise LuaTableError(f"Unsupported Lua value {token.value!r}")

    def parse_table(self) -> Any:
        self.take("{")
        keyed: dict[Any, Any] = {}
        array: list[Any] = []
        while self.peek_value() != "}":
            token = self.peek()
            if token is None:
                raise LuaTableError("Unterminated Lua table")

            if token.value == "[":
                self.take("[")
                key = self.parse_value()
                self.take("]")
                self.take("=")
                keyed[key] = self.parse_value()
            elif token.kind == "name" and self.position + 1 < len(self.tokens) and self.tokens[self.position + 1].value == "=":
                key = self.take().value
                self.take("=")
                keyed[key] = self.parse_value()
            else:
                array.append(self.parse_value())

            if self.peek_value() in {",", ";"}:
                self.position += 1
            elif self.peek_value() != "}":
                raise LuaTableError("Expected a Lua table separator")
        self.take("}")

        if not keyed:
            return array
        for index, value in enumerate(array, start=1):
            keyed.setdefault(index, value)
        return keyed


def decode_string(value: str) -> str:
    quote = value[0]
    body = value[1:-1]
    output: list[str] = []
    index = 0
    escapes = {
        "a": "\a",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "v": "\v",
        "\\": "\\",
        '"': '"',
        "'": "'",
    }
    while index < len(body):
        char = body[index]
        if char != "\\":
            output.append(char)
            index += 1
            continue
        index += 1
        if index >= len(body):
            raise LuaTableError("Invalid Lua string escape")
        escaped = body[index]
        index += 1
        if escaped == "\n":
            continue
        if escaped == "z":
            while index < len(body) and body[index].isspace():
                index += 1
            continue
        if escaped.isdigit():
            digits = escaped
            while index < len(body) and len(digits) < 3 and body[index].isdigit():
                digits += body[index]
                index += 1
            output.append(chr(int(digits, 10)))
            continue
        output.append(escapes.get(escaped, escaped if escaped == quote else escaped))
    return "".join(output)


def parse_lua_table(source: str) -> Any:
    return Parser(tokenize(source)).parse()
