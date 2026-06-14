"""Service-to-service internal endpoints (no user surface).

Currently hosts the gate-action notification webhook (gate-action-
notifications T3, phases N2 + N3):

    POST /api/v1/internal/coord-notifications

Coord fires this *best-effort* when its merge gate escalates a PR to
specialist review. The web backend resolves the responsible qontinui
user(s) from the context coord *embeds* in the body (so there is NO call
back to coord and NO user bearer involved), then creates a prefs-gated
in-app + email notification for each — deduped, honest about confidence,
and privacy-scoped for the tenant-fallback source.

Auth is a shared service secret (``X-Coord-Service-Secret`` ==
``settings.COORD_WEB_SERVICE_SECRET``), constant-time compared. When the
secret is unset/empty the feature is UNCONFIGURED and every call is
rejected (401) — an unauthenticated call is NEVER accepted.

This is a narrow service surface: no user auth dependency, no list/read
routes, just the single ingest endpoint.
"""

from __future__ import annotations

import hmac
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.core.config import settings
from app.models.notification import Notification, NotificationType
from app.models.organization import Organization, TeamMember, TeamRole
from app.models.user import User
from app.services import identity_resolver
from app.services.identity_resolver import ResponsibleUser
from app.services.notifications.builders import build_gate_action_notification
from app.services.notifications.core import notification_service

logger = structlog.get_logger(__name__)

router = APIRouter()

_SECRET_HEADER = "X-Coord-Service-Secret"

# How many recent GATE_ACTION notifications to scan per user when checking
# the belt-and-braces web-side idempotency guard. Coord already de-noises
# on a real verdict change; this is a backstop, so a small window is
# sufficient and cheap.
_DEDUP_SCAN_LIMIT = 50


class ResponsibleContext(BaseModel):
    """The responsible-user context coord embeds so web needs no callback.

    Field names/types mirror coord's emitted payload EXACTLY (the cross-
    repo contract). ``github_author_id`` is GitHub's numeric id (int);
    the resolver coerces it to the string join key.
    """

    tenant_id: str | None = None
    github_author_id: int | None = None
    device_owner_user_id: str | None = None
    tenant_fallback_user_ids: list[str] = Field(default_factory=list)


class CoordNotificationRequest(BaseModel):
    """Body of the coord -> web gate-action webhook (the T3 contract)."""

    repo: str = Field(description="owner/name of the GitHub repository.")
    pr_number: int = Field(ge=1, description="The pull-request number.")
    block_reason_code: str = Field(
        description="Coord's gate block-reason code (e.g. 'blast_radius')."
    )
    head_sha: str = Field(description="Head commit SHA of the PR at escalation.")
    evidence: Any | None = Field(
        default=None,
        description=(
            "Arbitrary gate evidence payload (opaque) — coord emits a list of "
            "removed-export records for blast-radius blocks, null otherwise. "
            "Accepted as-is and passed through to notification metadata."
        ),
    )
    coverage: float | None = Field(
        default=None,
        description="Analysis coverage fraction in [0,1], or null if unknown.",
    )
    graph_available: bool = Field(
        description="Whether a code graph backed the decision (authority signal)."
    )
    responsible_context: ResponsibleContext = Field(
        description="Embedded responsible-user context (no coord callback needed)."
    )


class CoordNotificationResponse(BaseModel):
    """Honest count of users actually notified (may be 0)."""

    notified_user_count: int


def _require_coord_secret(
    x_coord_service_secret: str | None = Header(default=None, alias=_SECRET_HEADER),
    # Plain `Request` annotation so FastAPI injects it (a `Request | None`
    # union is rejected as a response-field type); None default keeps the
    # dependency directly callable in unit tests.
    request: Request = None,  # type: ignore[assignment]
) -> None:
    """Authenticate the coord service call via the shared secret.

    Rejects (401) when the secret is unconfigured (empty) — the feature is
    then OFF and no call is ever accepted — or when the presented header
    does not constant-time match. Never reveals which condition failed
    to the CLIENT; the server-side log carries enough shape (header
    presence/length + User-Agent, never the value) to identify a
    misconfigured caller — there is a recurring ~5-min-cadence 401 sender
    on this endpoint that ALB/access logs can't fingerprint.
    """
    configured = settings.COORD_WEB_SERVICE_SECRET or ""
    presented = x_coord_service_secret or ""
    # Empty configured secret => feature unconfigured => reject all.
    if not configured or not hmac.compare_digest(presented, configured):
        logger.warning(
            "coord_notification_rejected",
            configured_empty=not configured,
            presented_len=len(presented),
            user_agent=request.headers.get("user-agent")
            if request is not None
            else None,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing coord service secret",
        )


async def _user_ids_admin_or_owner(
    db: AsyncSession,
    candidate_user_ids: list,
) -> set:
    """Filter ``candidate_user_ids`` to org admins/owners (privacy narrowing).

    The tenant-fallback resolution source is intentionally broad (coord
    surfaces the tenant's members when neither the github-author nor the
    device-owner arm resolved anyone). Per the vetted plan, the fallback
    source must notify **admins / owners only**, never the full member
    list.

    LIMITATION: web has no first-class *coord tenant* membership model —
    coord owns tenant membership and supplies these ``user_ids`` opaquely.
    Web's closest role concept is the OSS team-collaboration
    ``auth.team_members.role`` (owner/admin/member/viewer) plus
    ``auth.organizations.owner_id`` and ``auth.users.is_superuser``. We use
    those: a candidate is kept iff they own an organization, hold an
    owner/admin TeamMember role in any organization, or are a superuser.
    This is a best-effort narrowing with web's available signal — it does
    not perfectly mirror coord's tenant-role graph, but it guarantees we
    never silently fan a fallback notification out to plain members.
    """
    if not candidate_user_ids:
        return set()

    keep: set = set()

    # Org owners (auth.organizations.owner_id).
    owner_rows = await db.execute(
        select(Organization.owner_id).where(
            Organization.owner_id.in_(candidate_user_ids)
        )
    )
    keep.update(r[0] for r in owner_rows.all())

    # TeamMember owner/admin roles.
    member_rows = await db.execute(
        select(TeamMember.user_id).where(
            TeamMember.user_id.in_(candidate_user_ids),
            TeamMember.role.in_([TeamRole.OWNER.value, TeamRole.ADMIN.value]),
        )
    )
    keep.update(r[0] for r in member_rows.all())

    # Superusers (platform admins).
    super_rows = await db.execute(
        select(User.id).where(
            User.id.in_(candidate_user_ids),
            User.is_superuser.is_(True),
        )
    )
    keep.update(r[0] for r in super_rows.all())

    return keep


async def _already_notified(
    db: AsyncSession,
    *,
    user_id,
    repo: str,
    pr_number: int,
    head_sha: str,
    block_reason_code: str,
) -> bool:
    """Belt-and-braces web-side idempotency check (no migration / no table).

    Coord only fires on a real verdict change (its persisted de-noise is
    the primary guard); this is a backstop against a duplicate webhook
    delivery. Scans the user's recent GATE_ACTION notifications and returns
    True iff an equivalent one already exists (same repo / pr_number /
    head_sha / block_reason_code in the stored metadata).
    """
    rows = await db.execute(
        select(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.type == NotificationType.GATE_ACTION,
        )
        .order_by(Notification.created_at.desc())
        .limit(_DEDUP_SCAN_LIMIT)
    )
    for n in rows.scalars().all():
        meta = n.notification_metadata or {}
        if (
            meta.get("repo") == repo
            and meta.get("pr_number") == pr_number
            and meta.get("head_sha") == head_sha
            and meta.get("block_reason_code") == block_reason_code
        ):
            return True
    return False


@router.post(
    "/coord-notifications",
    response_model=CoordNotificationResponse,
    dependencies=[Depends(_require_coord_secret)],
)
async def receive_coord_notification(
    body: CoordNotificationRequest,
    db: AsyncSession = Depends(get_async_db),
) -> CoordNotificationResponse:
    """Receive coord's gate-action webhook and notify responsible users.

    Resolves the responsible user(s) from the embedded context (no coord
    callback), then for each — after privacy narrowing of the tenant-
    fallback source and a dedupe check — creates a prefs-gated in-app +
    email GATE_ACTION notification. Returns the honest count actually
    created (0 is a valid, expected outcome: everyone opted out, every
    candidate was a non-admin fallback, or all were already notified).
    """
    rc = body.responsible_context
    ctx = identity_resolver.coord_context_from_responsible_context(
        tenant_id=rc.tenant_id,
        github_author_id=rc.github_author_id,
        device_owner_user_id=rc.device_owner_user_id,
        tenant_fallback_user_ids=rc.tenant_fallback_user_ids,
    )

    try:
        responsible: list[
            ResponsibleUser
        ] = await identity_resolver.resolve_responsible_users_from_context(db, ctx)
    except HTTPException as exc:
        # The resolver raises 404 when nothing resolves. For a best-effort
        # webhook that is not an error — it means "nobody to notify".
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            logger.info(
                "coord_notification_no_responsible_users",
                repo=body.repo,
                pr_number=body.pr_number,
            )
            return CoordNotificationResponse(notified_user_count=0)
        raise

    # Privacy narrowing: the tenant-fallback source must reach admins/owners
    # only. The github-author and device-owner sources are already specific.
    fallback_ids = [
        u.user_id
        for u in responsible
        if u.source == identity_resolver.SOURCE_TENANT_FALLBACK
    ]
    allowed_fallback = await _user_ids_admin_or_owner(db, fallback_ids)
    targets = [
        u
        for u in responsible
        if u.source != identity_resolver.SOURCE_TENANT_FALLBACK
        or u.user_id in allowed_fallback
    ]

    built = build_gate_action_notification(
        repo=body.repo,
        pr_number=body.pr_number,
        block_reason_code=body.block_reason_code,
        head_sha=body.head_sha,
        coverage=body.coverage,
        graph_available=body.graph_available,
        evidence=body.evidence,
    )
    metadata = dict(built.metadata)
    metadata["source"] = None  # per-user source stamped below

    notified = 0
    for user in targets:
        if await _already_notified(
            db,
            user_id=user.user_id,
            repo=body.repo,
            pr_number=body.pr_number,
            head_sha=body.head_sha,
            block_reason_code=body.block_reason_code,
        ):
            logger.info(
                "coord_notification_deduped",
                user_id=str(user.user_id),
                repo=body.repo,
                pr_number=body.pr_number,
            )
            continue

        per_user_meta = dict(metadata)
        per_user_meta["source"] = user.source
        created = await notification_service.create_notification(
            db,
            user_id=user.user_id,
            notification_type=NotificationType.GATE_ACTION,
            title=built.title,
            message=built.message,
            resource_type="pull_request",
            resource_id=f"{body.repo}#{body.pr_number}",
            metadata=per_user_meta,
            send_email=True,
        )
        # create_notification returns None when the user opted out (free).
        if created is not None:
            notified += 1

    logger.info(
        "coord_notification_processed",
        repo=body.repo,
        pr_number=body.pr_number,
        resolved=len(responsible),
        targeted=len(targets),
        notified=notified,
    )
    return CoordNotificationResponse(notified_user_count=notified)
