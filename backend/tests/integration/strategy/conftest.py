"""Skip gate for the Strategy Phase 1 e2e harnesses.

These exercise the full bridge (web StrategyClient → coord
/coord/auth/service-token → /strategy/* → substrate git). They are
OFF by default and only run when explicitly opted in AND the service
deps are actually present:

  STRATEGY_E2E_TESTS=1
  COORD_URL                (default http://localhost:9870) reachable
  COORD_ADMIN_SECRET       set (coord must share the same value)
  coord configured with STRATEGY_SUBSTRATE_PATH

In CI today these skip cleanly (coord isn't deployed yet — Phase 1
code lands now, goes live on the next coord deploy). The
deterministic cache TTL-expiry + per-key isolation behaviour is
covered separately and unconditionally by the coord-side Rust unit
test `strategy::tests::cache_hit_within_ttl_then_miss_after_expiry`.
"""

from __future__ import annotations

import os
import socket
from urllib.parse import urlparse

import pytest

COORD_URL = os.getenv("COORD_URL", "http://localhost:9870")
ADMIN_SECRET = os.getenv("COORD_ADMIN_SECRET")


def _coord_reachable() -> bool:
    try:
        u = urlparse(COORD_URL)
        with socket.create_connection(
            (u.hostname or "localhost", u.port or 80), timeout=1.0
        ):
            return True
    except OSError:
        return False


_skip_reason = None
if os.getenv("STRATEGY_E2E_TESTS") != "1":
    _skip_reason = "STRATEGY_E2E_TESTS != 1 (opt-in)"
elif not ADMIN_SECRET:
    _skip_reason = "COORD_ADMIN_SECRET unset"
elif not _coord_reachable():
    _skip_reason = f"coord unreachable at {COORD_URL}"

pytestmark = pytest.mark.skipif(_skip_reason is not None, reason=_skip_reason or "")
