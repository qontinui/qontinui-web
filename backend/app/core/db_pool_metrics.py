"""DB connection-pool observability: gauges + debounced high-occupancy warning.

The backend's operational metric surface is structured logging (structlog ->
JSON ``logs/app.log``; see ``database_pool_configured`` in ``app.db.session``)
plus the polled ``/health`` endpoint. There is no Prometheus registry, and
``MetricsMiddleware`` tracks per-user API metrics only — so pool gauges follow
the existing idioms rather than inventing a new metrics system:

* ``pool_stats`` computes the gauge snapshot (checked-out, overflow, size,
  capacity, occupancy) from the engine pool's sync facade.
* ``PoolOccupancyWatcher`` emits a ``db_pool_high_occupancy`` WARNING when
  occupancy crosses the threshold, debounced so a saturated pool does not
  spam a warning per request.
* ``observe_async_engine_pool`` glues both to the app engine; it is sampled
  per-request by ``MetricsMiddleware`` and exposed to pollers via ``/health``.

The typed 503 handlers in ``app.middleware.error_handler`` are the saturation
*alarm* signal (``db_pool_exhausted`` logs every pool-checkout timeout). An
infra alarm on these log events is operator follow-up, not code in this repo.
"""

import time
from collections.abc import Callable
from typing import Protocol, cast

import structlog

logger = structlog.get_logger(__name__)

# Warn when checked-out connections exceed this fraction of total capacity
# (pool size + max overflow).
HIGH_OCCUPANCY_THRESHOLD = 0.7

# Minimum seconds between two db_pool_high_occupancy warnings.
WARN_DEBOUNCE_SECONDS = 30.0


class PoolLike(Protocol):
    """The slice of SQLAlchemy's QueuePool API the gauges read."""

    def checkedout(self) -> int: ...

    def overflow(self) -> int: ...

    def size(self) -> int: ...


def pool_stats(pool: PoolLike, max_overflow: int) -> dict[str, int | float]:
    """Compute the pool gauge snapshot.

    ``max_overflow`` is passed in (from ``app.db.session``) because QueuePool
    exposes no public accessor for it — only the current ``overflow()`` count,
    which is clamped at 0 here since it reads negative while the pool is
    below its base size.
    """
    size = pool.size()
    checked_out = pool.checkedout()
    overflow = max(pool.overflow(), 0)
    capacity = size + max_overflow
    occupancy = checked_out / capacity if capacity > 0 else 0.0
    return {
        "checked_out": checked_out,
        "overflow": overflow,
        "size": size,
        "max_overflow": max_overflow,
        "capacity": capacity,
        "occupancy": round(occupancy, 3),
    }


class PoolOccupancyWatcher:
    """Emits a debounced WARNING when pool occupancy runs high.

    Only actual warnings advance the debounce clock, so a brief dip below
    the threshold never masks the next excursion.
    """

    def __init__(
        self,
        threshold: float = HIGH_OCCUPANCY_THRESHOLD,
        debounce_seconds: float = WARN_DEBOUNCE_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._threshold = threshold
        self._debounce_seconds = debounce_seconds
        self._clock = clock
        self._last_warned_at: float | None = None

    def observe(self, pool: PoolLike, max_overflow: int) -> dict[str, int | float]:
        """Snapshot the pool; warn (debounced) if occupancy is high."""
        stats = pool_stats(pool, max_overflow)
        if stats["occupancy"] >= self._threshold and self._should_warn():
            logger.warning("db_pool_high_occupancy", **stats)
        return stats

    def _should_warn(self) -> bool:
        now = self._clock()
        if (
            self._last_warned_at is not None
            and now - self._last_warned_at < self._debounce_seconds
        ):
            return False
        self._last_warned_at = now
        return True


# Process-wide watcher shared by MetricsMiddleware and /health.
pool_watcher = PoolOccupancyWatcher()


def observe_async_engine_pool() -> dict[str, int | float]:
    """Sample the app engine's pool through the shared watcher.

    Imports lazily so importing this module never constructs the engines
    (keeps unit tests light and avoids import cycles).
    """
    from app.db.session import async_engine, max_overflow

    # The engine is statically typed as holding a base Pool, but at runtime
    # it is an AsyncAdaptedQueuePool, which implements the PoolLike methods.
    return pool_watcher.observe(cast(PoolLike, async_engine.pool), max_overflow)
