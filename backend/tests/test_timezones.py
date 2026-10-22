import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from backend.app.sqlite_stats import local_dt, local_timezone


@pytest.mark.skipif(not hasattr(time, 'tzset'), reason='OS does not expose tzset')
@pytest.mark.parametrize('name', ['America/New_York', 'Europe/Berlin', 'Asia/Kathmandu', 'UTC', ''])
def test_cached_timezone_matches_os_including_dst(monkeypatch, name):
    original = os.environ.get('TZ')
    try:
        monkeypatch.setenv('TZ', name)
        time.tzset()
        zone = local_timezone()
        assert zone is not None
        for value in [1705320000, 1721044800, 1710053999, 1710054000, 1730611800, 1730615400]:
            expected = datetime.fromtimestamp(value).astimezone()
            actual = local_dt(value, zone)
            assert actual.isoformat() == expected.isoformat()
            assert actual.tzname() == expected.tzname()
            assert (actual + timedelta(hours=1)).timestamp() == (expected + timedelta(hours=1)).timestamp()
    finally:
        if original is None:
            os.environ.pop('TZ', None)
        else:
            os.environ['TZ'] = original
        time.tzset()


def test_missing_system_timezone_uses_os_fallback(monkeypatch):
    monkeypatch.delenv('TZ', raising=False)
    monkeypatch.setattr(Path, 'open', lambda *args, **kwargs: (_ for _ in ()).throw(FileNotFoundError()))
    assert local_timezone() is None
    value = 1721044800
    assert local_dt(value).isoformat() == datetime.fromtimestamp(value, timezone.utc).astimezone().isoformat()


def test_timezone_changes_are_loaded_for_each_build(monkeypatch):
    monkeypatch.setenv('TZ', 'America/New_York')
    first = local_timezone()
    monkeypatch.setenv('TZ', 'Europe/Berlin')
    second = local_timezone()
    assert first == ZoneInfo('America/New_York')
    assert second == ZoneInfo('Europe/Berlin')
