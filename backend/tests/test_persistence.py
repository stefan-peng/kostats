import json
import multiprocessing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from backend.app.devices import DeviceRegistry
from backend.app.persistence import atomic_json
from backend.app.storage import SnapshotStore
from backend.tests.test_storage_device import create_db


def add_device(arguments):
    root, index = arguments
    DeviceRegistry(Path(root)).create_manual(f'Device {index}')


def test_registry_updates_across_instances_and_threads(tmp_path: Path):
    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(add_device, [(str(tmp_path), i) for i in range(16)]))
    assert len(DeviceRegistry(tmp_path).list_devices()) == 16


def test_registry_updates_across_processes(tmp_path: Path):
    with multiprocessing.get_context('spawn').Pool(3) as pool:
        pool.map(add_device, [(str(tmp_path), i) for i in range(12)])
    assert len(DeviceRegistry(tmp_path).list_devices()) == 12


def test_concurrent_imports_do_not_lose_manifest_entries(tmp_path: Path):
    source = tmp_path / 'source.sqlite3'
    create_db(source)
    root = tmp_path / 'data'
    with ThreadPoolExecutor(max_workers=6) as executor:
        snapshots = list(executor.map(lambda _: SnapshotStore(root).import_file(source, source_kind='upload'), range(12)))
    assert {row['id'] for row in SnapshotStore(root).list_snapshots()} == {item.id for item in snapshots}
    assert len(snapshots) == 12


def test_atomic_write_failure_preserves_old_index_and_removes_temp(monkeypatch, tmp_path: Path):
    path = tmp_path / 'manifest.json'
    atomic_json(path, {'before': 1})

    def fail_replace(*args):
        raise OSError('interrupted')
    monkeypatch.setattr(Path, 'replace', fail_replace)
    with pytest.raises(OSError, match='interrupted'):
        atomic_json(path, {'after': 2})
    assert json.loads(path.read_text()) == {'before': 1}
    assert list(tmp_path.glob('*.tmp')) == []
    assert list(tmp_path.glob('.*.tmp')) == []
