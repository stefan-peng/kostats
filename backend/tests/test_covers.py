from __future__ import annotations

import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from backend.app.covers import (
    MAX_CONTAINER_BYTES,
    MAX_COVER_DIMENSION,
    bounded_zip_member,
    cover_url_for_md5s,
    covers_dir,
    epub_cover_bytes,
    load_cover_manifest,
    normalized_cover,
    normalized_epub_path,
    populate_cover_cache,
    save_cover_manifest,
)


def image_bytes(*, size: tuple[int, int] = (40, 60), format: str = "PNG") -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "navy").save(output, format=format)
    return output.getvalue()


def write_epub(path: Path, *, version: int = 3, href: str = "Images/cover%20art.png", cover: bytes | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = '<meta name="cover" content="cover-id" />' if version == 2 else ""
    properties = ' properties="cover-image"' if version == 3 else ""
    opf = f'''<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf">
        <metadata>{meta}</metadata>
        <manifest><item id="cover-id" href="{href}" media-type="image/png"{properties}/></manifest>
      </package>'''
    container = '''<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OPS/content.opf" /></rootfiles>
      </container>'''
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("META-INF/container.xml", container)
        archive.writestr("OPS/content.opf", opf)
        if cover is not None:
            archive.writestr("OPS/Images/cover art.png", cover)


@pytest.mark.parametrize("version", [2, 3])
def test_extracts_epub2_and_epub3_nested_encoded_cover_paths(tmp_path: Path, version: int) -> None:
    epub = tmp_path / f"book-{version}.epub"
    expected = image_bytes()
    write_epub(epub, version=version, cover=expected)

    assert epub_cover_bytes(epub) == expected


def test_cover_href_strips_query_and_fragment_before_decoding(tmp_path: Path) -> None:
    epub = tmp_path / "book.epub"
    expected = image_bytes()
    write_epub(epub, href="Images/cover%20art.png?cache=1#preview", cover=expected)

    assert epub_cover_bytes(epub) == expected


def test_bounded_zip_member_rejects_oversized_encrypted_and_truncated_members() -> None:
    class Member:
        def __init__(self, payload: bytes) -> None:
            self.payload = payload

        def __enter__(self) -> "Member":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self, size: int) -> bytes:
            return self.payload[:size]

    class Archive:
        def __init__(self, *, file_size: int, flag_bits: int = 0, payload: bytes = b"") -> None:
            self.info = zipfile.ZipInfo("member")
            self.info.file_size = file_size
            self.info.flag_bits = flag_bits
            self.payload = payload
            self.opened = False

        def getinfo(self, name: str) -> zipfile.ZipInfo:
            return self.info

        def open(self, info: zipfile.ZipInfo, mode: str) -> Member:
            self.opened = True
            return Member(self.payload)

    oversized = Archive(file_size=MAX_CONTAINER_BYTES + 1)
    encrypted = Archive(file_size=1, flag_bits=1, payload=b"x")
    truncated = Archive(file_size=2, payload=b"x")

    assert bounded_zip_member(oversized, "member", MAX_CONTAINER_BYTES) is None
    assert oversized.opened is False
    assert bounded_zip_member(encrypted, "member", MAX_CONTAINER_BYTES) is None
    assert encrypted.opened is False
    assert bounded_zip_member(truncated, "member", MAX_CONTAINER_BYTES) is None


def test_pillow_decompression_bomb_is_treated_as_missing_cover(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Image, "open", lambda *args, **kwargs: (_ for _ in ()).throw(Image.DecompressionBombError("bomb")))

    assert normalized_cover(image_bytes()) is None


def test_pillow_decompression_bomb_warning_is_treated_as_missing_cover(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1500)

    assert normalized_cover(image_bytes(size=(40, 60))) is None


def test_missing_malformed_and_unsupported_covers_are_ignored(tmp_path: Path) -> None:
    missing = tmp_path / "missing.epub"
    write_epub(missing, cover=None)
    malformed = tmp_path / "malformed.epub"
    malformed.write_bytes(b"not a zip")

    assert epub_cover_bytes(missing) is None
    assert epub_cover_bytes(malformed) is None
    assert normalized_cover(b"<svg />") is None


@pytest.mark.parametrize(
    "doc_path",
    ["/mnt/onboard/../secrets.epub", "/mnt/onboard/books/%2E%2E/secrets.epub", "../../secrets.epub"],
)
def test_normalized_epub_path_rejects_traversal(tmp_path: Path, doc_path: str) -> None:
    volume = tmp_path / "KOBO"
    volume.mkdir()

    assert normalized_epub_path(volume, doc_path) is None


def test_normalizes_bounds_and_reuses_content_addressed_asset(tmp_path: Path) -> None:
    volume = tmp_path / "KOBO"
    epub = volume / "Books/My Book.epub"
    write_epub(epub, cover=image_bytes(size=(2400, 3600)))
    data_root = tmp_path / "data"
    records = [{"doc_path": "/mnt/onboard/Books/My%20Book.epub", "partial_md5_checksum": "partial-a"}]

    populate_cover_cache(volume, records, data_root)
    first_manifest = load_cover_manifest(data_root)
    asset = covers_dir(data_root) / f"{first_manifest['partial-a']}.webp"
    first_mtime = asset.stat().st_mtime_ns
    populate_cover_cache(volume, records, data_root)

    assert load_cover_manifest(data_root) == first_manifest
    assert asset.stat().st_mtime_ns == first_mtime
    with Image.open(asset) as image:
        assert max(image.size) == MAX_COVER_DIMENSION
    assert cover_url_for_md5s(data_root, ["missing", "partial-a"]) == f"/api/covers/{asset.stem}"


def test_manifest_write_is_atomic_when_replace_fails(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    save_cover_manifest(data_root, {"old": "a" * 64})
    original = (covers_dir(data_root) / "manifest.json").read_text(encoding="utf-8")

    def fail_replace(self: Path, target: Path) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        save_cover_manifest(data_root, {"new": "b" * 64})

    assert (covers_dir(data_root) / "manifest.json").read_text(encoding="utf-8") == original
    assert list(covers_dir(data_root).glob("manifest-*.tmp")) == []


def test_corrupt_manifest_is_treated_as_empty(tmp_path: Path) -> None:
    path = covers_dir(tmp_path) / "manifest.json"
    path.parent.mkdir(parents=True)
    path.write_text("{broken", encoding="utf-8")

    assert load_cover_manifest(tmp_path) == {}
