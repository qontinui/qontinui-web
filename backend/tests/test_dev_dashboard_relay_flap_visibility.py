"""The fleet view must tell a FLAPPING relay from one that never connected.

RT6 of plan
``2026-08-30-mobile-account-usage-relay-503-runner-runtime-starvation``.

A mobile "Account Usage" 503 is ``coord.devices.ws_session_id IS NULL``. Two
different faults produce it — a runner that never registered, and a runner that
registers and drops every few seconds — and they need opposite remedies. The
runner already reported a tri-state ``connected`` (qontinui-runner
``0a8f06579``), which closed the "silent for days" half of the problem and left
this half open: a flapping relay reports ``True`` in whichever heartbeat lands
inside a connection, so ``connected`` alone renders both faults identically.

These tests pin the three properties that make them distinguishable off-box.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from app.schemas.dev_dashboard import RunnerHeartbeat, RunnerRelay
from app.services.dev_dashboard_service import FleetRegistry


def _heartbeat(**relay_fields: object) -> RunnerHeartbeat:
    return RunnerHeartbeat(
        hostname="box",
        ip="192.168.1.10",
        port=9876,
        os="windows",
        relay=RunnerRelay(**relay_fields) if relay_fields else None,
    )


def test_a_runner_that_predates_the_field_reads_unknown_not_healthy() -> None:
    """Absent is UNKNOWN. It must not be filled in with a confident default."""
    registry = FleetRegistry()
    runner = asyncio.run(registry.register_heartbeat(_heartbeat()))
    assert runner.relay is None


def test_flapping_and_steady_differ_only_in_the_streak() -> None:
    """The property a bare ``connected`` boolean cannot express.

    Both runners report ``connected=True`` at the instant of the heartbeat. The
    streak is the only field that says one of them cannot hold the socket.
    """
    registry = FleetRegistry()
    flapping = asyncio.run(
        registry.register_heartbeat(
            RunnerHeartbeat(
                hostname="flapper",
                ip="192.168.1.11",
                port=9876,
                os="windows",
                relay=RunnerRelay(
                    connected=True,
                    consecutive_quick_disconnects=4,
                    last_connected_at_ms=1_756_000_000_000,
                ),
            )
        )
    )
    steady = asyncio.run(
        registry.register_heartbeat(
            RunnerHeartbeat(
                hostname="steady",
                ip="192.168.1.12",
                port=9876,
                os="windows",
                relay=RunnerRelay(
                    connected=True,
                    consecutive_quick_disconnects=0,
                    last_connected_at_ms=1_756_000_000_000,
                ),
            )
        )
    )

    assert flapping.relay is not None and steady.relay is not None
    assert flapping.relay.connected == steady.relay.connected
    assert flapping.relay.consecutive_quick_disconnects == 4
    assert steady.relay.consecutive_quick_disconnects == 0


def test_never_registered_is_distinguishable_from_registered_then_dropped() -> None:
    """``last_connected_at_ms`` is the discriminator; both report connected=False."""
    registry = FleetRegistry()
    never = asyncio.run(
        registry.register_heartbeat(
            RunnerHeartbeat(
                hostname="never",
                ip="192.168.1.13",
                port=9876,
                os="windows",
                relay=RunnerRelay(
                    connected=False,
                    last_error="401 Unauthorized",
                    consecutive_quick_disconnects=0,
                    last_connected_at_ms=None,
                ),
            )
        )
    )
    dropped = asyncio.run(
        registry.register_heartbeat(
            RunnerHeartbeat(
                hostname="dropped",
                ip="192.168.1.14",
                port=9876,
                os="windows",
                relay=RunnerRelay(
                    connected=False,
                    consecutive_quick_disconnects=6,
                    last_connected_at_ms=1_756_000_000_000,
                ),
            )
        )
    )

    assert never.relay is not None and dropped.relay is not None
    assert never.relay.connected == dropped.relay.connected
    assert never.relay.last_connected_at_ms is None
    assert dropped.relay.last_connected_at_ms == 1_756_000_000_000


def test_a_stale_runners_last_relay_state_survives_going_unhealthy() -> None:
    """The case RT6 exists for.

    When the box stops answering, nothing can be asked of it — so the last relay
    state it managed to report is the only evidence available. Marking the
    runner unhealthy must not blank it.
    """
    registry = FleetRegistry()
    asyncio.run(
        registry.register_heartbeat(
            RunnerHeartbeat(
                hostname="wedged",
                ip="192.168.1.15",
                port=9876,
                os="windows",
                relay=RunnerRelay(
                    connected=False,
                    last_error="WS connect exceeded 20s with no handshake response",
                    consecutive_quick_disconnects=7,
                    last_connected_at_ms=1_756_000_000_000,
                ),
            )
        )
    )

    # Age the stored heartbeat past the 90s health window.
    stored = registry._runners["wedged:9876"]  # noqa: SLF001
    stored.last_heartbeat = datetime.now(UTC) - timedelta(seconds=600)

    status = asyncio.run(registry.get_fleet_status())
    (runner,) = [r for r in status.runners if r.id == "wedged:9876"]

    assert runner.is_healthy is False, "the runner is stale"
    assert runner.relay is not None, "its last relay reading must survive"
    assert runner.relay.consecutive_quick_disconnects == 7
    assert (
        runner.relay.last_error == "WS connect exceeded 20s with no handshake response"
    )
