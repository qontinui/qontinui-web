"""``/api/v1/overview/spend/*`` — the spend read, the ingest door, import
tokens and the caller's alert preference.

Tenant-scoped through ``X-Qontinui-Active-Tenant`` like every overview route.
A member reads; a project admin writes (``require_edit("project_admin")``).
The ingest door also accepts an ``overview.import_tokens`` bearer, which is
how a script (the fleet importer) posts without a browser session.

Wire shapes are pinned by the session's API contract; money is integer micros
and an UNKNOWN figure is ``null``, never 0.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID

import structlog
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_async_db
from app.models.overview import ImportToken, SpendAlertPreference, Vendor
from app.models.user import User as UserModel
from app.overview.permissions import (
    OverviewAccess,
    build_overview_access,
    get_overview_access,
    get_overview_caller,
    require_edit,
)
from app.spend.connectors import CONNECTORS, IngestQuery
from app.spend.ingest import ingest_payload
from app.spend.summary import GroupBy, build_renewals, build_summary

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/spend", tags=["overview:spend"])

#: The largest raw payload the ingest door reads (plan Phase 1).
MAX_INGEST_BYTES = 2 * 1024 * 1024

#: Every import token starts with this, so the door can tell one from a
#: Cognito JWT without asking anybody — and never sends it to coord or Cognito.
IMPORT_TOKEN_PREFIX = "qsit_"


def _now() -> datetime:
    return datetime.now(UTC)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


@router.get("/summary")
async def read_summary(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = Query(default=None),
    vendor: UUID | None = Query(default=None),
    group_by: GroupBy = Query(default="day"),
    view: Literal["amortized", "charged"] = Query(default="amortized"),
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    """Per-vendor freshness and figures, the series, totals and alerts."""
    now = _now()
    end = to or now.date()
    start = from_ or (end - timedelta(days=59))
    if start > end:
        raise HTTPException(status_code=422, detail="from is after to")
    if (end - start).days > 800:
        raise HTTPException(status_code=422, detail="range is longer than 800 days")
    summary = await build_summary(
        db,
        access.tenant_id,
        start=start,
        end=end,
        vendor_id=vendor,
        group_by=group_by,
        view=view,
        now=now,
    )
    return summary.wire()


@router.get("/renewals")
async def read_renewals(
    days: int = Query(default=60, ge=1, le=400),
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    renewals = await build_renewals(db, access.tenant_id, days=days, now=_now())
    return {"renewals": [r.model_dump(mode="json") for r in renewals]}


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------


class IngestQueryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)


class IngestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    vendor_id: UUID
    query: IngestQueryBody
    #: The provider's response, verbatim.
    raw: Any


@dataclass(frozen=True)
class IngestPrincipal:
    tenant_id: UUID
    #: ``import_token:<name>`` or ``session:<actor>`` — recorded on the run.
    source: str
    #: A vendor-scoped token may ingest for that vendor only.
    vendor_id: UUID | None = None


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization") or ""
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


async def _resolve_session_user(token: str, db: AsyncSession) -> UserModel | None:
    """The browser session's user, through the single Cognito path."""
    from app.auth.cognito_user import (
        CognitoAuthError,
        verify_cognito_token_and_resolve_user,
    )

    try:
        user = await verify_cognito_token_and_resolve_user(token, db)
    except CognitoAuthError:
        return None
    return user if user is not None and user.is_active else None


async def _ingest_principal(request: Request, db: AsyncSession) -> IngestPrincipal:
    bearer = _bearer(request)
    if bearer is None:
        raise HTTPException(status_code=401, detail="not_authenticated")
    if bearer.startswith(IMPORT_TOKEN_PREFIX):
        row = await db.scalar(
            select(ImportToken).where(
                ImportToken.token_hash == hash_token(bearer),
                ImportToken.revoked_at.is_(None),
            )
        )
        if row is None:
            raise HTTPException(status_code=401, detail="import_token_invalid")
        # An import token is valid for its own tenant only. A request naming
        # another one is refused rather than quietly re-scoped.
        active = request.headers.get("X-Qontinui-Active-Tenant")
        if active and active.strip().lower() != str(row.tenant_id):
            raise HTTPException(status_code=403, detail="import_token_wrong_tenant")
        row.last_used_at = _now()
        return IngestPrincipal(
            tenant_id=row.tenant_id,
            source=f"import_token:{row.name}",
            vendor_id=row.vendor_id,
        )

    user = await _resolve_session_user(bearer, db)
    if user is None:
        raise HTTPException(status_code=401, detail="not_authenticated")
    caller = await get_overview_caller(request)
    access = await build_overview_access(caller, user, db)
    if not access.can_edit("project_admin"):
        raise HTTPException(
            status_code=403,
            detail={
                "error": "not_permitted",
                "message": "Only a project administrator may import spend.",
            },
        )
    return IngestPrincipal(
        tenant_id=access.tenant_id, source=f"session:{access.actor or user.id}"
    )


async def after_ingest(tenant_id: UUID) -> None:
    """Evaluate the tenant's rules once a successful ingest has committed."""
    from app.spend.evaluate import evaluate_and_deliver_tenant

    try:
        await evaluate_and_deliver_tenant(tenant_id)
    except Exception:  # noqa: BLE001 — the hourly tick retries
        logger.exception("spend_after_ingest_evaluate_failed", tenant_id=str(tenant_id))


@router.post("/ingest/{connector}", status_code=201)
async def ingest(
    connector: str,
    request: Request,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_async_db),
) -> Any:
    """Normalise a raw provider payload and upsert its entries.

    201 with the run on success; 422 (with the ``failed`` run written) when
    the normaliser rejects the payload.
    """
    # Authenticate BEFORE reading the body, then read it with a running cap,
    # so an unauthenticated (or chunked, length-less) caller cannot make the
    # server buffer an arbitrary payload.
    principal = await _ingest_principal(request, db)
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_INGEST_BYTES:
        raise HTTPException(status_code=413, detail="payload_too_large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_INGEST_BYTES:
            raise HTTPException(status_code=413, detail="payload_too_large")
        chunks.append(chunk)
    raw_body = b"".join(chunks)
    if connector not in CONNECTORS:
        raise HTTPException(status_code=404, detail="unknown_connector")
    try:
        body = IngestBody.model_validate(json.loads(raw_body or b"null"))
    except (ValueError, ValidationError) as exc:
        detail = exc.errors() if isinstance(exc, ValidationError) else "invalid JSON"
        raise HTTPException(status_code=422, detail=detail) from exc

    if principal.vendor_id is not None and principal.vendor_id != body.vendor_id:
        raise HTTPException(status_code=403, detail="import_token_wrong_vendor")
    vendor = await db.scalar(
        select(Vendor).where(
            Vendor.id == body.vendor_id, Vendor.tenant_id == principal.tenant_id
        )
    )
    if vendor is None:
        raise HTTPException(status_code=404, detail="unknown_vendor")
    if vendor.connector != connector:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "connector_mismatch",
                "message": f"That vendor's connector is {vendor.connector!r}.",
            },
        )

    result = await ingest_payload(
        db,
        tenant_id=principal.tenant_id,
        vendor=vendor,
        connector=connector,
        query=IngestQuery(body.query.year, body.query.month, body.query.day),
        raw=body.raw,
        source=principal.source,
    )
    await db.commit()
    payload = {
        "import_run_id": str(result.run_id),
        "status": result.status,
        "rows_upserted": result.rows_upserted,
        "items_seen": result.items_seen,
        "reconcile_delta_micros": result.reconcile_delta_micros,
    }
    if result.status != "ok":
        payload["error"] = result.error
        # The failed run is committed above either way. A payload the
        # normaliser rejects is the caller's to fix (422); a failure to store
        # it is this server's (500), and the caller should retry.
        code = 422 if result.failure == "rejected" else 500
        return JSONResponse(status_code=code, content=payload)
    background.add_task(after_ingest, principal.tenant_id)
    return payload


# ---------------------------------------------------------------------------
# Import tokens
# ---------------------------------------------------------------------------


class ImportTokenCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    vendor_id: UUID | None = None


class ImportTokenRead(BaseModel):
    id: str
    name: str
    vendor_id: str | None
    created_at: datetime
    created_by: str | None
    last_used_at: datetime | None
    revoked_at: datetime | None


def _token_read(row: ImportToken) -> ImportTokenRead:
    return ImportTokenRead(
        id=str(row.id),
        name=row.name,
        vendor_id=str(row.vendor_id) if row.vendor_id else None,
        created_at=row.created_at,
        created_by=row.created_by,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
    )


@router.post("/import-tokens", status_code=201)
async def create_import_token(
    payload: ImportTokenCreate,
    access: OverviewAccess = Depends(require_edit("project_admin")),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, str]:
    """Mint a token. Its value is in THIS response only; only its hash is kept."""
    if payload.vendor_id is not None:
        found = await db.scalar(
            select(Vendor.id).where(
                Vendor.id == payload.vendor_id, Vendor.tenant_id == access.tenant_id
            )
        )
        if found is None:
            raise HTTPException(status_code=422, detail="unknown_vendor")
    token = IMPORT_TOKEN_PREFIX + secrets.token_urlsafe(32)
    row = ImportToken(
        tenant_id=access.tenant_id,
        vendor_id=payload.vendor_id,
        name=payload.name,
        token_hash=hash_token(token),
        created_by=access.actor,
        updated_by=access.actor,
    )
    db.add(row)
    await db.commit()
    return {"id": str(row.id), "token": token}


@router.get("/import-tokens")
async def list_import_tokens(
    access: OverviewAccess = Depends(require_edit("project_admin")),
    db: AsyncSession = Depends(get_async_db),
) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(ImportToken)
            .where(ImportToken.tenant_id == access.tenant_id)
            .order_by(ImportToken.created_at.desc())
        )
    ).scalars()
    return {"tokens": [_token_read(r).model_dump(mode="json") for r in rows]}


@router.delete("/import-tokens/{token_id}", status_code=204)
async def revoke_import_token(
    token_id: UUID,
    access: OverviewAccess = Depends(require_edit("project_admin")),
    db: AsyncSession = Depends(get_async_db),
) -> Response:
    result = await db.execute(
        update(ImportToken)
        .where(
            ImportToken.id == token_id,
            ImportToken.tenant_id == access.tenant_id,
            ImportToken.revoked_at.is_(None),
        )
        .values(revoked_at=_now(), updated_by=access.actor)
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        exists = await db.scalar(
            select(ImportToken.id).where(
                ImportToken.id == token_id, ImportToken.tenant_id == access.tenant_id
            )
        )
        if exists is None:
            raise HTTPException(status_code=404, detail="not_found")
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# The caller's own alert preference
# ---------------------------------------------------------------------------


class AlertPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")

    muted: bool


def _user_id(access: OverviewAccess) -> UUID:
    if access.user_id is None:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return access.user_id


@router.get("/alert-preferences", response_model=AlertPreferences)
async def read_alert_preferences(
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> AlertPreferences:
    row = await db.get(SpendAlertPreference, (access.tenant_id, _user_id(access)))
    return AlertPreferences(muted=bool(row.muted) if row else False)


@router.put("/alert-preferences", response_model=AlertPreferences)
async def write_alert_preferences(
    payload: AlertPreferences,
    access: OverviewAccess = Depends(get_overview_access),
    db: AsyncSession = Depends(get_async_db),
) -> AlertPreferences:
    """Any member sets their OWN switch; nobody sets another's."""
    user_id = _user_id(access)
    row = await db.get(SpendAlertPreference, (access.tenant_id, user_id))
    if row is None:
        row = SpendAlertPreference(
            tenant_id=access.tenant_id,
            user_id=user_id,
            muted=payload.muted,
            created_by=access.actor,
            updated_by=access.actor,
        )
        db.add(row)
    else:
        row.muted = payload.muted
        row.updated_by = access.actor
    await db.commit()
    return AlertPreferences(muted=payload.muted)
