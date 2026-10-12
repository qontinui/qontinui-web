"""Replace ``asyncio.sleep`` for ``app.services.coord_proxy`` ONLY.

``post_to_coord`` backs off with ``asyncio.sleep``, and its tests replace that
sleep so a retry costs no wall time. Patching
``app.services.coord_proxy.asyncio.sleep`` looks module-scoped but is not: it
sets the ``sleep`` attribute of the ONE process-wide ``asyncio`` module, so
every ``asyncio.sleep`` awaited anywhere while the patch is active (a test's
own, a background task's) returns at once and is recorded by the mock. A test
asserting the exact backoff sequence then reads stray entries — qontinui-web
#1718's shard 6/6 read ``[0.5, 1.5, 0.7789, 0.7788, ...]`` on 2026-10-06.

:func:`patch_coord_proxy_sleep` instead rebinds the ``asyncio`` NAME inside
``coord_proxy`` to a :class:`ScopedAsyncio` whose ``sleep`` is the mock and
whose every other attribute is the real module's.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch


class ScopedAsyncio:
    """Stands in for ``asyncio`` inside ``app.services.coord_proxy``:
    ``sleep`` is ``sleep``, everything else is the real module's."""

    def __init__(self, sleep: AsyncMock) -> None:
        self.sleep = sleep

    def __getattr__(self, name: str) -> Any:
        return getattr(asyncio, name)


def patch_coord_proxy_sleep(sleep: AsyncMock | None = None) -> Any:
    """A ``patch`` context manager replacing coord_proxy's ``asyncio.sleep``
    with ``sleep`` (a fresh ``AsyncMock`` when not given), and nothing else."""
    return patch(
        "app.services.coord_proxy.asyncio",
        new=ScopedAsyncio(sleep if sleep is not None else AsyncMock()),
    )
