"""Web half of the devenv enroll transport (plan 2026-08-05, Phase 2).

Two things are pinned here, both of which fail *silently* if they regress —
which is the whole reason the plan carries them:

1. ``devices_ws._route_device_message`` must have an arm for
   ``devenv_enroll_ack``. That router is a CLOSED set of ``msg_type`` arms
   ending in ``logger.debug("devices_ws_unhandled_message")``, so a new inbound
   type without an arm is dropped at debug level and nothing raises its hand.
   The same bug already shipped once for the runner's terminal-RPC replies (see
   the comment block in ``devices_ws``), and for enrollment the ack is the only
   evidence a directive ever reached the box. The tests therefore assert the
   ack is **routed** — not merely that it was sent — by checking it does NOT
   reach the fall-through.

2. ``RunnerWebSocketManager.send_devenv_enroll`` must build the same envelope
   shape as ``send_dispatch`` and delegate to the relay, keeping the
   ``require_local_connection`` default strict.

The Phase-1 shadow-probe tests that also lived here are gone with the probe
itself: Phase 4's engine emits ``devenv_auto_enroll_decision`` for the same
question, off the connect hot path, and its failure-must-read-as-UNKNOWN
property is asserted in ``test_devenv_auto_enroll.py`` against the engine.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1.endpoints import devices_ws


class _Manager:
    """Minimal stub for ``runner_websocket_manager`` used by the router."""

    def __init__(self) -> None:
        self.send_terminal_response_to_mobiles = AsyncMock()
        self.send_response_to_frontends = AsyncMock()
        self.send_chat_response_to_mobiles = AsyncMock()
        self.get_websocket = lambda _id: None
        self.refresh_ttl = AsyncMock()


def _events(mock_logger_method) -> list[str]:
    """The event names a structlog mock was called with (first positional arg)."""
    return [c.args[0] for c in mock_logger_method.call_args_list if c.args]


@pytest.mark.asyncio
async def test_devenv_enroll_ack_is_routed_not_dropped(monkeypatch) -> None:
    """The ack reaches its own arm and never the unhandled fall-through."""
    fake_logger = MagicMock()
    monkeypatch.setattr(devices_ws, "logger", fake_logger)

    manager = _Manager()
    msg: dict[str, Any] = {
        "type": "devenv_enroll_ack",
        "machine_id": "m-1",
        "ok": True,
    }
    await devices_ws._route_device_message(msg, "dev-1", "user-1", manager)

    # Routed: logged at INFO under its own event name...
    assert "devices_ws_devenv_enroll_ack" in _events(fake_logger.info)
    # ...and NOT silently discarded by the closed-set fall-through.
    assert "devices_ws_unhandled_message" not in _events(fake_logger.debug)

    kwargs = fake_logger.info.call_args.kwargs
    assert kwargs["device_id"] == "dev-1"
    assert kwargs["machine_id"] == "m-1"
    assert kwargs["ok"] is True


@pytest.mark.asyncio
async def test_devenv_enroll_ack_failure_carries_reason(monkeypatch) -> None:
    """A failed enroll must surface WHY, not just that it failed."""
    fake_logger = MagicMock()
    monkeypatch.setattr(devices_ws, "logger", fake_logger)

    manager = _Manager()
    msg: dict[str, Any] = {
        "type": "devenv_enroll_ack",
        "machine_id": "m-2",
        "ok": False,
        "reason": "kill switch set",
    }
    await devices_ws._route_device_message(msg, "dev-2", "user-1", manager)

    assert "devices_ws_devenv_enroll_ack" in _events(fake_logger.info)
    assert "devices_ws_unhandled_message" not in _events(fake_logger.debug)
    kwargs = fake_logger.info.call_args.kwargs
    assert kwargs["ok"] is False
    assert kwargs["reason"] == "kill switch set"


@pytest.mark.asyncio
async def test_ack_is_not_relayed_to_frontends_or_mobiles() -> None:
    """The ack is a server-side signal; it must not leak onto UI channels."""
    manager = _Manager()
    await devices_ws._route_device_message(
        {"type": "devenv_enroll_ack", "ok": True}, "dev-1", "user-1", manager
    )
    manager.send_response_to_frontends.assert_not_called()
    manager.send_terminal_response_to_mobiles.assert_not_called()
    manager.send_chat_response_to_mobiles.assert_not_called()


@pytest.mark.asyncio
async def test_unknown_type_still_hits_the_fallthrough(monkeypatch) -> None:
    """Control: the fall-through is real, so the assertions above mean something.

    Without this, "not in unhandled" could pass simply because the fall-through
    never fires in this harness.
    """
    fake_logger = MagicMock()
    monkeypatch.setattr(devices_ws, "logger", fake_logger)

    manager = _Manager()
    await devices_ws._route_device_message(
        {"type": "devenv_enroll_ack_typo"}, "dev-1", "user-1", manager
    )

    assert "devices_ws_unhandled_message" in _events(fake_logger.debug)


@pytest.mark.asyncio
async def test_send_devenv_enroll_envelope_and_delegation() -> None:
    """The manager method mirrors ``send_dispatch``'s envelope + delegation."""
    from app.services.runner_websocket_manager import RunnerWebSocketManager

    manager = RunnerWebSocketManager.__new__(RunnerWebSocketManager)
    relay = MagicMock()
    relay.send_command_to_runner = AsyncMock(return_value=True)
    manager._relay = relay  # type: ignore[attr-defined]

    rid = "11111111-1111-1111-1111-111111111111"
    ok = await manager.send_devenv_enroll(
        rid, {"enrollment_code": "ABC123", "machine_id": "m-9"}
    )

    assert ok is True
    sent_rid, msg = relay.send_command_to_runner.call_args.args
    assert sent_rid == rid
    assert msg == {
        "type": "devenv_enroll",
        "enrollment_code": "ABC123",
        "machine_id": "m-9",
    }
    # The default stays STRICT: the connect-handler caller owns the socket, so
    # the in-process gate is the correct one there.
    assert (
        relay.send_command_to_runner.call_args.kwargs["require_local_connection"]
        is True
    )


@pytest.mark.asyncio
async def test_send_devenv_enroll_can_opt_out_of_local_gate() -> None:
    """Cross-process callers that confirmed via Redis publish over pub/sub."""
    from app.services.runner_websocket_manager import RunnerWebSocketManager

    manager = RunnerWebSocketManager.__new__(RunnerWebSocketManager)
    relay = MagicMock()
    relay.send_command_to_runner = AsyncMock(return_value=False)
    manager._relay = relay  # type: ignore[attr-defined]

    ok = await manager.send_devenv_enroll(
        "dev-x", {"machine_id": "m-1"}, require_local_connection=False
    )

    assert ok is False
    assert (
        relay.send_command_to_runner.call_args.kwargs["require_local_connection"]
        is False
    )
