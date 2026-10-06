"""Per-repo follow-up dials — read/write proxies for two coord per-repo settings.

Plan ``2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind``
Phase 4b. Both dials live on coord's ``coord.tenant_repo_profiles`` row for a
``(tenant, repo)`` pair, and neither had any web surface before this module:

* **Post-merge follow-up scope** — ``GET``/``PUT /coord/post-merge-followup-scope``.
  Whether a merged PR in this repo spawns its post-merge follow-up session:
  ``all`` (default — every merge spawns), ``code_only`` (only when the diff
  touches one of ``code_paths``) or ``none``. The GET also carries the fleet
  rollout ``mode`` (``shadow`` | ``enforce`` | ``off``): under ``shadow`` coord
  only COMPUTES the verdict and suppresses nothing, which the operator must be
  able to see beside the setting.
* **Continuation-delivery mode** — ``GET``/``PUT /coord/continuation-delivery-mode``.
  How work is delivered back to an author session:
  ``in_session_with_spawn_fallback`` | ``spawn_always`` | ``notify_only``.

Mounted under ``/operations`` (see ``app/api/v1/api.py``) so the paths sit
beside the fleet-policy proxy they copy, and so the frontend's
``ACTIVE_TENANT_URL_PREFIXES`` entry for ``/api/v1/operations/`` already
forwards the Project selector. It is a separate module rather than more lines in
``operations.py`` only to stay out of that file's merge traffic; every piece of
proxy plumbing is reused from there, unchanged:

* the operator's Cognito bearer and the ``X-Qontinui-Active-Tenant`` selection
  are captured by ``get_tenant_id`` / ``require_coord_tenant_admin`` and
  forwarded by ``operations._tenant_headers``, so coord builds its own
  ``OperatorContext`` (the PUTs are ``OperatorContext`` + ``rbac::is_tenant_admin``
  on coord's side) and scopes the read to the effective tenant;
* ``can_edit`` uses the SAME effective-tenant rule as ``GET /fleet-policy``
  (``operations.get_fleet_policy``'s docstring says why ``identity.is_admin``
  would be wrong in both directions);
* coord's non-2xx answers pass through with coord's status and body, so a
  ``400`` validation message, a ``403 admin_required`` and a
  ``503 column_not_present`` / ``preference_unreadable`` reach the browser as
  coord said them.

**Unknown is never rendered as a default.** Coord answers an unreadable
follow-up scope with a 503 rather than ``all``, because served policy
``production-and-cost`` ``agent-spawn-authorization`` forbids resolving an
unreadable preference to the permissive default. This proxy keeps that: a 503
stays a 503, and a 200 whose body carries no recognisable ``scope`` is a 502
here, never a guessed ``all``.

The continuation-delivery READ is weaker, and this module says so rather than
hiding it: coord's ``GET /coord/continuation-delivery-mode`` resolves
fail-open (``continuation_delivery::get_continuation_delivery_mode`` returns
the default on a missing row, a missing column AND a failed read) and always
reports ``resolved_scope: "repo"``. So its answer is "what coord's resolver
returns", not "what is stored"; :class:`ContinuationDeliveryModeView` carries
``provenance_known: False`` so the UI cannot present it as a stored setting.
"""

from __future__ import annotations

import re
from typing import Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.api.deps import get_current_active_user_async
from app.api.v1.endpoints.operations import (
    ACTIVE_TENANT_HEADER,
    _effective_tenant_roles,
    _proxy_coord_get,
    _proxy_coord_put,
    get_tenant_id,
    require_coord_tenant_admin,
)
from app.models.user import User as UserModel
from app.services.coord_identity import get_coord_identity

logger = structlog.get_logger(__name__)
router = APIRouter()

POST_MERGE_SCOPE_COORD_PATH = "/coord/post-merge-followup-scope"
CONTINUATION_DELIVERY_COORD_PATH = "/coord/continuation-delivery-mode"

FollowupScope = Literal["all", "code_only", "none"]
FOLLOWUP_SCOPES: tuple[str, ...] = ("all", "code_only", "none")

DeliveryMode = Literal["in_session_with_spawn_fallback", "spawn_always", "notify_only"]
DELIVERY_MODES: tuple[str, ...] = (
    "in_session_with_spawn_fallback",
    "spawn_always",
    "notify_only",
)

#: Coord keys both dials on the GitHub full name, ``owner/name``, and 400s the
#: follow-up scope otherwise (``post_merge_scope::is_full_repo_name``). The
#: same check is applied to both here so a typo is a local 422, not a row
#: written under a key no webhook will ever match.
_REPO_FULL_NAME = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


def _check_repo(value: str) -> str:
    repo = value.strip()
    if not _REPO_FULL_NAME.match(repo):
        raise ValueError("repo must be a GitHub full name, owner/name")
    return repo


async def _can_edit(request: Request, current_user: UserModel) -> bool:
    """Whether the caller may write — the rule ``require_coord_tenant_admin``
    applies to the PUTs: admin in the EFFECTIVE tenant, or a qontinui
    superuser. UI gating only; coord re-checks ``rbac::is_tenant_admin``."""
    identity = await get_coord_identity(request)
    active = request.headers.get(ACTIVE_TENANT_HEADER)
    return "admin" in _effective_tenant_roles(identity, active) or bool(
        current_user.is_superuser
    )


# ---------------------------------------------------------------------------
# Post-merge follow-up scope
# ---------------------------------------------------------------------------


class PostMergeFollowupScopeView(BaseModel):
    """One repo's post-merge follow-up scope, as coord resolves it."""

    repo: str
    scope: FollowupScope
    #: Globs naming the paths that carry a build/test oracle. Meaningful for
    #: ``code_only``; kept (and shown) under ``all`` / ``none`` because coord
    #: keeps them there too, so parking a repo at ``all`` does not lose them.
    code_paths: list[str] = Field(default_factory=list)
    #: ``"repo"`` — this repo's row declares the scope. ``"default"`` — no row
    #: declares one, and ``all`` is the undeclared default. ``None`` — coord
    #: did not say, which is UNKNOWN, not either of those.
    resolved_scope: Literal["repo", "default"] | None = None
    #: The fleet rollout mode (``COORD_POST_MERGE_SCOPE_MODE``). ``shadow``:
    #: coord computes and logs the verdict but suppresses nothing, so a
    #: ``code_only``/``none`` here does not yet stop any spawn. ``enforce``:
    #: it acts. ``off``: the layer is skipped entirely. ``None``: coord did not
    #: say — UNKNOWN, and the UI must not assume any of the three.
    mode: Literal["shadow", "enforce", "off"] | None = None
    #: Same effective-tenant rule as ``GET /fleet-policy``'s ``can_edit``.
    can_edit: bool


def _scope_view(
    payload: Any, *, repo: str, can_edit: bool
) -> PostMergeFollowupScopeView:
    """Project coord's GET body, refusing to invent a scope it did not send."""
    body = payload if isinstance(payload, dict) else {}
    scope = body.get("scope")
    if scope not in FOLLOWUP_SCOPES:
        # A 200 without a recognisable scope is not "all". Surface it as an
        # upstream fault so the UI renders UNKNOWN for this repo.
        logger.warning(
            "post_merge_followup_scope.unrecognised_scope",
            repo=repo,
            scope=scope,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"coord answered without a recognisable scope ({scope!r}); "
                "the follow-up scope for this repo is unknown"
            ),
        )
    paths = body.get("code_paths")
    resolved = body.get("resolved_scope")
    mode = body.get("mode")
    return PostMergeFollowupScopeView(
        # Echo the repo we ASKED about (coord trims; so did we).
        repo=repo,
        scope=scope,
        code_paths=[p for p in paths if isinstance(p, str)]
        if isinstance(paths, list)
        else [],
        resolved_scope=resolved if resolved in ("repo", "default") else None,
        mode=mode if mode in ("shadow", "enforce", "off") else None,
        can_edit=can_edit,
    )


class PostMergeFollowupScopePut(BaseModel):
    """Closed body for the scope write — the shape coord's
    ``PutPostMergeFollowupScopeRequest`` accepts, and nothing else.

    ``code_paths`` semantics are coord's and are kept exactly:

    * omitted (``None``) on an ``all`` / ``none`` write KEEPS the stored globs;
    * ``[]`` clears them;
    * ``code_only`` must carry at least one non-blank glob — checked here so
      the common mistake is a local 422; coord still re-validates and is the
      authority on whether each glob compiles (its 400 passes through).
    """

    model_config = ConfigDict(extra="forbid")

    repo: str = Field(..., min_length=3, max_length=256)
    scope: FollowupScope
    code_paths: list[str] | None = None

    @field_validator("repo")
    @classmethod
    def _repo_full_name(cls, v: str) -> str:
        return _check_repo(v)

    @field_validator("code_paths")
    @classmethod
    def _no_blank_globs(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        cleaned = [p.strip() for p in v]
        for i, p in enumerate(cleaned):
            if not p:
                raise ValueError(f"code_paths[{i}] is blank")
        return cleaned

    @model_validator(mode="after")
    def _code_only_needs_paths(self) -> PostMergeFollowupScopePut:
        if self.scope == "code_only" and not self.code_paths:
            raise ValueError(
                "scope code_only requires a non-empty code_paths (globs naming "
                'the paths that carry a build/test oracle, e.g. ["scripts/**"])'
            )
        return self


class PostMergeFollowupScopeWriteResult(BaseModel):
    """What the write did, and — separately — what coord now resolves.

    ``effective`` is a SECOND, fresh GET. When it fails, ``effective`` is
    ``None`` and ``readback_error`` says why: that is UNKNOWN, never "the
    written scope applies".
    """

    ok: bool
    repo: str
    written_scope: FollowupScope
    #: Coord's echo of the globs STORED after the write (an omitted
    #: ``code_paths`` keeps the previous ones, so this can differ from what
    #: was sent). ``None`` when coord's echo carried none.
    stored_code_paths: list[str] | None = None
    updated_by: str | None = None
    effective: PostMergeFollowupScopeView | None = None
    readback_error: str | None = None


@router.get("/post-merge-followup-scope", response_model=PostMergeFollowupScopeView)
async def get_post_merge_followup_scope(
    request: Request,
    repo: str = Query(..., min_length=3, description="GitHub full name, owner/name"),
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> PostMergeFollowupScopeView:
    """Read one repo's post-merge follow-up scope for the effective tenant.

    A coord 503 (``preference_unreadable`` / ``column_not_present``) passes
    through as a 503 — it is never answered with the ``all`` default.
    """
    try:
        key = _check_repo(repo)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload = await _proxy_coord_get(
        POST_MERGE_SCOPE_COORD_PATH, params={"repo": key}, tenant_id=tenant_id
    )
    can_edit = await _can_edit(request, current_user)
    return _scope_view(payload, repo=key, can_edit=can_edit)


@router.put(
    "/post-merge-followup-scope", response_model=PostMergeFollowupScopeWriteResult
)
async def put_post_merge_followup_scope(
    body: PostMergeFollowupScopePut,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> PostMergeFollowupScopeWriteResult:
    """Write one repo's scope, then READ BACK what coord resolves.

    Tenant-admin gated web-side; coord re-checks with ``rbac::is_tenant_admin``
    and its ``403 admin_required`` passes through verbatim.
    """
    # ``exclude_none``: an omitted ``code_paths`` must stay omitted on the
    # wire — that is coord's "keep the stored globs" signal.
    written = await _proxy_coord_put(
        POST_MERGE_SCOPE_COORD_PATH,
        body.model_dump(exclude_none=True),
        tenant_id=tenant_id,
    )
    echo = written if isinstance(written, dict) else {}

    effective: PostMergeFollowupScopeView | None = None
    readback_error: str | None = None
    try:
        payload = await _proxy_coord_get(
            POST_MERGE_SCOPE_COORD_PATH,
            params={"repo": body.repo},
            tenant_id=tenant_id,
        )
        # The caller passed `require_coord_tenant_admin`.
        effective = _scope_view(payload, repo=body.repo, can_edit=True)
    except HTTPException as exc:
        readback_error = f"read-back failed: coord returned {exc.status_code}"
    except Exception as exc:  # noqa: BLE001 — the WRITE succeeded; don't lose it
        readback_error = f"read-back failed: {exc}"
    if readback_error is not None:
        logger.warning(
            "post_merge_followup_scope.readback_failed",
            repo=body.repo,
            detail=readback_error,
        )

    stored = echo.get("code_paths")
    updated_by = echo.get("updated_by")
    return PostMergeFollowupScopeWriteResult(
        ok=bool(echo.get("ok", True)),
        repo=body.repo,
        written_scope=body.scope,
        stored_code_paths=[p for p in stored if isinstance(p, str)]
        if isinstance(stored, list)
        else None,
        updated_by=updated_by if isinstance(updated_by, str) else None,
        effective=effective,
        readback_error=readback_error,
    )


# ---------------------------------------------------------------------------
# Continuation-delivery mode
# ---------------------------------------------------------------------------


class ContinuationDeliveryModeView(BaseModel):
    """What coord's resolver returns for one repo's continuation delivery."""

    repo: str
    mode: DeliveryMode
    #: Always ``False`` today. Coord's read is fail-open — a missing row, a
    #: missing column and a failed read ALL resolve to the default
    #: ``in_session_with_spawn_fallback`` — and its ``resolved_scope`` is the
    #: constant ``"repo"``. So "set for this repo" and "default because the
    #: read failed" are indistinguishable from this answer, and the UI must
    #: not present ``mode`` as a confirmed stored setting.
    provenance_known: bool = False
    can_edit: bool


def _delivery_view(
    payload: Any, *, repo: str, can_edit: bool
) -> ContinuationDeliveryModeView:
    body = payload if isinstance(payload, dict) else {}
    level = body.get("effective_level")
    if level not in DELIVERY_MODES:
        logger.warning(
            "continuation_delivery_mode.unrecognised_mode", repo=repo, mode=level
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"coord answered without a recognisable delivery mode ({level!r}); "
                "the continuation-delivery mode for this repo is unknown"
            ),
        )
    return ContinuationDeliveryModeView(repo=repo, mode=level, can_edit=can_edit)


class ContinuationDeliveryModePut(BaseModel):
    """Closed body for coord's ``PutContinuationDeliveryRequest``."""

    model_config = ConfigDict(extra="forbid")

    repo: str = Field(..., min_length=3, max_length=256)
    mode: DeliveryMode

    @field_validator("repo")
    @classmethod
    def _repo_full_name(cls, v: str) -> str:
        return _check_repo(v)


class ContinuationDeliveryModeWriteResult(BaseModel):
    """The write, and a separate fresh read of what coord resolves."""

    ok: bool
    repo: str
    written_mode: DeliveryMode
    effective: ContinuationDeliveryModeView | None = None
    readback_error: str | None = None


@router.get("/continuation-delivery-mode", response_model=ContinuationDeliveryModeView)
async def get_continuation_delivery_mode(
    request: Request,
    repo: str = Query(..., min_length=3, description="GitHub full name, owner/name"),
    tenant_id: UUID = Depends(get_tenant_id),
    current_user: UserModel = Depends(get_current_active_user_async),
) -> ContinuationDeliveryModeView:
    """Read what coord resolves for one repo's continuation-delivery mode.

    See :class:`ContinuationDeliveryModeView` ``provenance_known`` for why
    this is a resolver answer and not a stored value.
    """
    try:
        key = _check_repo(repo)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload = await _proxy_coord_get(
        CONTINUATION_DELIVERY_COORD_PATH, params={"repo": key}, tenant_id=tenant_id
    )
    can_edit = await _can_edit(request, current_user)
    return _delivery_view(payload, repo=key, can_edit=can_edit)


@router.put(
    "/continuation-delivery-mode", response_model=ContinuationDeliveryModeWriteResult
)
async def put_continuation_delivery_mode(
    body: ContinuationDeliveryModePut,
    tenant_id: UUID = Depends(require_coord_tenant_admin),
) -> ContinuationDeliveryModeWriteResult:
    """Write one repo's continuation-delivery mode, then read it back."""
    written = await _proxy_coord_put(
        CONTINUATION_DELIVERY_COORD_PATH, body.model_dump(), tenant_id=tenant_id
    )
    echo = written if isinstance(written, dict) else {}

    effective: ContinuationDeliveryModeView | None = None
    readback_error: str | None = None
    try:
        payload = await _proxy_coord_get(
            CONTINUATION_DELIVERY_COORD_PATH,
            params={"repo": body.repo},
            tenant_id=tenant_id,
        )
        effective = _delivery_view(payload, repo=body.repo, can_edit=True)
    except HTTPException as exc:
        readback_error = f"read-back failed: coord returned {exc.status_code}"
    except Exception as exc:  # noqa: BLE001 — the WRITE succeeded; don't lose it
        readback_error = f"read-back failed: {exc}"
    if readback_error is not None:
        logger.warning(
            "continuation_delivery_mode.readback_failed",
            repo=body.repo,
            detail=readback_error,
        )
    return ContinuationDeliveryModeWriteResult(
        ok=bool(echo.get("ok", True)),
        repo=body.repo,
        written_mode=body.mode,
        effective=effective,
        readback_error=readback_error,
    )
