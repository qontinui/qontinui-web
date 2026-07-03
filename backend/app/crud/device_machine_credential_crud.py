"""CRUD helpers for ``devenv`` device machine credentials (``dmk_``).

A **device machine key** is a long-lived, device-bound bearer credential
(``dmk_<token>``) a paired runner can exchange for a device JWT with NO
user session — the >30-day-offline cold-start recovery path (Phase 4b).

Mirrors :mod:`app.crud.devenv_machine_crud`'s machine-key idiom verbatim,
for a **device** instead of an env-capture machine: only the sha256 hex
**hash** + a short **prefix** are persisted; the plaintext ``dmk_`` is
returned to the runner exactly ONCE at mint time and is unrecoverable
thereafter.

One active credential per device: :func:`mint` UPSERTs on ``device_id`` so
a re-mint atomically replaces the prior key (rotating the secret), rather
than accumulating stale rows.
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

from app.models.devenv import DeviceMachineCredential

logger = structlog.get_logger(__name__)

# Device-machine-key generation. Mirrors ``MACHINE_KEY_PREFIX`` /
# ``MACHINE_KEY_PREFIX_LEN`` in ``devenv_machine_crud`` but with a distinct
# ``dmk_`` prefix so the two credential classes are never confused.
DEVICE_MACHINE_KEY_PREFIX: Final[str] = "dmk_"
DEVICE_MACHINE_KEY_PREFIX_LEN: Final[int] = 14

# Default TTL for a freshly minted device machine key. Long enough to cover
# the >30-day cold-start window, short enough to bound exposure; renewed
# opportunistically on each successful exchange (sliding session).
DEVICE_MACHINE_KEY_TTL_DAYS: Final[int] = 60


def hash_device_machine_key(plaintext_key: str) -> str:
    """Return the sha256 hex digest of a device machine key (64 chars)."""
    return hashlib.sha256(plaintext_key.encode("utf-8")).hexdigest()


def generate_device_machine_key() -> tuple[str, str, str]:
    """Generate a new device machine key.

    Returns ``(plaintext_key, dmk_hash, dmk_prefix)``:

    * ``plaintext_key`` — ``"dmk_" + token_urlsafe(32)``; returned to the
      runner exactly once, never stored.
    * ``dmk_hash`` — sha256 hex of the plaintext; stored for lookup.
    * ``dmk_prefix`` — first 14 chars of the plaintext; stored for display
      so the owner can recognize a key without seeing the secret.
    """
    plaintext = DEVICE_MACHINE_KEY_PREFIX + secrets.token_urlsafe(32)
    dmk_hash = hash_device_machine_key(plaintext)
    dmk_prefix = plaintext[:DEVICE_MACHINE_KEY_PREFIX_LEN]
    return plaintext, dmk_hash, dmk_prefix


def _expiry(
    now: datetime | None = None, ttl_days: int = DEVICE_MACHINE_KEY_TTL_DAYS
) -> datetime:
    """Return the expiry for a key minted ``now`` (default: current UTC)."""
    base = now or datetime.now(UTC)
    return base + timedelta(days=ttl_days)


async def mint(
    db: AsyncSession,
    *,
    device_id: UUID,
    owner_user_id: UUID | None,
    tenant_id: UUID | None = None,
    ttl_days: int = DEVICE_MACHINE_KEY_TTL_DAYS,
) -> tuple[str, DeviceMachineCredential]:
    """Mint (or rotate) the device machine key for ``device_id``.

    Generates a fresh ``dmk_`` and stores ONLY its hash + prefix, with a
    ``now + ttl_days`` expiry. UPSERT semantics on ``device_id`` (one active
    key per device): a re-mint replaces the prior credential in place,
    rotating the secret and clearing any previous revocation/usage stamps.

    Returns ``(plaintext_key, credential)`` — the plaintext is delivered to
    the runner exactly once. The caller commits.
    """
    plaintext, dmk_hash, dmk_prefix = generate_device_machine_key()
    now = datetime.now(UTC)
    expires_at = _expiry(now, ttl_days)

    stmt = (
        select(DeviceMachineCredential)
        .where(DeviceMachineCredential.device_id == device_id)
        .with_for_update()
    )
    cred = (await db.execute(stmt)).scalar_one_or_none()

    if cred is None:
        cred = DeviceMachineCredential(
            device_id=device_id,
            owner_user_id=owner_user_id,
            dmk_hash=dmk_hash,
            dmk_prefix=dmk_prefix,
            tenant_id=tenant_id,
            expires_at=expires_at,
            last_used_at=None,
            revoked_at=None,
        )
        db.add(cred)
    else:
        # Rotate the existing row in place — replace the secret and reset
        # the lifecycle stamps so the re-minted key is fresh.
        cred.owner_user_id = owner_user_id
        cred.dmk_hash = dmk_hash
        cred.dmk_prefix = dmk_prefix
        cred.tenant_id = tenant_id
        cred.expires_at = expires_at
        cred.last_used_at = None
        cred.revoked_at = None

    await db.flush()
    logger.info(
        "devenv_device_machine_key_minted",
        device_id=str(device_id),
        dmk_prefix=dmk_prefix,
    )
    return plaintext, cred


async def get_by_hash(
    db: AsyncSession, dmk_hash: str
) -> DeviceMachineCredential | None:
    """Resolve a credential by its sha256 hash.

    Returns the row regardless of revoked/expired state — the caller
    decides how to handle a revoked or expired key (so it can distinguish
    401 unknown-key from 403 revoked/expired).
    """
    stmt = select(DeviceMachineCredential).where(
        DeviceMachineCredential.dmk_hash == dmk_hash
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_by_key(
    db: AsyncSession, plaintext_key: str
) -> DeviceMachineCredential | None:
    """Resolve a credential by its plaintext key via sha256 hash lookup."""
    return await get_by_hash(db, hash_device_machine_key(plaintext_key))


async def revoke(db: AsyncSession, device_id: UUID) -> DeviceMachineCredential | None:
    """Revoke the device's credential: stamp ``revoked_at`` + invalidate.

    Clearing the hash hard-invalidates the credential (no future hash
    lookup can match) in addition to the revoked-at guard. Returns the
    revoked row, or ``None`` if the device has no credential. Caller
    commits.
    """
    stmt = (
        select(DeviceMachineCredential)
        .where(DeviceMachineCredential.device_id == device_id)
        .with_for_update()
    )
    cred = (await db.execute(stmt)).scalar_one_or_none()
    if cred is None:
        return None
    cred.revoked_at = datetime.now(UTC)
    cred.dmk_hash = ""
    await db.flush()
    logger.info(
        "devenv_device_machine_key_revoked",
        device_id=str(device_id),
    )
    return cred


async def bump_last_used(
    db: AsyncSession,
    cred: DeviceMachineCredential,
    *,
    slide_ttl_days: int | None = DEVICE_MACHINE_KEY_TTL_DAYS,
) -> None:
    """Stamp ``last_used_at`` = now on a successful exchange.

    When ``slide_ttl_days`` is set (default), also slides ``expires_at`` to
    ``now + slide_ttl_days`` so an actively-recovering runner's key never
    lapses (a truly-dead runner's key still eventually expires). Pass
    ``None`` to bump usage without extending the TTL. Caller commits.
    """
    now = datetime.now(UTC)
    cred.last_used_at = now
    if slide_ttl_days is not None:
        cred.expires_at = _expiry(now, slide_ttl_days)
    await db.flush()


def is_usable(cred: DeviceMachineCredential, now: datetime | None = None) -> bool:
    """Return whether ``cred`` is neither revoked nor expired.

    A convenience for the exchange path: a usable credential has
    ``revoked_at IS NULL`` and either no ``expires_at`` or an ``expires_at``
    in the future. Normalizes a naive stored timestamp to UTC for the
    comparison (the column is timestamptz).
    """
    if cred.revoked_at is not None:
        return False
    if cred.expires_at is None:
        return True
    current = now or datetime.now(UTC)
    expires = cred.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    return expires > current
