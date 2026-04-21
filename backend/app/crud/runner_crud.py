"""
CRUD operations for runner bearer tokens and the runner fleet registry.

This module is deliberately separate from :mod:`app.crud.runner` (which owns
transient WebSocket connection records) to keep authentication concerns apart
from connection-history concerns.
"""

from datetime import timedelta
from uuid import UUID

from fastapi import HTTPException, status
from qontinui_schemas.common import utc_now
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tokens import (
    RUNNER_TOKEN_PREFIX,
    generate_runner_token,
    hash_runner_token,
    verify_runner_token,
)
from app.models.runner import Runner
from app.models.runner_token import RunnerToken

__all__ = [
    "create_runner_token",
    "validate_runner_token",
    "revoke_runner_token",
    "list_runner_tokens",
    "get_runner_token",
    "register_runner",
    "heartbeat_runner",
    "list_runners",
    "get_runner",
    "delete_runner",
]


# ---------------------------------------------------------------------------
# Runner tokens
# ---------------------------------------------------------------------------


async def create_runner_token(
    db: AsyncSession,
    user_id: UUID,
    name: str,
    expires_in_days: int | None = None,
) -> tuple[RunnerToken, str]:
    """Create a new runner token for ``user_id``.

    Args:
        db: Active async session.
        user_id: Owning user.
        name: User-friendly label (e.g. "laptop").
        expires_in_days: Lifetime in days, or ``None`` for a token that never
            expires. Negative values are allowed (produces an already-expired
            token, useful for tests).

    Returns:
        A tuple ``(record, plain_token)``. The plain token is **only** visible
        here — callers must surface it to the user and then discard it. Only
        the Argon2 hash is stored.
    """
    plain_token = generate_runner_token()
    token_hash = hash_runner_token(plain_token)

    expires_at = None
    if expires_in_days is not None:
        expires_at = utc_now() + timedelta(days=expires_in_days)

    record = RunnerToken(
        user_id=user_id,
        name=name,
        token_hash=token_hash,
        expires_at=expires_at,
        is_revoked=False,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    return record, plain_token


async def validate_runner_token(
    db: AsyncSession,
    plain_token: str,
) -> RunnerToken | None:
    """Look up and validate a plaintext runner token.

    Iterates over every non-revoked, non-expired token and uses constant-time
    Argon2 verification to find a match. O(n) in the number of active tokens,
    which is acceptable for a realistic fleet size; a future optimisation
    could introduce a cheap lookup prefix column.

    On a match, bumps ``last_used_at`` and commits.

    Returns:
        The matching :class:`RunnerToken`, or ``None`` if no valid token
        matches.
    """
    # Fast shape check — skip the DB round trip for obviously wrong tokens.
    if not plain_token.startswith(RUNNER_TOKEN_PREFIX):
        return None

    now = utc_now()
    query = select(RunnerToken).where(
        RunnerToken.is_revoked.is_(False),
    )
    result = await db.execute(query)
    candidates = list(result.scalars().all())

    for candidate in candidates:
        # Skip expired tokens (expires_at is timezone-aware in our schema).
        if candidate.expires_at is not None and candidate.expires_at <= now:
            continue

        if verify_runner_token(plain_token, candidate.token_hash):
            candidate.last_used_at = now
            await db.commit()
            await db.refresh(candidate)
            return candidate

    return None


async def revoke_runner_token(
    db: AsyncSession,
    token_id: UUID,
    user_id: UUID,
) -> None:
    """Revoke a runner token.

    Verifies that ``user_id`` owns the token before revoking. Idempotent:
    revoking an already-revoked token is a no-op.

    Raises:
        HTTPException 404: Token does not exist.
        HTTPException 403: Token exists but belongs to a different user.
    """
    query = select(RunnerToken).where(RunnerToken.id == token_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner token not found",
        )
    if record.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this runner token",
        )

    if not record.is_revoked:
        record.is_revoked = True
        record.revoked_at = utc_now()
        await db.commit()


async def list_runner_tokens(
    db: AsyncSession,
    user_id: UUID,
) -> list[RunnerToken]:
    """Return all runner tokens (including revoked) owned by ``user_id``."""
    query = (
        select(RunnerToken)
        .where(RunnerToken.user_id == user_id)
        .order_by(RunnerToken.created_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_runner_token(
    db: AsyncSession,
    token_id: UUID,
) -> RunnerToken | None:
    """Fetch a runner token by id (no ownership check)."""
    query = select(RunnerToken).where(RunnerToken.id == token_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Runner fleet registry
# ---------------------------------------------------------------------------


def _generate_dispatch_secret() -> str:
    """Generate a fresh per-runner dispatch secret.

    Returns a 64-character hex string (32 random bytes). Mirrors the
    ``server_default`` on :attr:`~app.models.runner.Runner.dispatch_secret`
    so rows created in Python get the same shape as rows created via raw
    SQL / ``server_default``.
    """
    import secrets

    return secrets.token_hex(32)


async def register_runner(
    db: AsyncSession,
    *,
    user_id: UUID,
    name: str,
    hostname: str,
    port: int,
    capabilities: list[str],
    server_mode: bool,
    restate_enabled: bool,
    restate_healthy: bool,
    runner_token_id: UUID | None = None,
) -> Runner:
    """Register (or update) a server-mode runner.

    Idempotent on ``(user_id, name)``: if a runner with the same name already
    exists for this user, its metadata is refreshed rather than creating a
    duplicate. Newly registered or re-registered runners are marked
    ``status="healthy"`` and have their heartbeat timestamp set to now.

    Every call rotates ``dispatch_secret``: the runner is expected to capture
    it off the response and replace any value it had cached. A plain-text
    secret is always returned on the response — hashed storage is impossible
    because web itself needs to present the value as a bearer when
    dispatching workflows.
    """
    query = select(Runner).where(Runner.user_id == user_id, Runner.name == name)
    result = await db.execute(query)
    existing = result.scalar_one_or_none()

    now = utc_now()

    if existing is not None:
        existing.hostname = hostname
        existing.port = port
        existing.capabilities = capabilities
        existing.server_mode = server_mode
        existing.restate_enabled = restate_enabled
        existing.restate_healthy = restate_healthy
        existing.last_heartbeat = now
        existing.status = "healthy"
        existing.dispatch_secret = _generate_dispatch_secret()
        if runner_token_id is not None:
            existing.runner_token_id = runner_token_id
        await db.commit()
        await db.refresh(existing)
        return existing

    record = Runner(
        user_id=user_id,
        name=name,
        hostname=hostname,
        port=port,
        capabilities=capabilities,
        server_mode=server_mode,
        restate_enabled=restate_enabled,
        restate_healthy=restate_healthy,
        last_heartbeat=now,
        status="healthy",
        runner_token_id=runner_token_id,
        dispatch_secret=_generate_dispatch_secret(),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def heartbeat_runner(
    db: AsyncSession,
    *,
    runner_id: UUID,
    restate_healthy: bool,
    status_value: str,
    derived_status: str | None = None,
    ui_error: dict | None = None,
) -> Runner | None:
    """Record a heartbeat from a runner, updating liveness fields.

    Phase 3J.5 extended the heartbeat to optionally carry ``derived_status``
    and ``ui_error``. Both are written on every heartbeat:

    * ``derived_status`` is replaced each heartbeat with the runner's
      latest value (``None`` from a pre-Phase-3J runner simply keeps the
      column null).
    * ``ui_error`` is authoritative each heartbeat: a dict overwrites the
      column, ``None`` (either explicitly sent as JSON ``null`` or omitted
      by a pre-Phase-3J runner) clears it. This matches the runner's
      state machine — the runner holds the current outstanding error and
      the heartbeat reflects that.

    Returns the updated row, or ``None`` if no runner with ``runner_id``
    exists.
    """
    query = select(Runner).where(Runner.id == runner_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if record is None:
        return None

    record.last_heartbeat = utc_now()
    record.restate_healthy = restate_healthy
    record.status = status_value
    record.derived_status = derived_status
    record.ui_error = ui_error
    await db.commit()
    await db.refresh(record)
    return record


async def list_runners(
    db: AsyncSession,
    user_id: UUID,
) -> list[Runner]:
    """Return all server-mode runners owned by ``user_id`` (newest first)."""
    query = (
        select(Runner)
        .where(Runner.user_id == user_id)
        .order_by(Runner.created_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_runner(
    db: AsyncSession,
    runner_id: UUID,
) -> Runner | None:
    """Fetch a runner by id (no ownership check)."""
    query = select(Runner).where(Runner.id == runner_id)
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def delete_runner(
    db: AsyncSession,
    runner_id: UUID,
    user_id: UUID,
) -> None:
    """Delete a runner registration.

    Raises:
        HTTPException 404: Runner does not exist.
        HTTPException 403: Runner exists but belongs to a different user.
    """
    record = await get_runner(db, runner_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Runner not found",
        )
    if record.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this runner",
        )

    await db.delete(record)
    await db.commit()
