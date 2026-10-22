"""Bounded, data-only EPUB package reads shared by metadata and cover discovery."""
from __future__ import annotations

import posixpath
import zipfile
from urllib.parse import unquote, urlsplit
from xml.etree.ElementTree import Element, ParseError

from defusedxml.ElementTree import fromstring
from defusedxml.common import DefusedXmlException

MAX_CONTAINER_BYTES = 1024 * 1024
MAX_OPF_BYTES = 4 * 1024 * 1024
MAX_XML_DEPTH = 64
MAX_XML_ELEMENTS = 50_000


def bounded_zip_member(archive: zipfile.ZipFile, name: str, maximum_bytes: int) -> bytes | None:
    try:
        info = archive.getinfo(name)
        if info.flag_bits & 0x1 or not 0 <= info.file_size <= maximum_bytes:
            return None
        with archive.open(info, "r") as member:
            payload = member.read(maximum_bytes + 1)
        return payload if len(payload) <= maximum_bytes and len(payload) == info.file_size else None
    except (KeyError, OSError, RuntimeError, ValueError, EOFError, zipfile.BadZipFile, NotImplementedError):
        return None


def xml_member(archive: zipfile.ZipFile, name: str, limit: int) -> Element:
    payload = bounded_zip_member(archive, name, limit)
    if payload is None:
        raise ValueError("Missing or oversized EPUB metadata")
    try:
        root = fromstring(payload, forbid_dtd=True)
    except (ParseError, DefusedXmlException) as exc:
        raise ValueError("Unsafe or malformed EPUB XML") from exc
    # The byte limit bounds initial tree allocation; these limits bound subsequent traversal.
    pending = [(root, 1)]
    count = 0
    while pending:
        node, depth = pending.pop()
        count += 1
        if depth > MAX_XML_DEPTH or count > MAX_XML_ELEMENTS:
            raise ValueError("EPUB XML complexity limit exceeded")
        pending.extend((child, depth + 1) for child in node)
    return root


def member_path(href: str, base: str = "") -> str:
    url = urlsplit(href)
    path = unquote(url.path)
    if url.scheme or url.netloc or not path or path.startswith("/") or "\\" in path or "\x00" in path:
        raise ValueError("Invalid EPUB member path")
    normalized = posixpath.normpath(posixpath.join(posixpath.dirname(base), path))
    if normalized in {".", ".."} or normalized.startswith("../"):
        raise ValueError("EPUB member path escapes archive")
    return normalized


def package_document(archive: zipfile.ZipFile) -> tuple[str, Element]:
    container = xml_member(archive, "META-INF/container.xml", MAX_CONTAINER_BYTES)
    rootfile = next((node for node in container.iter() if node.tag.rsplit("}", 1)[-1] == "rootfile"), None)
    if rootfile is None or not rootfile.get("full-path"):
        raise ValueError("Missing EPUB package path")
    name = member_path(rootfile.attrib["full-path"])
    return name, xml_member(archive, name, MAX_OPF_BYTES)
