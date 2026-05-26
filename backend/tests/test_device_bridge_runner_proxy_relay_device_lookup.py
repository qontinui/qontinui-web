"""Regression test for the device-bridge runner-proxy *relay* device lookup.

The Remote-mode relay path (:func:`app.api.v1.endpoints.device_bridge_ws._runner_proxy_relay`)
resolves the target device with a raw-SQL lookup against ``coord.devices``
before publishing the ``http_request`` envelope on the runner's Redis
command channel.

The Unified Devices Registry migration renamed the registry's primary key
to ``device_id``; the old ``id`` column no longer exists in SQL (the
``app/models/device.py`` model exposes ``id`` only as a Python ``@property``
alias, invisible to raw SQL — see the explicit warning there). The relay
lookup, however, still ran::

    SELECT id, ws_session_id FROM coord.devices WHERE id = :device_id ...

which raised ``UndefinedColumnError: column "id" does not exist``. That was
swallowed by a broad ``except Exception`` and returned a misleading
``502 {"detail": "device lookup failed"}`` — the final blocker for
mobile->runner Remote-mode connections. The sibling *port* lookup in the
same module was already pinned to ``device_id`` by
``test_device_bridge_runner_proxy_port_lookup.py``.

This test pins the post-fix relay query shape:

* The SQL targets ``coord.devices``.
* It references the real PK column ``device_id`` (NOT a bare ``id``).
* It keeps the ownership + pairing filters (``user_id``,
  ``capability_user_paired = true``).

Like the sibling test, this is a source-level pin: the SQL is built inline
and the handler has no cheap DI seam, so we read the handler source rather
than executing the query (no live DB required).
"""

from __future__ import annotations

import inspect
import re

from app.api.v1.endpoints import device_bridge_ws


def _normalize_ws(s: str) -> str:
    """Collapse runs of whitespace to a single space for substring matching."""
    return re.sub(r"\s+", " ", s).strip()


def test_runner_proxy_relay_device_lookup_uses_device_id() -> None:
    """The relay device lookup must target ``coord.devices.device_id``."""
    source = _normalize_ws(inspect.getsource(device_bridge_ws._runner_proxy_relay))

    # The relay must query the unified registry table.
    assert "FROM coord.devices" in source, (
        "_runner_proxy_relay must query coord.devices for the device lookup."
    )

    # It must use the real PK column name. The migration renamed the PK to
    # ``device_id``; ``id`` exists only as a Python @property alias and is
    # invisible to raw SQL, so a bare ``id`` reference raises
    # ``UndefinedColumnError`` and strands every Remote-mode connection.
    assert "device_id = :device_id" in source, (
        "_runner_proxy_relay must filter on the real PK column device_id."
    )
    assert "SELECT device_id, ws_session_id" in source, (
        "_runner_proxy_relay must SELECT the real PK column device_id."
    )

    # Guard against the regression returning: no bare ``id`` column
    # reference in the lookup SQL itself (``device_id`` is fine; a
    # standalone ``id`` token is the bug). We scope the check to the
    # SELECT...coord.devices statement so explanatory comments/docstrings
    # mentioning the old ``id`` column don't trip it.
    sql_match = re.search(r"SELECT .*?FROM coord\.devices[^\"']*", source)
    assert sql_match is not None, "could not locate the relay lookup SQL"
    sql = sql_match.group(0)
    assert not re.search(r"(?<![A-Za-z0-9_.:])id\b", sql), (
        "_runner_proxy_relay references a bare ``id`` column; coord.devices "
        "has no ``id`` column (PK is device_id)."
    )

    # Ownership + pairing filters preserved.
    assert "user_id = :uid" in source
    assert "capability_user_paired = true" in source
