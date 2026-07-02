from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LEGACY_DEVICE_ID = "primary-kobo"
UPLOAD_DEVICE_ID = "uploaded-databases"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{digest}"


def normalized_label(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip().casefold()


def lua_string_field(text: str, key: str) -> str | None:
    match = re.search(
        rf'(?:\["{re.escape(key)}"\]|{re.escape(key)})\s*=\s*("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')',
        text,
    )
    if not match:
        return None
    value = match.group(1)[1:-1]
    return bytes(value, "utf-8").decode("unicode_escape").strip() or None


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return ""


def detect_koreader_version(koreader_root: Path) -> str | None:
    for relative in ("git-rev", "version", "VERSION"):
        path = koreader_root / relative
        if path.is_file():
            value = read_text(path).strip()
            if value:
                return value.splitlines()[0][:120]
    return None


def detect_device_model(koreader_root: Path) -> str | None:
    settings = read_text(koreader_root / "settings.reader.lua")
    for key in ("device_model", "device", "product"):
        if value := lua_string_field(settings, key):
            return value
    version_file = koreader_root.parents[1] / ".kobo/version"
    value = read_text(version_file).strip()
    if value:
        return f"Kobo product {value[-3:]}"
    return None


def detect_device_identity(volume: Path) -> dict[str, str | None]:
    koreader_root = volume / ".adds/koreader"
    settings = read_text(koreader_root / "settings.reader.lua")
    configured_id = lua_string_field(settings, "device_id")
    model = detect_device_model(koreader_root)
    version = detect_koreader_version(koreader_root)
    version_file = read_text(volume / ".kobo/version").strip()
    signature = configured_id or version_file or f"{model or 'unknown'}:{volume}"
    device_id = stable_id("kobo", signature)
    label = model or "Kobo device"
    return {
        "id": device_id,
        "label": label,
        "model": model,
        "koreader_version": version,
    }


class DeviceRegistry:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.path = root / "devices.json"

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        self.ensure()
        if not self.path.exists():
            return {"version": 1, "devices": []}
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return {"version": 1, "devices": []}
        payload.setdefault("version", 1)
        payload.setdefault("devices", [])
        return payload

    def save(self, payload: dict[str, Any]) -> None:
        self.ensure()
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(self.path)

    def list_devices(self) -> list[dict[str, Any]]:
        return sorted(self.load()["devices"], key=lambda item: item.get("label") or item["id"])

    def resolve(self, device_id: str) -> dict[str, Any] | None:
        return next((item for item in self.load()["devices"] if item["id"] == device_id), None)

    def upsert(
        self,
        *,
        device_id: str,
        label: str,
        model: str | None = None,
        koreader_version: str | None = None,
        source: str,
        label_source: str = "auto",
    ) -> dict[str, Any]:
        payload = self.load()
        now = utc_now()
        existing = next((item for item in payload["devices"] if item["id"] == device_id), None)
        if existing is None:
            existing = {
                "id": device_id,
                "label": label,
                "model": model,
                "koreader_version": koreader_version,
                "label_source": label_source,
                "source": source,
                "first_seen": now,
                "last_seen": now,
            }
            payload["devices"].append(existing)
        else:
            if existing.get("label_source") != "manual":
                existing["label"] = existing.get("label") or label
                existing["label_source"] = existing.get("label_source") or label_source
            existing["model"] = model or existing.get("model")
            existing["koreader_version"] = koreader_version or existing.get("koreader_version")
            existing["source"] = source
            existing["last_seen"] = now
        self.save(payload)
        return existing

    def create_manual(self, label: str, *, source: str = "manual") -> dict[str, Any] | None:
        clean = label.strip()
        if not clean:
            return None
        existing = next(
            (
                item
                for item in self.load()["devices"]
                if normalized_label(item.get("label")) == normalized_label(clean)
            ),
            None,
        )
        if existing is not None:
            return existing
        return self.upsert(
            device_id=stable_id("device", clean),
            label=clean,
            model=None,
            koreader_version=None,
            source=source,
            label_source="manual",
        )

    def rename(self, device_id: str, label: str) -> dict[str, Any] | None:
        clean = label.strip()
        if not clean:
            return None
        payload = self.load()
        device = next((item for item in payload["devices"] if item["id"] == device_id), None)
        if device is None:
            return None
        device["label"] = clean
        device["label_source"] = "manual"
        self.save(payload)
        return device

    def ensure_for_volume(self, volume: Path) -> dict[str, Any]:
        identity = detect_device_identity(volume)
        return self.upsert(
            device_id=str(identity["id"]),
            label=str(identity["label"] or "Kobo device"),
            model=identity["model"],
            koreader_version=identity["koreader_version"],
            source="kobo",
            label_source="auto",
        )

    def ensure_upload_device(self) -> dict[str, Any]:
        return self.upsert(
            device_id=UPLOAD_DEVICE_ID,
            label="Uploaded databases",
            model=None,
            koreader_version=None,
            source="upload",
            label_source="auto",
        )

    def legacy_device_for_source(self, source: str | None) -> dict[str, Any]:
        if source == "upload":
            return {
                "id": UPLOAD_DEVICE_ID,
                "label": "Uploaded databases",
                "model": None,
                "source": "upload",
            }
        return {
            "id": LEGACY_DEVICE_ID,
            "label": "Primary Kobo",
            "model": None,
            "source": "legacy",
        }
