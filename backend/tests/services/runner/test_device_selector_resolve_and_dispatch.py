"""Unit tests for the shared runner-selection and dispatch-error helpers.

``get_owned_runner_or_404`` / ``resolve_runner_for_request`` /
``dispatch_or_http_error`` in ``app.services.runner.device_selector`` replace
the copies that lived in five selection sites and seven dispatch sites. These
tests pin the contract every adopter now inherits: the ``runner_not_found``
404 (the authorization-bearing ownership comparison), the 503 carrying the
CALLER's endpoint string, the auto-pick fallback, and the 503/504 bodies and
structlog event names of the dispatch mapper.

No database: ``runner_crud.get_runner`` is monkeypatched on the module the
helper resolves it through, and the auto-pick query runs against a mocked
``AsyncSession`` exactly as ``test_runner_selector.py`` does.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest
import structlog
from fastapi import HTTPException

from app.services.runner import device_selector
from app.services.runner.command_relay import (
    RunnerCommandTimeoutError,
    RunnerNotConnectedError,
)
from app.services.runner.device_selector import (
    dispatch_or_http_error,
    get_owned_runner_or_404,
    resolve_runner_for_request,
)

pytestmark = pytest.mark.asyncio

ENDPOINT = "/api/v1/some/{thing}/endpoint"


def _runner(*, user_id: UUID) -> SimpleNamespace:
    rid = uuid4()
    return SimpleNamespace(device_id=rid, id=rid, user_id=user_id)


def _registry(*, connected: set[str]) -> MagicMock:
    registry = MagicMock()
    registry.is_runner_connected = lambda rid: rid in connected
    registry.is_runner_socket_live = lambda rid: rid in connected
    return registry


def _manager(
    *, connected: set[str] | None = None, dispatch: AsyncMock | None = None
) -> SimpleNamespace:
    return SimpleNamespace(
        registry=_registry(connected=connected or set()),
        relay=SimpleNamespace(dispatch_and_wait=dispatch or AsyncMock()),
    )


def _db_listing(runners: list[SimpleNamespace]) -> AsyncMock:
    """``AsyncSession`` whose ``execute(...).scalars()`` iterates ``runners``."""
    scalars = MagicMock()
    scalars.__iter__ = lambda self: iter(runners)  # noqa: ARG005
    result = MagicMock()
    result.scalars = MagicMock(return_value=scalars)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.fixture()
def stored_runners(monkeypatch: pytest.MonkeyPatch) -> dict[UUID, SimpleNamespace]:
    """The rows ``runner_crud.get_runner`` can find, keyed by id."""
    rows: dict[UUID, SimpleNamespace] = {}

    async def _get_runner(db: Any, runner_id: UUID) -> SimpleNamespace | None:
        return rows.get(runner_id)

    monkeypatch.setattr(device_selector.runner_crud, "get_runner", _get_runner)
    return rows


# =============================================================================
# get_owned_runner_or_404 — the ownership core
# =============================================================================


async def test_owned_runner_is_returned(
    stored_runners: dict[UUID, SimpleNamespace],
) -> None:
    me = uuid4()
    mine = _runner(user_id=me)
    stored_runners[mine.id] = mine

    assert await get_owned_runner_or_404(AsyncMock(), me, mine.id) is mine


async def test_foreign_runner_is_404_runner_not_found(
    stored_runners: dict[UUID, SimpleNamespace],
) -> None:
    theirs = _runner(user_id=uuid4())
    stored_runners[theirs.id] = theirs

    with pytest.raises(HTTPException) as exc:
        await get_owned_runner_or_404(AsyncMock(), uuid4(), theirs.id)

    assert exc.value.status_code == 404
    assert exc.value.detail == {
        "error": "runner_not_found",
        "runner_id": str(theirs.id),
    }


async def test_unknown_runner_is_the_same_404(
    stored_runners: dict[UUID, SimpleNamespace],
) -> None:
    unknown = uuid4()
    with pytest.raises(HTTPException) as exc:
        await get_owned_runner_or_404(AsyncMock(), uuid4(), unknown)

    assert exc.value.status_code == 404
    assert exc.value.detail == {"error": "runner_not_found", "runner_id": str(unknown)}


# =============================================================================
# resolve_runner_for_request — core + registration check + auto-pick
# =============================================================================


async def test_resolve_explicit_foreign_runner_is_404_even_when_connected(
    stored_runners: dict[UUID, SimpleNamespace],
) -> None:
    theirs = _runner(user_id=uuid4())
    stored_runners[theirs.id] = theirs
    manager = _manager(connected={str(theirs.id)})
    user = SimpleNamespace(id=uuid4())

    with pytest.raises(HTTPException) as exc:
        await resolve_runner_for_request(
            theirs.id, user.id, AsyncMock(), manager, ENDPOINT
        )

    assert exc.value.status_code == 404
    assert exc.value.detail["error"] == "runner_not_found"


async def test_resolve_explicit_registered_runner_is_used(
    stored_runners: dict[UUID, SimpleNamespace],
) -> None:
    user = SimpleNamespace(id=uuid4())
    mine = _runner(user_id=user.id)
    stored_runners[mine.id] = mine
    manager = _manager(connected={str(mine.id)})

    picked = await resolve_runner_for_request(
        mine.id, user.id, AsyncMock(), manager, ENDPOINT
    )

    assert picked is mine


async def test_resolve_explicit_disconnected_runner_is_503_with_callers_endpoint(
    stored_runners: dict[UUID, SimpleNamespace],
) -> None:
    """Owned but unregistered: 503 — never silently swapped for another runner."""
    user = SimpleNamespace(id=uuid4())
    mine_off = _runner(user_id=user.id)
    mine_on = _runner(user_id=user.id)
    stored_runners[mine_off.id] = mine_off
    stored_runners[mine_on.id] = mine_on
    manager = _manager(connected={str(mine_on.id)})
    db = _db_listing([mine_on])

    with pytest.raises(HTTPException) as exc:
        await resolve_runner_for_request(mine_off.id, user.id, db, manager, ENDPOINT)

    assert exc.value.status_code == 503
    assert exc.value.detail["error"] == "no_runner_connected"
    assert exc.value.detail["endpoint"] == ENDPOINT
    db.execute.assert_not_awaited()  # the auto-pick arm was not consulted


async def test_resolve_auto_picks_the_live_runner() -> None:
    user = SimpleNamespace(id=uuid4())
    offline = _runner(user_id=user.id)
    online = _runner(user_id=user.id)
    manager = _manager(connected={str(online.id)})

    picked = await resolve_runner_for_request(
        None, user.id, _db_listing([offline, online]), manager, ENDPOINT
    )

    assert picked is online


async def test_resolve_auto_pick_with_none_live_is_503_with_callers_endpoint() -> None:
    user = SimpleNamespace(id=uuid4())
    manager = _manager(connected=set())

    with pytest.raises(HTTPException) as exc:
        await resolve_runner_for_request(
            None, user.id, _db_listing([_runner(user_id=user.id)]), manager, ENDPOINT
        )

    assert exc.value.status_code == 503
    assert exc.value.detail["error"] == "no_runner_connected"
    assert exc.value.detail["endpoint"] == ENDPOINT


# =============================================================================
# dispatch_or_http_error — the relay-failure mapper
# =============================================================================


async def test_dispatch_returns_the_raw_response_with_the_callers_timeout() -> None:
    runner = _runner(user_id=uuid4())
    request_id = uuid4()
    dispatch = AsyncMock(return_value={"type": "command_response", "ok": 1})
    manager = _manager(dispatch=dispatch)

    raw = await dispatch_or_http_error(
        manager, runner, {"c": 1}, request_id, ENDPOINT, 60.0, "pfx"
    )

    assert raw == {"type": "command_response", "ok": 1}
    dispatch.assert_awaited_once_with(
        str(runner.id), {"c": 1}, request_id=str(request_id), timeout_s=60.0
    )


async def test_dispatch_disconnect_is_503_and_logs_the_prefixed_event() -> None:
    runner = _runner(user_id=uuid4())
    request_id = uuid4()
    manager = _manager(dispatch=AsyncMock(side_effect=RunnerNotConnectedError("x")))

    with structlog.testing.capture_logs() as logs, pytest.raises(HTTPException) as exc:
        await dispatch_or_http_error(
            manager, runner, {}, request_id, ENDPOINT, 30.0, "pfx"
        )

    assert exc.value.status_code == 503
    assert exc.value.detail["error"] == "no_runner_connected"
    assert exc.value.detail["endpoint"] == ENDPOINT
    assert logs == [
        {
            "event": "pfx_runner_disconnected_mid_dispatch",
            "log_level": "warning",
            "runner_id": str(runner.id),
            "request_id": str(request_id),
        }
    ]


async def test_dispatch_timeout_is_504_and_logs_the_prefixed_event() -> None:
    runner = _runner(user_id=uuid4())
    request_id = uuid4()
    manager = _manager(
        dispatch=AsyncMock(
            side_effect=RunnerCommandTimeoutError(str(runner.id), "r", 30.0)
        )
    )

    with structlog.testing.capture_logs() as logs, pytest.raises(HTTPException) as exc:
        await dispatch_or_http_error(
            manager, runner, {}, request_id, ENDPOINT, 30.0, "pfx"
        )

    assert exc.value.status_code == 504
    assert exc.value.detail == {
        "error": "runner_timeout",
        "endpoint": ENDPOINT,
        "request_id": str(request_id),
    }
    assert logs == [
        {
            "event": "pfx_timeout",
            "log_level": "error",
            "runner_id": str(runner.id),
            "request_id": str(request_id),
        }
    ]


async def test_dispatch_timeout_carries_the_callers_extra_log_fields() -> None:
    """background_removal's timeout event always carried ``timeout_s``."""
    runner = _runner(user_id=uuid4())
    request_id = uuid4()
    manager = _manager(
        dispatch=AsyncMock(
            side_effect=RunnerCommandTimeoutError(str(runner.id), "r", 30.0)
        )
    )

    with structlog.testing.capture_logs() as logs, pytest.raises(HTTPException):
        await dispatch_or_http_error(
            manager,
            runner,
            {},
            request_id,
            ENDPOINT,
            30.0,
            "background_removal",
            timeout_log_fields={"timeout_s": 30.0},
        )

    assert logs == [
        {
            "event": "background_removal_timeout",
            "log_level": "error",
            "runner_id": str(runner.id),
            "request_id": str(request_id),
            "timeout_s": 30.0,
        }
    ]


async def test_dispatch_logs_through_the_callers_logger() -> None:
    """Events keep the caller's logger (and so its rendered logger name)."""
    runner = _runner(user_id=uuid4())
    caller_log = MagicMock()
    manager = _manager(dispatch=AsyncMock(side_effect=RunnerNotConnectedError("x")))

    with pytest.raises(HTTPException):
        await dispatch_or_http_error(
            manager, runner, {}, uuid4(), ENDPOINT, 30.0, "pfx", log=caller_log
        )

    caller_log.warning.assert_called_once()
    assert caller_log.warning.call_args.args == (
        "pfx_runner_disconnected_mid_dispatch",
    )
