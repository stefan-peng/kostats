"""Read-only device inventory; no document payload is copied into snapshots."""

from __future__ import annotations

import hashlib
import os
import zipfile
from pathlib import Path
from xml.etree import ElementTree

BOOK_EXTENSIONS = {
    '.epub', '.pdf', '.djvu', '.djv', '.mobi', '.azw', '.azw3', '.fb2',
    '.txt', '.rtf', '.doc', '.docx', '.cbz', '.cbr', '.cbt', '.chm',
    '.pdb', '.xps', '.oxps',
}


def partial_md5(path: Path) -> str:
    # KOReader frontend/util.lua partialMD5: its 32-bit shift at i=-1 is zero.
    digest = hashlib.md5()
    with path.open('rb') as handle:
        for offset in [0] + [1024 * 4**i for i in range(11)]:
            handle.seek(offset)
            sample = handle.read(1024)
            if not sample:
                break
            digest.update(sample)
    return digest.hexdigest()


def epub_metadata(path: Path) -> dict:
    if path.suffix.lower() != '.epub':
        return {}
    try:
        with zipfile.ZipFile(path) as archive:
            def xml(name: str) -> ElementTree.Element:
                if archive.getinfo(name).file_size > 2 * 1024 * 1024:
                    raise ValueError('Metadata too large')
                return ElementTree.fromstring(archive.read(name))
            container = xml('META-INF/container.xml')
            rootfile = next(node for node in container.iter() if node.tag.split('}')[-1] == 'rootfile')
            package = xml(rootfile.attrib['full-path'])
            ns = '{http://purl.org/dc/elements/1.1/}'
            def values(name: str) -> list[str]:
                return [
                    node.text.strip() for node in package.iter(ns + name)
                    if node.text and node.text.strip()
                ]

            return {
                'title': next(iter(values('title')), None),
                'authors': ', '.join(values('creator')) or None,
                'language': next(iter(values('language')), None),
            }
    except (OSError, ValueError, KeyError, StopIteration, zipfile.BadZipFile, ElementTree.ParseError):
        return {}


def inventory(volume: Path) -> list[dict]:
    records = []

    def scan_error(error: OSError) -> None:
        raise error

    for root, dirs, files in os.walk(volume, onerror=scan_error):
        dirs[:] = sorted(
            name for name in dirs
            if not name.startswith('.') and not name.endswith('.sdr')
            and name != 'System Volume Information'
            and not (Path(root) / name).is_symlink()
        )
        for name in sorted(files):
            path = Path(root) / name
            if name.startswith('.') or path.suffix.lower() not in BOOK_EXTENSIONS or path.is_symlink():
                continue
            try:
                checksum = partial_md5(path)
            except OSError:
                checksum = None
            records.append({
                'source_path': str(path),
                'doc_path': '/mnt/onboard/' + path.relative_to(volume).as_posix(),
                'partial_md5_checksum': checksum,
                'title': path.stem,
                'inventory_only': True,
                **{key: value for key, value in epub_metadata(path).items() if value is not None},
            })
    return records
