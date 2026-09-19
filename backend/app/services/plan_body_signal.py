"""Does the work unit the console calls a "Plan" actually have a plan?

``/admin/coord/plans`` renders ``coord.work_units``. A work unit is a slug, a
status and free-form metadata — it has **no body**. The document lives in a
different schema in a different service (``agent.work_artifacts``, which
qontinui-web owns), joined only by ``work_artifacts.work_unit_slug``. Until
this module existed, no surface joined them, so a plan and a slug were the
same bytes on every door an operator or an agent could reach: an operator
could pick a bodyless row off the console and send a session at a plan that
does not exist. Measured 2026-09-02: 52 dated plan-shaped work units had no
plan ``.md`` on any machine, 31 of them still non-terminal.

Plan ``2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans``,
Phases 1, 2 and 5a. qontinui-web's backend is the only component that can see
both layers, so the derivation lives here and ships as **wire fields** — one
definition that the list, the detail page and the spawn guard all read, rather
than three consumers each re-deriving it and disagreeing the first time a
value is added (which Phase 5a promptly did: ``scanned_locally``).

Two signals, and they answer different questions
================================================

:func:`derive_body_provenance` is a **screen**. It reads
``work_units.metadata.source_path``, which the runner's markdown scanner
stamps on every unit it creates *from a scanned file* and which a unit created
by a bare ``coord_work_unit_upsert`` (the "a session discovered a defect and
filed it" path) never carries. It needs no corpus, no join and no query.

:func:`resolve_body_knowledge` is the **verdict**, and it is deliberately
three-valued. It joins ``agent.work_artifacts`` and answers ``True`` /
``False`` / ``"unknown"``.

Neither one is the other. The screen's measured quality, on ONE device on
2026-09-02 (this is a one-device fleet, so no second census exists):

* recall **90.4%** — of the units that truly had no document, 90.4% carried
  no ``source_path``;
* precision **27.6%** — of the 170 units the screen flags, only 47 are truly
  bodyless.

Those are a **dated observation, not an invariant**. Nothing in this package
asserts them: recall is a property of one corpus on one day, so pinning it as
a test would red the build on an unrelated corpus change. The UI states the
precision in the marker's tooltip for the same reason — the screen must not
read as a verdict.

The converse also holds and is why ``scanned`` is not proof of a body: 5 of
those 52 bodyless units carried a ``source_path`` pointing at a file that
exists on no machine.

Why the verdict must be three-valued
====================================

The document corpus is not yet populated at scale — the scan-driven body sync
is gated on ``QONTINUI_PLAN_LIBRARY_SYNC`` **and** on the tenant's
``plan_capture`` dial, and on 2026-09-02 the corpus held ~1% of the plans. A
two-valued ``has_body`` would therefore have rendered ~1351 false accusations
on its first deploy, been dismissed as noise within a day, and taught
operators to ignore the badge before it could ever become true.

So a join **miss** is only evidence when absence *can* be evidence. Three
independent facts can each break that, and each gets its own reason string
rather than being folded into one useless "dunno":

``artifact_surface_unavailable``
    The artifact side could not be read at all — including a failure to
    resolve the caller's organization scope. Every row on the page is
    ``"unknown"``, hits included, because there were no hits to have.

``capture_unreadable``
    The ``plan_capture`` dial could not be read. Unknown is not "off": a
    capability toggle that cannot be read tells us nothing about whether the
    corpus is being kept current.

``capture_never_configured``
    The dial resolved with ``resolved_scope == "none"`` — nobody ever wrote a
    row for this tenant. Distinct from someone having turned it off, and the
    fleet-policy wire type carries the distinction precisely so a consumer
    cannot collapse them.

``capture_off``
    The dial resolved to something other than ``record``. Somebody decided
    this; the corpus is not being filled, so absence proves nothing.

``empty_corpus_for_org``
    The scope arm. ``/api/v1/operations/plans`` is **tenant**-scoped while
    ``agent.work_artifacts`` is **organization**-scoped (the calling user's
    personal organization, or the shared NULL bucket). An operator reading
    the console may simply not be the principal the body sync writes under,
    and the corpus carries no cross-org view — so "no artifact for this slug
    in *your* org" and "no artifact for this slug anywhere" are the same empty
    result. The cheap discriminator is corpus-level and computed ONCE per
    request, not per row: if this caller's org holds **zero** ``plan``
    artifacts, every miss on the page is ``"unknown"``. Without this arm the
    tri-state still manufactures a full page of false accusations, just for a
    different reason.

``unjoinable_row``
    coord served a row with no usable slug. There is no join key, so there is
    no answer — said out loud rather than rendered as a miss.

``no_org_principal``
    The request carried no credential the plan library can derive an
    organization from. ``/plans`` is gated on a coord-resolvable bearer, which
    is a WIDER door than the plan library's own dual-auth tree, so this is
    reachable without the route being unauthenticated. Scoping such a request
    to the shared NULL bucket would report one principal's corpus as
    another's, so it reports UNKNOWN instead.

A **hit** is always ``True``: an artifact row exists, whatever the dial says.
The reasons above govern misses only (and the first one governs everything,
because it means there were no reads).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.crud import work_artifact as crud
from app.models.user import User
from app.services.permissions import resolve_personal_organization

logger = structlog.get_logger(__name__)

#: The fleet-policy domain whose dial gates the scan-driven body sync.
PLAN_CAPTURE_DOMAIN = "plan_capture"

#: The one ``plan_capture`` level under which a join miss is evidence.
PLAN_CAPTURE_LIVE_LEVEL = "record"

#: The only artifact kind ``work_unit_slug`` is populated for. The runner's
#: ``body_push`` writes the stem ``(kind == ArtifactKind::Plan).then(...)``, so
#: every other kind carries a NULL link by construction — filtering on it is
#: not an optimisation, it is what makes the join key mean anything.
PLAN_ARTIFACT_KIND = "plan"

#: ``has_body``'s third value. A distinct string rather than ``None`` so that
#: "we could not establish this" is impossible to read as a missing field.
UNKNOWN: Literal["unknown"] = "unknown"

BodyProvenance = Literal["scanned", "scanned_locally", "never_scanned"]

BodyUnknownReason = Literal[
    "artifact_surface_unavailable",
    "capture_unreadable",
    "capture_never_configured",
    "capture_off",
    "empty_corpus_for_org",
    "unjoinable_row",
    "no_org_principal",
]

#: ``True`` | ``False`` | ``"unknown"``. See the module doc.
HasBody = bool | Literal["unknown"]

#: A path segment that makes provenance machine-local. A session worktree is
#: not a place another machine can resolve, so a ``source_path`` under one is
#: not the same claim as a canonical plans-directory path (Phase 5a).
_MACHINE_LOCAL_SEGMENT = "agent-worktrees"

#: The directory a canonical plan lives in, on every checkout of every repo
#: that holds one.
_CANONICAL_PLANS_SEGMENT = "plans"


def derive_body_provenance(metadata: object) -> BodyProvenance:
    """Classify what a scanner has (or has not) seen for this work unit.

    * ``never_scanned`` — no ``source_path``. The unit was created by a bare
      upsert, so no scanner ever saw a file for it. This is the screen.
    * ``scanned_locally`` — a ``source_path`` that is machine-local: under an
      ``agent-worktrees/`` segment, or simply not under a ``plans/``
      directory. Provenance no other machine can resolve, so it must not read
      as ``scanned`` (Phase 5a).
    * ``scanned`` — a ``source_path`` under a canonical ``plans/`` directory.

    ``metadata`` is coord's free-form JSON object and is typed ``object``
    because it genuinely is: coord applies no schema to it, so a non-mapping
    (or a non-string ``source_path``) is a shape this must survive rather than
    a case that cannot happen.
    """
    source_path: str | None = None
    if isinstance(metadata, Mapping):
        raw = metadata.get("source_path")
        if isinstance(raw, str) and raw.strip():
            source_path = raw.strip()
    if source_path is None:
        return "never_scanned"
    return "scanned" if _is_canonical_plans_path(source_path) else "scanned_locally"


def _is_canonical_plans_path(source_path: str) -> bool:
    """True for a path under a ``plans/`` directory and no session worktree.

    Both separators are folded because ``source_path`` is whatever the
    scanning machine recorded, and this fleet scans from Windows and Linux
    checkouts alike. Only the DIRECTORY segments are considered — a file
    literally named ``plans`` is not a plans directory.
    """
    segments = [
        s for s in source_path.replace("\\", "/").split("/") if s not in ("", ".", "..")
    ]
    directories = {s.lower() for s in segments[:-1]}
    if _MACHINE_LOCAL_SEGMENT in directories:
        return False
    return _CANONICAL_PLANS_SEGMENT in directories


@dataclass(frozen=True)
class CaptureDial:
    """The tenant's resolved ``plan_capture`` policy, as this module needs it.

    ``readable`` is separate from ``level`` on purpose. Coord folds
    ``master_enabled`` into ``effective_level``, so an unread dial and a dial
    that resolved to ``off`` would otherwise both arrive as "not record" —
    and they are different facts about the fleet, with different reason
    strings. Read it with :meth:`unreadable`, never by testing ``level is
    None``.
    """

    level: str | None
    resolved_scope: str | None
    readable: bool

    @classmethod
    def unreadable(cls) -> CaptureDial:
        return cls(level=None, resolved_scope=None, readable=False)


@dataclass(frozen=True)
class BodyKnowledge:
    """What this request could establish about bodies, for one page of rows.

    Built by :func:`resolve_body_knowledge`; every field is a fact that was
    measured, and ``None`` means "not measured" rather than zero.
    """

    #: Slugs on this page for which a ``plan`` artifact row exists.
    slugs_with_artifact: frozenset[str]
    #: Why a MISS on this page is ``"unknown"`` rather than ``False``.
    #: ``None`` means absence is evidence here and a miss is a genuine
    #: ``False``.
    miss_reason: BodyUnknownReason | None
    #: False when the artifact side could not be read at all, which makes
    #: EVERY row unknown rather than only the misses.
    artifact_surface_readable: bool
    capture: CaptureDial
    #: How many ``plan`` artifacts the caller's organization holds. ``None``
    #: when the surface was unreadable — never 0, which is a measurement.
    org_plan_artifact_count: int | None

    def has_body(self, slug: str | None) -> HasBody:
        """The tri-state verdict for one slug."""
        if not self.artifact_surface_readable:
            return UNKNOWN
        if not isinstance(slug, str) or not slug:
            return UNKNOWN
        if slug in self.slugs_with_artifact:
            return True
        return UNKNOWN if self.miss_reason is not None else False

    def unknown_reason(self, slug: str | None) -> BodyUnknownReason | None:
        """The machine-readable reason, set only when the answer is unknown."""
        if not self.artifact_surface_readable:
            # `miss_reason` IS the page-wide reason on this arm — reading it
            # rather than restating one keeps the two from disagreeing.
            return self.miss_reason
        if not isinstance(slug, str) or not slug:
            return "unjoinable_row"
        if slug in self.slugs_with_artifact:
            return None
        return self.miss_reason

    def as_signal_block(self) -> dict[str, Any]:
        """The once-per-page explanation, for the envelope.

        The per-row fields say WHAT; this says why, once, instead of the UI
        having to reconstruct a page-level fact from 500 identical tooltips.
        """
        return {
            "capture_level": self.capture.level,
            "capture_resolved_scope": self.capture.resolved_scope,
            "capture_readable": self.capture.readable,
            "artifact_surface_readable": self.artifact_surface_readable,
            "org_plan_artifact_count": self.org_plan_artifact_count,
            "miss_reason": self.miss_reason,
        }


def _miss_reason(
    capture: CaptureDial, org_plan_artifact_count: int
) -> BodyUnknownReason | None:
    """Why a join miss on this page cannot be read as ``False``.

    Ordered root-cause first. A dial that is off explains an empty corpus, so
    reporting the empty corpus instead would name the symptom; a dial that is
    ON with an empty corpus is the org-scope arm and nothing else.
    """
    if not capture.readable:
        return "capture_unreadable"
    if capture.resolved_scope == "none":
        return "capture_never_configured"
    if capture.level != PLAN_CAPTURE_LIVE_LEVEL:
        return "capture_off"
    if org_plan_artifact_count == 0:
        return "empty_corpus_for_org"
    return None


def _unresolvable(reason: BodyUnknownReason, capture: CaptureDial) -> BodyKnowledge:
    """The shape every "we could not read the artifact side" exit returns."""
    return BodyKnowledge(
        slugs_with_artifact=frozenset(),
        miss_reason=reason,
        artifact_surface_readable=False,
        capture=capture,
        org_plan_artifact_count=None,
    )


async def resolve_body_knowledge(
    db: AsyncSession,
    user: User | None,
    *,
    slugs: Sequence[str],
    capture: CaptureDial,
) -> BodyKnowledge:
    """Join one page of work-unit slugs against the caller's plan corpus.

    Two bounded queries, never N: one ``IN``-list over the page's slugs, and
    one count of the organization's ``plan`` artifacts (the discriminator that
    stops an operator whose org has never received a body-sync write from
    being shown a page of false accusations).

    Every failure on the artifact side — a broken session, a statement
    timeout, an organization lookup that blew up — lands on
    ``artifact_surface_unavailable`` and reports UNKNOWN. That is deliberately
    the SAME fail-closed reading ``plan_library._resolve_org_id`` applies when
    it answers 503 rather than silently scoping to the shared NULL bucket:
    reading a dependency failure as "no artifact" would turn a pool blip into
    a page of accusations. Here it must not 500 either — ``/plans`` renders
    the operator's whole work-unit list, and the honest degraded answer is the
    list with an unknown badge on every row.
    """
    joinable = sorted({s for s in slugs if isinstance(s, str) and s})
    if user is None:
        # No organization-scoped principal on this request. Not an error and
        # not an empty corpus — the join simply has no scope to run in.
        logger.info(
            "plan_body_signal.no_org_principal",
            slug_count=len(joinable),
            detail="reporting has_body=unknown rather than scoping to the "
            "shared NULL organization bucket",
        )
        return _unresolvable("no_org_principal", capture)
    try:
        org = await resolve_personal_organization(db, user.id)
        # ``None`` is a real scope (the shared NULL bucket), not an error —
        # the same reading ``plan_library`` gives it. What must NEVER reach
        # here is a FAILED lookup wearing that value, which is why the
        # non-swallowing resolver is the one called and why the ``except``
        # below is the only other exit.
        # ``Organization`` is a legacy-style model, so mypy types ``id`` as
        # ``Column[UUID]`` rather than ``UUID`` — the same cast
        # ``plan_library._resolve_org_id`` and ``known_issues.py`` make.
        org_id: UUID | None = org.id if org is not None else None  # type: ignore[assignment]
        corpus = await crud.count_artifacts(db, org_id=org_id, kind=PLAN_ARTIFACT_KIND)
        present = await crud.work_unit_slugs_with_artifacts(
            db, org_id=org_id, slugs=joinable, kind=PLAN_ARTIFACT_KIND
        )
    except Exception as exc:  # noqa: BLE001 — UNKNOWN is the answer, not a 500
        logger.warning(
            "plan_body_signal.artifact_surface_unavailable",
            user_id=str(getattr(user, "id", None)),
            slug_count=len(joinable),
            error=str(exc),
            detail="reporting has_body=unknown for every row rather than false",
        )
        return _unresolvable("artifact_surface_unavailable", capture)

    return BodyKnowledge(
        slugs_with_artifact=frozenset(present),
        miss_reason=_miss_reason(capture, corpus),
        artifact_surface_readable=True,
        capture=capture,
        org_plan_artifact_count=corpus,
    )
