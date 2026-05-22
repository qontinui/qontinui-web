"""CRUD helpers for ``auth.pair_codes``.

Phase 2a.1 of plan
``D:/qontinui-root/plans/2026-05-22-mtc-iter3-remediation-web-dashboard.md``.

Provides:

* :func:`generate_code` — pure helper that draws 6 chars from the
  unambiguous alphabet (~30 bits of entropy).
* :func:`mint_pair_code` — inserts a new row with a 5-min TTL. Handles
  collisions with retry-on-IntegrityError up to 5 attempts.
* :func:`get_redeemable` — fetches a code row by code with a row lock
  (``FOR UPDATE``), returning ``None`` if the code doesn't exist,
  is expired, or has already been redeemed.
* :func:`mark_redeemed` — sets ``redeemed_at`` and
  ``redeemed_by_device_id`` on a freshly-locked row.
* :func:`sweep_expired_unredeemed` — periodic cleanup of unused expired
  codes (retention: 24h after expiry).

The redeem path enforces single-use via the row lock — concurrent
redeem attempts for the same code serialize on the row, and the second
caller sees ``redeemed_at`` set and aborts.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

import structlog
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pair_code import PairCode

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Code generation
# ---------------------------------------------------------------------------


# 32-char unambiguous alphabet: 24 letters (no I, O) + 8 digits (no 0, 1).
# Operators read off a small screen and re-type into the runner Settings;
# the dropped chars are the ones most commonly mis-read.
PAIR_CODE_ALPHABET: Final[str] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# 6 chars from a 32-char alphabet = 32^6 = ~10.7 billion possibilities,
# = ~30 bits of entropy. Plenty for a 5-min single-use code.
PAIR_CODE_LENGTH: Final[int] = 6

# TTL for newly minted codes (kept in lockstep with the model's
# server_default of ``now() + INTERVAL '5 minutes'``).
PAIR_CODE_TTL: Final[timedelta] = timedelta(minutes=5)

# After-expiry retention for the sweep job. Expired-unused rows linger
# briefly so an operator's "wait, what code did I just see" question is
# answerable from the audit log, but get cleaned up before the table
# grows unbounded.
SWEEP_RETENTION: Final[timedelta] = timedelta(hours=24)

# Bounded retry on PK collision. The alphabet is sparse enough that 5
# attempts under any realistic load suffice; retries above that almost
# certainly indicate a misconfigured rng or a saturated table.
MAX_MINT_RETRIES: Final[int] = 5


def generate_code() -> str:
    """Draw a random 6-char code from :data:`PAIR_CODE_ALPHABET`.

    Uses :func:`secrets.choice` for crypto-grade randomness — these
    codes guard a paired device JWT, so a predictable rng (e.g.
    ``random.choice``) would leak the credential. Output is always
    uppercase; the alphabet has no lowercase letters.
    """
    return "".join(secrets.choice(PAIR_CODE_ALPHABET) for _ in range(PAIR_CODE_LENGTH))


# ---------------------------------------------------------------------------
# Mint
# ---------------------------------------------------------------------------


async def mint_pair_code(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    issued_by_user_id: UUID,
) -> PairCode:
    """Insert a fresh pair code with a 5-minute TTL.

    Retries up to :data:`MAX_MINT_RETRIES` times on PK collision (almost
    never fires given the 30-bit entropy; the retry is defense against
    a saturated namespace).

    The returned row is detached + refreshed so the caller can read the
    server-side ``created_at`` / ``expires_at``.
    """
    last_exc: Exception | None = None
    for attempt in range(1, MAX_MINT_RETRIES + 1):
        code = generate_code()
        # Compute expiry on the Python side too. The server-side default
        # is in lockstep, but Python-side write lets us serialize the
        # response without a refresh on the rare case where ``flush`` +
        # ``refresh`` see different transaction snapshots.
        now = datetime.now(UTC)
        row = PairCode(
            code=code,
            tenant_id=tenant_id,
            issued_by_user_id=issued_by_user_id,
            created_at=now,
            expires_at=now + PAIR_CODE_TTL,
        )
        db.add(row)
        try:
            await db.flush()
            await db.refresh(row)
            logger.info(
                "pair_code_minted",
                tenant_id=str(tenant_id),
                issued_by=str(issued_by_user_id),
                code_prefix=code[:2],
                expires_at=row.expires_at.isoformat(),
            )
            return row
        except IntegrityError as exc:
            # Collision on the PK — rare but possible. Rollback the
            # implicit nested savepoint AsyncSession opens for the
            # flush and try again with a fresh code.
            last_exc = exc
            await db.rollback()
            logger.warning(
                "pair_code_collision_retry",
                attempt=attempt,
                tenant_id=str(tenant_id),
            )
            continue

    raise RuntimeError(
        f"failed to mint pair code after {MAX_MINT_RETRIES} attempts: {last_exc}"
    )


# ---------------------------------------------------------------------------
# Redeem
# ---------------------------------------------------------------------------


async def get_redeemable(db: AsyncSession, code: str) -> PairCode | None:
    """Fetch a pair code row by code, row-locked for redemption.

    Returns ``None`` when the code:

    * doesn't exist (caller 404s),
    * has expired (caller 410s),
    * has already been redeemed (caller 409s).

    The endpoint differentiates the three cases by re-querying without
    the lock — see :func:`find_by_code` below.

    The ``SELECT ... FOR UPDATE`` is the consume-side lock: concurrent
    redeem attempts for the same code serialize on the row, and the
    second caller sees ``redeemed_at`` set and aborts.
    """
    stmt = select(PairCode).where(PairCode.code == code).with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        return None
    now = datetime.now(UTC)
    if row.redeemed_at is not None:
        return None
    if row.expires_at <= now:
        return None
    return row


async def find_by_code(db: AsyncSession, code: str) -> PairCode | None:
    """Plain unlocked lookup — for differentiating 404 vs 409 vs 410."""
    stmt = select(PairCode).where(PairCode.code == code)
    return (await db.execute(stmt)).scalar_one_or_none()


async def mark_redeemed(
    db: AsyncSession,
    *,
    row: PairCode,
    device_id: UUID,
) -> PairCode:
    """Set ``redeemed_at`` + ``redeemed_by_device_id`` on a locked row.

    Caller must have obtained ``row`` from :func:`get_redeemable` (which
    holds the row lock) within the same transaction. Returns the
    refreshed row.
    """
    row.redeemed_at = datetime.now(UTC)
    row.redeemed_by_device_id = device_id
    await db.flush()
    await db.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Sweep
# ---------------------------------------------------------------------------


async def sweep_expired_unredeemed(db: AsyncSession) -> int:
    """Delete unredeemed pair codes whose ``expires_at`` is more than
    :data:`SWEEP_RETENTION` in the past.

    Returns the number of rows deleted. Idempotent; safe to call from a
    periodic task.
    """
    cutoff = datetime.now(UTC) - SWEEP_RETENTION
    stmt = delete(PairCode).where(
        PairCode.redeemed_at.is_(None),
        PairCode.expires_at < cutoff,
    )
    result = await db.execute(stmt)
    # SQLAlchemy's Result type doesn't expose `rowcount` in its
    # generic typing; the underlying CursorResult does for DELETE/UPDATE.
    deleted = int(getattr(result, "rowcount", 0) or 0)
    if deleted:
        logger.info("pair_code_sweep_deleted", count=deleted)
    return deleted
