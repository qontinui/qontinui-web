"""The presentation scope's rules: normalisation, defaults and the fold.

Plan ``2026-10-23-console-presentation-spaces`` Phase 1 (D3.3). Presentation
mode renders an item's free text only when every repository it belongs to has
a FIRST-PARTY owner and the text holds none of the CONFIDENTIAL terms
(``frontend/src/components/presentation/redaction.ts`` applies the rule).
This module decides what the two lists ARE for one read:

* **first-party owners** — the tenant's configured list when it has one;
  otherwise the owners of the repositories the tenant OWNS among its
  registered ones (coord's ``role`` = ``owner``; an ``observer`` row is another
  tenant's repository this one only audits), read from coord. When that read
  fails the answer is UNKNOWN (``None`` plus a typed reason), never ``[]``: an
  empty list would be a decision the tenant did not make, and an UNKNOWN makes
  the lens withhold everything anyway. Every UNKNOWN is logged with its reason,
  so the operator can read afterwards why a presentation withheld its titles.
* **confidential terms** — the tenant's configured terms PLUS the viewer's
  other projects' names, always. A union, never "the defaults until someone
  saves": a saved list must not stop withholding the names a later viewer
  brings with them, and the viewer's names are never written into the tenant's
  row, which every member of the tenant can read.

Nothing here touches the database. The one network read is
:func:`read_registered_repo_owners`, through the shared coord proxy.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import httpx
import structlog
from fastapi import HTTPException

from app.api.coord_proxy import _proxy_coord_get
from app.api.v1.endpoints.operations import CoordTransportUnavailable
from app.services.coord_identity import CoordIdentity

logger = structlog.get_logger(__name__)

#: Why the registered-repository owners are UNKNOWN on a read:
#:
#: * ``tenant_scope_mismatch`` — coord resolved a different project for this
#:   request than the one this backend resolved, so its repository list would
#:   be another project's owners;
#: * ``coord_unreachable`` — coord could not be reached, or did not answer in
#:   time;
#: * ``coord_refused`` — coord answered with an error status;
#: * ``coord_unreadable`` — coord answered 2xx with a body that is not the
#:   repository list.
UnknownReason = Literal[
    "tenant_scope_mismatch",
    "coord_unreachable",
    "coord_refused",
    "coord_unreadable",
]

#: Where the effective first-party owners came from.
OwnersSource = Literal["configured", "registered_repos"]

#: coord's tenant-scoped repository list (``coord.tenant_repos``): ``{"repos":
#: [{"repo": "owner/name", "role": "owner" | "observer", ...}], "total": n}``
#: (qontinui-coord ``pr_merge/settings_wire.rs`` ``TenantRepoRow``). Deliberately
#: NOT ``/coord/canonical-repos``, which is a fleet-wide view whose rows mostly
#: carry no tenant at all.
REGISTERED_REPOS_PATH = "/pr-merge/repos"

#: The ``coord.tenant_repos.role`` of a repository the tenant itself owns. The
#: column's CHECK allows ``owner`` and ``observer``; ``observer`` is reserved
#: for one tenant auditing ANOTHER's repository read-only, so only ``owner``
#: makes a repository's GitHub owner first-party.
OWNER_ROLE = "owner"

#: How much of coord's error detail a log line keeps.
_LOGGED_DETAIL_CHARS = 200

#: A GitHub owner (user or organisation) login, lower-cased: 1-39 characters,
#: letters, digits and single hyphens, neither leading nor trailing.
_GITHUB_OWNER = re.compile(r"^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$")

_GITHUB_PREFIXES = (
    re.compile(r"^https?://(?:www\.)?github\.com/", re.IGNORECASE),
    re.compile(r"^git@github\.com:", re.IGNORECASE),
)

_WHITESPACE = re.compile(r"\s+")


def normalize_owner(raw: object) -> str | None:
    """A GitHub owner in its compared form (trimmed, ``@`` dropped,
    lower-cased), or ``None`` when ``raw`` is not one."""
    if not isinstance(raw, str):
        return None
    owner = raw.strip().removeprefix("@").lower()
    return owner if _GITHUB_OWNER.match(owner) else None


def owner_of_repo(repo: object) -> str | None:
    """The owner of ``owner/name`` (a ``https://github.com/…`` or
    ``git@github.com:…`` spelling parses too), or ``None`` when there is none.
    The same reading as the frontend's ``repoOwnerOf``."""
    if not isinstance(repo, str):
        return None
    spelled = repo.strip()
    for prefix in _GITHUB_PREFIXES:
        spelled = prefix.sub("", spelled)
    owner, slash, name = spelled.partition("/")
    if not slash or not name.strip():
        return None
    return normalize_owner(owner)


def match_key(term: str) -> str:
    """``term`` folded the way the frontend matches it (``normalizeForMatch``):
    compatibility-decomposed, accents dropped, lower-cased, everything but
    letters and digits removed. Two terms with one key match the same text."""
    decomposed = unicodedata.normalize("NFKD", term)
    unmarked = "".join(
        c for c in decomposed if not unicodedata.category(c).startswith("M")
    )
    return "".join(
        c for c in unmarked.lower() if unicodedata.category(c)[0] in ("L", "N")
    )


def clean_term(raw: str) -> str:
    """A term as stored: trimmed, with internal whitespace collapsed."""
    return _WHITESPACE.sub(" ", raw).strip()


def dedupe_terms(terms: Iterable[str]) -> list[str]:
    """``terms`` cleaned, keeping the FIRST spelling of each match key and
    dropping any term that names nothing (no letter or digit)."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in terms:
        term = clean_term(raw)
        key = match_key(term)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(term)
    return out


def registered_repo_owners(payload: Any) -> list[str]:
    """The distinct GitHub owners of the repositories the tenant OWNS, sorted.

    Raises :class:`ValueError` when ``payload`` is not coord's list shape — a
    shape this build cannot read is UNKNOWN, not "no repositories". A row is
    counted only when its ``role`` is exactly :data:`OWNER_ROLE`: an
    ``observer`` row is another tenant's repository, and a missing or unknown
    role cannot prove the repository is this tenant's, so either fails closed
    (its owner is not made first-party). A row whose ``repo`` names no
    parseable owner is skipped the same way; the rest of the list is still a
    real answer.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("repos"), list):
        raise ValueError("not a repository list")
    owners: set[str] = set()
    for row in payload["repos"]:
        if not isinstance(row, dict):
            raise ValueError("a repository row is not an object")
        if row.get("role") != OWNER_ROLE:
            continue
        owner = owner_of_repo(row.get("repo"))
        if owner is not None:
            owners.add(owner)
    return sorted(owners)


def viewer_other_tenant_names(identity: CoordIdentity, tenant_id: UUID) -> list[str]:
    """The viewer's OTHER projects' names — the confidential-term default.

    Each other membership contributes its display name and its slug. A name
    that folds to one of the ACTIVE project's own names is dropped: a name the
    project shares cannot tell the other party apart from this one, and
    withholding it would withhold this project's own titles. Sorted, and
    deduplicated by match key.
    """
    own = {
        match_key(name)
        for membership in identity.tenants
        if membership.tenant_id == tenant_id
        for name in (membership.display_name, membership.slug)
        if name
    }
    names = [
        name
        for membership in identity.tenants
        if membership.tenant_id != tenant_id
        for name in (membership.display_name, membership.slug)
        if name and match_key(name) not in own
    ]
    return sorted(dedupe_terms(names), key=lambda term: (match_key(term), term))


@dataclass(frozen=True)
class OwnersRead:
    """The registered-repository owners, or why they are unknown."""

    owners: tuple[str, ...] | None
    unknown_reason: UnknownReason | None


async def read_registered_repo_owners(
    identity: CoordIdentity, tenant_id: UUID
) -> OwnersRead:
    """Read the owners of ``tenant_id``'s registered repositories from coord.

    Coord scopes ``GET /pr-merge/repos`` to the project IT resolves from the
    forwarded bearer and ``X-Qontinui-Active-Tenant`` — reported back as
    ``identity.home_tenant_id`` (post-override). This backend resolved
    ``tenant_id`` itself; when the two differ, coord's list is some other
    project's and is not used.
    """
    if identity.home_tenant_id != tenant_id:
        return _unknown(
            "tenant_scope_mismatch",
            tenant_id,
            coord_tenant_id=(
                None
                if identity.home_tenant_id is None
                else str(identity.home_tenant_id)
            ),
        )
    try:
        payload = await _proxy_coord_get(REGISTERED_REPOS_PATH, tenant_id=tenant_id)
    except CoordTransportUnavailable as exc:
        # Checked before ``HTTPException``, which it subclasses: its status is
        # this backend's own 502/504, never coord's answer.
        return _unknown("coord_unreachable", tenant_id, status_code=exc.status_code)
    except HTTPException as exc:
        return _unknown(
            "coord_refused",
            tenant_id,
            status_code=exc.status_code,
            detail=str(exc.detail)[:_LOGGED_DETAIL_CHARS],
        )
    except httpx.HTTPError as exc:
        # A transport error the proxy does not classify escapes it raw.
        return _unknown("coord_unreachable", tenant_id, error=type(exc).__name__)
    except ValueError as exc:
        # A 2xx whose body is not JSON (``json.JSONDecodeError``).
        return _unknown("coord_unreadable", tenant_id, error=type(exc).__name__)
    try:
        owners = registered_repo_owners(payload)
    except ValueError as exc:
        return _unknown("coord_unreadable", tenant_id, error=str(exc))
    return OwnersRead(owners=tuple(owners), unknown_reason=None)


def _unknown(reason: UnknownReason, tenant_id: UUID, **context: object) -> OwnersRead:
    """An UNKNOWN read, logged: with nothing configured, it withholds every
    title in front of an audience, and the log line is what tells the operator
    why afterwards."""
    logger.warning(
        "presentation_scope.registered_repo_owners_unknown",
        reason=reason,
        tenant_id=str(tenant_id),
        **context,
    )
    return OwnersRead(owners=None, unknown_reason=reason)


@dataclass(frozen=True)
class EffectiveScope:
    """The two lists a presentation-mode render applies, for one read."""

    first_party_owners: tuple[str, ...] | None
    first_party_owners_source: OwnersSource
    first_party_owners_unknown_reason: UnknownReason | None
    confidential_terms: tuple[str, ...]


def effective_scope(
    *,
    configured_owners: Iterable[str] | None,
    configured_terms: Iterable[str],
    registered: OwnersRead,
    viewer_names: Iterable[str],
) -> EffectiveScope:
    """Fold the stored row, coord's repositories and the viewer's names.

    Configured owners win outright — an explicit ``[]`` included, which
    withholds every title. With none configured, the registered-repository
    owners apply, UNKNOWN when they could not be read. The terms are always the
    union of the configured terms and the viewer's names.
    """
    if configured_owners is not None:
        owners: tuple[str, ...] | None = tuple(configured_owners)
        source: OwnersSource = "configured"
        reason: UnknownReason | None = None
    else:
        owners = registered.owners
        source = "registered_repos"
        reason = registered.unknown_reason
    terms = dedupe_terms([*configured_terms, *viewer_names])
    return EffectiveScope(
        first_party_owners=owners,
        first_party_owners_source=source,
        first_party_owners_unknown_reason=reason,
        confidential_terms=tuple(terms),
    )
