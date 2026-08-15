"""Connect-time devenv auto-enrollment engine (plan 2026-08-05, Phase 4).

One test per branch of :func:`app.services.devenv_auto_enroll.evaluate_and_dispatch`,
plus the four properties the plan calls out by name: idempotence across
reconnects, concurrent connects creating exactly one row, a pairing gate that is
actually load-bearing, and a failure inside the engine never reaching the
connect handler.

The pairing-gate tests deserve a note, because they are the ones most likely to
rot into a vacuous pass. ``device_crud.register_device`` sets
``capability_user_paired = True`` unconditionally on BOTH its paths, and
``devices_ws`` calls that upsert on every connect immediately before this engine
runs — so a gate on that flag can never reject anything here. Every device row
these tests build therefore carries ``capability_user_paired=True``, exactly as
the connect handler would leave it, and the rejection test varies ONLY
``paired_at``. Swap the gate back to the flag and
``test_pairing_gate_rejects_a_device_coord_never_paired`` fails immediately.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.devenv import AutoEnrollPolicy, Environment, Machine
from app.models.device import Device
from app.services import devenv_auto_enroll
from app.services.devenv_auto_enroll import (
    OUTCOME_ALREADY_ENROLLED,
    OUTCOME_AMBIGUOUS,
    OUTCOME_COOLDOWN,
    OUTCOME_CREATED,
    OUTCOME_DISABLED,
    OUTCOME_FAILED,
    OUTCOME_NEEDS_ENVIRONMENT,
    OUTCOME_NOT_PAIRED,
    OUTCOME_NOT_PRIMARY,
    OUTCOME_PENDING_REMINTED,
    OUTCOME_POLICY_DISABLED,
    OUTCOME_REINSTALL_REMINTED,
    evaluate_and_dispatch,
    run_auto_enroll,
)

PRIMARY_UNENROLLED: dict[str, Any] = {"instance_role": "primary", "enrolled": False}
PRIMARY_ENROLLED: dict[str, Any] = {"instance_role": "primary", "enrolled": True}


class _Manager:
    """Stub of the WS manager — records what the engine tried to dispatch."""

    def __init__(self, *, sent: bool = True) -> None:
        self.sent = sent
        self.calls: list[tuple[Any, dict[str, Any]]] = []

    async def send_devenv_enroll(
        self, runner_id: Any, payload: dict[str, Any], **_kw: Any
    ) -> bool:
        self.calls.append((runner_id, payload))
        return self.sent


# ---------------------------------------------------------------------------
# Row builders
# ---------------------------------------------------------------------------


async def _mk_user(db: AsyncSession):
    from app.models.user import User

    user = User(
        email=f"autoenroll_{uuid4()}@example.com",
        username=f"autoenroll_{uuid4().hex[:8]}",
        full_name="Auto Enroll User",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


async def _mk_device(
    db: AsyncSession,
    *,
    user_id: UUID,
    paired: bool,
    hostname: str,
    device_id: UUID | None = None,
) -> Device:
    """A ``coord.devices`` row shaped exactly as a connect leaves it.

    ``capability_user_paired`` is ALWAYS True — that is what
    ``register_device`` writes on every connect, on both its branches. Only
    ``paired_at`` distinguishes a coord-paired box from a self-registered one.
    """
    device = Device(
        device_id=device_id or uuid4(),
        user_id=user_id,
        name=hostname,
        hostname=hostname,
        state="healthy",
        capability_user_paired=True,
        paired_at=datetime.now(UTC) if paired else None,
    )
    db.add(device)
    await db.flush()
    return device


async def _mk_env(
    db: AsyncSession, *, user_id: UUID, name: str | None = None
) -> Environment:
    env = Environment(owner_user_id=user_id, name=name or f"env-{uuid4().hex[:8]}")
    db.add(env)
    await db.flush()
    await db.refresh(env)
    return env


async def _mk_machine(
    db: AsyncSession,
    *,
    user_id: UUID,
    coord_device_id: UUID,
    name: str | None = None,
    enrolled: bool = False,
    environment_id: UUID | None = None,
    last_attempt_at: datetime | None = None,
) -> Machine:
    machine = Machine(
        owner_user_id=user_id,
        name=name or f"machine-{uuid4().hex[:8]}",
        hostname="box",
        coord_device_id=coord_device_id,
        environment_id=environment_id,
        key_hash=("h" * 64) if enrolled else None,
        key_prefix="mk_test" if enrolled else None,
        enrolled_at=datetime.now(UTC) if enrolled else None,
        auto_enroll_last_attempt_at=last_attempt_at,
    )
    db.add(machine)
    await db.flush()
    await db.refresh(machine)
    return machine


async def _machines_for(db: AsyncSession, device_id: UUID) -> list[Machine]:
    stmt = select(Machine).where(
        Machine.coord_device_id == device_id, Machine.revoked_at.is_(None)
    )
    return list((await db.execute(stmt)).scalars().all())


@pytest.fixture()
def enabled(monkeypatch):
    """Global flag ON — the rollout default is OFF, so tests must opt in."""
    monkeypatch.setattr(settings, "DEVENV_AUTO_ENROLL_ENABLED", True)
    monkeypatch.setattr(settings, "DEVENV_AUTO_ENROLL_COOLDOWN_MINUTES", 60)


# ===========================================================================
# Step 1 — the global flag
# ===========================================================================


@pytest.mark.asyncio
async def test_flag_off_returns_before_touching_anything(
    async_db_session: AsyncSession, monkeypatch
) -> None:
    """Default-off means the connect path is unchanged, not merely quiet."""
    monkeypatch.setattr(settings, "DEVENV_AUTO_ENROLL_ENABLED", False)
    manager = _Manager()
    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=uuid4(),
        user_id=uuid4(),
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )
    assert outcome == OUTCOME_DISABLED
    assert manager.calls == []


# ===========================================================================
# Step 2 — the client hint and the server-side pairing gate
# ===========================================================================


@pytest.mark.asyncio
async def test_secondary_instance_is_suppressed(
    async_db_session: AsyncSession, enabled
) -> None:
    """A runner may always decline on its own behalf."""
    manager = _Manager()
    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=uuid4(),
        user_id=uuid4(),
        devenv_hint={"instance_role": "secondary", "enrolled": False},
        manager=manager,
    )
    assert outcome == OUTCOME_NOT_PRIMARY
    assert manager.calls == []


@pytest.mark.asyncio
async def test_missing_devenv_block_is_suppressed(
    async_db_session: AsyncSession, enabled
) -> None:
    """An older runner build sends no hint; silence is not consent."""
    manager = _Manager()
    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=uuid4(),
        user_id=uuid4(),
        devenv_hint=None,
        manager=manager,
    )
    assert outcome == OUTCOME_NOT_PRIMARY


@pytest.mark.asyncio
async def test_pairing_gate_rejects_a_device_coord_never_paired(
    async_db_session: AsyncSession, enabled
) -> None:
    """``paired_at IS NULL`` blocks enrollment even though the flag says paired.

    This is the test that fails the moment someone swaps the gate back to
    ``capability_user_paired``: the row below sets that flag True (as
    ``register_device`` does on every connect) and leaves ``paired_at`` NULL, so
    a flag-based gate would sail through and create the machine. Everything else
    the create path needs — an environment, no policy row — is present, so the
    ONLY thing standing between this call and a new row is the gate.
    """
    user = await _mk_user(async_db_session)
    await _mk_env(async_db_session, user_id=user.id)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=False,
        hostname=f"unpaired-{uuid4().hex[:8]}",
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert device.capability_user_paired is True  # the vacuous flag, on
    assert outcome == OUTCOME_NOT_PAIRED
    assert manager.calls == []
    assert await _machines_for(async_db_session, device.device_id) == []


@pytest.mark.asyncio
async def test_pairing_gate_admits_a_coord_paired_device(
    async_db_session: AsyncSession, enabled
) -> None:
    """Control for the test above: identical setup, ``paired_at`` stamped.

    Without this pair, the rejection test could pass for any reason at all.
    """
    user = await _mk_user(async_db_session)
    await _mk_env(async_db_session, user_id=user.id)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"paired-{uuid4().hex[:8]}",
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_CREATED
    assert len(manager.calls) == 1


@pytest.mark.asyncio
async def test_unknown_device_row_is_rejected(
    async_db_session: AsyncSession, enabled
) -> None:
    """No ``coord.devices`` row at all reads the same as never paired."""
    manager = _Manager()
    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=uuid4(),
        user_id=uuid4(),
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )
    assert outcome == OUTCOME_NOT_PAIRED


# ===========================================================================
# Step 3 — the owner's policy row
# ===========================================================================


@pytest.mark.asyncio
async def test_policy_disabled_returns(async_db_session: AsyncSession, enabled) -> None:
    user = await _mk_user(async_db_session)
    await _mk_env(async_db_session, user_id=user.id)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"optout-{uuid4().hex[:8]}",
    )
    async_db_session.add(AutoEnrollPolicy(owner_user_id=user.id, enabled=False))
    await async_db_session.flush()
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_POLICY_DISABLED
    assert manager.calls == []
    assert await _machines_for(async_db_session, device.device_id) == []


@pytest.mark.asyncio
async def test_policy_target_environment_wins_over_the_single_env_rule(
    async_db_session: AsyncSession, enabled
) -> None:
    """With two environments only the stated target can resolve the ambiguity."""
    user = await _mk_user(async_db_session)
    await _mk_env(async_db_session, user_id=user.id)
    target = await _mk_env(async_db_session, user_id=user.id)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"targeted-{uuid4().hex[:8]}",
    )
    async_db_session.add(
        AutoEnrollPolicy(
            owner_user_id=user.id, enabled=True, target_environment_id=target.id
        )
    )
    await async_db_session.flush()
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_CREATED
    rows = await _machines_for(async_db_session, device.device_id)
    assert [r.environment_id for r in rows] == [target.id]


# ===========================================================================
# Step 4 — the machine-row branches
# ===========================================================================


@pytest.mark.asyncio
async def test_duplicate_rows_are_never_guessed_between(
    async_db_session: AsyncSession, enabled
) -> None:
    """Two live rows for one device: refuse to guess, act on neither.

    Since Phase 6 (``devenv_10``) the database forbids this shape —
    ``UNIQUE (coord_device_id) WHERE revoked_at IS NULL`` — so the duplicate
    has to be constructed with the index dropped. That is not a workaround
    around the constraint; it is the honest setup for what this branch now
    covers: rows that ALREADY existed when the constraint was added, on a
    database the migration cannot retroactively clean. The engine's refusal to
    guess is what keeps such a pair harmless, so the branch stays and so does
    this test.

    The DROP is inside the test's own transaction, which the fixture rolls
    back, so no other test sees a database without the invariant.
    """
    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"dup-{uuid4().hex[:8]}",
    )
    # IF EXISTS: the test schema is built from ORM metadata, and a test DB
    # created before devenv_10 landed would not carry the index at all. A
    # missing index must not fail the test for the wrong reason.
    await async_db_session.execute(
        text("DROP INDEX IF EXISTS devenv.uq_devenv_machine_active_coord_device")
    )
    await _mk_machine(
        async_db_session, user_id=user.id, coord_device_id=device.device_id
    )
    await _mk_machine(
        async_db_session, user_id=user.id, coord_device_id=device.device_id
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_AMBIGUOUS
    assert manager.calls == []


@pytest.mark.asyncio
async def test_pending_row_is_reminted_not_duplicated(
    async_db_session: AsyncSession, enabled
) -> None:
    """A row created but never enrolled gets a fresh code — same machine id."""
    user = await _mk_user(async_db_session)
    env = await _mk_env(async_db_session, user_id=user.id)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"pending-{uuid4().hex[:8]}",
    )
    machine = await _mk_machine(
        async_db_session,
        user_id=user.id,
        coord_device_id=device.device_id,
        environment_id=env.id,
    )
    assert machine.enrollment_code is None
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_PENDING_REMINTED
    rows = await _machines_for(async_db_session, device.device_id)
    assert [r.id for r in rows] == [machine.id]  # reused, not duplicated
    assert machine.enrollment_code is not None
    assert machine.auto_enroll_last_attempt_at is not None
    assert len(manager.calls) == 1
    _rid, payload = manager.calls[0]
    assert payload["machine_id"] == str(machine.id)
    assert payload["enrollment_code"] == machine.enrollment_code
    assert payload["environment_id"] == str(env.id)


@pytest.mark.asyncio
async def test_enrolled_row_with_agreeing_hint_is_a_noop(
    async_db_session: AsyncSession, enabled
) -> None:
    """The steady state: nothing minted, nothing sent, nothing stamped."""
    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"steady-{uuid4().hex[:8]}",
    )
    machine = await _mk_machine(
        async_db_session,
        user_id=user.id,
        coord_device_id=device.device_id,
        enrolled=True,
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_ENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_ALREADY_ENROLLED
    assert manager.calls == []
    assert machine.key_hash is not None
    assert machine.enrollment_code is None
    assert machine.auto_enroll_last_attempt_at is None


@pytest.mark.asyncio
async def test_reinstall_hint_regenerates_enrollment_on_that_row(
    async_db_session: AsyncSession, enabled
) -> None:
    """``enrolled: false`` on an enrolled row rotates the key on THAT row.

    This arm ships on its correctness argument — a reinstall cannot be inferred
    server-side, since the row still looks healthy — and it can act only on the
    machine already bound to this same ``coord_device_id``.
    """
    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"reinstall-{uuid4().hex[:8]}",
    )
    machine = await _mk_machine(
        async_db_session,
        user_id=user.id,
        coord_device_id=device.device_id,
        enrolled=True,
        last_attempt_at=datetime.now(UTC) - timedelta(days=2),
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_REINSTALL_REMINTED
    # regenerate-enrollment semantics: the superseded key stops authenticating.
    assert machine.key_hash is None
    assert machine.enrolled_at is None
    assert machine.enrollment_code is not None
    assert len(manager.calls) == 1
    assert await _machines_for(async_db_session, device.device_id) == [machine]


@pytest.mark.asyncio
async def test_reinstall_hint_inside_the_cooldown_is_a_noop(
    async_db_session: AsyncSession, enabled
) -> None:
    """A lying client gets at most one key rotation per cooldown."""
    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"cooldown-{uuid4().hex[:8]}",
    )
    machine = await _mk_machine(
        async_db_session,
        user_id=user.id,
        coord_device_id=device.device_id,
        enrolled=True,
        last_attempt_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_COOLDOWN
    assert manager.calls == []
    assert machine.key_hash is not None


@pytest.mark.asyncio
async def test_no_machine_and_no_resolvable_environment_is_a_noop(
    async_db_session: AsyncSession, enabled
) -> None:
    """Two environments, no stated target → the server must not guess.

    An unbound machine cannot capture anything (the runner's ``is_enrolled()``
    needs both ids), so creating one would buy nothing and cost a confusing row.
    """
    user = await _mk_user(async_db_session)
    await _mk_env(async_db_session, user_id=user.id)
    await _mk_env(async_db_session, user_id=user.id)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"noenv-{uuid4().hex[:8]}",
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_NEEDS_ENVIRONMENT
    assert manager.calls == []
    assert await _machines_for(async_db_session, device.device_id) == []


@pytest.mark.asyncio
async def test_zero_environments_is_also_a_noop(
    async_db_session: AsyncSession, enabled
) -> None:
    """The owner has nowhere to put the box — same honest no-op."""
    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"zeroenv-{uuid4().hex[:8]}",
    )
    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=_Manager(),
    )
    assert outcome == OUTCOME_NEEDS_ENVIRONMENT


@pytest.mark.asyncio
async def test_machine_is_created_bound_and_dispatched(
    async_db_session: AsyncSession, enabled
) -> None:
    """The create path: named from the hostname, bound up front, origin honest.

    No policy row exists here — an ABSENT row means enabled (decision 3), and
    that is the case this asserts.
    """
    user = await _mk_user(async_db_session)
    env = await _mk_env(async_db_session, user_id=user.id)
    hostname = f"newbox-{uuid4().hex[:8]}"
    device = await _mk_device(
        async_db_session, user_id=user.id, paired=True, hostname=hostname
    )
    manager = _Manager()

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert outcome == OUTCOME_CREATED
    rows = await _machines_for(async_db_session, device.device_id)
    assert len(rows) == 1
    machine = rows[0]
    assert machine.name == hostname
    assert machine.coord_device_id == device.device_id
    assert machine.environment_id == env.id
    assert machine.enrollment_origin == "auto"
    assert machine.enrollment_code is not None
    assert machine.auto_enroll_last_attempt_at is not None
    assert len(manager.calls) == 1
    rid, payload = manager.calls[0]
    assert rid == device.device_id
    assert payload["machine_id"] == str(machine.id)
    assert payload["environment_id"] == str(env.id)


@pytest.mark.asyncio
async def test_colliding_hostname_gets_a_numeric_suffix(
    async_db_session: AsyncSession, enabled
) -> None:
    """``(owner, name)`` is unique, so a second box on that name must dedupe."""
    user = await _mk_user(async_db_session)
    await _mk_env(async_db_session, user_id=user.id)
    hostname = f"twin-{uuid4().hex[:8]}"
    await _mk_machine(
        async_db_session,
        user_id=user.id,
        coord_device_id=uuid4(),
        name=hostname,
    )
    device = await _mk_device(
        async_db_session, user_id=user.id, paired=True, hostname=hostname
    )

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=_Manager(),
    )

    assert outcome == OUTCOME_CREATED
    rows = await _machines_for(async_db_session, device.device_id)
    assert [r.name for r in rows] == [f"{hostname}-2"]


# ===========================================================================
# Idempotence, concurrency, and the failure boundary
# ===========================================================================


@pytest.mark.asyncio
async def test_second_connect_is_a_noop(
    async_db_session: AsyncSession, enabled
) -> None:
    """Reconnects are the common case; they must not re-mint or re-create."""
    user = await _mk_user(async_db_session)
    await _mk_env(async_db_session, user_id=user.id)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"reconnect-{uuid4().hex[:8]}",
    )
    manager = _Manager()

    first = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )
    second = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=manager,
    )

    assert first == OUTCOME_CREATED
    assert second == OUTCOME_COOLDOWN
    assert len(await _machines_for(async_db_session, device.device_id)) == 1
    assert len(manager.calls) == 1

    # ...and once the box has actually enrolled, the steady state is the
    # cheapest branch rather than a cooldown that eventually expires.
    machine = (await _machines_for(async_db_session, device.device_id))[0]
    machine.key_hash = "h" * 64
    machine.enrolled_at = datetime.now(UTC)
    await async_db_session.flush()
    third = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_ENROLLED,
        manager=manager,
    )
    assert third == OUTCOME_ALREADY_ENROLLED
    assert len(manager.calls) == 1


@pytest.mark.asyncio
async def test_two_concurrent_connects_create_exactly_one_row(
    test_engine, enabled
) -> None:
    """The ``FOR UPDATE`` path locks nothing when there are zero rows.

    Two simultaneous connects for one device would therefore both see "no
    machine" and both insert; the transaction-scoped advisory lock is what makes
    the second one observe the first's row. This test needs two INDEPENDENT
    connections, so it runs outside the shared rolled-back session fixture and
    cleans up after itself.
    """
    maker = sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    device_id = uuid4()
    user_id: UUID | None = None
    hostname = f"race-{uuid4().hex[:8]}"
    try:
        async with maker() as setup:
            user = await _mk_user(setup)
            user_id = user.id
            await _mk_device(
                setup,
                user_id=user.id,
                paired=True,
                hostname=hostname,
                device_id=device_id,
            )
            await _mk_env(setup, user_id=user.id)
            await setup.commit()

        async def _one() -> str:
            async with maker() as db:
                return await evaluate_and_dispatch(
                    db,
                    device_id=device_id,
                    user_id=user_id,  # type: ignore[arg-type]
                    devenv_hint=PRIMARY_UNENROLLED,
                    manager=_Manager(),
                )

        outcomes = await asyncio.gather(_one(), _one())
        assert sorted(outcomes) == [OUTCOME_COOLDOWN, OUTCOME_CREATED]

        async with maker() as check:
            assert len(await _machines_for(check, device_id)) == 1
    finally:
        async with maker() as cleanup:
            await cleanup.execute(
                delete(Machine).where(Machine.coord_device_id == device_id)
            )
            await cleanup.execute(delete(Device).where(Device.device_id == device_id))
            if user_id is not None:
                await cleanup.execute(
                    delete(Environment).where(Environment.owner_user_id == user_id)
                )
                await cleanup.execute(
                    delete(Machine).where(Machine.owner_user_id == user_id)
                )
                from app.models.user import User

                await cleanup.execute(delete(User).where(User.id == user_id))
            await cleanup.commit()


@pytest.mark.asyncio
async def test_engine_failure_never_reaches_the_connect_handler(
    monkeypatch, enabled
) -> None:
    """A blown session must log and return, not propagate into the handshake."""

    def _boom(*_a: Any, **_kw: Any):
        raise RuntimeError("database is on fire")

    monkeypatch.setattr(devenv_auto_enroll, "AsyncSessionLocal", _boom)
    outcome = await run_auto_enroll(uuid4(), uuid4(), PRIMARY_UNENROLLED, _Manager())
    assert outcome == OUTCOME_FAILED


@pytest.mark.asyncio
async def test_scheduled_task_swallows_failures_too(monkeypatch, enabled) -> None:
    """The fire-and-forget entry point is the boundary the socket relies on."""

    def _boom(*_a: Any, **_kw: Any):
        raise RuntimeError("database is on fire")

    monkeypatch.setattr(devenv_auto_enroll, "AsyncSessionLocal", _boom)
    task = devenv_auto_enroll.schedule_auto_enroll(
        uuid4(), uuid4(), PRIMARY_UNENROLLED, _Manager()
    )
    assert task is not None
    assert await task == OUTCOME_FAILED
    assert task.exception() is None


@pytest.mark.asyncio
async def test_a_failing_dispatch_still_burns_the_cooldown(
    async_db_session: AsyncSession, enabled
) -> None:
    """The stamp is committed BEFORE the send, so a dead socket cannot hot-loop."""
    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"deadsocket-{uuid4().hex[:8]}",
    )
    machine = await _mk_machine(
        async_db_session, user_id=user.id, coord_device_id=device.device_id
    )

    outcome = await evaluate_and_dispatch(
        async_db_session,
        device_id=device.device_id,
        user_id=user.id,
        devenv_hint=PRIMARY_UNENROLLED,
        manager=_Manager(sent=False),
    )

    assert outcome == OUTCOME_PENDING_REMINTED
    assert machine.auto_enroll_last_attempt_at is not None


# ===========================================================================
# Phase 6 — the duplicate-row hole, closed at the database
# ===========================================================================


@pytest.mark.asyncio
async def test_a_second_live_row_for_one_device_is_rejected(
    async_db_session: AsyncSession,
) -> None:
    """``devenv_10``'s partial unique index refuses the second live row.

    The engine already serialises its OWN create path with an advisory lock,
    but that covers one writer. This invariant covers the operator dispatch
    path, the agent enroll path, a hand-made row, and any writer not yet
    written — and it fails loudly at the second insert rather than quietly at
    every subsequent connect, which is what a duplicate actually costs: the
    engine reads "the machine row for this device", finds two, and does nothing
    for that box from then on.
    """
    from sqlalchemy.exc import IntegrityError

    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"uniq-{uuid4().hex[:8]}",
    )
    await _mk_machine(
        async_db_session, user_id=user.id, coord_device_id=device.device_id
    )

    nested = await async_db_session.begin_nested()
    with pytest.raises(IntegrityError):
        await _mk_machine(
            async_db_session, user_id=user.id, coord_device_id=device.device_id
        )
    await nested.rollback()


@pytest.mark.asyncio
async def test_a_revoked_row_does_not_block_re_enrolling_its_device(
    async_db_session: AsyncSession,
) -> None:
    """The index is PARTIAL for this reason, and the reason is load-bearing.

    ``POST /machines/{id}/revoke`` does not clear ``coord_device_id``, so a
    full unique index would let one revoked machine bar its own device from
    ever being enrolled again — turning the one-click undo into a permanent
    lockout.
    """
    user = await _mk_user(async_db_session)
    device = await _mk_device(
        async_db_session,
        user_id=user.id,
        paired=True,
        hostname=f"revoked-{uuid4().hex[:8]}",
    )
    old = await _mk_machine(
        async_db_session, user_id=user.id, coord_device_id=device.device_id
    )
    old.revoked_at = datetime.now(UTC)
    await async_db_session.flush()

    fresh = await _mk_machine(
        async_db_session, user_id=user.id, coord_device_id=device.device_id
    )
    assert fresh.id != old.id

    live = await _machines_for(async_db_session, device.device_id)
    assert [m.id for m in live] == [fresh.id]
