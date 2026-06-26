"""Machine-key API for the ``devenv`` digital-twin agent.

This router is authenticated by the **machine key**, not a user JWT — the
agent runs unattended on a dev machine and has no user session. The key is
sent on every call (except enroll) via the ``X-Machine-Key`` header in the
form ``mk_<token>``.

Endpoints (mounted under ``/api/v1/devenv``):

* ``POST /agent/enroll`` — **no machine-key dependency.** Consumes a
  one-time enrollment code under a ``FOR UPDATE`` row lock, mints + stores
  the key (hash + prefix only), and returns the plaintext key ONCE plus
  the machine's bound environment_id if any.
* ``PUT /agent/environments/{environment_id}/config`` — machine-key auth.
  Validates the environment is owned by the machine's owner, then upserts
  the config row keyed (environment_id, machine.id). The secret backstop
  is applied by :class:`ConfigEnvelope`'s validator before persist.
"""

from __future__ import annotations

from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.crud import devenv_machine_crud
from app.models.devenv import Machine
from app.repositories.devenv import config_repo, environment_repo
from app.schemas.devenv import (
    ConfigEnvelope,
    EnrollRequest,
    EnrollResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter()

MACHINE_KEY_PREFIX = "mk_"


# ---------------------------------------------------------------------------
# Machine-key authentication dependency
# ---------------------------------------------------------------------------


async def get_authenticated_machine(
    x_machine_key: str = Header(alias="X-Machine-Key"),
    db: AsyncSession = Depends(get_async_db),
) -> Machine:
    """Resolve + authenticate a machine from its ``X-Machine-Key`` header.

    * Rejects keys without the ``mk_`` prefix (400-ish 401).
    * Looks up by sha256 hash; unknown => 401.
    * Rejects revoked machines => 403.
    * Bumps ``last_seen_at`` on success.

    This resolves ``owner_user_id`` WITHOUT a user JWT — the machine key is
    the credential and the owner is whatever owns the matched machine.
    """
    if not x_machine_key or not x_machine_key.startswith(MACHINE_KEY_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_machine_key",
                "message": "Missing or malformed machine key.",
            },
        )
    machine = await devenv_machine_crud.get_machine_by_key(db, x_machine_key)
    if machine is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_machine_key",
                "message": "Machine key not recognized.",
            },
        )
    if machine.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "machine_revoked",
                "message": "This machine has been revoked.",
            },
        )
    await devenv_machine_crud.touch_last_seen(db, machine)
    await db.commit()
    return machine


# ---------------------------------------------------------------------------
# Enroll
# ---------------------------------------------------------------------------


@router.post(
    "/agent/enroll",
    response_model=EnrollResponse,
    status_code=status.HTTP_200_OK,
)
async def enroll_agent(
    payload: EnrollRequest,
    db: AsyncSession = Depends(get_async_db),
) -> EnrollResponse:
    """Consume a one-time enrollment code and mint a machine key.

    **No machine-key dependency** — the enrollment code IS the credential
    (the agent has no key yet). The code is consumed under a ``FOR UPDATE``
    row lock so concurrent enroll attempts serialize and only the first
    succeeds. The plaintext key is returned ONCE; only its hash + prefix
    are stored.

    Returns the machine's bound ``environment_id`` if exactly one
    environment exists for the owner (a convenience for single-environment
    setups); otherwise ``None`` and the agent reports per-environment by id.
    """
    code = payload.enrollment_code.strip().upper()
    machine = await devenv_machine_crud.get_enrollable_machine(db, code)
    if machine is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "enrollment_code_invalid",
                "message": "Enrollment code is invalid, expired, or already used.",
            },
        )
    # Optional sanity binding: if the agent asserts a machine_id it must
    # match the machine the code belongs to.
    if payload.machine_id is not None and payload.machine_id != machine.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "machine_id_mismatch",
                "message": "machine_id does not match the enrollment code.",
            },
        )
    plaintext = await devenv_machine_crud.consume_enrollment(
        db, machine=machine, hostname=payload.hostname
    )

    # Resolve the bound environment: if the owner has exactly one
    # environment, bind to it; otherwise leave None.
    environment_id: UUID | None = None
    envs = await environment_repo.list(db, owner_id=machine.owner_user_id)
    if len(envs) == 1:
        environment_id = envs[0].id  # type: ignore[assignment]

    await db.commit()
    logger.info(
        "devenv_agent_enrolled",
        machine_id=str(machine.id),
        bound_environment_id=str(environment_id) if environment_id else None,
    )
    return EnrollResponse(
        machine_id=machine.id,  # type: ignore[arg-type]
        machine_key=plaintext,
        environment_id=environment_id,
    )


# ---------------------------------------------------------------------------
# Report config
# ---------------------------------------------------------------------------


@router.put(
    "/agent/environments/{environment_id}/config",
    status_code=status.HTTP_200_OK,
)
async def report_config(
    environment_id: UUID,
    envelope: ConfigEnvelope,
    db: AsyncSession = Depends(get_async_db),
    machine: Machine = Depends(get_authenticated_machine),
) -> dict[str, object]:
    """Upsert the calling machine's config for an environment.

    The environment must be owned by the machine's owner (else 404 — never
    leak existence). The :class:`ConfigEnvelope` validator has already
    applied the secret backstop (env_contract values coerced to
    present/absent; nested non-string section values rejected) by the time
    this body runs, so the stored config is secret-safe.
    """
    env = await environment_repo.get(
        db, owner_id=machine.owner_user_id, env_id=environment_id
    )
    if env is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "environment_not_found",
                "message": "Environment not found.",
            },
        )

    stored = envelope.to_stored_config()
    row = await config_repo.upsert(
        db,
        owner_id=machine.owner_user_id,
        environment_id=environment_id,
        machine_id=machine.id,
        config=stored,
        schema_version=envelope.schema_version,
        source="agent",
        captured_at=envelope.captured_at,
    )
    await db.commit()
    logger.info(
        "devenv_agent_config_reported",
        machine_id=str(machine.id),
        environment_id=str(environment_id),
        sections=list(envelope.sections.keys()),
    )
    return {
        "ok": True,
        "config_id": str(row.id),
        "environment_id": str(environment_id),
        "machine_id": str(machine.id),
        "schema_version": envelope.schema_version,
    }
