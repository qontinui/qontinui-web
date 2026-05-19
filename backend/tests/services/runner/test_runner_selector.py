"""Unit tests for ``pick_active_runner_for_user`` and the 503 envelope helper.

The selector function fans out into a SQL query + an in-memory registry
check. To stay deterministic + dependency-free, these tests mock the
``AsyncSession.execute`` result directly. The selector's SQL shape is
verified through the args passed to ``execute``.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from app.services.runner.device_selector import (
    pick_active_runner_for_user,
    runner_bridge_503_no_runner,
)


def _make_registry(connected_ids: set[str]) -> MagicMock:
    """Build a mock registry whose ``is_runner_connected`` checks a set."""
    registry = MagicMock()
    registry.is_runner_connected = lambda rid: rid in connected_ids
    return registry


def _make_runner(*, runner_id: UUID, user_id: UUID, name: str = "r") -> SimpleNamespace:
    """Lightweight stand-in for an ORM ``Device`` row.

    The selector only reads ``.device_id``; ``id`` is preserved for the
    ``str(runner.id)`` assertions further down.
    """
    return SimpleNamespace(
        device_id=runner_id, id=runner_id, user_id=user_id, name=name
    )


def _make_db_with_runners(runners: list[SimpleNamespace]) -> AsyncMock:
    """Mock ``AsyncSession`` whose ``execute(stmt).scalars()`` yields ``runners``.

    The selector iterates ``rows.scalars()`` (no further methods called),
    so a simple list is sufficient.
    """
    scalars_result = MagicMock()
    scalars_result.__iter__ = lambda self: iter(runners)  # noqa: ARG005

    result = MagicMock()
    result.scalars = MagicMock(return_value=scalars_result)

    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db


@pytest.mark.asyncio
async def test_pick_active_runner_no_runners() -> None:
    """User owns no runners -> None."""
    user_id = uuid4()
    db = _make_db_with_runners([])
    registry = _make_registry(set())

    picked = await pick_active_runner_for_user(user_id, db, registry)

    assert picked is None
    # Verify the SQL was actually run (selector didn't short-circuit).
    db.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_pick_active_runner_single_connected() -> None:
    """Single runner, connected -> returned."""
    user_id = uuid4()
    rid = uuid4()
    runner = _make_runner(runner_id=rid, user_id=user_id)
    db = _make_db_with_runners([runner])
    registry = _make_registry({str(rid)})

    picked = await pick_active_runner_for_user(user_id, db, registry)

    assert picked is runner


@pytest.mark.asyncio
async def test_pick_active_runner_single_disconnected() -> None:
    """Single runner, NOT connected -> None."""
    user_id = uuid4()
    runner = _make_runner(runner_id=uuid4(), user_id=user_id)
    db = _make_db_with_runners([runner])
    # Registry sees nothing connected.
    registry = _make_registry(set())

    picked = await pick_active_runner_for_user(user_id, db, registry)

    assert picked is None


@pytest.mark.asyncio
async def test_pick_active_runner_prefers_connected_over_freshest_offline() -> None:
    """Freshest is offline, older is connected -> older wins.

    The SQL is ordered by ``last_heartbeat`` DESC; the selector returns
    the first row whose id passes the registry check. So the fresher
    (offline) row is first, the older (connected) row second; the
    selector skips the first and picks the second.
    """
    user_id = uuid4()
    fresher_offline = _make_runner(runner_id=uuid4(), user_id=user_id, name="fresher")
    older_connected = _make_runner(runner_id=uuid4(), user_id=user_id, name="older")
    # Order matches the SQL: fresher first, older second.
    db = _make_db_with_runners([fresher_offline, older_connected])
    registry = _make_registry({str(older_connected.id)})

    picked = await pick_active_runner_for_user(user_id, db, registry)

    assert picked is older_connected


@pytest.mark.asyncio
async def test_pick_active_runner_picks_first_connected_when_multiple() -> None:
    """If multiple runners are connected, the first (freshest) one wins."""
    user_id = uuid4()
    fresh = _make_runner(runner_id=uuid4(), user_id=user_id, name="fresh")
    stale = _make_runner(runner_id=uuid4(), user_id=user_id, name="stale")
    # SQL returns fresh first (last_heartbeat DESC).
    db = _make_db_with_runners([fresh, stale])
    registry = _make_registry({str(fresh.id), str(stale.id)})

    picked = await pick_active_runner_for_user(user_id, db, registry)

    assert picked is fresh


@pytest.mark.asyncio
async def test_pick_active_runner_query_filters_by_user() -> None:
    """The selector's WHERE clause is keyed on the supplied ``user_id``.

    The query is built via SQLAlchemy ``select(Runner).where(...)``;
    we assert the executed statement compiles to SQL containing the
    user_id binding parameter. (Smoke check — confirms the SQL is
    constructed for the user, not all rows.)
    """
    user_id = uuid4()
    db = _make_db_with_runners([])
    registry = _make_registry(set())

    await pick_active_runner_for_user(user_id, db, registry)

    db.execute.assert_awaited_once()
    stmt = db.execute.await_args.args[0]
    # SQLAlchemy stores the bound user_id in stmt.compile().params.
    compiled = stmt.compile(compile_kwargs={"literal_binds": False})
    assert user_id in compiled.params.values()


def test_runner_bridge_503_no_runner_envelope_shape() -> None:
    """The 503 envelope contains the documented fields."""
    exc = runner_bridge_503_no_runner(
        "/api/v1/state-discovery/ui-bridge/discover-states"
    )

    assert exc.status_code == 503
    assert isinstance(exc.detail, dict)
    assert exc.detail["error"] == "no_runner_connected"
    assert exc.detail["endpoint"] == "/api/v1/state-discovery/ui-bridge/discover-states"
    assert "remedy" in exc.detail
    assert "device" in exc.detail["message"].lower()
