from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import stat
import zipfile
from pathlib import Path

import pytest

from backend.app.backups import (
    RecoveryBackupStore,
    partial_md5,
)
from backend.app.errors import BackupError


def create_sqlite(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE values_table (value TEXT)")
    connection.execute("INSERT INTO values_table VALUES (?)", (value,))
    connection.commit()
    connection.close()


def write_book_and_sidecar(
    volume: Path,
    *,
    book_relative: str = "Books/Author/Book.epub",
    sidecar_relative: str = "Books/Author/Book.sdr",
    title: str = "Book",
    authors: str = "Author",
) -> tuple[Path, Path]:
    book = volume / book_relative
    book.parent.mkdir(parents=True, exist_ok=True)
    book.write_bytes(b"x" * 2048 + b"book payload")
    checksum = partial_md5(book)
    sidecar = volume / sidecar_relative / "metadata.epub.lua"
    sidecar.parent.mkdir(parents=True, exist_ok=True)
    sidecar.write_text(
        f"""
        return {{
            ["doc_path"] = "/mnt/onboard/{book_relative}",
            ["partial_md5_checksum"] = "{checksum}",
            ["doc_props"] = {{
                ["title"] = "{title}",
                ["authors"] = "{authors}",
            }},
            ["percent_finished"] = 0.5,
        }}
        """,
        encoding="utf-8",
    )
    (sidecar.parent / "cover.jpg").write_bytes(b"cover")
    return book, sidecar


def create_koreader_fixture(volume: Path, *, mode: str = "doc") -> None:
    root = volume / ".adds/koreader"
    (root / "settings").mkdir(parents=True, exist_ok=True)
    (root / "data/dict").mkdir(parents=True)
    (root / "plugins/kobo.koplugin").mkdir(parents=True)
    (root / "patches").mkdir()
    (root / "styletweaks").mkdir()
    (root / "git-rev").write_text("v2026.03\n", encoding="utf-8")
    (root / "settings.reader.lua").write_text(
        f"""
        return {{
            ["document_metadata_folder"] = "{mode}",
            ["device_model"] = "Kobo_monza",
            ["wallabag"] = {{ ["username"] = "reader", ["password"] = "secret" }},
            ["lastfile"] = "/mnt/onboard/Books/Author/Book.epub",
        }}
        """,
        encoding="utf-8",
    )
    (root / "history.lua").write_text(
        """
        return {
            ["/mnt/onboard/Books/Author/Book.epub"] = { ["time"] = 1 },
            ["/mnt/onboard/Missing.epub"] = { ["time"] = 2 },
        }
        """,
        encoding="utf-8",
    )
    (root / "settings/collections.lua").write_text(
        """
        return {
            ["Favorites"] = {
                [1] = "/mnt/onboard/Books/Author/Book.epub",
                [2] = "/mnt/onboard/Missing.epub",
            },
        }
        """,
        encoding="utf-8",
    )
    (root / "settings/cloudstorage.lua").write_text(
        'return { ["password"] = "cloud-secret" }\n',
        encoding="utf-8",
    )
    create_sqlite(root / "settings/statistics.sqlite3", "statistics")
    create_sqlite(root / "settings/vocabulary_builder.sqlite3", "vocabulary")
    create_sqlite(root / "settings/bookinfo_cache.sqlite3", "cache")
    (root / "settings/statistics.sqlite3-wal").write_bytes(b"wal")
    (root / "data/dict/custom.dict").write_bytes(b"dictionary")
    (root / "data/cr3.ini").write_text("font=serif\n", encoding="utf-8")
    (root / "plugins/kobo.koplugin/main.lua").write_text("return {}\n", encoding="utf-8")
    (root / "patches/2-custom.lua").write_text("return {}\n", encoding="utf-8")


def backup_fixture(tmp_path: Path, *, mode: str = "doc") -> tuple[RecoveryBackupStore, Path, dict]:
    volume = tmp_path / "KOBOeReader"
    volume.mkdir()
    create_koreader_fixture(volume, mode=mode)
    write_book_and_sidecar(volume)
    store = RecoveryBackupStore(tmp_path / "data")
    result = store.create_from_kobo(volume)
    return store, volume, result["backup"]


def make_v1_backup(store: RecoveryBackupStore, volume: Path, backup: dict) -> dict:
    legacy_path = Path(backup["archive_path"]).with_name("legacy-v1.zip")
    with zipfile.ZipFile(backup["archive_path"]) as source, zipfile.ZipFile(
        legacy_path, "w", compression=zipfile.ZIP_DEFLATED
    ) as legacy:
        manifest = json.loads(source.read("manifest.json"))
        manifest["format_version"] = 1
        for item in manifest["payloads"]:
            payload = (
                (volume / ".adds/koreader/data/dict/custom.dict").read_bytes()
                if item["category"] == "dictionaries"
                else source.read(item["path"])
            )
            legacy.writestr(item["path"], payload)
        for name in source.namelist():
            if name not in {item["path"] for item in manifest["payloads"]} and name != "manifest.json":
                legacy.writestr(name, source.read(name))
        legacy.writestr("manifest.json", json.dumps(manifest))
    legacy_backup = {**backup, "id": "legacy-v1", "format_version": 1, "archive_path": str(legacy_path)}
    store.save_index({"version": 1, "backups": [legacy_backup]})
    return legacy_backup


def test_backup_includes_recovery_data_and_excludes_books_and_caches(tmp_path: Path) -> None:
    store, _, backup = backup_fixture(tmp_path)

    with zipfile.ZipFile(backup["archive_path"]) as archive:
        names = set(archive.namelist())
        manifest = json.loads(archive.read("manifest.json"))

    assert backup["format_version"] == 2
    assert manifest["format_version"] == 2
    assert "payload/koreader/settings.reader.lua" in names
    assert "payload/koreader/settings/statistics.sqlite3" in names
    assert "payload/koreader/settings/vocabulary_builder.sqlite3" in names
    assert "payload/koreader/data/dict/custom.dict" not in names
    assert "payload/sidecars/Books/Author/Book.sdr/metadata.epub.lua" in names
    assert "payload/sidecars/Books/Author/Book.sdr/cover.jpg" in names
    assert "payload/extensions/plugins/kobo.koplugin/main.lua" in names
    assert not any(name.endswith("Book.epub") for name in names)
    assert not any("bookinfo_cache.sqlite3" in name for name in names)
    assert not any(name.endswith("-wal") for name in names)
    assert manifest["credentials_included"] is True
    assert backup["credentials_included"] is True
    assert stat.S_IMODE(Path(backup["archive_path"]).stat().st_mode) == 0o600
    assert store.list_backups() == [backup]


def test_dictionary_payloads_are_content_addressed_across_backups(tmp_path: Path) -> None:
    store, volume, first = backup_fixture(tmp_path)
    dictionary = volume / ".adds/koreader/data/dict/custom.dict"
    checksum = hashlib.sha256(dictionary.read_bytes()).hexdigest()
    object_path = store.dictionary_object_path(checksum)

    assert object_path.is_file()
    first_object = object_path.read_bytes()
    second = store.create_from_kobo(volume, source="pre-restore-safety", force=True)["backup"]

    assert object_path.read_bytes() == first_object
    assert list(store.dictionary_objects_dir.rglob("*.gz")) == [object_path]
    for backup in (first, second):
        with zipfile.ZipFile(backup["archive_path"]) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            item = next(item for item in manifest["payloads"] if item["category"] == "dictionaries")
            assert item["sha256"] == checksum
            assert item["path"] not in archive.namelist()


def test_restore_reads_dictionary_from_content_addressed_store(tmp_path: Path) -> None:
    store, volume, backup = backup_fixture(tmp_path)
    dictionary = volume / ".adds/koreader/data/dict/custom.dict"
    dictionary.unlink()

    store.restore(backup["id"], confirmed=True, restore_extensions=False, volume=volume)

    assert dictionary.read_bytes() == b"dictionary"


def test_v1_backup_restores_inline_dictionary_and_new_backups_use_v2(tmp_path: Path) -> None:
    store, volume, backup = backup_fixture(tmp_path)
    legacy_backup = make_v1_backup(store, volume, backup)

    current = store.create_from_kobo(volume)
    assert current["created"] is True
    assert current["backup"]["format_version"] == 2
    assert store.list_backups()[0]["format_version"] == 2

    dictionary = volume / ".adds/koreader/data/dict/custom.dict"
    dictionary.unlink()
    store.restore(legacy_backup["id"], confirmed=True, restore_extensions=False, volume=volume)

    assert dictionary.read_bytes() == b"dictionary"


def test_backup_format_version_is_inferred_from_archive_for_legacy_index_rows(tmp_path: Path) -> None:
    store, volume, backup = backup_fixture(tmp_path)
    v2_without_index_version = {key: value for key, value in backup.items() if key != "format_version"}
    store.save_index({"version": 1, "backups": [v2_without_index_version]})

    assert store.list_backups()[0]["format_version"] == 2

    legacy_backup = make_v1_backup(store, volume, backup)
    legacy_without_index_version = {
        key: value for key, value in legacy_backup.items() if key != "format_version"
    }
    store.save_index({"version": 1, "backups": [legacy_without_index_version]})

    assert store.list_backups()[0]["format_version"] == 1


def test_dictionary_object_path_rejects_untrusted_checksum(tmp_path: Path) -> None:
    store = RecoveryBackupStore(tmp_path / "data")

    with pytest.raises(BackupError, match="checksum"):
        store.dictionary_object_path("../../outside")


def test_corrupt_dictionary_deflate_stream_is_reported_and_replaced(tmp_path: Path) -> None:
    store = RecoveryBackupStore(tmp_path / "data")
    payload = b"dictionary"
    checksum = hashlib.sha256(payload).hexdigest()
    object_path = store.dictionary_object_path(checksum)
    object_path.parent.mkdir(parents=True)
    object_path.write_bytes(
        b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x02\xff\x07\x00\x00\x00\x00\x00\x00\x00\x00"
    )

    with zipfile.ZipFile(tmp_path / "backup.zip", "w") as archive:
        with pytest.raises(BackupError, match="unreadable"):
            store.read_payload({"category": "dictionaries", "sha256": checksum}, archive)

    store.store_dictionary_object(payload, checksum)
    assert gzip.decompress(object_path.read_bytes()) == payload


def test_backup_sqlite_payloads_are_consistent_databases(tmp_path: Path) -> None:
    _, _, backup = backup_fixture(tmp_path)

    with zipfile.ZipFile(backup["archive_path"]) as archive:
        for name, expected in (
            ("payload/koreader/settings/statistics.sqlite3", "statistics"),
            ("payload/koreader/settings/vocabulary_builder.sqlite3", "vocabulary"),
        ):
            restored = tmp_path / Path(name).name
            restored.write_bytes(archive.read(name))
            connection = sqlite3.connect(restored)
            try:
                assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
                assert connection.execute("SELECT value FROM values_table").fetchone()[0] == expected
            finally:
                connection.close()


def test_identical_backup_is_deduplicated_but_safety_backup_is_forced(tmp_path: Path) -> None:
    store, volume, first = backup_fixture(tmp_path)

    duplicate = store.create_from_kobo(volume)
    safety = store.create_from_kobo(volume, source="pre-restore-safety", force=True)

    assert duplicate == {"created": False, "backup": first}
    assert safety["created"] is True
    assert safety["backup"]["id"] != first["id"]
    assert len(store.list_backups()) == 2


def test_restore_preview_reports_exact_missing_and_ambiguous_matches(tmp_path: Path) -> None:
    store, source_volume, backup = backup_fixture(tmp_path)
    original_book = source_volume / "Books/Author/Book.epub"
    clean = tmp_path / "CleanKobo"
    clean.mkdir()
    create_koreader_fixture(clean)
    first = clean / "Books/New/Book.epub"
    first.parent.mkdir(parents=True)
    first.write_bytes(original_book.read_bytes())

    preview = store.restore_preview(backup["id"], clean)
    assert preview["exact_matches"][0]["new_doc_path"] == "/mnt/onboard/Books/New/Book.epub"
    assert preview["missing_matches"] == []
    assert preview["ambiguous_matches"] == []

    second = clean / "Books/Other/Book.epub"
    second.parent.mkdir(parents=True)
    second.write_bytes(original_book.read_bytes())
    ambiguous = store.restore_preview(backup["id"], clean)
    assert ambiguous["exact_matches"] == []
    assert len(ambiguous["ambiguous_matches"][0]["candidates"]) == 2

    first.unlink()
    second.unlink()
    missing = store.restore_preview(backup["id"], clean)
    assert missing["exact_matches"] == []
    assert len(missing["missing_matches"]) == 1


def test_backup_calculates_partial_md5_for_legacy_sidecar(tmp_path: Path) -> None:
    store, volume, backup = backup_fixture(tmp_path)
    sidecar = volume / "Books/Author/Book.sdr/metadata.epub.lua"
    sidecar.write_text(
        sidecar.read_text(encoding="utf-8").replace(
            f'["partial_md5_checksum"] = "{partial_md5(volume / "Books/Author/Book.epub")}",',
            "",
        ),
        encoding="utf-8",
    )

    legacy_backup = store.create_from_kobo(volume)["backup"]
    with zipfile.ZipFile(legacy_backup["archive_path"]) as archive:
        manifest = json.loads(archive.read("manifest.json"))

    assert manifest["sidecars"][0]["partial_md5_checksum"] == partial_md5(
        volume / "Books/Author/Book.epub"
    )


def test_backup_ignores_transient_kobo_plugin_cache_sidecars(tmp_path: Path) -> None:
    volume = tmp_path / "KOBOeReader"
    volume.mkdir()
    create_koreader_fixture(volume)
    write_book_and_sidecar(volume)
    cache_id = "075680f1-27da-41a8-a988-5f6a740d2f20"
    cache_sidecar = (
        volume
        / f".adds/koreader/docsettings/tmp/kobo.koplugin.cache/{cache_id}.sdr/metadata.epub.lua"
    )
    cache_sidecar.parent.mkdir(parents=True)
    cache_sidecar.write_text(
        f'return {{ ["doc_path"] = "/tmp/kobo.koplugin.cache/{cache_id}" }}\n',
        encoding="utf-8",
    )

    store = RecoveryBackupStore(tmp_path / "data")
    backup = store.create_from_kobo(volume)["backup"]

    with zipfile.ZipFile(backup["archive_path"]) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    assert all("kobo.koplugin.cache" not in item["source_path"] for item in manifest["sidecars"])


def test_backup_keeps_legacy_history_sidecars_as_separate_records(tmp_path: Path) -> None:
    store, volume, _ = backup_fixture(tmp_path)
    history = volume / ".adds/koreader/history"
    history.mkdir()
    for index in (1, 2):
        path = history / f"[#mnt#onboard#Books#] Legacy {index}.epub.lua"
        path.write_text(
            f"""
            return {{
                ["doc_path"] = "/mnt/onboard/Books/Legacy {index}.epub",
                ["partial_md5_checksum"] = "legacy-{index}",
            }}
            """,
            encoding="utf-8",
        )

    backup = store.create_from_kobo(volume)["backup"]
    with zipfile.ZipFile(backup["archive_path"]) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    legacy_records = [
        record
        for record in manifest["sidecars"]
        if record["source_path"].startswith(".adds/koreader/history/")
    ]

    assert len(legacy_records) == 2
    assert all(len(record["files"]) == 1 for record in legacy_records)


def test_restore_rewrites_paths_drops_stale_entries_and_creates_safety_backup(tmp_path: Path) -> None:
    store, source_volume, backup = backup_fixture(tmp_path, mode="dir")
    clean = tmp_path / "CleanKobo"
    clean.mkdir()
    create_koreader_fixture(clean, mode="doc")
    (clean / ".adds/koreader/plugins/kobo.koplugin/main.lua").unlink()
    (clean / ".adds/koreader/plugins/kobo.koplugin").rmdir()
    new_book = clean / "Books/New Author/New Book.epub"
    new_book.parent.mkdir(parents=True)
    new_book.write_bytes((source_volume / "Books/Author/Book.epub").read_bytes())

    result = store.restore(
        backup["id"],
        confirmed=True,
        restore_extensions=False,
        volume=clean,
    )

    restored_sidecar = (
        clean
        / ".adds/koreader/docsettings/mnt/onboard/Books/New Author/New Book.sdr/metadata.epub.lua"
    )
    assert restored_sidecar.exists()
    assert "/mnt/onboard/Books/New Author/New Book.epub" in restored_sidecar.read_text(encoding="utf-8")
    restored_history = (clean / ".adds/koreader/history.lua").read_text(encoding="utf-8")
    assert "/mnt/onboard/Books/New Author/New Book.epub" in restored_history
    assert "/mnt/onboard/Missing.epub" not in restored_history
    assert result["restored"]["sidecars"] == 1
    assert result["safety_backup_id"]
    assert result["restart_required"] is True
    assert not (clean / ".adds/koreader/plugins/kobo.koplugin").exists()


def test_restore_preserves_non_book_device_paths(tmp_path: Path) -> None:
    store, source_volume, _ = backup_fixture(tmp_path)
    settings = source_volume / ".adds/koreader/settings.reader.lua"
    settings.write_text(
        settings.read_text(encoding="utf-8").replace(
            '["lastfile"] = "/mnt/onboard/Books/Author/Book.epub",',
            '["wallabag_directory"] = "/mnt/onboard/Wallabag",',
        ),
        encoding="utf-8",
    )
    backup = store.create_from_kobo(source_volume)["backup"]
    clean = tmp_path / "CleanKobo"
    clean.mkdir()
    create_koreader_fixture(clean)
    new_book = clean / "Books/New/Book.epub"
    new_book.parent.mkdir(parents=True)
    new_book.write_bytes((source_volume / "Books/Author/Book.epub").read_bytes())

    store.restore(
        backup["id"],
        confirmed=True,
        restore_extensions=False,
        volume=clean,
    )

    restored_settings = (clean / ".adds/koreader/settings.reader.lua").read_text(encoding="utf-8")
    assert '["wallabag_directory"] = "/mnt/onboard/Wallabag"' in restored_settings


def test_restore_raises_when_a_payload_cannot_be_written(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    store, volume, backup = backup_fixture(tmp_path)

    def reject_write(destination: Path, payload: bytes) -> None:
        raise OSError(f"read-only destination: {destination}")

    monkeypatch.setattr("backend.app.backups.write_payload", reject_write)

    with pytest.raises(BackupError, match=r"Restore failed for .*Safety backup"):
        store.restore(
            backup["id"],
            confirmed=True,
            restore_extensions=False,
            volume=volume,
        )


def test_restore_optional_extensions_only_fills_missing_files(tmp_path: Path) -> None:
    store, source_volume, backup = backup_fixture(tmp_path)
    clean = tmp_path / "CleanKobo"
    clean.mkdir()
    create_koreader_fixture(clean)
    existing_plugin = clean / ".adds/koreader/plugins/kobo.koplugin/main.lua"
    existing_plugin.write_text("clean install\n", encoding="utf-8")
    new_book = clean / "Book.epub"
    new_book.write_bytes((source_volume / "Books/Author/Book.epub").read_bytes())

    store.restore(
        backup["id"],
        confirmed=True,
        restore_extensions=True,
        volume=clean,
    )

    assert existing_plugin.read_text(encoding="utf-8") == "clean install\n"
    assert (clean / ".adds/koreader/patches/2-custom.lua").exists()


def test_restore_requires_confirmation_and_rejects_checksum_changes(tmp_path: Path) -> None:
    store, volume, backup = backup_fixture(tmp_path)

    with pytest.raises(BackupError, match="confirmation"):
        store.restore(backup["id"], confirmed=False, restore_extensions=False, volume=volume)

    archive_path = Path(backup["archive_path"])
    with zipfile.ZipFile(archive_path, "a") as archive:
        archive.writestr("payload/koreader/settings.reader.lua", b"tampered")

    with pytest.raises(BackupError, match="checksum"):
        store.restore_preview(backup["id"], volume)


def test_restore_rejects_path_traversal_in_archive(tmp_path: Path) -> None:
    store, volume, backup = backup_fixture(tmp_path)
    archive_path = Path(backup["archive_path"])
    with zipfile.ZipFile(archive_path, "a") as archive:
        archive.writestr("../escape", b"bad")

    with pytest.raises(BackupError, match="unsafe path"):
        store.restore_preview(backup["id"], volume)
