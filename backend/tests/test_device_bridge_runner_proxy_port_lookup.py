"""Regression test for the device-bridge runner-proxy port lookup.

The Unified Devices Registry migration (Phase 5/8 of
``D:/qontinui-root/plans/2026-05-18-unified-devices-registry.md``)
renamed ``auth.runners`` → ``coord.devices``. The port-lookup SQL in
:func:`app.api.v1.endpoints.device_bridge_ws.runner_proxy` still
referenced the old table for several weeks, fell through to
``UndefinedTable``, and the ``runner_proxy_port_lookup_failed`` log
event fired on every mobile proxy call. The code's fallback to the
default port 9876 masked the breakage from end-users but spammed the
log channel — and any time the runner ran on a non-default port the
lookup would silently return the wrong destination.

This test pins the post-fix query shape:

* The SQL targets ``coord.devices`` (NOT the renamed ``runners``).
* It filters on ``capability_user_paired = true`` so only user-paired
  runner rows (not coord-only fleet devices that share the unified
  table) are considered.
* It keeps the legacy ``user_id`` + ``ws_session_id IS NOT NULL`` +
  ``ORDER BY ws_connected_at DESC`` selection rule.
"""

from __future__ import annotations

import re

from app.api.v1.endpoints import device_bridge_ws


def _normalize_ws(s: str) -> str:
    """Collapse runs of whitespace to a single space for substring matching."""
    return re.sub(r"\s+", " ", s).strip()


def test_runner_proxy_port_lookup_targets_coord_devices() -> None:
    """The runner-proxy port-lookup SQL must target ``coord.devices``.

    We don't execute the query — we read the source of the
    ``runner_proxy`` handler and assert the literal SQL it constructs
    is the post-migration shape. This is intentionally a source-level
    pin: the SQL is built inline, the handler has no DI seam to mock
    cheaply, and the regression is observable as "the file changed
    such that the renamed table reappears". A source-level assertion
    catches that with zero infrastructure.
    """
    import inspect

    source = _normalize_ws(inspect.getsource(device_bridge_ws.runner_proxy))

    # The renamed table must be gone — the regression we're pinning.
    # ``FROM runners`` would re-introduce ``runner_proxy_port_lookup_failed``
    # log spam on every mobile proxy call.
    assert "FROM runners" not in source, (
        "runner_proxy still queries the legacy ``runners`` table; the "
        "Unified Devices Registry migration renamed it to coord.devices."
    )

    # The new canonical table.
    assert "FROM coord.devices" in source, (
        "runner_proxy must query coord.devices for the port lookup."
    )

    # Selection rule preserved.
    assert "user_id = :uid" in source
    assert "ws_session_id IS NOT NULL" in source
    assert "ORDER BY ws_connected_at DESC" in source

    # We only want user-paired runner rows, not coord-only fleet
    # devices that share the unified table.
    assert "capability_user_paired = true" in source
