"""CRUD helpers for ``devenv`` machine enrollment + key material.

Two credential classes live here:

* **Enrollment code** — a short, human-transcribable single-use code the
  owner mints (shown ONCE) and pastes into the agent. Drawn from the same
  32-char unambiguous alphabet as the pair-code flow
  (:mod:`app.crud.pair_code_crud`). Consumed under a ``SELECT ... FOR
  UPDATE`` row lock so concurrent enroll attempts serialize and only the
  first succeeds.

* **Machine key** — a long-lived bearer credential (``mk_<token>``) the
  agent stores and sends on every call via the ``X-Machine-Key`` header.
  Only the **sha256 hex hash** + a short **prefix** are persisted; the
  plaintext is returned to the agent exactly ONCE at enroll time and is
  unrecoverable thereafter.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.devenv import Machine

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Enrollment code
# ---------------------------------------------------------------------------

# 32-char unambiguous alphabet (no 0/O/1/I) — reused from the pair-code flow
# so the owner can read it off-screen and retype into the agent without
# confusing look-alike characters.
ENROLLMENT_CODE_ALPHABET: Final[str] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# 10 chars from a 32-char alphabet = ~50 bits of entropy. Longer than the
# 6-char pair code because the enrollment window is longer (15 min default).
ENROLLMENT_CODE_LENGTH: Final[int] = 10

# Default TTL for a freshly minted enrollment code.
ENROLLMENT_CODE_TTL: Final[timedelta] = timedelta(minutes=15)

# Machine-key generation.
MACHINE_KEY_PREFIX: Final[str] = "mk_"
MACHINE_KEY_PREFIX_LEN: Final[int] = 14


def generate_enrollment_code() -> str:
    """Draw a random enrollment code from the unambiguous alphabet.

    Uses :func:`secrets.choice` for crypto-grade randomness — the code
    guards a machine-key mint, so a predictable rng would leak the
    credential.
    """
    return "".join(
        secrets.choice(ENROLLMENT_CODE_ALPHABET) for _ in range(ENROLLMENT_CODE_LENGTH)
    )


def enrollment_expiry(now: datetime | None = None) -> datetime:
    """Return the expiry for a code minted ``now`` (default: current UTC)."""
    base = now or datetime.now(UTC)
    return base + ENROLLMENT_CODE_TTL


def mint_enrollment_code(machine: Machine) -> tuple[str, datetime]:
    """Mint a fresh enrollment code onto ``machine`` and return (code, exp).

    Mutates ``machine`` in place (sets ``enrollment_code`` +
    ``enrollment_expires_at``). The caller is responsible for flush/commit.
    """
    code = generate_enrollment_code()
    expires = enrollment_expiry()
    machine.enrollment_code = code
    machine.enrollment_expires_at = expires
    return code, expires


# ---------------------------------------------------------------------------
# Machine key
# ---------------------------------------------------------------------------


def hash_machine_key(plaintext_key: str) -> str:
    """Return the sha256 hex digest of a machine key (64 chars)."""
    return hashlib.sha256(plaintext_key.encode("utf-8")).hexdigest()


def generate_machine_key() -> tuple[str, str, str]:
    """Generate a new machine key.

    Returns ``(plaintext_key, key_hash, key_prefix)``:

    * ``plaintext_key`` — ``"mk_" + token_urlsafe(32)``; returned to the
      agent exactly once, never stored.
    * ``key_hash`` — sha256 hex of the plaintext; stored for lookup.
    * ``key_prefix`` — first 14 chars of the plaintext; stored for display
      so the owner can recognize a key without seeing the secret.
    """
    plaintext = MACHINE_KEY_PREFIX + secrets.token_urlsafe(32)
    key_hash = hash_machine_key(plaintext)
    key_prefix = plaintext[:MACHINE_KEY_PREFIX_LEN]
    return plaintext, key_hash, key_prefix


# ---------------------------------------------------------------------------
# Enrollment consume (row-locked, single-use)
# ---------------------------------------------------------------------------


async def get_enrollable_machine(
    db: AsyncSession, enrollment_code: str
) -> Machine | None:
    """Fetch the machine for an enrollment code, row-locked for consume.

    Returns ``None`` when the code:

    * doesn't match any machine,
    * has expired,
    * has already been consumed (the machine is already enrolled — i.e.
      ``key_hash`` is set), or
    * belongs to a revoked machine.

    The ``SELECT ... FOR UPDATE`` is the consume-side lock — concurrent
    enroll attempts for the same code serialize on the row, and the second
    caller sees the key already minted and aborts. Mirrors
    :func:`app.crud.pair_code_crud.get_redeemable`.
    """
    stmt = (
        select(Machine)
        .where(Machine.enrollment_code == enrollment_code)
        .with_for_update()
    )
    machine = (await db.execute(stmt)).scalar_one_or_none()
    if machine is None:
        return None
    now = datetime.now(UTC)
    if machine.revoked_at is not None:
        return None
    if machine.enrollment_expires_at is None:
        return None
    # Compare tz-aware. Stored value is timestamptz; normalize naive to UTC.
    expires = machine.enrollment_expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires <= now:
        return None
    # Already consumed — a key has been minted for this machine.
    if machine.key_hash is not None:
        return None
    return machine


async def consume_enrollment(
    db: AsyncSession,
    *,
    machine: Machine,
    hostname: str | None = None,
) -> str:
    """Consume the enrollment code on a locked machine, minting a key.

    Generates a fresh machine key, stores ONLY the hash + prefix, clears
    the enrollment code (single-use), stamps ``enrolled_at``, and returns
    the **plaintext** key for one-time delivery to the agent. The caller
    must have obtained ``machine`` from :func:`get_enrollable_machine`
    (which holds the row lock) within the same transaction.
    """
    plaintext, key_hash, key_prefix = generate_machine_key()
    now = datetime.now(UTC)
    machine.key_hash = key_hash
    machine.key_prefix = key_prefix
    machine.enrolled_at = now
    machine.last_seen_at = now
    # Single-use: burn the enrollment code so it can't be replayed.
    machine.enrollment_code = None
    machine.enrollment_expires_at = None
    if hostname is not None:
        machine.hostname = hostname
    await db.flush()
    logger.info(
        "devenv_machine_enrolled",
        machine_id=str(machine.id),
        key_prefix=key_prefix,
    )
    return plaintext


# ---------------------------------------------------------------------------
# Machine-key authentication lookup
# ---------------------------------------------------------------------------


async def get_machine_by_key(db: AsyncSession, plaintext_key: str) -> Machine | None:
    """Resolve a machine by its plaintext key via sha256 hash lookup.

    Returns the machine regardless of revoked state — the caller decides
    how to handle a revoked machine (so it can distinguish 401 unknown-key
    from 403 revoked).
    """
    key_hash = hash_machine_key(plaintext_key)
    stmt = select(Machine).where(Machine.key_hash == key_hash)
    return (await db.execute(stmt)).scalar_one_or_none()


async def touch_last_seen(db: AsyncSession, machine: Machine) -> None:
    """Bump ``last_seen_at`` to now. Caller commits."""
    machine.last_seen_at = datetime.now(UTC)
    await db.flush()


async def revoke_machine(db: AsyncSession, machine: Machine) -> None:
    """Revoke a machine: stamp ``revoked_at`` and invalidate its key.

    Clearing the key hash hard-invalidates the credential (no future
    ``X-Machine-Key`` lookup can match), in addition to the revoked-at
    guard. Caller commits.
    """
    machine.revoked_at = datetime.now(UTC)
    machine.key_hash = None
    await db.flush()


def _ensure_uuid(value: str | UUID) -> UUID:
    """Coerce a str/UUID to UUID (helper for type-narrowing callers)."""
    return value if isinstance(value, UUID) else UUID(str(value))
