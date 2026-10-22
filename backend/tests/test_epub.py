import posixpath
import zipfile
from pathlib import Path

import pytest
from hypothesis import given, strategies as st

import backend.app.epub as epub
from backend.app.covers import epub_cover_bytes
from backend.app.library import epub_metadata


def write_package(path, *, container=None, package='<package/>'):
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('META-INF/container.xml', container if container is not None else '<container><rootfile full-path="OPS/book.opf"/></container>')
        archive.writestr('OPS/book.opf', package)


@pytest.mark.parametrize('target', ['container', 'package'])
@pytest.mark.parametrize('xml', [
    '<!DOCTYPE package [<!ENTITY x "expanded">]><package>&x;</package>',
    '<!DOCTYPE package SYSTEM "file:///etc/passwd"><package/>',
    '<package>', '<package>' * 65 + '</package>' * 65,
])
def test_unsafe_or_malformed_xml_ignored_by_both_consumers(tmp_path: Path, target, xml):
    path = tmp_path / 'unsafe.epub'
    write_package(path, **{target: xml})
    assert epub_metadata(path) == {}
    assert epub_cover_bytes(path) is None


def test_xml_byte_and_element_limits(monkeypatch, tmp_path: Path):
    path = tmp_path / 'book.epub'
    write_package(path)
    monkeypatch.setattr(epub, 'MAX_OPF_BYTES', 5)
    assert epub_metadata(path) == {}
    monkeypatch.setattr(epub, 'MAX_OPF_BYTES', 1000)
    monkeypatch.setattr(epub, 'MAX_XML_ELEMENTS', 3)
    write_package(path, package='<package><a/><a/><a/></package>')
    assert epub_metadata(path) == {}


@pytest.mark.parametrize('href', ['../escape.opf', '%2e%2e/escape.opf', '/book.opf', 'https://example.org/book.opf', '//example.org/a', 'a\\b', 'a%00b', '', '#fragment'])
def test_invalid_package_paths_rejected(href):
    with pytest.raises(ValueError):
        epub.member_path(href)


def test_relative_cover_and_encoded_package_paths(tmp_path: Path):
    path = tmp_path / 'book.epub'
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('META-INF/container.xml', '<container><rootfile full-path="OPS/book%20one.opf"/></container>')
        archive.writestr('OPS/book one.opf', '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Title</dc:title><manifest><item id="cover" properties="cover-image" href="../Images/cover.png"/></manifest></package>')
        archive.writestr('Images/cover.png', b'cover')
    assert epub_metadata(path)['title'] == 'Title'
    assert epub_cover_bytes(path) == b'cover'


@given(st.text(max_size=200))
def test_member_path_is_relative_and_normalized(href):
    try:
        path = epub.member_path(href, 'OPS/book.opf')
    except ValueError:
        return
    assert not path.startswith('/')
    assert path not in {'.', '..'} and not path.startswith('../')
    assert '\\' not in path and '\x00' not in path
    assert path == posixpath.normpath(path)
