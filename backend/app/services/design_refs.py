"""Domain logic of the design reference library (``design_refs`` schema).

Plan ``2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query``,
Phase 1. The routes live in ``app/api/v1/endpoints/design_refs.py``; this
module holds what they share and what tests drive directly:

* **Blob keys** — tier-prefixed, content-addressed
  (``design-refs/<tier>/<tenant>/sha256/<h[:2]>/<h><ext>``), through
  :func:`app.services.storage.content_addressed_key`.
* **The holdout split** — :func:`intake_split`: the domain hash alone,
  assigned when the site is created.
* **Read filters** — :func:`public_tier_select` (the public-tier filter: zero
  private rows), :func:`agent_visible` / :func:`is_agent_reference` (confirmed
  reference sites only), :func:`is_hidden_holdout` (confirmed holdouts, hidden
  from CRUD) and :func:`facts_visible` (reference sites, any confirmation).
* **Hybrid search** — :func:`search`.
* **Style distance** — :func:`token_distance`.
* **Correlations** — :func:`correlation_report` (Human judgement item 5).
* **Principle support** — :func:`reference_support`.
* **Takedown** — :func:`takedown` (rows, judgement rows and reference-counted
  blobs).

Known residual of the measured-facts reads (plan Phase 2): a device writes the
KEYS of ``tokens``, ``layout_bands`` and ``motion_summary`` and the viewport
words of a capture, and without a token vocabulary a grammar can bound their
shape but not their meaning. What reaches an agent is therefore
device-controlled snake_case identifiers: at most 32 characters each, at most
:data:`MEASURED_MAX_KEYS` keys per object, :data:`MEASURED_MAX_LIST_ITEMS` items
per list, :data:`MEASURED_NODE_BUDGET` nodes per field, 24-character viewport
tokens and :data:`MEASURED_MAX_VIEWPORTS` of them. Never a string value, a
blob key, a sentence-shaped key or a free-text URL part. Operator curation or
confirmation removes a site's measured facts from this arm (the page leaves
``similar-by-style`` and ``/examples``, or turns into the full confirmed
record). ``tests/test_design_refs_api.py`` asserts each cap.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
import statistics
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Final
from urllib.parse import urlsplit
from uuid import UUID

import structlog
from sqlalchemy import (
    Float,
    Select,
    Text,
    and_,
    bindparam,
    case,
    cast,
    delete,
    func,
    or_,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.design_refs import (
    MEASURED_FACETS,
    Blob,
    Capture,
    CaptureSource,
    Comparison,
    Component,
    Correction,
    Description,
    DesignPrinciple,
    DesignPrincipleEvidence,
    DoNotCapture,
    Flow,
    Page,
    PerceptionRating,
    ReplayBundle,
    Site,
    SitePersonality,
)
from app.schemas.design_refs import MeasuredCaptureOut
from app.services.storage import ObjectStorageService, content_addressed_key

logger = structlog.get_logger(__name__)

KEY_ROOT: Final = "design-refs"
#: ``design-refs/<tier>/<tenant>/sha256/<h[:2]>/<h><ext>``.
_KEY_RE: Final = re.compile(
    r"\Adesign-refs/(?P<tier>private|public)/(?P<tenant>[0-9a-f-]{36})/sha256/"
    r"(?P<fan>[0-9a-f]{2})/(?P<sha>[0-9a-f]{64})(?P<ext>\.[a-z0-9]{1,10})\Z"
)

#: The share of each style family's sites held out (Human judgement item 6).
HOLDOUT_BUCKETS: Final = 5  # 1 in 5 = 20%

#: Correlation flag thresholds (Human judgement item 5).
FLAG_MIN_N: Final = 20
FLAG_MIN_ABS_R: Final = 0.4

#: Candidates a search ranks at most (the corpus is curated, not web-scale).
SEARCH_CANDIDATE_CAP: Final = 2000

LEVEL_MODELS: Final[dict[str, Any]] = {
    "site": Site,
    "page": Page,
    "flow": Flow,
    "component": Component,
}


def _now() -> datetime:
    return datetime.now(UTC)


# ═════════════════════════════ blob keys ═════════════════════════════


def blob_prefix(tier: str) -> str:
    return f"{KEY_ROOT}/{tier}"


def blob_key(tier: str, tenant_id: UUID, sha256: str, ext: str) -> str:
    """The content-addressed key of one blob under its tier prefix."""
    return content_addressed_key(blob_prefix(tier), tenant_id, sha256, ext)


@dataclass(frozen=True)
class ParsedKey:
    tier: str
    tenant_id: UUID
    sha256: str
    ext: str


def parse_blob_key(key: str) -> ParsedKey | None:
    """The parts of a well-formed design-refs key, or None."""
    match = _KEY_RE.match(key)
    if match is None or match["fan"] != match["sha"][:2]:
        return None
    try:
        tenant = UUID(match["tenant"])
    except ValueError:
        return None
    return ParsedKey(
        tier=match["tier"], tenant_id=tenant, sha256=match["sha"], ext=match["ext"]
    )


def normalise_domain(value: str) -> str:
    """A bare lower-case host: scheme, path, port and a leading ``www.`` gone."""
    host = value.strip().lower()
    host = re.sub(r"\A[a-z][a-z0-9+.-]*://", "", host)
    host = host.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    host = host.rsplit("@", 1)[-1].split(":", 1)[0]
    return host.removeprefix("www.")


def url_domain_and_path(url: str) -> tuple[str, str]:
    rest = re.sub(r"\A[a-z][a-z0-9+.-]*://", "", url.strip(), flags=re.I)
    host, _, path = rest.partition("/")
    return normalise_domain(host), "/" + path.split("?", 1)[0].split("#", 1)[0]


async def blocked_by_do_not_capture(
    db: AsyncSession, tenant_id: UUID, url: str
) -> DoNotCapture | None:
    """The do-not-capture entry covering ``url``, if any."""
    domain, path = url_domain_and_path(url)
    rows = (
        await db.execute(
            select(DoNotCapture).where(
                DoNotCapture.tenant_id == tenant_id, DoNotCapture.domain == domain
            )
        )
    ).scalars()
    for row in rows:
        if path_covered(path, row.path_prefix):
            return row
    return None


def path_covered(path: str, prefix: str) -> bool:
    """``prefix`` covers ``path`` on a SEGMENT boundary: ``/blog`` covers
    ``/blog`` and ``/blog/post`` but not ``/blogger``; an empty prefix (or
    ``/``) covers the whole domain."""
    base = prefix.rstrip("/")
    if not base:
        return True
    return path == base or path.startswith(base + "/")


# ═════════════════════════════ the split ═════════════════════════════


def domain_bucket(domain: str) -> int:
    """``hash(domain)`` reduced to one of :data:`HOLDOUT_BUCKETS` buckets."""
    digest = hashlib.sha256(normalise_domain(domain).encode()).digest()
    return int.from_bytes(digest[:8], "big") % HOLDOUT_BUCKETS


async def intake_split(db: AsyncSession, tenant_id: UUID, domain: str) -> str:
    """The split a new site gets at intake (``POST /sites``).

    The domain hash alone: ``holdout`` when :func:`domain_bucket` is 0, else
    ``reference``. A domain already split in this tenant (its other-tier
    record, including a row assigned by the retired forced-balance rule) keeps
    that split, so one site is never a reference in one tier and a holdout in
    the other. The split is immutable once written (the DB trigger).
    """
    sibling = (
        await db.execute(
            select(Site.split).where(
                Site.tenant_id == tenant_id,
                Site.domain == normalise_domain(domain),
                Site.split.is_not(None),
            )
        )
    ).scalar()
    if sibling is not None:
        return str(sibling)
    return "holdout" if domain_bucket(domain) == 0 else "reference"


# ═════════════════════════════ read filters ═════════════════════════════


def public_tier_select(model: Any) -> Select[Any]:
    """THE public-tier read filter: rows of ``model`` a public route may
    serve — ``tier = 'public'`` and never ``rejected``. Every public route
    (Phase 6) builds on this; it returns zero private rows by construction."""
    stmt = select(model).where(model.tier == "public")
    if hasattr(model, "review_state"):
        stmt = stmt.where(model.review_state != "rejected")
    return stmt


def apply_public_tier(stmt: Select[Any], model: Any) -> Select[Any]:
    """The same filter applied to an existing statement over ``model``."""
    stmt = stmt.where(model.tier == "public")
    if hasattr(model, "review_state"):
        stmt = stmt.where(model.review_state != "rejected")
    return stmt


def agent_visible(stmt: Select[Any]) -> Select[Any]:
    """Exclude holdout sites and sites whose context is not yet confirmed (a
    statement joined to :class:`Site`): an agent-facing read serves a
    CONFIRMED REFERENCE site only."""
    return stmt.where(Site.split == "reference", Site.context_state == "confirmed")


def facts_visible(stmt: Select[Any]) -> Select[Any]:
    """Keep reference-split sites whatever their confirmation state (a
    statement joined to :class:`Site`). Used only by the measured-facts arms,
    which serve machine-measured numbers of an unconfirmed reference site."""
    return stmt.where(Site.split == "reference")


def is_agent_reference(site: Site) -> bool:
    """:func:`agent_visible`, per row: a confirmed reference site."""
    return is_agent_reference_state(site.split, site.context_state)


def is_agent_reference_state(split: str, context_state: str) -> bool:
    """:func:`is_agent_reference` over the ``(split, context_state)`` pair
    :func:`site_splits` returns."""
    return split == "reference" and context_state == "confirmed"


def is_hidden_holdout(site: Site) -> bool:
    """A confirmed holdout: hidden from every non-operator CRUD read. A
    holdout whose context is not yet confirmed stays visible to CRUD (the
    worker finds and uploads to it), and to no agent-facing read."""
    return site.split == "holdout" and site.context_state == "confirmed"


def site_labels(site: Site) -> list[str]:
    labels: list[str] = []
    if site.split == "holdout":
        labels.append("holdout")
    if site.context_state != "confirmed":
        labels.append("context_unconfirmed")
    return labels


# ═════════════════════════════ judgement targets ═════════════════════════════


async def target_sites(
    db: AsyncSession, tenant_id: UUID, kind: str, ids: Iterable[UUID]
) -> dict[UUID, UUID]:
    """``{target_id: site_id}`` for the tenant's site/page/component ids;
    an id the tenant does not hold is absent."""
    wanted = list(set(ids))
    if not wanted:
        return {}
    if kind == "site":
        stmt = select(Site.id, Site.id).where(
            Site.tenant_id == tenant_id, Site.id.in_(wanted)
        )
    elif kind == "page":
        stmt = select(Page.id, Page.site_id).where(
            Page.tenant_id == tenant_id, Page.id.in_(wanted)
        )
    elif kind == "component":
        stmt = (
            select(Component.id, Page.site_id)
            .join(Page, Page.id == Component.page_id)
            .where(Component.tenant_id == tenant_id, Component.id.in_(wanted))
        )
    else:
        raise ValueError(f"unknown judgement target kind {kind!r}")
    return {row[0]: row[1] for row in (await db.execute(stmt)).all()}


async def evidence_site_ids(
    db: AsyncSession, tenant_id: UUID, kind: str, evidence_id: UUID
) -> list[UUID] | None:
    """The sites a rating or comparison touches (both of a comparison's), or
    None when the tenant holds no such evidence row."""
    if kind == "perception_rating":
        rating = (
            await db.execute(
                select(PerceptionRating).where(
                    PerceptionRating.tenant_id == tenant_id,
                    PerceptionRating.id == evidence_id,
                )
            )
        ).scalar_one_or_none()
        if rating is None:
            return None
        sites = await target_sites(
            db, tenant_id, rating.target_kind, [rating.target_id]
        )
        return sorted(set(sites.values()), key=str)
    if kind == "comparison":
        comparison = (
            await db.execute(
                select(Comparison).where(
                    Comparison.tenant_id == tenant_id, Comparison.id == evidence_id
                )
            )
        ).scalar_one_or_none()
        if comparison is None:
            return None
        sites = await target_sites(
            db, tenant_id, comparison.target_kind, [comparison.a_id, comparison.b_id]
        )
        return sorted(set(sites.values()), key=str)
    raise ValueError(f"unknown evidence kind {kind!r}")


async def site_splits(
    db: AsyncSession, tenant_id: UUID, site_ids: Iterable[UUID]
) -> dict[UUID, tuple[str, str]]:
    """``{site_id: (split, context_state)}`` for the tenant's sites."""
    ids = list(set(site_ids))
    if not ids:
        return {}
    rows = await db.execute(
        select(Site.id, Site.split, Site.context_state).where(
            Site.tenant_id == tenant_id, Site.id.in_(ids)
        )
    )
    return {row[0]: (row[1], row[2]) for row in rows.all()}


async def reference_support(
    db: AsyncSession, tenant_id: UUID, principle_id: UUID
) -> set[UUID]:
    """The distinct REFERENCE sites a principle's supporting evidence spans."""
    rows = (
        await db.execute(
            select(DesignPrincipleEvidence.site_ids).where(
                DesignPrincipleEvidence.tenant_id == tenant_id,
                DesignPrincipleEvidence.principle_id == principle_id,
                DesignPrincipleEvidence.role == "supports",
            )
        )
    ).scalars()
    sites: set[UUID] = set()
    for ids in rows:
        sites.update(ids)
    splits = await site_splits(db, tenant_id, sites)
    return {
        sid
        for sid, (split, state) in splits.items()
        if is_agent_reference_state(split, state)
    }


# ═════════════════════════════ correlations ═════════════════════════════


@dataclass(frozen=True)
class Correlation:
    variable_kind: str  # "dimension" | "trait"
    key: str
    facet: str
    n: int
    r: float | None
    flagged: bool


def pearson(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    """Pearson's r, or None when either series has no variance."""
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True))
    return sxy / math.sqrt(sxx * syy)


async def correlation_report(db: AsyncSession, tenant_id: UUID) -> list[Correlation]:
    """Correlations between judgements and measured capture facets, over
    REFERENCE sites only (Human judgement item 5).

    Per target, the median of each rater's latest score on a dimension; per
    site, the median over its targets. Per site and trait, the latest
    confirmed value. Per site and facet, the median over the site's captures.
    A correlation with ``n >= 20`` and ``|r| >= 0.4`` is FLAGGED: at risk of
    being learned, so a principle scoped to that dimension or trait needs a
    counterexample before it can be approved.
    """
    reference = {
        row[0]
        for row in (
            await db.execute(
                select(Site.id).where(
                    Site.tenant_id == tenant_id,
                    Site.split == "reference",
                    Site.context_state == "confirmed",
                )
            )
        ).all()
    }
    if not reference:
        return []

    # Facets per site: median over the site's captures.
    facet_values: dict[str, dict[UUID, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    capture_rows = await db.execute(
        select(Page.site_id, Capture.facets)
        .join(Page, Page.id == Capture.page_id)
        .where(Capture.tenant_id == tenant_id, Page.site_id.in_(reference))
    )
    for site_id, facets in capture_rows.all():
        for facet in MEASURED_FACETS:
            value = (facets or {}).get(facet)
            if isinstance(value, int | float) and not isinstance(value, bool):
                facet_values[facet][site_id].append(float(value))
    site_facet: dict[str, dict[UUID, float]] = {
        facet: {sid: statistics.median(vals) for sid, vals in per_site.items()}
        for facet, per_site in facet_values.items()
    }

    # Ratings: each rater's latest per (target, dimension).
    latest: dict[tuple[str, UUID, str, str, str], tuple[datetime, int]] = {}
    for row in (
        await db.execute(
            select(PerceptionRating).where(PerceptionRating.tenant_id == tenant_id)
        )
    ).scalars():
        latest_key = (
            row.target_kind,
            row.target_id,
            row.dimension_key,
            row.rater_kind,
            row.rater_id,
        )
        if latest_key not in latest or row.created_at > latest[latest_key][0]:
            latest[latest_key] = (row.created_at, row.score)
    by_target: dict[tuple[str, UUID, str], list[int]] = defaultdict(list)
    for (kind, tid, dim, _rk, _rid), (_at, score) in latest.items():
        by_target[(kind, tid, dim)].append(score)
    target_ids_by_kind: dict[str, set[UUID]] = defaultdict(set)
    for kind, tid, _dim in by_target:
        target_ids_by_kind[kind].add(tid)
    site_of: dict[tuple[str, UUID], UUID] = {}
    for kind, ids in target_ids_by_kind.items():
        for tid, sid in (await target_sites(db, tenant_id, kind, ids)).items():
            site_of[(kind, tid)] = sid
    per_site_dim: dict[str, dict[UUID, list[float]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for (kind, tid, dim), scores in by_target.items():
        target_site = site_of.get((kind, tid))
        if target_site is None or target_site not in reference:
            continue
        per_site_dim[dim][target_site].append(float(statistics.median(scores)))
    variables: list[tuple[str, str, dict[UUID, float]]] = [
        ("dimension", dim, {sid: statistics.median(v) for sid, v in per_site.items()})
        for dim, per_site in per_site_dim.items()
    ]

    # Traits: latest confirmed value per (site, trait).
    trait_latest: dict[tuple[UUID, str], tuple[datetime, int]] = {}
    for row in (
        await db.execute(
            select(SitePersonality).where(
                SitePersonality.tenant_id == tenant_id,
                SitePersonality.state == "confirmed",
                SitePersonality.site_id.in_(reference),
            )
        )
    ).scalars():
        tkey = (row.site_id, row.trait_key)
        if tkey not in trait_latest or row.created_at > trait_latest[tkey][0]:
            trait_latest[tkey] = (row.created_at, row.value)
    per_trait: dict[str, dict[UUID, float]] = defaultdict(dict)
    for (sid, trait), (_at, value) in trait_latest.items():
        per_trait[trait][sid] = float(value)
    variables.extend(("trait", trait, vals) for trait, vals in per_trait.items())

    report: list[Correlation] = []
    for kind, key, values in sorted(variables, key=lambda v: (v[0], v[1])):
        for facet in MEASURED_FACETS:
            facet_by_site = site_facet.get(facet, {})
            common = sorted(set(values) & set(facet_by_site), key=str)
            xs = [values[s] for s in common]
            ys = [facet_by_site[s] for s in common]
            r = pearson(xs, ys)
            flagged = (
                r is not None and len(common) >= FLAG_MIN_N and abs(r) >= FLAG_MIN_ABS_R
            )
            report.append(
                Correlation(
                    variable_kind=kind,
                    key=key,
                    facet=facet,
                    n=len(common),
                    r=None if r is None else round(r, 4),
                    flagged=flagged,
                )
            )
    return report


def flagged_keys(report: Iterable[Correlation]) -> set[str]:
    """Dimension and trait keys that appear in any flagged correlation."""
    return {c.key for c in report if c.flagged}


# ═════════════════════════════ style distance ═════════════════════════════


def _flatten(tokens: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """Flatten nested tokens to ``a/b`` names. ``/`` is outside the measured
    key grammar, so a dotted key (``a.b``) never collides with nesting."""
    flat: dict[str, Any] = {}
    for key, value in tokens.items():
        name = f"{prefix}{key}"
        if isinstance(value, dict):
            flat.update(_flatten(value, f"{name}/"))
        else:
            flat[name] = value
    return flat


def token_distance(ours: dict[str, Any], theirs: dict[str, Any]) -> float:
    """0 (identical token sets) .. 1 (nothing shared): the share of token
    names in either set whose values differ or are missing from one side."""
    a = _flatten(ours)
    b = _flatten(theirs)
    names = set(a) | set(b)
    if not names:
        return 1.0
    same = sum(1 for n in names if n in a and n in b and a[n] == b[n])
    return round(1 - same / len(names), 6)


#: What a difference says for a reference value this read withholds.
WITHHELD: Final = "withheld"


def token_differences(
    ours: dict[str, Any],
    theirs: dict[str, Any],
    withheld_from: dict[str, Any] | None = None,
) -> list[tuple[str, Any, Any]]:
    """``(name, ours, theirs)`` for every differing token. ``withheld_from`` is
    the reference's UNFILTERED token set: a name the caller supplied that the
    reference holds only as a withheld (non-numeric) value reads ``"withheld"``,
    so a withheld value is never mistaken for an absent one. Only names the
    caller itself named are ever reported this way."""
    a = _flatten(ours)
    b = _flatten(theirs)
    raw = _flatten(withheld_from) if withheld_from is not None else {}
    out: list[tuple[str, Any, Any]] = []
    for name in sorted(set(a) | set(b)):
        theirs_value = b.get(name)
        if name not in b and name in a and name in raw:
            theirs_value = WITHHELD
        if a.get(name) != theirs_value:
            out.append((name, a.get(name), theirs_value))
    return out


def is_measured_token_set(tokens: dict[str, Any]) -> bool:
    """False for an empty set and for the worker's stated-unknown sentinel
    (``{"state": "unknown", ...}``): comparing an unknown against anything is
    not a distance."""
    return bool(tokens) and tokens.get("state") != "unknown"


# ═════════════════════════════ measured facts ═════════════════════════════

#: Keys a measured-facts read may serve: a short identifier, never a sentence.
_MEASURED_KEY_RE: Final = re.compile(r"\A[a-z0-9_.]{1,32}\Z")
#: A viewport name or size a measured read may serve: ``desktop``, ``375x812``.
_VIEWPORT_RE: Final = re.compile(r"\A(?:[a-z][a-z0-9_]{0,23}|[0-9]{2,5}x[0-9]{2,5})\Z")
#: Integers beyond this are not measurements (and are not exactly a float).
_MAX_MEASURED_INT: Final = 2**53
_URL_MAX_CHARS: Final = 200
#: ``facets.method`` is served only in this form.
_FACETS_METHOD_RE: Final = re.compile(r"\Afacets@[0-9]{1,4}\Z")
_DNS_LABEL: Final = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
_DOMAIN_RE: Final = re.compile(rf"\A{_DNS_LABEL}(?:\.{_DNS_LABEL})*\Z")
#: One URL path segment a measured read serves: no hyphen, no ``%`` escape.
_PATH_SEGMENT_RE: Final = re.compile(r"\A[A-Za-z0-9_.~]{1,24}\Z")
_URL_MAX_SEGMENTS: Final = 3
#: Shape caps: a grammar bounds each token, these bound how many.
MEASURED_MAX_KEYS: Final = 64
MEASURED_MAX_LIST_ITEMS: Final = 256
#: Nodes (containers and leaves) one measured field may spend in total.
MEASURED_NODE_BUDGET: Final = 512
MEASURED_MAX_VIEWPORTS: Final = 8
MEASURED_MAX_CAPTURES: Final = 20
_MEASURED_MAX_DEPTH: Final = 8


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return abs(value) <= _MAX_MEASURED_INT  # never reaches math.isfinite
    return isinstance(value, float) and math.isfinite(value)


def measured_viewport(value: Any) -> str | None:
    """``value`` when it is a short viewport token, else None."""
    return value if isinstance(value, str) and _VIEWPORT_RE.match(value) else None


def measured_viewports(values: Any) -> list[str]:
    """The viewport tokens of a page's free-form ``viewports`` list."""
    if not isinstance(values, list):
        return []
    kept = [v for v in values if measured_viewport(v) is not None]
    return kept[:MEASURED_MAX_VIEWPORTS]


def measured_domain(domain: Any) -> str | None:
    """``domain`` when it is a DNS host name (lower-case labels), else None."""
    if isinstance(domain, str) and len(domain) <= 253 and _DOMAIN_RE.match(domain):
        return domain
    return None


def measured_url(url: Any, domain: str) -> str | None:
    """``scheme://host`` of a page URL, plus its path only when the path is at
    most :data:`_URL_MAX_SEGMENTS` segments of ``[A-Za-z0-9_.~]{1,24}``;
    otherwise the host alone. None unless the host is the site's own domain.
    Userinfo, port, query, fragment, percent escapes and hyphenated words are
    free text and never served."""
    if not isinstance(url, str):
        return None
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not host:
        return None
    shown = measured_domain(host)
    if shown is None or normalise_domain(shown) != domain:
        return None
    head = f"{parts.scheme}://{shown}"
    segments = parts.path.split("/")[1:] if parts.path.startswith("/") else []
    if segments == [""]:
        return head  # the site root
    if (
        not segments
        or len(segments) > _URL_MAX_SEGMENTS
        or not all(_PATH_SEGMENT_RE.match(seg) for seg in segments)
    ):
        return head
    return head + "".join("/" + seg for seg in segments)


def numeric_only(value: Any) -> tuple[Any, int]:
    """``(filtered, dropped)``: ``value`` with only numeric leaves under keys
    matching a short-identifier grammar. Every string, boolean, null, oddly
    keyed, surplus (beyond the key, item and node caps) or too-deep node is
    dropped and counted once. A list is kept WHOLE or not at all: dropping one
    element would shift the positions of the rest, which a position-keyed list
    (layout bands) cannot carry. A device can write anything into ``tokens``,
    ``layout_bands`` and ``motion_summary``, so a numeric-only guarantee is
    enforced here rather than assumed."""
    return _numeric_walk(value, 0, [MEASURED_NODE_BUDGET])


def _numeric_walk(value: Any, depth: int, budget: list[int]) -> tuple[Any, int]:
    if budget[0] <= 0:
        return _DROPPED, 1
    budget[0] -= 1
    if isinstance(value, dict):
        if depth >= _MEASURED_MAX_DEPTH:
            return _DROPPED, 1
        out_d: dict[str, Any] = {}
        dropped = 0
        for key, child in value.items():
            if not isinstance(key, str) or not _MEASURED_KEY_RE.match(key):
                dropped += 1
                continue
            if len(out_d) >= MEASURED_MAX_KEYS:
                dropped += 1
                continue
            kept, n = _numeric_walk(child, depth + 1, budget)
            dropped += n
            if kept is _DROPPED or (isinstance(kept, dict | list) and not kept):
                continue  # a node nothing numeric survived in carries no fact
            out_d[key] = kept
        return out_d, dropped
    if isinstance(value, list):
        if depth >= _MEASURED_MAX_DEPTH:
            return _DROPPED, 1
        if len(value) > MEASURED_MAX_LIST_ITEMS:
            return _DROPPED, len(value)
        out_l: list[Any] = []
        dropped = 0
        failed = False
        for child in value:
            kept, n = _numeric_walk(child, depth + 1, budget)
            dropped += n
            if kept is _DROPPED or (isinstance(kept, dict | list) and not kept):
                failed = True
                continue
            out_l.append(kept)
        if failed:
            return _DROPPED, dropped or 1
        return out_l, dropped
    if _is_number(value):
        return value, 0
    return _DROPPED, 1


#: Sentinel for a leaf :func:`numeric_only` removed (a real ``None`` is also
#: removed, but must not be confused with "kept").
_DROPPED: Final = object()


def measured_capture(capture: Any) -> MeasuredCaptureOut:
    """THE allowlist of what a proposed (unconfirmed) capture reveals
    (plan D4): identity, the numeric ``MEASURED_FACETS`` values, and
    numeric-only tokens, layout bands and motion summary. No blob key, no
    text."""
    dropped = 0
    raw_facets = capture.facets if isinstance(capture.facets, dict) else {}
    facets: dict[str, float] = {}
    method: str | None = None
    for key, value in raw_facets.items():
        if key in MEASURED_FACETS and _is_number(value):
            facets[key] = float(value)
        elif (
            key == "method"
            and isinstance(value, str)
            and _FACETS_METHOD_RE.match(value)
        ):
            method = value
        else:
            dropped += 1
    raw_tokens = capture.tokens if isinstance(capture.tokens, dict) else {}
    tokens: dict[str, Any] | None = None
    if is_measured_token_set(raw_tokens):
        filtered, n = numeric_only(raw_tokens)
        dropped += n
        tokens = None if filtered is _DROPPED else (filtered or None)
    else:
        dropped += len(raw_tokens)
    bands, n = numeric_only(
        capture.layout_bands if isinstance(capture.layout_bands, list) else []
    )
    dropped += n
    if bands is _DROPPED:
        bands = []
    motion, n = numeric_only(
        capture.motion_summary if isinstance(capture.motion_summary, dict) else {}
    )
    dropped += n
    if motion is _DROPPED:
        motion = {}
    return MeasuredCaptureOut(
        id=capture.id,
        page_id=capture.page_id,
        run_id=capture.run_id,
        viewport=measured_viewport(capture.viewport),
        captured_at=capture.created_at,
        facets=facets,
        facets_method=method,
        tokens=tokens,
        tokens_state="measured" if tokens else "unknown",
        layout_bands=bands,
        motion_summary=motion,
        dropped_non_numeric=dropped,
    )


# ═════════════════════════════ search ═════════════════════════════


@dataclass
class SearchQuery:
    level: str
    text: str | None = None
    facets: dict[str, Any] | None = None
    industry: str | None = None
    business_type: str | None = None
    price_tier: str | None = None
    style_family: str | None = None
    tier: str | None = None
    query_embedding: list[float] | None = None
    query_embedding_model: str | None = None
    personality_target: dict[str, int] | None = None
    personality_tolerance: int | None = None
    include_unconfirmed: bool = False
    include_anti_pattern: bool = False
    include_holdout: bool = False
    limit: int = 20
    #: ``{facet: (min, max)}`` over the per-page median; page level only.
    measured: dict[str, tuple[float | None, float | None]] | None = None


@dataclass
class SearchOutcome:
    vector_arm: str
    hits: list[Hit]
    #: The candidate cap bound, so the result may be incomplete.
    candidates_capped: bool = False
    #: See ``SearchResponse.measured_unknown``.
    measured_unknown: int = 0
    #: More hits matched than ``limit`` returned.
    truncated: bool = False


@dataclass
class Hit:
    level: str
    target_id: UUID
    site: Site
    record: Any
    facet_exact: bool = False
    text_rank: float | None = None
    vector_similarity: float | None = None
    personality_distance: float | None = None
    personality_basis: str | None = None
    snippet: str | None = None
    labels: list[str] = field(default_factory=list)
    #: Per-facet median over the page's newest run (page level only).
    measured: dict[str, float] = field(default_factory=dict)


def _entity_select(level: str) -> tuple[Any, Select[Any]]:
    model = LEVEL_MODELS[level]
    if model is Site:
        return model, select(Site, Site)
    if model is Component:
        return model, (
            select(Component, Site)
            .join(Page, Page.id == Component.page_id)
            .join(Site, Site.id == Page.site_id)
        )
    return model, select(model, Site).join(Site, Site.id == model.site_id)


def _proposed_group(stmt: Select[Any], include_anti_pattern: bool) -> Select[Any]:
    """The unconfirmed reference pages: also never a page of a site the
    operator marked ``anti_pattern`` (unless asked)."""
    stmt = facts_visible(stmt).where(Site.context_state == "proposed")
    if not include_anti_pattern:
        stmt = stmt.where(or_(Site.quality.is_(None), Site.quality != "anti_pattern"))
    return stmt


def _median_facets(tenant_id: UUID, facets: Sequence[str]) -> Any:
    """A subquery ``(page_id, <facet>...)``: per page, the median of each
    facet over the captures of the page's NEWEST ``run_id`` (the median
    :func:`correlation_report` uses). A facet that is absent or not a number
    in every capture of that run is NULL, never zero."""
    newest = (
        select(Capture.page_id, Capture.run_id)
        .where(Capture.tenant_id == tenant_id)
        .distinct(Capture.page_id)
        .order_by(Capture.page_id, Capture.created_at.desc())
        .subquery("newest_run")
    )
    columns = [
        func.percentile_cont(0.5)
        .within_group(
            case(
                (
                    func.jsonb_typeof(Capture.facets[facet]) == "number",
                    cast(Capture.facets[facet].astext, Float),
                )
            )
        )
        .label(facet)
        for facet in facets
    ]
    return (
        select(Capture.page_id, *columns)
        .join(
            newest,
            and_(
                newest.c.page_id == Capture.page_id, newest.c.run_id == Capture.run_id
            ),
        )
        .where(Capture.tenant_id == tenant_id)
        .group_by(Capture.page_id)
        .subquery("page_medians")
    )


@dataclass
class Candidates:
    rows: list[tuple[Any, Site]]
    #: The candidate cap bound: more rows matched than were returned.
    capped: bool = False
    #: Candidates dropped because a ``measured`` facet had no value.
    measured_unknown: int = 0


async def candidate_entities(
    db: AsyncSession, tenant_id: UUID, level: str, **kwargs: Any
) -> list[tuple[Any, Site]]:
    """:func:`candidates` without the cap and unknown accounting."""
    return (await candidates(db, tenant_id, level, **kwargs)).rows


async def candidates(
    db: AsyncSession,
    tenant_id: UUID,
    level: str,
    *,
    include_holdout: bool,
    include_anti_pattern: bool = False,
    proposed_facts: bool = False,
    tier: str | None = None,
    industry: str | None = None,
    business_type: str | None = None,
    price_tier: str | None = None,
    style_family: str | None = None,
    role: str | None = None,
    ids: Sequence[UUID] | None = None,
    measured: dict[str, tuple[float | None, float | None]] | None = None,
) -> Candidates:
    """The tenant's records at ``level`` that an agent-facing read may see:
    never ``rejected``, ``anti_pattern`` only when asked, holdout only when
    the (operator-gated) caller asked for it.

    ``proposed_facts`` widens PAGE level (and only page level) from confirmed
    reference sites to every reference-split site, confirmed or not: the
    measured-facts arms. Each row's confirmation is its site's
    ``context_state``. Holdouts stay out at every confirmation state, and
    component, site and flow levels stay confirmed-only (plan D4).

    ``measured`` (page level) keeps pages whose per-page median of each named
    facet lies in ``[min, max]``. It is applied in SQL, BEFORE the candidate
    cap, so a corpus above the cap cannot silently return an incomplete set.
    A page missing a named facet is not a match; it is counted in
    ``measured_unknown``."""
    model, stmt = _entity_select(level)
    stmt = stmt.where(
        model.tenant_id == tenant_id,
        Site.tenant_id == tenant_id,
        model.review_state != "rejected",
    )
    if model is not Site:
        stmt = stmt.where(Site.review_state != "rejected")
    if not include_anti_pattern:
        stmt = stmt.where(or_(model.quality.is_(None), model.quality != "anti_pattern"))
    two_groups = proposed_facts and level == "page" and not include_holdout
    if not include_holdout and not two_groups:
        stmt = agent_visible(stmt)
    if tier is not None:
        stmt = stmt.where(model.tier == tier)
    for column, value in (
        (Site.industry, industry),
        (Site.business_type, business_type),
        (Site.price_tier, price_tier),
        (Site.style_family, style_family),
    ):
        if value is not None:
            stmt = stmt.where(column == value)
    if role is not None and model is Component:
        stmt = stmt.where(Component.role == role)
    if ids is not None:
        stmt = stmt.where(model.id.in_(list(ids)))
    if measured and model is not Page:
        raise ValueError("measured filters apply to page-level queries only")
    # With ``proposed_facts``: agent_visible OR (facts_visible AND proposed),
    # each group under its OWN cap and newest-first order, so a flood of
    # unconfirmed pages cannot crowd confirmed ones out of the candidates.
    groups = (
        [
            agent_visible(stmt),
            _proposed_group(stmt, include_anti_pattern),
        ]
        if two_groups
        else [stmt]
    )
    medians = _median_facets(tenant_id, list(measured)) if measured else None
    rows: list[tuple[Any, Site]] = []
    capped = False
    unknown = 0
    for group in groups:
        if measured and medians is not None:
            group = group.outerjoin(medians, medians.c.page_id == Page.id)
            in_range = []
            missing = []
            for facet, (low, high) in measured.items():
                column = medians.c[facet]
                missing.append(column.is_(None))
                in_range.append(column.is_not(None))
                if low is not None:
                    in_range.append(column >= low)
                if high is not None:
                    in_range.append(column <= high)
            unknown += int(
                (
                    await db.execute(
                        select(func.count()).select_from(
                            group.where(or_(*missing))
                            .with_only_columns(Page.id)
                            .subquery()
                        )
                    )
                ).scalar_one()
            )
            group = group.where(and_(*in_range))
        group = group.order_by(model.created_at.desc()).limit(SEARCH_CANDIDATE_CAP + 1)
        found = [(row[0], row[1]) for row in (await db.execute(group)).all()]
        capped = capped or len(found) > SEARCH_CANDIDATE_CAP
        rows.extend(found[:SEARCH_CANDIDATE_CAP])
    rows.sort(key=lambda pair: pair[0].created_at, reverse=True)
    return Candidates(rows=rows, capped=capped, measured_unknown=unknown)


async def page_medians(
    db: AsyncSession, tenant_id: UUID, page_ids: Sequence[UUID]
) -> dict[UUID, dict[str, float]]:
    """``{page_id: {facet: median}}`` for the facets each page has a value for."""
    ids = list(set(page_ids))
    if not ids:
        return {}
    medians = _median_facets(tenant_id, MEASURED_FACETS)
    rows = (await db.execute(select(medians).where(medians.c.page_id.in_(ids)))).all()
    out: dict[UUID, dict[str, float]] = {}
    for row in rows:
        values = {
            facet: float(row._mapping[facet])
            for facet in MEASURED_FACETS
            if row._mapping[facet] is not None
        }
        if values:
            out[row._mapping["page_id"]] = values
    return out


async def latest_personality(
    db: AsyncSession,
    tenant_id: UUID,
    site_ids: Iterable[UUID],
    *,
    include_unconfirmed: bool,
) -> dict[UUID, tuple[dict[str, int], bool]]:
    """``{site_id: ({trait: value}, used_unconfirmed)}`` — the latest
    CONFIRMED value per trait, falling back to the latest proposed one only
    when ``include_unconfirmed``."""
    ids = list(set(site_ids))
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(SitePersonality)
            .where(
                SitePersonality.tenant_id == tenant_id, SitePersonality.site_id.in_(ids)
            )
            .order_by(SitePersonality.created_at)
        )
    ).scalars()
    confirmed: dict[UUID, dict[str, int]] = defaultdict(dict)
    proposed: dict[UUID, dict[str, int]] = defaultdict(dict)
    for row in rows:
        target = confirmed if row.state == "confirmed" else proposed
        target[row.site_id][row.trait_key] = row.value
    result: dict[UUID, tuple[dict[str, int], bool]] = {}
    for sid in ids:
        values = dict(confirmed.get(sid, {}))
        used_unconfirmed = False
        if include_unconfirmed:
            for trait, value in proposed.get(sid, {}).items():
                if trait not in values:
                    values[trait] = value
                    used_unconfirmed = True
        result[sid] = (values, used_unconfirmed)
    return result


def personality_distance(
    values: dict[str, int], target: dict[str, int], tolerance: int | None
) -> float | None:
    """Root-mean-square distance over the target's traits (equal weights), or
    None when a trait has no value or one is outside ``tolerance``."""
    if not target:
        return None
    squares = 0.0
    for trait, wanted in target.items():
        if trait not in values:
            return None
        gap = abs(values[trait] - wanted)
        if tolerance is not None and gap > tolerance:
            return None
        squares += gap * gap
    return round(math.sqrt(squares / len(target)), 6)


async def search(
    db: AsyncSession, tenant_id: UUID, query: SearchQuery
) -> SearchOutcome:
    """Hybrid search. Returns the vector arm, the hits and the accounting.

    Ranking: facet-exact matches first; then (with a personality target) the
    closest personality; then the hybrid score (full-text rank plus cosine
    similarity when the query carried an embedding); newest last. Without
    ``query_embedding`` the vector arm is skipped and said so
    (``skipped_no_embedding``) — the backend never computes an embedding.
    """
    vector_arm = (
        "hybrid" if query.query_embedding is not None else "skipped_no_embedding"
    )
    # D6: an unconfirmed site's page enters a result only when nothing a
    # description or a proposed site-context value could steer is in the
    # query; a description signal, a personality target or a context filter
    # applied to an unconfirmed site would leak hidden content through the
    # ranking or the filter.
    browse = query.level == "page" and not (
        (query.text and query.text.strip())
        or query.facets is not None
        or query.query_embedding is not None
        or query.personality_target
        or query.industry is not None
        or query.business_type is not None
        or query.price_tier is not None
        or query.style_family is not None
    )
    found = await candidates(
        db,
        tenant_id,
        query.level,
        include_holdout=query.include_holdout,
        include_anti_pattern=query.include_anti_pattern,
        proposed_facts=browse,
        tier=query.tier,
        industry=query.industry,
        business_type=query.business_type,
        price_tier=query.price_tier,
        style_family=query.style_family,
        measured=query.measured,
    )
    hits: dict[UUID, Hit] = {}
    for record, site in found.rows:
        hits[record.id] = Hit(
            level=query.level, target_id=record.id, site=site, record=record
        )
    if not hits:
        return SearchOutcome(vector_arm, [], found.capped, found.measured_unknown)

    has_text = bool(query.text and query.text.strip())
    signals = has_text or query.facets is not None or query.query_embedding is not None
    if signals:
        d = Description
        columns: list[Any] = [d.target_id]
        if query.facets is not None:
            columns.append(
                func.bool_or(
                    d.facets.op("@>")(bindparam("facets", query.facets, type_=JSONB))
                )
            )
        else:
            columns.append(text("false"))
        if has_text:
            tsq = func.plainto_tsquery("english", query.text)
            columns.append(
                func.max(func.ts_rank_cd(d.body_tsv, tsq)).filter(
                    d.body_tsv.op("@@")(tsq)
                )
            )
        else:
            columns.append(text("NULL::float"))
        if query.query_embedding is not None:
            columns.append(
                func.max(1 - d.embedding.cosine_distance(query.query_embedding)).filter(
                    d.embedding_model == query.query_embedding_model
                )
            )
        else:
            columns.append(text("NULL::float"))
        columns.append(func.min(func.left(d.body, 280)))
        stmt = (
            select(*columns)
            .where(
                d.tenant_id == tenant_id,
                d.level == query.level,
                d.review_state != "rejected",
                d.target_id.in_(list(hits)),
            )
            .group_by(d.target_id)
        )
        matched: set[UUID] = set()
        for target_id, facet_exact, rank, similarity, snippet in (
            await db.execute(stmt)
        ).all():
            hit = hits[target_id]
            hit.facet_exact = bool(facet_exact)
            hit.text_rank = None if rank is None else round(float(rank), 6)
            hit.vector_similarity = (
                None if similarity is None else round(float(similarity), 6)
            )
            hit.snippet = snippet
            if (
                hit.facet_exact
                or (hit.text_rank or 0) > 0
                or hit.vector_similarity is not None
            ):
                matched.add(target_id)
        hits = {tid: hit for tid, hit in hits.items() if tid in matched}

    if query.personality_target:
        personalities = await latest_personality(
            db,
            tenant_id,
            [hit.site.id for hit in hits.values()],
            include_unconfirmed=query.include_unconfirmed,
        )
        kept: dict[UUID, Hit] = {}
        for tid, hit in hits.items():
            values, used_unconfirmed = personalities.get(hit.site.id, ({}, False))
            distance = personality_distance(
                values, query.personality_target, query.personality_tolerance
            )
            if distance is None:
                continue
            hit.personality_distance = distance
            hit.personality_basis = "unconfirmed" if used_unconfirmed else "confirmed"
            if used_unconfirmed:
                hit.labels.append("personality_unconfirmed")
            kept[tid] = hit
        hits = kept

    for hit in hits.values():
        hit.labels = site_labels(hit.site) + hit.labels
        if hit.record.review_state == "pending":
            hit.labels.append("unreviewed")

    def rank_key(hit: Hit) -> tuple[Any, ...]:
        hybrid = (hit.text_rank or 0.0) + (hit.vector_similarity or 0.0)
        return (
            0 if hit.facet_exact else 1,
            hit.personality_distance if hit.personality_distance is not None else 0.0,
            0 if hit.record.review_state == "approved" else 1,
            -hybrid,
            -hit.record.created_at.timestamp(),
        )

    ranked = sorted(hits.values(), key=rank_key)
    truncated = len(ranked) > query.limit
    ordered = ranked[: query.limit]
    if query.level == "page":
        medians = await page_medians(db, tenant_id, [hit.target_id for hit in ordered])
        for hit in ordered:
            hit.measured = medians.get(hit.target_id, {})
    for hit in ordered:
        if hit.site.context_state != "confirmed" and not query.include_holdout:
            # A proposed hit carries measured facts and the curation state;
            # nothing a description or a person wrote about the site.
            hit.snippet = None
            hit.text_rank = None
            hit.vector_similarity = None
            hit.personality_distance = None
            hit.personality_basis = None
    return SearchOutcome(
        vector_arm, ordered, found.capped, found.measured_unknown, truncated
    )


# ═════════════════════════════ takedown ═════════════════════════════


@dataclass
class TakedownOutcome:
    sites: int = 0
    pages: int = 0
    flows: int = 0
    captures: int = 0
    components: int = 0
    descriptions: int = 0
    ratings: int = 0
    comparisons: int = 0
    personality_rows: int = 0
    evidence_rows: int = 0
    corrections: int = 0
    principles_reverted: list[UUID] = field(default_factory=list)
    blobs_deleted: int = 0
    blobs_kept: int = 0
    do_not_capture: list[str] = field(default_factory=list)
    #: Object keys to delete from storage once the transaction committed.
    object_keys: list[str] = field(default_factory=list)


def _rowcount(result: Any) -> int:
    """A DELETE/UPDATE's affected-row count (a ``CursorResult`` attribute)."""
    return int(getattr(result, "rowcount", 0) or 0)


async def _ids(db: AsyncSession, stmt: Select[Any]) -> set[UUID]:
    return {row[0] for row in (await db.execute(stmt)).all()}


async def referenced_keys(
    db: AsyncSession, tenant_id: UUID, keys: Iterable[str]
) -> set[str]:
    """Which of ``keys`` a surviving record of the tenant still names, read
    from every blob-key column at call time."""
    wanted = sorted(set(keys))
    if not wanted:
        return set()
    rows = await db.execute(
        text(
            """
            SELECT k FROM unnest(:keys) AS k
             WHERE EXISTS (SELECT 1 FROM design_refs.capture c
                            WHERE c.tenant_id = :tenant
                              AND k IN (c.screenshot_key, c.structure_key,
                                        c.styles_key, c.a11y_key))
                OR EXISTS (SELECT 1 FROM design_refs.component m
                            WHERE m.tenant_id = :tenant AND m.crop_key = k)
                OR EXISTS (SELECT 1 FROM design_refs.replay_bundle b
                            WHERE b.tenant_id = :tenant AND b.bundle_key = k)
                OR EXISTS (SELECT 1 FROM design_refs.capture_source s,
                                         jsonb_each(s.parts) AS p
                            WHERE s.tenant_id = :tenant AND p.value->>'key' = k)
            """
        ).bindparams(bindparam("keys", type_=ARRAY(Text))),
        {"keys": wanted, "tenant": tenant_id},
    )
    return {row[0] for row in rows.all()}


async def _record_keys(
    db: AsyncSession,
    tenant_id: UUID,
    capture_ids: set[UUID],
    component_ids: set[UUID],
    page_ids: set[UUID],
) -> set[str]:
    keys: set[str] = set()
    if capture_ids:
        for row in (
            await db.execute(
                select(
                    Capture.screenshot_key,
                    Capture.structure_key,
                    Capture.styles_key,
                    Capture.a11y_key,
                ).where(Capture.tenant_id == tenant_id, Capture.id.in_(capture_ids))
            )
        ).all():
            keys.update(k for k in row if k)
    if component_ids:
        keys.update(
            k
            for (k,) in (
                await db.execute(
                    select(Component.crop_key).where(
                        Component.tenant_id == tenant_id,
                        Component.id.in_(component_ids),
                    )
                )
            ).all()
            if k
        )
    if page_ids:
        keys.update(
            k
            for (k,) in (
                await db.execute(
                    select(ReplayBundle.bundle_key).where(
                        ReplayBundle.tenant_id == tenant_id,
                        ReplayBundle.page_id.in_(page_ids),
                    )
                )
            ).all()
        )
        for (parts,) in (
            await db.execute(
                select(CaptureSource.parts).where(
                    CaptureSource.tenant_id == tenant_id,
                    CaptureSource.page_id.in_(page_ids),
                )
            )
        ).all():
            for part in (parts or {}).values():
                if isinstance(part, dict) and part.get("key"):
                    keys.add(str(part["key"]))
    return keys


async def takedown(
    db: AsyncSession,
    tenant_id: UUID,
    *,
    actor_id: str,
    reason: str,
    domain: str | None = None,
    target_kind: str | None = None,
    target_id: UUID | None = None,
) -> TakedownOutcome:
    """Remove a domain (every tier) or one record, and everything that
    names it. Runs in the caller's transaction; the caller commits, THEN
    deletes ``outcome.object_keys`` from storage (:func:`delete_objects`), so
    a rolled-back takedown never loses a blob.

    * Rows: the record tree (sites → pages, flows → captures, sources,
      bundles, components → fingerprints), their descriptions and corrections,
      and every judgement row targeting a removed site, page or component
      (ratings, comparisons, personality rows, the principle-evidence rows
      citing them). A flow keeps its other steps when one page goes.
    * Principles left with supporting evidence from fewer than two reference
      sites revert from ``approved`` to ``proposed``.
    * Blobs: reference-counted — a key no surviving record names loses its
      ``blob`` row and its object; one another record still names is kept.
    * The domain (or the page's domain + path) joins ``do_not_capture``.
    """
    out = TakedownOutcome()
    site_ids: set[UUID] = set()
    page_ids: set[UUID] = set()
    flow_ids: set[UUID] = set()
    component_ids: set[UUID] = set()
    dnc: list[tuple[str, str]] = []

    if domain is not None:
        host = normalise_domain(domain)
        site_ids = await _ids(
            db, select(Site.id).where(Site.tenant_id == tenant_id, Site.domain == host)
        )
        dnc.append((host, ""))
    elif target_kind == "site":
        rows = (
            await db.execute(
                select(Site.id, Site.domain).where(
                    Site.tenant_id == tenant_id, Site.id == target_id
                )
            )
        ).all()
        site_ids = {row[0] for row in rows}
        dnc.extend((row[1], "") for row in rows)
    elif target_kind == "page":
        rows = (
            await db.execute(
                select(Page.id, Page.url).where(
                    Page.tenant_id == tenant_id, Page.id == target_id
                )
            )
        ).all()
        page_ids = {row[0] for row in rows}
        dnc.extend(url_domain_and_path(row[1]) for row in rows)
    elif target_kind == "flow":
        flow_ids = await _ids(
            db, select(Flow.id).where(Flow.tenant_id == tenant_id, Flow.id == target_id)
        )
    elif target_kind == "component":
        component_ids = await _ids(
            db,
            select(Component.id).where(
                Component.tenant_id == tenant_id, Component.id == target_id
            ),
        )

    if site_ids:
        page_ids |= await _ids(
            db,
            select(Page.id).where(
                Page.tenant_id == tenant_id, Page.site_id.in_(site_ids)
            ),
        )
        flow_ids |= await _ids(
            db,
            select(Flow.id).where(
                Flow.tenant_id == tenant_id, Flow.site_id.in_(site_ids)
            ),
        )
    capture_ids: set[UUID] = set()
    if page_ids:
        component_ids |= await _ids(
            db,
            select(Component.id).where(
                Component.tenant_id == tenant_id, Component.page_id.in_(page_ids)
            ),
        )
        capture_ids = await _ids(
            db,
            select(Capture.id).where(
                Capture.tenant_id == tenant_id, Capture.page_id.in_(page_ids)
            ),
        )

    candidate_keys = await _record_keys(
        db, tenant_id, capture_ids, component_ids, page_ids
    )

    # ── judgement rows ──
    removed_by_kind = {"site": site_ids, "page": page_ids, "component": component_ids}
    rating_conditions = [
        and_(PerceptionRating.target_kind == kind, PerceptionRating.target_id.in_(ids))
        for kind, ids in removed_by_kind.items()
        if ids
    ]
    if page_ids:
        rating_conditions.append(PerceptionRating.context_page_id.in_(page_ids))
    rating_ids: set[UUID] = set()
    if rating_conditions:
        rating_ids = await _ids(
            db,
            select(PerceptionRating.id).where(
                PerceptionRating.tenant_id == tenant_id, or_(*rating_conditions)
            ),
        )
    comparison_conditions = [
        and_(
            Comparison.target_kind == kind,
            or_(Comparison.a_id.in_(ids), Comparison.b_id.in_(ids)),
        )
        for kind, ids in removed_by_kind.items()
        if ids
    ]
    comparison_ids: set[UUID] = set()
    if comparison_conditions:
        comparison_ids = await _ids(
            db,
            select(Comparison.id).where(
                Comparison.tenant_id == tenant_id, or_(*comparison_conditions)
            ),
        )

    evidence_conditions = []
    if rating_ids:
        evidence_conditions.append(
            and_(
                DesignPrincipleEvidence.evidence_kind == "perception_rating",
                DesignPrincipleEvidence.evidence_id.in_(rating_ids),
            )
        )
    if comparison_ids:
        evidence_conditions.append(
            and_(
                DesignPrincipleEvidence.evidence_kind == "comparison",
                DesignPrincipleEvidence.evidence_id.in_(comparison_ids),
            )
        )
    if site_ids:
        evidence_conditions.append(
            DesignPrincipleEvidence.site_ids.op("&&")(
                bindparam(
                    "removed_sites", list(site_ids), type_=ARRAY(PGUUID(as_uuid=True))
                )
            )
        )
    affected_principles: set[UUID] = set()
    if evidence_conditions:
        deleted_evidence = (
            await db.execute(
                delete(DesignPrincipleEvidence)
                .where(
                    DesignPrincipleEvidence.tenant_id == tenant_id,
                    or_(*evidence_conditions),
                )
                .returning(DesignPrincipleEvidence.principle_id)
            )
        ).all()
        out.evidence_rows = len(deleted_evidence)
        affected_principles = {row[0] for row in deleted_evidence}
    if rating_ids:
        out.ratings = _rowcount(
            await db.execute(
                delete(PerceptionRating).where(
                    PerceptionRating.tenant_id == tenant_id,
                    PerceptionRating.id.in_(rating_ids),
                )
            )
        )
    if comparison_ids:
        out.comparisons = _rowcount(
            await db.execute(
                delete(Comparison).where(
                    Comparison.tenant_id == tenant_id, Comparison.id.in_(comparison_ids)
                )
            )
        )
    personality_ids: set[UUID] = set()
    if site_ids:
        personality_ids = await _ids(
            db,
            select(SitePersonality.id).where(
                SitePersonality.tenant_id == tenant_id,
                SitePersonality.site_id.in_(site_ids),
            ),
        )
        out.personality_rows = _rowcount(
            await db.execute(
                delete(SitePersonality).where(
                    SitePersonality.tenant_id == tenant_id,
                    SitePersonality.site_id.in_(site_ids),
                )
            )
        )

    # ── descriptions and corrections of removed records ──
    described = [
        and_(Description.level == level, Description.target_id.in_(ids))
        for level, ids in (
            ("site", site_ids),
            ("page", page_ids),
            ("flow", flow_ids),
            ("component", component_ids),
        )
        if ids
    ]
    description_ids: set[UUID] = set()
    if described:
        description_ids = await _ids(
            db,
            select(Description.id).where(
                Description.tenant_id == tenant_id, or_(*described)
            ),
        )
        out.descriptions = _rowcount(
            await db.execute(
                delete(Description).where(
                    Description.tenant_id == tenant_id,
                    Description.id.in_(description_ids),
                )
            )
        )
    corrected = [
        and_(Correction.target_kind == kind, Correction.target_id.in_(ids))
        for kind, ids in (
            ("site", site_ids),
            ("page", page_ids),
            ("flow", flow_ids),
            ("component", component_ids),
            ("description", description_ids),
            ("site_personality", personality_ids),
        )
        if ids
    ]
    if corrected:
        out.corrections = _rowcount(
            await db.execute(
                delete(Correction).where(
                    Correction.tenant_id == tenant_id, or_(*corrected)
                )
            )
        )

    # ── the record rows (FKs cascade down the tree) ──
    if page_ids and not site_ids:
        # A surviving flow keeps its other steps.
        for flow in (
            await db.execute(
                select(Flow).where(
                    Flow.tenant_id == tenant_id,
                    Flow.id.not_in(flow_ids or {UUID(int=0)}),
                )
            )
        ).scalars():
            removed_pages = {str(p) for p in page_ids}
            kept = [
                step
                for step in flow.steps or []
                if not (
                    isinstance(step, dict) and str(step.get("page_id")) in removed_pages
                )
            ]
            if kept != (flow.steps or []):
                flow.steps = kept
    out.captures = len(capture_ids)
    out.components = len(component_ids)
    out.pages = len(page_ids)
    out.flows = len(flow_ids)
    out.sites = len(site_ids)
    if component_ids:
        await db.execute(
            delete(Component).where(
                Component.tenant_id == tenant_id, Component.id.in_(component_ids)
            )
        )
    if flow_ids:
        await db.execute(
            delete(Flow).where(Flow.tenant_id == tenant_id, Flow.id.in_(flow_ids))
        )
    if page_ids:
        await db.execute(
            delete(Page).where(Page.tenant_id == tenant_id, Page.id.in_(page_ids))
        )
    if site_ids:
        await db.execute(
            delete(Site).where(Site.tenant_id == tenant_id, Site.id.in_(site_ids))
        )
    await db.flush()

    # ── principles left below two reference sites revert ──
    for principle_id in sorted(affected_principles, key=str):
        principle = (
            await db.execute(
                select(DesignPrinciple).where(
                    DesignPrinciple.tenant_id == tenant_id,
                    DesignPrinciple.id == principle_id,
                )
            )
        ).scalar_one_or_none()
        if principle is None or principle.status != "approved":
            continue
        if len(await reference_support(db, tenant_id, principle_id)) >= 2:
            continue
        principle.status = "proposed"
        principle.approved_by = None
        principle.approved_at = None
        db.add(
            Correction(
                tenant_id=tenant_id,
                target_kind="design_principle",
                target_id=principle_id,
                field="status",
                from_value="approved",
                to_value="proposed",
                actor_kind="operator",
                actor_id=actor_id,
            )
        )
        out.principles_reverted.append(principle_id)

    # ── do-not-capture ──
    for host, path in dnc:
        existing = (
            await db.execute(
                select(DoNotCapture.id).where(
                    DoNotCapture.tenant_id == tenant_id,
                    DoNotCapture.domain == host,
                    DoNotCapture.path_prefix == ("" if path in ("", "/") else path),
                )
            )
        ).scalar()
        prefix = "" if path in ("", "/") else path
        if existing is None:
            db.add(
                DoNotCapture(
                    tenant_id=tenant_id,
                    domain=host,
                    path_prefix=prefix,
                    reason=reason,
                    created_by=actor_id,
                )
            )
        out.do_not_capture.append(host + prefix)
    await db.flush()

    # ── blobs, reference-counted ──
    # Lock the candidate blob rows FOR UPDATE before counting references: a
    # record being created against one of them holds FOR SHARE on its row
    # (``_require_blobs``) until it commits, so this waits for it and the
    # count below (a new statement under READ COMMITTED) sees it. A record
    # that arrives after this lock finds the row deleted and is refused.
    if candidate_keys:
        await db.execute(
            select(Blob.key)
            .where(Blob.tenant_id == tenant_id, Blob.key.in_(sorted(candidate_keys)))
            .order_by(Blob.key)
            .with_for_update()
        )
    still = await referenced_keys(db, tenant_id, candidate_keys)
    orphaned = sorted(candidate_keys - still)
    out.blobs_kept = len(candidate_keys & still)
    if orphaned:
        await db.execute(
            delete(Blob).where(Blob.tenant_id == tenant_id, Blob.key.in_(orphaned))
        )
    out.blobs_deleted = len(orphaned)
    out.object_keys = orphaned
    logger.info(
        "design_refs_takedown",
        tenant_id=str(tenant_id),
        domain=domain,
        target_kind=target_kind,
        target_id=str(target_id) if target_id else None,
        sites=out.sites,
        pages=out.pages,
        blobs_deleted=out.blobs_deleted,
        blobs_kept=out.blobs_kept,
    )
    return out


async def delete_objects(
    storage: ObjectStorageService,
    keys: Iterable[str],
    *,
    db: AsyncSession,
    tenant_id: UUID,
) -> int:
    """Delete objects after the takedown committed; a failure is logged,
    not raised (the row is already gone, so the object is unreachable).

    Each key is re-checked first: a blob row recreated for it since the
    takedown committed (the same bytes uploaded again) names the object, so
    it is kept."""
    deleted = 0
    for key in keys:
        if (
            await db.execute(
                select(Blob.key).where(Blob.tenant_id == tenant_id, Blob.key == key)
            )
        ).scalar() is not None:
            logger.info("design_refs_object_kept_rerecorded", key=key)
            continue
        ok = await asyncio.to_thread(storage.delete_file, key)
        if ok:
            deleted += 1
        else:
            logger.warning("design_refs_object_delete_failed", key=key)
    return deleted


__all__ = [
    "HOLDOUT_BUCKETS",
    "Correlation",
    "Hit",
    "ParsedKey",
    "SearchQuery",
    "TakedownOutcome",
    "agent_visible",
    "apply_public_tier",
    "blob_key",
    "blob_prefix",
    "blocked_by_do_not_capture",
    "Candidates",
    "SearchOutcome",
    "candidate_entities",
    "candidates",
    "page_medians",
    "correlation_report",
    "delete_objects",
    "domain_bucket",
    "evidence_site_ids",
    "facts_visible",
    "flagged_keys",
    "intake_split",
    "is_agent_reference",
    "is_agent_reference_state",
    "is_hidden_holdout",
    "is_measured_token_set",
    "measured_capture",
    "measured_domain",
    "measured_url",
    "measured_viewport",
    "measured_viewports",
    "numeric_only",
    "latest_personality",
    "normalise_domain",
    "parse_blob_key",
    "path_covered",
    "pearson",
    "personality_distance",
    "public_tier_select",
    "reference_support",
    "referenced_keys",
    "search",
    "site_labels",
    "site_splits",
    "target_sites",
    "WITHHELD",
    "token_differences",
    "token_distance",
]
