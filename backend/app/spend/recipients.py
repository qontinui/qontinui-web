"""Who gets a tenant's spend-alert pushes (plan decision 9).

The tenant's coord ADMINS who have an active ``push_devices`` row and have
not muted spend alerts. Recipients default ON (served policy
``capability-ships-enabled``); muting is each user's own switch.

The admins are read from coord as web's SERVICE principal
(``GET /coord/service/tenant-admins``): a scheduler tick has no caller, so
the members proxy, which forwards the caller's bearer, cannot serve it. Any
failure of that read is UNKNOWN — the alert stands as
``unknown_recipients`` and the next tick retries; it is never read as "no
admins".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID

import structlog
from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.overview import SpendAlertPreference
from app.models.push_device import PushDevice
from app.models.user import User

logger = structlog.get_logger(__name__)


@dataclass
class Recipients:
    #: ``ok`` — the admins were read; ``unknown`` — they could not be.
    status: str
    detail: str | None = None
    #: ``(push_device_id, push_token)`` of every unmuted admin's active device.
    devices: list[tuple[UUID, str]] = field(default_factory=list)
    #: Admins resolved to a local user (muted or not).
    users: int = 0
    muted_users: int = 0
    #: Admins coord named that could not be matched to a local account (no
    #: subject match, and no VERIFIED email match). Recorded, never guessed.
    unmatched: int = 0


async def fetch_tenant_admins(tenant_id: UUID) -> tuple[list[dict] | None, str | None]:
    """``(admins, None)`` on success, ``(None, reason)`` when UNKNOWN."""
    from app.services.coord_service_account import (
        CoordServiceAccountDisabledError,
        coord_service_account,
    )

    try:
        status, body = await coord_service_account.get_tenant_admins(str(tenant_id))
    except CoordServiceAccountDisabledError:
        return None, "coord service account disabled (COORD_ADMIN_SECRET unset)"
    except Exception as exc:  # noqa: BLE001 — UNKNOWN, retried next tick
        return None, f"coord admins read failed: {type(exc).__name__}"
    if status in (404, 501):
        return None, f"coord admins read unsupported (HTTP {status})"
    if status != 200 or not isinstance(body, dict):
        return None, f"coord admins read answered HTTP {status}"
    admins = body.get("admins")
    if not isinstance(admins, list):
        return None, "coord admins read returned no admins list"
    return [a for a in admins if isinstance(a, dict)], None


async def resolve_recipients(db: AsyncSession, tenant_id: UUID) -> Recipients:
    admins, reason = await fetch_tenant_admins(tenant_id)
    if admins is None:
        return Recipients(status="unknown", detail=reason)
    # An admin is matched by Cognito subject. Email is a fallback only for an
    # admin coord knows no subject for, and only onto a local account whose
    # email is VERIFIED — an unverified account that merely claims an admin's
    # address is never handed that tenant's spend pushes.
    subs = {str(a["cognito_sub"]) for a in admins if a.get("cognito_sub")}
    emails = {
        str(a["email"]).lower()
        for a in admins
        if a.get("email") and not a.get("cognito_sub")
    }
    unmatchable = sum(
        1 for a in admins if not a.get("cognito_sub") and not a.get("email")
    )
    if not subs and not emails:
        return Recipients(
            status="ok",
            detail="the tenant has no matchable admins",
            unmatched=unmatchable,
        )
    clauses: list[ColumnElement[bool]] = []
    if subs:
        clauses.append(User.cognito_sub.in_(subs))
    if emails:
        clauses.append(
            and_(func.lower(User.email).in_(emails), User.is_verified.is_(True))
        )
    matched = (
        await db.execute(
            select(User.id, User.cognito_sub, User.email).where(
                or_(*clauses), User.is_active.is_(True)
            )
        )
    ).all()
    found_subs = {row.cognito_sub for row in matched if row.cognito_sub}
    found_emails = {row.email.lower() for row in matched if row.email}
    unmatched = unmatchable + len(subs - found_subs) + len(emails - found_emails)
    if unmatched:
        logger.info(
            "spend_recipients_unmatched_admins",
            tenant_id=str(tenant_id),
            count=unmatched,
        )
    user_ids = [row.id for row in matched]
    if not user_ids:
        return Recipients(
            status="ok",
            detail="no admin has a qontinui-web account",
            unmatched=unmatched,
        )
    muted = set(
        (
            await db.execute(
                select(SpendAlertPreference.user_id).where(
                    SpendAlertPreference.tenant_id == tenant_id,
                    SpendAlertPreference.user_id.in_(user_ids),
                    SpendAlertPreference.muted.is_(True),
                )
            )
        ).scalars()
    )
    live = [u for u in user_ids if u not in muted]
    devices: list[tuple[UUID, str]] = []
    if live:
        devices = [
            (row[0], row[1])
            for row in (
                await db.execute(
                    select(PushDevice.id, PushDevice.push_token).where(
                        PushDevice.user_id.in_(live),
                        PushDevice.is_active.is_(True),
                    )
                )
            ).all()
        ]
    return Recipients(
        status="ok",
        devices=devices,
        users=len(user_ids),
        muted_users=len(muted),
        unmatched=unmatched,
    )
