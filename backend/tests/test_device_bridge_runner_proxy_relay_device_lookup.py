"""Regression test for the device-bridge runner-proxy *relay* device lookup.

History: the Remote-mode relay path
(:func:`app.api.v1.endpoints.device_bridge_ws._runner_proxy_relay`) resolved
the target device with a raw-SQL ownership lookup against ``coord.devices``
(``SELECT device_id, ws_session_id FROM coord.devices WHERE device_id=:id
AND user_id=:uid AND capability_user_paired``).

Phase 3 of ``2026-05-30-web-coord-schema-boundary-decoupling.md`` moved that
read off coord's Postgres schema onto coord's HTTP boundary
(``GET /coord/devices/:id/routing`` via
:func:`app.services.coord_device.get_device_routing`, ownership-checked
coord-side, 404 → ``None``). This test pins the post-migration shape:

* the relay handler no longer contains any ``coord.devices`` SQL string, and
* it sources the device's ws-session from the coord routing client.

The behavioural cases (404 on unowned, 503 on null ws_session, 502/504 on
coord transport faults) are covered by
``test_device_bridge_runner_proxy_relay.py``.
"""

from __future__ import annotations

import inspect

from app.api.v1.endpoints import device_bridge_ws


def test_runner_proxy_relay_no_longer_reads_coord_devices_sql() -> None:
    """The relay device lookup must not contain ``coord.devices`` SQL."""
    source = inspect.getsource(device_bridge_ws._runner_proxy_relay)

    # No raw-SQL execution machinery remains in the handler body (we check
    # the execution seams rather than the literal `FROM coord.devices`
    # token, since the explanatory comment quotes the former SQL).
    assert "AsyncSessionLocal" not in source, (
        "_runner_proxy_relay still opens a DB session for the device lookup; "
        "the read moved onto coord's GET /coord/devices/:id/routing."
    )
    assert "text(" not in source, (
        "_runner_proxy_relay still builds raw SQL for the device lookup."
    )
    assert "get_device_routing" in source, (
        "_runner_proxy_relay must source the device routing from the coord "
        "routing client."
    )
