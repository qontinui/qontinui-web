"""Connect-time devenv auto-enrollment decision engine (plan 2026-08-05, Phase 4).

A device that opens ``WS /api/v1/devices/ws`` has already proven who it is: the
``device_id`` and ``user_id`` come from a coord-signed JWT verified against
coord's JWKS, never from the frame. That handshake is therefore the one moment
where "should this box be in a devenv environment?" is answerable as a fact
rather than a claim — and it is the trigger this module runs on.

**Everything here is fire-and-forget.** The caller
(:mod:`app.api.v1.endpoints.devices_ws`) schedules :func:`schedule_auto_enroll`
*after* the ``connected`` ack is on the wire and never awaits the result. The
handshake must not wait on an enrollment decision, and a failure in here must
never drop the socket: contrast the Redis-registration block in ``devices_ws``,
which rolls back and closes on failure. This one is wrapped, logged, and
swallowed — an auto-enrollment that cannot happen is a missing convenience; a
dropped device socket is an outage.

Trust model (decision 2 of the plan). The ``devenv`` block on ``runner_info``
is **client-asserted**, so the contract is deliberately asymmetric:

* a hint may freely SUPPRESS enrollment (``instance_role != "primary"``);
* a hint may NEVER name the machine row, the environment or the owner — those
  come from the verified claims and this server's own tables;
* the one hint that *causes* action is ``enrolled: false`` on a device whose
  machine row says enrolled — the reinstall case, which is un-inferable
  server-side. It can only ever act on the row already bound to that same
  ``coord_device_id``, and it is rate-limited by
  ``machines.auto_enroll_last_attempt_at``. A lying client can rotate its own
  machine key at most once per cooldown, and nothing else.

One clarification so "may never name" is not read as "no client-asserted string
ever reaches a persisted field": a NEW machine's ``machines.name`` (and
``hostname``) IS derived from the ``runner_info`` hostname, which is
client-asserted. That is cosmetic only — it is a display label, the owner can
rename it, ``coord_device_id`` and ``owner_user_id`` are server-derived from the
verified claims, and a collision with an existing name gets a numeric suffix
rather than merging into anyone's row. Nothing is authorized by it.

Every path returns an :class:`AutoEnrollOutcome` string. That is what makes the
branches testable without parsing log lines, and it is logged verbatim so a
production reader sees the same vocabulary the tests assert on.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, Final
from uuid import UUID

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.crud import devenv_machine_crud
from app.db.session import AsyncSessionLocal
from app.models.devenv import AutoEnrollPolicy, Environment, Machine
from app.models.device import Device

logger = structlog.get_logger(__name__)

# Outcome vocabulary. Returned by :func:`evaluate_and_dispatch`, logged, and
# asserted on by the tests — one string per branch of the plan's algorithm.
AutoEnrollOutcome = str

OUTCOME_DISABLED: Final[AutoEnrollOutcome] = "disabled_globally"
OUTCOME_NOT_PRIMARY: Final[AutoEnrollOutcome] = "hint_not_primary"
OUTCOME_NOT_PAIRED: Final[AutoEnrollOutcome] = "device_not_paired"
OUTCOME_POLICY_DISABLED: Final[AutoEnrollOutcome] = "policy_disabled"
OUTCOME_AMBIGUOUS: Final[AutoEnrollOutcome] = "ambiguous"
OUTCOME_CONCURRENT: Final[AutoEnrollOutcome] = "concurrent_connect"
OUTCOME_COOLDOWN: Final[AutoEnrollOutcome] = "cooldown"
OUTCOME_PENDING_REMINTED: Final[AutoEnrollOutcome] = "pending_reminted"
OUTCOME_ALREADY_ENROLLED: Final[AutoEnrollOutcome] = "already_enrolled"
OUTCOME_REINSTALL_REMINTED: Final[AutoEnrollOutcome] = "reinstall_reminted"
OUTCOME_NEEDS_ENVIRONMENT: Final[AutoEnrollOutcome] = "needs_environment"
OUTCOME_NAME_UNAVAILABLE: Final[AutoEnrollOutcome] = "name_unavailable"
OUTCOME_CREATED: Final[AutoEnrollOutcome] = "created"
OUTCOME_FAILED: Final[AutoEnrollOutcome] = "failed"

# Max ``-2``, ``-3``, ... suffixes tried when the hostname-derived name is
# already taken for this owner. A bound, not a policy: past this many
# collisions the honest answer is "a human should name this box".
_MAX_NAME_SUFFIX: Final[int] = 50

# ``devenv.machines.name`` is VARCHAR(200).
_MAX_NAME_LEN: Final[int] = 200

# Strong refs to in-flight fire-and-forget tasks. ``asyncio`` holds only a weak
# reference to a running task, so without this a task can be garbage-collected
# mid-await and the enrollment vanishes with no error anywhere.
_BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()


def _cooldown() -> timedelta:
    """The re-dispatch cooldown, from settings."""
    return timedelta(minutes=int(settings.DEVENV_AUTO_ENROLL_COOLDOWN_MINUTES))


def _within_cooldown(last_attempt_at: datetime | None) -> bool:
    """True when a dispatch for this row happened too recently to repeat.

    ``None`` (never attempted) is never within cooldown. Naive timestamps are
    read as UTC — the column is ``timestamptz``, but a session that wrote a
    naive value must not crash the comparison.
    """
    if last_attempt_at is None:
        return False
    stamped = last_attempt_at
    if stamped.tzinfo is None:
        stamped = stamped.replace(tzinfo=UTC)
    return (datetime.now(UTC) - stamped) < _cooldown()


def _hint_str(hint: dict[str, Any] | None, key: str) -> str | None:
    """Read a string field off the client-asserted hint, or ``None``."""
    if not hint:
        return None
    value = hint.get(key)
    return value if isinstance(value, str) else None


def _hint_bool(hint: dict[str, Any] | None, key: str) -> bool | None:
    """Read a bool field off the client-asserted hint, or ``None``.

    ``None`` means "the runner said nothing" — distinct from ``False``, and the
    distinction matters: an older runner build sends no ``devenv`` block at all,
    and silence must never be read as "I lost my enrollment".
    """
    if not hint:
        return None
    value = hint.get(key)
    return value if isinstance(value, bool) else None


def _advisory_key(device_id: UUID) -> int:
    """A stable signed-64-bit advisory-lock key for a device.

    Derived in Python rather than via ``hashtextextended`` so the lock does not
    depend on a server-side hash function's stability across PG versions.
    """
    return int.from_bytes(device_id.bytes[:8], "big", signed=True)


async def resolve_target_environment(
    db: AsyncSession,
    *,
    user_id: UUID,
    policy: AutoEnrollPolicy | None,
) -> UUID | None:
    """Resolve which environment a NEW machine for this owner should join.

    Precedence: the owner's policy ``target_environment_id`` (validated to be an
    environment they actually own — a dangling pointer must not bind a machine
    to someone else's environment), then the shipped auto-bind rule from
    ``devenv_agent.enroll_agent``: exactly one environment → that one.

    ``None`` means "the server must not guess". Two environments and no stated
    target is precisely the ambiguity the policy row exists to resolve.

    Public because the policy API (``GET /devenv/auto-enroll-policy``) reports
    what a new box would ACTUALLY join, and it must answer that with this
    function rather than a second copy of the precedence. A dashboard whose
    "effective environment" disagreed with the engine's would be worse than no
    dashboard: it would show a healthy policy while every connect no-ops.
    """
    target = policy.target_environment_id if policy is not None else None
    if target is not None:
        owned = await db.scalar(
            select(Environment.id).where(
                Environment.id == target,
                Environment.owner_user_id == user_id,
            )
        )
        if owned is not None:
            return target
        logger.warning(
            "devenv_auto_enroll_target_environment_invalid",
            user_id=str(user_id),
            target_environment_id=str(target),
        )
    envs = (
        (
            await db.execute(
                select(Environment.id).where(Environment.owner_user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    if len(envs) == 1:
        return envs[0]
    return None


async def _resolve_name(
    db: AsyncSession, *, user_id: UUID, hostname: str | None
) -> str | None:
    """Pick an unused machine name derived from the hostname.

    ``(owner_user_id, name)`` is the table's only unique constraint, so a
    colliding name is a hard insert failure rather than a merge — dedupe with a
    numeric suffix exactly as a human naming a second box would.
    """
    base = (hostname or "").strip() or "device"
    base = base[:_MAX_NAME_LEN]
    candidate = base
    for suffix in range(1, _MAX_NAME_SUFFIX + 1):
        if suffix > 1:
            tail = f"-{suffix}"
            candidate = base[: _MAX_NAME_LEN - len(tail)] + tail
        exists = await db.scalar(
            select(Machine.id).where(
                Machine.owner_user_id == user_id,
                Machine.name == candidate,
            )
        )
        if exists is None:
            return candidate
    return None


async def _dispatch(
    manager: Any,
    *,
    device_id: UUID,
    machine: Machine,
    enrollment_code: str,
) -> bool:
    """Send the ``devenv_enroll`` directive down the socket we are holding.

    The stamp on ``auto_enroll_last_attempt_at`` is committed by the caller
    BEFORE this runs, so a send that raises still burns the cooldown. That is
    the plan's "stamp regardless of ack": a device whose enrollment keeps
    failing must not be retried on every reconnect.
    """
    payload: dict[str, Any] = {
        "enrollment_code": enrollment_code,
        "machine_id": str(machine.id),
    }
    if machine.environment_id is not None:
        payload["environment_id"] = str(machine.environment_id)
    sent = await manager.send_devenv_enroll(device_id, payload)
    logger.info(
        "devenv_auto_enroll_dispatched",
        device_id=str(device_id),
        machine_id=str(machine.id),
        environment_id=(
            str(machine.environment_id) if machine.environment_id is not None else None
        ),
        sent=bool(sent),
    )
    return bool(sent)


async def evaluate_and_dispatch(
    db: AsyncSession,
    *,
    device_id: UUID,
    user_id: UUID,
    devenv_hint: dict[str, Any] | None,
    manager: Any,
) -> AutoEnrollOutcome:
    """Decide and act on one connect. Returns the branch taken.

    Exceptions propagate — :func:`run_auto_enroll` is the swallowing wrapper.
    Keeping this half honest means a DB error surfaces in tests instead of being
    indistinguishable from "nothing to do".
    """
    if not settings.DEVENV_AUTO_ENROLL_ENABLED:
        return OUTCOME_DISABLED

    # Gate 1 — the client's own declaration. A runner may always decline on its
    # own behalf; a missing hint is treated as non-primary because a build old
    # enough to omit the block is also old enough to lack the enroll arm.
    if _hint_str(devenv_hint, "instance_role") != "primary":
        return OUTCOME_NOT_PRIMARY

    # Gate 2 — the SERVER-side pairing fact. This reads ``paired_at``, NOT
    # ``capability_user_paired``: web's own ``device_crud.register_device`` sets
    # that flag ``True`` unconditionally on both its update and insert paths,
    # and ``devices_ws`` calls exactly that upsert moments before this engine
    # runs — so reading it would read a value this very connect just forced
    # true. ``paired_at`` is written by coord's pair-complete flows ONLY
    # (``routes_phase3::record_pairing``, reached from ``pair-complete`` and
    # ``pair-cli``, both credential-gated) and never by web at runtime, so a
    # temp/secondary runner that registers itself through this connect path has
    # it NULL and is correctly rejected. Verified against coord ``origin/main``
    # before this shipped: the anonymous ``POST /coord/devices/register`` route
    # goes through ``device_state::register_device``, whose UPSERT never
    # mentions the column.
    paired_at = await db.scalar(
        select(Device.paired_at).where(Device.device_id == device_id)
    )
    if paired_at is None:
        # Missing row and NULL column are the same answer here — "coord never
        # recorded a pair for this device" — and neither may enroll.
        logger.info(
            "devenv_auto_enroll_not_paired",
            device_id=str(device_id),
            user_id=str(user_id),
        )
        return OUTCOME_NOT_PAIRED

    policy = await db.scalar(
        select(AutoEnrollPolicy).where(AutoEnrollPolicy.owner_user_id == user_id)
    )
    # An ABSENT row means enabled (decision 3): an owner who never opened the
    # policy surface still gets the behaviour; opting out is an explicit act.
    if policy is not None and not policy.enabled:
        return OUTCOME_POLICY_DISABLED

    # Serialize the whole decision per device. The ``FOR UPDATE`` below locks
    # the rows it finds, which is exactly nothing in the create case — two
    # simultaneous connects for one device would both see zero rows and both
    # insert. A transaction-scoped advisory lock is the missing serialization
    # point; it is released on commit/rollback, so no path can leak it.
    #
    # TRY, not wait. If another connect for this same device already holds the
    # lock, it is running this identical decision right now — so there is
    # nothing for this caller to do but wait for an answer it would then
    # discard. Waiting would park a pooled connection (prod: 10 + 15 overflow)
    # for as long as the holder takes, once per connect, and a flapping device
    # reconnecting in a loop is exactly the case that produces several at once.
    # Returning immediately costs nothing real: the holder creates the row, and
    # this device's next connect sees it.
    acquired = await db.scalar(
        text("SELECT pg_try_advisory_xact_lock(:key)"),
        {"key": _advisory_key(device_id)},
    )
    if not acquired:
        logger.info(
            "devenv_auto_enroll_concurrent",
            device_id=str(device_id),
            user_id=str(user_id),
        )
        return OUTCOME_CONCURRENT

    rows = (
        (
            await db.execute(
                select(Machine)
                .where(
                    Machine.coord_device_id == device_id,
                    Machine.revoked_at.is_(None),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )

    if len(rows) > 1:
        # Never guess between duplicates. The non-unique
        # ``idx_devenv_machine_coord_device`` permits this today; Phase 6 turns
        # the discipline into a constraint.
        logger.warning(
            "devenv_auto_enroll_ambiguous",
            device_id=str(device_id),
            user_id=str(user_id),
            machine_count=len(rows),
            machine_ids=[str(m.id) for m in rows],
        )
        return OUTCOME_AMBIGUOUS

    if len(rows) == 1:
        machine = rows[0]
        enrolled = machine.key_hash is not None

        if enrolled:
            # Steady state: the box says it is enrolled and the row agrees.
            # This must cost one indexed SELECT and nothing more — it is the
            # branch every healthy reconnect in the fleet takes.
            if _hint_bool(devenv_hint, "enrolled") is not False:
                return OUTCOME_ALREADY_ENROLLED
            # Reinstall: the row looks healthy but the box lost its config.
            # Un-inferable server-side (only ``last_seen_at`` drifts, and that
            # is inference, not evidence), so the client hint is the trigger —
            # bounded to ITS OWN row and to one attempt per cooldown.
            if _within_cooldown(machine.auto_enroll_last_attempt_at):
                return OUTCOME_COOLDOWN
            outcome = OUTCOME_REINSTALL_REMINTED
        else:
            # Created but never enrolled — re-mint on THIS row rather than
            # creating a second one. The machine id is reused, so anything
            # already pointing at it (an environment binding, a drift history)
            # stays attached. Cooldown applies here too: without it every
            # reconnect of a box that never completes enrollment would re-mint
            # and re-dispatch forever.
            if _within_cooldown(machine.auto_enroll_last_attempt_at):
                return OUTCOME_COOLDOWN
            outcome = OUTCOME_PENDING_REMINTED

        # ``regenerate-enrollment`` semantics (devenv.py's operator route): a
        # fresh code supersedes any prior key, so clear the key material rather
        # than leaving a credential that still authenticates.
        code, _expires = devenv_machine_crud.mint_enrollment_code(machine)
        machine.key_hash = None
        machine.enrolled_at = None
        machine.auto_enroll_last_attempt_at = datetime.now(UTC)
        await db.flush()
        await db.commit()
        await _dispatch(
            manager, device_id=device_id, machine=machine, enrollment_code=code
        )
        return outcome

    # ---- 0 rows: create the machine -------------------------------------
    environment_id = await resolve_target_environment(
        db, user_id=user_id, policy=policy
    )
    if environment_id is None:
        # An unbound machine cannot capture anything: the runner's
        # ``is_enrolled()`` requires BOTH a machine id and an environment id, so
        # enrolling without one buys nothing and costs a confusing row. Say so
        # instead — Phase 5's policy control is what turns this log line into
        # something an owner can act on.
        logger.info(
            "devenv_auto_enroll_needs_environment",
            device_id=str(device_id),
            user_id=str(user_id),
            has_policy=policy is not None,
        )
        return OUTCOME_NEEDS_ENVIRONMENT

    hostname = await db.scalar(
        select(Device.hostname).where(Device.device_id == device_id)
    )
    name = await _resolve_name(db, user_id=user_id, hostname=hostname)
    if name is None:
        logger.warning(
            "devenv_auto_enroll_name_unavailable",
            device_id=str(device_id),
            user_id=str(user_id),
            hostname=hostname,
        )
        return OUTCOME_NAME_UNAVAILABLE

    machine = Machine(
        owner_user_id=user_id,
        name=name,
        hostname=hostname,
        description=None,
        environment_id=environment_id,
        # Bound up front, not at enroll-consume: the whole point of this path is
        # that the device's identity is already proven, and binding late would
        # leave a window where a second connect sees zero rows again.
        coord_device_id=device_id,
        enrollment_origin="auto",
        auto_enroll_last_attempt_at=datetime.now(UTC),
    )
    db.add(machine)
    await db.flush()
    code, _expires = devenv_machine_crud.mint_enrollment_code(machine)
    await db.flush()
    await db.commit()
    logger.info(
        "devenv_auto_enroll_created",
        device_id=str(device_id),
        user_id=str(user_id),
        machine_id=str(machine.id),
        environment_id=str(environment_id),
        name=name,
    )
    await _dispatch(manager, device_id=device_id, machine=machine, enrollment_code=code)
    return OUTCOME_CREATED


async def run_auto_enroll(
    device_id: UUID,
    user_id: UUID,
    devenv_hint: dict[str, Any] | None,
    manager: Any,
) -> AutoEnrollOutcome:
    """Open a session, run the engine, and swallow every failure.

    This is the boundary the connect handler is protected by. Anything that
    escapes here would ride an un-awaited task's exception handler at best; at
    worst, if this were ever awaited inline, it would take the socket with it.
    """
    try:
        async with AsyncSessionLocal() as db:
            outcome = await evaluate_and_dispatch(
                db,
                device_id=device_id,
                user_id=user_id,
                devenv_hint=devenv_hint,
                manager=manager,
            )
    except Exception as exc:
        # UNKNOWN, not "nothing to do" — a failed engine run must never read as
        # a quiet no-op, which is the exact silence this whole plan exists to
        # remove.
        logger.warning(
            "devenv_auto_enroll_failed",
            device_id=str(device_id),
            user_id=str(user_id),
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return OUTCOME_FAILED
    logger.info(
        "devenv_auto_enroll_decision",
        device_id=str(device_id),
        user_id=str(user_id),
        outcome=outcome,
    )
    return outcome


def schedule_auto_enroll(
    device_id: UUID,
    user_id: UUID,
    devenv_hint: dict[str, Any] | None,
    manager: Any,
) -> asyncio.Task[AutoEnrollOutcome] | None:
    """Fire-and-forget the engine; never raise into the connect handler.

    Returns the task (for tests) or ``None`` when one could not even be created.
    The caller must NOT await it: the handshake is finished by the time this is
    called and must not be extended by a DB round trip.
    """
    try:
        task = asyncio.create_task(
            run_auto_enroll(device_id, user_id, devenv_hint, manager)
        )
    except Exception as exc:  # pragma: no cover — create_task on a live loop
        logger.warning(
            "devenv_auto_enroll_schedule_failed",
            device_id=str(device_id),
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return None
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
    return task
