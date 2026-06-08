"""GitHub-identity lookup + PR responsible-user resolution (I1 + I3-web).

Two layers:

I1 — lookup helpers (the canonical join keyed on the stable numeric id):

* :func:`user_for_github_user_id` — ``github_user_id -> User | None`` (the
  canonical resolution; GitHub's numeric id is invariant across logins).
* :func:`user_for_github_login` — ``github_login -> User | None`` (a
  convenience alias; login is mutable, so this is best-effort only).

I3-web — the responsible-user resolver (the contract entrypoint, per the
plan's RESOLVED Q4 — the resolver lives web-side because the primary
consumers are web-side and web owns the ``github_user_id -> user`` half):

* :func:`resolve_responsible_users` — ``(repo, pr_number)`` -> a non-empty,
  source-tagged, tenant-scoped list of responsible users. It calls coord's
  ``GET /coord/pr/{repo}/{pr}/responsible-context`` over the proven
  web->coord seam (forwarded Cognito bearer + ``x-qontinui-user-id``),
  then composes:

    1. ``github_author_id`` -> :func:`user_for_github_user_id` -> source
       ``"github-author"`` (the PR's human author, if linked).
    2. ``device_owner_user_id`` -> User -> source ``"device-owner"`` (the
       owner of the device the resolving agent runs on; I2-derived in coord
       via ``agent_worktrees.device_id -> devices.user_id``).
    3. tenant fallback -> source ``"tenant-fallback"`` (the tenant's
       admins / members) when arms 1+2 yield nobody.

  The result is **never empty** (the fallback guarantees >=1) and each
  entry carries its ``source`` so consumers (T3 notifications, per-user
  dashboards) can be honest about confidence. Every hop is tenant-scoped;
  cross-tenant identity is never resolved or leaked.

Resolution sources, in priority order.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User

logger = structlog.get_logger(__name__)

# Same 5s coord-read budget as operations.py / coord_device.py / coord_identity.
_COORD_TIMEOUT = httpx.Timeout(5.0)

# Coord's per-user ownership-scoping header (mirrors coord's USER_ID_HEADER /
# coord_device.py::_USER_ID_HEADER).
_USER_ID_HEADER = "x-qontinui-user-id"

# Resolution source tags (the contract's ``source`` enum).
SOURCE_GITHUB_AUTHOR = "github-author"
SOURCE_DEVICE_OWNER = "device-owner"
SOURCE_TENANT_FALLBACK = "tenant-fallback"


# ---------------------------------------------------------------------------
# I1 — lookup helpers
# ---------------------------------------------------------------------------


async def user_for_github_user_id(db: AsyncSession, github_user_id: str) -> User | None:
    """Return the user linked to ``github_user_id`` (the canonical key).

    The GitHub numeric id is stable across login renames, so this is the
    durable join used by the resolver. Returns ``None`` when no user has
    linked that GitHub identity.
    """
    if not github_user_id:
        return None
    result = await db.execute(
        select(User).where(User.github_user_id == github_user_id)  # type: ignore[arg-type]
    )
    return result.scalars().first()


async def user_for_github_login(db: AsyncSession, login: str) -> User | None:
    """Return the user whose ``github_login`` alias matches ``login``.

    Convenience only — ``github_login`` is a mutable display alias, so a
    miss here does NOT mean "no such user" (the login may simply not be
    stamped or may have been renamed). Resolve by id where correctness
    matters. Returns ``None`` on no match.
    """
    if not login:
        return None
    result = await db.execute(
        select(User).where(User.github_login == login)  # type: ignore[arg-type]
    )
    return result.scalars().first()


# ---------------------------------------------------------------------------
# I3-web — the responsible-user resolver
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ResponsibleUser:
    """One responsible user + the source that resolved them."""

    user_id: UUID
    source: str


@dataclass(frozen=True)
class _CoordContext:
    """Parsed coord ``responsible-context`` payload."""

    tenant_id: UUID | None
    github_author_id: str | None
    agent_id: str | None
    device_owner_user_id: UUID | None
    # Tenant fallback candidates (coord owns tenant membership). Coord
    # surfaces the tenant's admins/members here so the web resolver never
    # needs a separate coord->web membership hop. Ordering is coord's
    # (admins first). Tolerated-absent for forward-compat.
    tenant_fallback_user_ids: tuple[UUID, ...]


def _as_uuid(value: Any) -> UUID | None:
    if value is None:
        return None
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


def _coord_headers(bearer: str | None, acting_user_id: str) -> dict[str, str]:
    headers: dict[str, str] = {_USER_ID_HEADER: acting_user_id}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return headers


async def _fetch_responsible_context(
    repo: str,
    pr_number: int,
    *,
    bearer: str | None,
    acting_user_id: str,
) -> _CoordContext:
    """GET coord ``/coord/pr/{repo}/{pr}/responsible-context``.

    Forwards the caller's Cognito bearer + ``x-qontinui-user-id`` so coord
    authenticates the operator and tenant-scopes the read — the same
    direction-of-call already proven by ``coord_device.py`` /
    ``operations.py::_proxy_coord_get``. Transport failures map to 502/504;
    coord's own >= 400 statuses surface verbatim.

    Coord returns ``{tenant_id, github_author_id, agent_id,
    device_owner_user_id, tenant_fallback_user_ids?}`` (the contract; the
    coord endpoint merges separately).
    """
    url = f"{settings.COORD_URL}/coord/pr/{repo}/{pr_number}/responsible-context"
    async with httpx.AsyncClient(timeout=_COORD_TIMEOUT) as client:
        try:
            resp = await client.get(url, headers=_coord_headers(bearer, acting_user_id))
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=502, detail="coord is not reachable"
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=504, detail="timeout waiting for coord"
            ) from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    try:
        payload = resp.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="coord responsible-context returned non-JSON",
        ) from exc
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=502,
            detail="coord responsible-context returned a non-object payload",
        )

    raw_fallback = payload.get("tenant_fallback_user_ids") or []
    fallback: list[UUID] = []
    if isinstance(raw_fallback, list):
        for entry in raw_fallback:
            uid = _as_uuid(entry)
            if uid is not None:
                fallback.append(uid)

    return _CoordContext(
        tenant_id=_as_uuid(payload.get("tenant_id")),
        github_author_id=(
            str(payload["github_author_id"])
            if payload.get("github_author_id") is not None
            else None
        ),
        agent_id=(
            str(payload["agent_id"]) if payload.get("agent_id") is not None else None
        ),
        device_owner_user_id=_as_uuid(payload.get("device_owner_user_id")),
        tenant_fallback_user_ids=tuple(fallback),
    )


def coord_context_from_responsible_context(
    *,
    tenant_id: Any = None,
    github_author_id: Any = None,
    device_owner_user_id: Any = None,
    tenant_fallback_user_ids: list[Any] | None = None,
    agent_id: Any = None,
) -> _CoordContext:
    """Build a :class:`_CoordContext` from a coord ``responsible_context``.

    Used by the T3 webhook path, where coord *embeds* the responsible
    context in the request body instead of the web backend fetching it.
    Applies the *identical* normalisation as
    :func:`_fetch_responsible_context` so the embedded-context path is
    indistinguishable from the fetched-context path: ``github_author_id``
    is coerced int|str -> ``str`` (the github-user-id join key), all UUID
    fields tolerate str/None, and bad fallback entries are dropped.
    """
    raw_fallback = tenant_fallback_user_ids or []
    fallback: list[UUID] = []
    if isinstance(raw_fallback, list):
        for entry in raw_fallback:
            uid = _as_uuid(entry)
            if uid is not None:
                fallback.append(uid)

    return _CoordContext(
        tenant_id=_as_uuid(tenant_id),
        github_author_id=(
            str(github_author_id) if github_author_id is not None else None
        ),
        agent_id=(str(agent_id) if agent_id is not None else None),
        device_owner_user_id=_as_uuid(device_owner_user_id),
        tenant_fallback_user_ids=tuple(fallback),
    )


async def resolve_responsible_users_from_context(
    db: AsyncSession,
    ctx: _CoordContext,
) -> list[ResponsibleUser]:
    """Compose responsible users from an already-fetched coord context.

    This is the pure composition half of the resolver — given a parsed
    :class:`_CoordContext` (however it was obtained), it resolves the
    responsible qontinui user(s), deduped by ``user_id`` with source
    priority preserved (github-author > device-owner > tenant-fallback),
    and never returns empty (raises 404 on a total miss, the honesty
    contract).

    Two callers share this composition:

    * :func:`resolve_responsible_users` — the authed entrypoint, which
      first fetches the context from coord (forwarding the caller's
      bearer) and then composes here.
    * the T3 ``coord-notifications`` webhook — coord *embeds* the context
      in the webhook body (no user bearer, no coord round-trip), builds a
      :class:`_CoordContext` from it, and composes here directly.

    Keeping the composition in one place guarantees both paths apply the
    identical source-priority / dedupe / never-empty semantics.
    """
    ordered: list[ResponsibleUser] = []
    seen: set[UUID] = set()

    def _add(user_id: UUID | None, source: str) -> None:
        if user_id is None or user_id in seen:
            return
        seen.add(user_id)
        ordered.append(ResponsibleUser(user_id=user_id, source=source))

    # (a) PR GitHub author id -> linked user.
    if ctx.github_author_id:
        author = await user_for_github_user_id(db, ctx.github_author_id)
        if author is not None:
            _add(author.id, SOURCE_GITHUB_AUTHOR)

    # (b) Agent's device owner user.
    if ctx.device_owner_user_id is not None:
        owner = await db.get(User, ctx.device_owner_user_id)
        if owner is not None:
            _add(owner.id, SOURCE_DEVICE_OWNER)

    # (c) Tenant fallback — never resolve to nobody. Only consulted when
    # arms (a)+(b) produced no user.
    if not ordered:
        for uid in ctx.tenant_fallback_user_ids:
            member = await db.get(User, uid)
            if member is not None:
                _add(member.id, SOURCE_TENANT_FALLBACK)

    if not ordered:
        # Honesty contract: the resolver must always return >=1 user. If we
        # reach here, coord supplied no author, no device owner, and no
        # tenant fallback candidates (or none resolved to a known web user)
        # — that is an upstream data gap, surfaced explicitly rather than as
        # a silent empty set.
        logger.warning(
            "responsible_users_empty",
            tenant_id=str(ctx.tenant_id) if ctx.tenant_id else None,
        )
        raise HTTPException(
            status_code=404,
            detail="No responsible user could be resolved for this PR.",
        )

    return ordered


async def resolve_responsible_users(
    db: AsyncSession,
    repo: str,
    pr_number: int,
    *,
    bearer: str | None,
    acting_user_id: str,
) -> list[ResponsibleUser]:
    """Resolve the responsible qontinui user(s) for ``(repo, pr_number)``.

    Returns a **non-empty** list of :class:`ResponsibleUser`, deduped by
    ``user_id`` with source-priority order preserved
    (github-author > device-owner > tenant-fallback). Every hop is
    tenant-scoped via the forwarded bearer + ``x-qontinui-user-id``; no
    cross-tenant user is ever resolved.

    The reusable service entrypoint — future consumers (per-user
    dashboards) call this directly; the thin authed endpoint is a
    presentation wrapper. Fetches the coord ``responsible-context`` then
    delegates composition to
    :func:`resolve_responsible_users_from_context`.
    """
    ctx = await _fetch_responsible_context(
        repo, pr_number, bearer=bearer, acting_user_id=acting_user_id
    )
    return await resolve_responsible_users_from_context(db, ctx)
