"""Unit tests for ``app.core.db_pool_metrics``.

Covers the gauge computation (``pool_stats``) and the debounced
``db_pool_high_occupancy`` warning (``PoolOccupancyWatcher``) with a fake
pool + fake clock. The logger is monkeypatched with a MagicMock so the
assertions are independent of however structlog happens to be configured by
sibling tests.
"""

from unittest.mock import MagicMock

import pytest

from app.core import db_pool_metrics
from app.core.db_pool_metrics import PoolOccupancyWatcher, pool_stats


class FakePool:
    """The QueuePool slice the gauges read (see ``PoolLike``)."""

    def __init__(self, checked_out: int, overflow: int, size: int) -> None:
        self._checked_out = checked_out
        self._overflow = overflow
        self._size = size

    def checkedout(self) -> int:
        return self._checked_out

    def overflow(self) -> int:
        return self._overflow

    def size(self) -> int:
        return self._size


class FakeClock:
    def __init__(self, now: float = 1000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def mock_logger(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    fake = MagicMock()
    monkeypatch.setattr(db_pool_metrics, "logger", fake)
    return fake


def _warnings(mock_logger: MagicMock) -> list:
    return [
        call
        for call in mock_logger.warning.call_args_list
        if call.args[0] == "db_pool_high_occupancy"
    ]


# ---------------------------------------------------------------- pool_stats


def test_pool_stats_computation() -> None:
    stats = pool_stats(FakePool(checked_out=12, overflow=2, size=10), max_overflow=15)

    assert stats == {
        "checked_out": 12,
        "overflow": 2,
        "size": 10,
        "max_overflow": 15,
        "capacity": 25,
        "occupancy": 0.48,
    }


def test_pool_stats_clamps_negative_overflow() -> None:
    # QueuePool.overflow() reads negative while the pool is below base size.
    stats = pool_stats(FakePool(checked_out=1, overflow=-9, size=10), max_overflow=15)

    assert stats["overflow"] == 0


def test_pool_stats_zero_capacity_is_zero_occupancy() -> None:
    stats = pool_stats(FakePool(checked_out=0, overflow=0, size=0), max_overflow=0)

    assert stats["occupancy"] == 0.0


# ------------------------------------------------------ PoolOccupancyWatcher


def test_warns_at_high_occupancy(mock_logger: MagicMock) -> None:
    watcher = PoolOccupancyWatcher(clock=FakeClock())

    # 20 / (10 + 15) = 0.8 >= 0.7 threshold
    stats = watcher.observe(FakePool(checked_out=20, overflow=10, size=10), 15)

    assert stats["occupancy"] == 0.8
    warnings = _warnings(mock_logger)
    assert len(warnings) == 1
    assert warnings[0].kwargs["checked_out"] == 20
    assert warnings[0].kwargs["capacity"] == 25


def test_no_warning_below_threshold(mock_logger: MagicMock) -> None:
    watcher = PoolOccupancyWatcher(clock=FakeClock())

    # 10 / 25 = 0.4 < 0.7
    watcher.observe(FakePool(checked_out=10, overflow=0, size=10), 15)

    assert _warnings(mock_logger) == []


def test_warning_debounced_then_reemitted(mock_logger: MagicMock) -> None:
    clock = FakeClock()
    watcher = PoolOccupancyWatcher(clock=clock)
    hot_pool = FakePool(checked_out=20, overflow=10, size=10)

    watcher.observe(hot_pool, 15)  # warns
    clock.now += 10.0
    watcher.observe(hot_pool, 15)  # inside 30s window -> suppressed
    clock.now += 25.0
    watcher.observe(hot_pool, 15)  # 35s since last warning -> warns again

    assert len(_warnings(mock_logger)) == 2


def test_below_threshold_does_not_consume_debounce(mock_logger: MagicMock) -> None:
    clock = FakeClock()
    watcher = PoolOccupancyWatcher(clock=clock)

    watcher.observe(FakePool(checked_out=2, overflow=0, size=10), 15)  # quiet
    watcher.observe(FakePool(checked_out=20, overflow=10, size=10), 15)  # hot

    # The quiet observation must not have started the debounce window.
    assert len(_warnings(mock_logger)) == 1
