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
from urllib.parse import unquote
from xml.etree import ElementTree

from PIL import Image, ImageOps, UnidentifiedImageError

from .epub import bounded_zip_member, member_path, package_document

MAX_COVER_DIMENSION = 1600
MAX_COVER_BYTES = 50 * 1024 * 1024
MANIFEST_VERSION = 2


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


def load_cover_source_fingerprints(data_root: Path) -> dict[str, str]:
    try:
        payload = json.loads(manifest_path(data_root).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    fingerprints = payload.get("source_fingerprints") if isinstance(payload, dict) else None
    return {
        str(checksum): str(fingerprint)
        for checksum, fingerprint in fingerprints.items()
        if isinstance(fingerprints, dict) and isinstance(checksum, str) and isinstance(fingerprint, str)
    } if isinstance(fingerprints, dict) else {}


def save_cover_manifest(
    data_root: Path,
    covers: dict[str, str],
    source_fingerprints: dict[str, str] | None = None,
) -> None:
    root = covers_dir(data_root)
    root.mkdir(parents=True, exist_ok=True)
    payload = {"version": MANIFEST_VERSION, "covers": covers, "source_fingerprints": source_fingerprints or {}}
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


def epub_cover_bytes(epub_path: Path) -> bytes | None:
    try:
        with zipfile.ZipFile(epub_path) as archive:
            opf_name, opf = package_document(archive)
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
            cover_name = member_path(href, opf_name)
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


def populate_cover_cache(volume: Path, records: list[dict[str, Any]], data_root: Path) -> bool:
    manifest = load_cover_manifest(data_root)
    source_fingerprints = load_cover_source_fingerprints(data_root)
    updated = dict(manifest)
    updated_fingerprints = dict(source_fingerprints)
    for record in records:
        try:
            checksum = record.get("partial_md5_checksum")
            if not isinstance(checksum, str) or not checksum:
                continue
            epub = normalized_epub_path(volume, record.get("doc_path"))
            if epub is None:
                continue
            stat = epub.stat()
            fingerprint = f"{stat.st_mtime_ns}:{stat.st_size}"
            existing = manifest.get(checksum)
            if (
                existing
                and (covers_dir(data_root) / f"{existing}.webp").is_file()
                and source_fingerprints.get(checksum) == fingerprint
            ):
                continue
            payload = epub_cover_bytes(epub)
            normalized = normalized_cover(payload) if payload is not None else None
            if normalized is None:
                continue
            asset_id, asset = normalized
            write_asset(data_root, asset_id, asset)
            # The same KOReader checksum can point to an EPUB whose embedded
            # cover has since been replaced.  Keep the checksum mapping current;
            # old content-addressed assets remain harmless and can be shared.
            updated[checksum] = asset_id
            updated_fingerprints[checksum] = fingerprint
        except Exception:
            continue
    covers_changed = updated != manifest
    if covers_changed or updated_fingerprints != source_fingerprints:
        try:
            save_cover_manifest(data_root, updated, updated_fingerprints)
            return covers_changed
        except Exception:
            pass
    return False


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
