from __future__ import annotations

import hashlib
import json
import os
import tempfile
import warnings
import zipfile
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_COVER_DIMENSION = 1600
MAX_CONTAINER_BYTES = 1024 * 1024
MAX_OPF_BYTES = 4 * 1024 * 1024
MAX_COVER_BYTES = 50 * 1024 * 1024
MANIFEST_VERSION = 1


def covers_dir(data_root: Path) -> Path:
    return data_root / "covers"


def manifest_path(data_root: Path) -> Path:
    return covers_dir(data_root) / "manifest.json"


def load_cover_manifest(data_root: Path) -> dict[str, str]:
    try:
        payload = json.loads(manifest_path(data_root).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    covers = payload.get("covers") if isinstance(payload, dict) else None
    return {
        str(md5): str(asset_id)
        for md5, asset_id in covers.items()
        if isinstance(covers, dict) and isinstance(md5, str) and isinstance(asset_id, str)
    } if isinstance(covers, dict) else {}


def save_cover_manifest(data_root: Path, covers: dict[str, str]) -> None:
    root = covers_dir(data_root)
    root.mkdir(parents=True, exist_ok=True)
    payload = {"version": MANIFEST_VERSION, "covers": covers}
    fd, temporary = tempfile.mkstemp(prefix="manifest-", suffix=".tmp", dir=root)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        Path(temporary).replace(manifest_path(data_root))
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def normalized_epub_path(volume: Path, doc_path: object) -> Path | None:
    if not isinstance(doc_path, str) or not doc_path.strip():
        return None
    decoded = unquote(doc_path.strip()).replace("\\", "/")
    for prefix in ("/mnt/onboard/", "/mnt/sd/", "mnt/onboard/", "mnt/sd/"):
        if decoded.startswith(prefix):
            decoded = decoded[len(prefix):]
            break
    else:
        decoded = decoded.lstrip("/")
    relative = PurePosixPath(decoded)
    if not decoded or relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        return None
    try:
        candidate = (volume / Path(*relative.parts)).resolve(strict=False)
        candidate.relative_to(volume.resolve(strict=True))
    except (OSError, ValueError):
        return None
    return candidate if candidate.is_file() and candidate.suffix.lower() == ".epub" else None


def xml_attr(element: ElementTree.Element, name: str) -> str | None:
    value = element.attrib.get(name)
    return value.strip() if value and value.strip() else None


def bounded_zip_member(archive: zipfile.ZipFile, name: str, maximum_bytes: int) -> bytes | None:
    try:
        info = archive.getinfo(name)
    except KeyError:
        return None
    if info.flag_bits & 0x1 or info.file_size < 0 or info.file_size > maximum_bytes:
        return None
    try:
        with archive.open(info, "r") as member:
            payload = member.read(maximum_bytes + 1)
    except (OSError, RuntimeError, zipfile.BadZipFile):
        return None
    if len(payload) > maximum_bytes or len(payload) != info.file_size:
        return None
    return payload


def epub_cover_bytes(epub_path: Path) -> bytes | None:
    try:
        with zipfile.ZipFile(epub_path) as archive:
            container_payload = bounded_zip_member(archive, "META-INF/container.xml", MAX_CONTAINER_BYTES)
            if container_payload is None:
                return None
            container = ElementTree.fromstring(container_payload)
            rootfile = next((item for item in container.iter() if item.tag.rsplit("}", 1)[-1] == "rootfile"), None)
            opf_name = xml_attr(rootfile, "full-path") if rootfile is not None else None
            if not opf_name:
                return None
            opf_name = unquote(opf_name)
            opf_payload = bounded_zip_member(archive, opf_name, MAX_OPF_BYTES)
            if opf_payload is None:
                return None
            opf = ElementTree.fromstring(opf_payload)
            manifest_items = {
                xml_attr(item, "id"): item
                for item in opf.iter()
                if item.tag.rsplit("}", 1)[-1] == "item" and xml_attr(item, "id")
            }
            cover_item = next(
                (item for item in manifest_items.values() if "cover-image" in (xml_attr(item, "properties") or "").split()),
                None,
            )
            if cover_item is None:
                cover_id = next(
                    (
                        xml_attr(item, "content")
                        for item in opf.iter()
                        if item.tag.rsplit("}", 1)[-1] == "meta"
                        and (xml_attr(item, "name") or "").lower() == "cover"
                    ),
                    None,
                )
                cover_item = manifest_items.get(cover_id) if cover_id else None
            href = xml_attr(cover_item, "href") if cover_item is not None else None
            if not href:
                return None
            href_path = unquote(urlsplit(href).path)
            if not href_path:
                return None
            cover_name = str(PurePosixPath(opf_name).parent / PurePosixPath(href_path))
            return bounded_zip_member(archive, cover_name, MAX_COVER_BYTES)
    except (OSError, ValueError, zipfile.BadZipFile, ElementTree.ParseError):
        return None


def normalized_cover(payload: bytes) -> tuple[str, bytes] | None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(payload)) as source:
                source_format = source.format
                source.load()
                image = ImageOps.exif_transpose(source)
                if source_format not in {"JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF"}:
                    return None
                image.thumbnail((MAX_COVER_DIMENSION, MAX_COVER_DIMENSION), Image.Resampling.LANCZOS)
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA" if "transparency" in source.info else "RGB")
                output = BytesIO()
                if image.mode == "RGBA":
                    image.save(output, format="WEBP", lossless=True, method=6)
                else:
                    image.save(output, format="WEBP", quality=88, method=6)
                data = output.getvalue()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
        UnidentifiedImageError,
    ):
        return None
    return hashlib.sha256(data).hexdigest(), data


def write_asset(data_root: Path, asset_id: str, payload: bytes) -> None:
    root = covers_dir(data_root)
    root.mkdir(parents=True, exist_ok=True)
    destination = root / f"{asset_id}.webp"
    if destination.is_file():
        return
    fd, temporary = tempfile.mkstemp(prefix="cover-", suffix=".tmp", dir=root)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        Path(temporary).replace(destination)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def populate_cover_cache(volume: Path, records: list[dict[str, Any]], data_root: Path) -> None:
    manifest = load_cover_manifest(data_root)
    updated = dict(manifest)
    for record in records:
        try:
            checksum = record.get("partial_md5_checksum")
            if not isinstance(checksum, str) or not checksum:
                continue
            existing = manifest.get(checksum)
            if existing and (covers_dir(data_root) / f"{existing}.webp").is_file():
                continue
            epub = normalized_epub_path(volume, record.get("doc_path"))
            if epub is None:
                continue
            payload = epub_cover_bytes(epub)
            normalized = normalized_cover(payload) if payload is not None else None
            if normalized is None:
                continue
            asset_id, asset = normalized
            write_asset(data_root, asset_id, asset)
            updated[checksum] = asset_id
        except Exception:
            continue
    if updated != manifest:
        try:
            save_cover_manifest(data_root, updated)
        except Exception:
            pass


def cover_url_for_md5s(
    data_root: Path,
    source_md5s: list[object],
    *,
    manifest: dict[str, str] | None = None,
) -> str | None:
    manifest = manifest if manifest is not None else load_cover_manifest(data_root)
    for checksum in source_md5s:
        asset_id = manifest.get(str(checksum))
        if asset_id and (covers_dir(data_root) / f"{asset_id}.webp").is_file():
            return f"/api/covers/{asset_id}"
    return None


def resolve_cover_asset(data_root: Path, asset_id: str) -> Path | None:
    if len(asset_id) != 64 or any(char not in "0123456789abcdef" for char in asset_id):
        return None
    if asset_id not in set(load_cover_manifest(data_root).values()):
        return None
    path = covers_dir(data_root) / f"{asset_id}.webp"
    return path if path.is_file() else None
