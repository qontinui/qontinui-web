"""CRUD for the Plan & Prompt Library (``agent.work_artifacts``).

Phase 1 of ``2026-08-10-plan-and-prompt-library-in-web``.

Scoping contract
----------------
Every function takes ``org_id: UUID | None`` — the organization derived from
the authenticated principal by the endpoint layer, NEVER from a request body.
Rows are matched with the same NULL-collapsing expression the functional
unique index uses (``coalesce(organization_id, nil) = coalesce(:org, nil)``),
so a principal with no personal organization reads and writes the NULL
bucket consistently instead of seeing everything or nothing.

Upsert contract
---------------
``content_sha256`` is ALWAYS computed server-side from ``body``. When it
matches the stored digest the upsert is a **no-op**: ``current_version`` does
not move and no version row is appended. When it differs, the head row is
updated and a snapshot is appended in the SAME transaction.

Kind-lock contract (``plan_library_02_kind_lock``)
--------------------------------------------------
``upsert_artifact`` has TWO resolution modes, selected by
``kind_is_heuristic``:

* ``False`` (default — operator/agent/API writes): phase-1 behaviour. The
  target row is the EXACT identity ``(org, kind, slug, source_repo)``, and the
  write additionally sets ``kind_locked = True``, because a caller that names
  a kind is asserting it.
* ``True`` (the runner scanner, whose kind is a filename/body heuristic): the
  target row is resolved by ``(org, slug, source_repo)`` **ignoring kind**, so
  a corrected artifact is FOUND rather than forked into a second row. A locked
  row keeps its kind; an unlocked one lets the heuristic move it.

When the kind-less key matches more than one row (a corpus that already forked
before this fix), the resolver prefers the single ``kind_locked`` row if there
is exactly one, and otherwise raises :class:`AmbiguousArtifactKind` — the
scanner must NOT pick a winner silently. The endpoint turns that into a
structured 409 naming the candidate ids so ``/plan-library/divergent``
surfaces the fork instead.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Select,
    Text,
    cast,
    func,
    or_,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.work_artifact import (
    NIL_ORGANIZATION_ID,
    SEARCH_TSVECTOR_SQL,
    TERMINAL_STATUSES,
    WorkArtifact,
    WorkArtifactEdge,
    WorkArtifactVersion,
)

#: Relations traversed BACKWARDS to reconstruct the prompt chain that produced
#: a plan: ``investigation_prompt --produced_report--> report --feeds-->
#: plan_authoring_prompt --authored_plan--> plan``. ``supersedes`` and
#: ``depends_on`` are deliberately excluded — they relate peer artifacts, not
#: producers.
PROMPT_CHAIN_RELATIONS: tuple[str, ...] = (
    "authored_plan",
    "feeds",
    "produced_report",
)

#: Hard stop for the backwards prompt-chain walk. The graph is user-authored
#: and may contain cycles; the visited set already breaks them, this bounds a
#: pathological long chain as well.
_PROMPT_CHAIN_MAX_DEPTH = 10

_NON_ALNUM = re.compile(r"[^A-Z0-9]+")


class AmbiguousArtifactKind(Exception):
    """A kind-less resolution matched several rows with no locked winner.

    Raised by the scan-safe upsert path instead of picking one arbitrarily.
    Carries the candidate ids so the caller can name them in a 409 and the
    operator can fix the fork through ``/plan-library/divergent``.
    """

    def __init__(
        self,
        *,
        slug: str,
        source_repo: str | None,
        candidates: list[WorkArtifact],
    ) -> None:
        self.slug = slug
        self.source_repo = source_repo
        self.candidate_ids = [row.id for row in candidates]
        self.candidate_kinds = sorted({row.kind for row in candidates})
        super().__init__(
            f"slug={slug!r} source_repo={source_repo!r} resolves to "
            f"{len(candidates)} rows with kinds {self.candidate_kinds} and no "
            "single kind_locked row to prefer"
        )


class ArtifactKindConflict(Exception):
    """Setting a kind would collide with an existing row's identity.

    ``uq_work_artifacts_identity`` covers ``kind``, so re-kinding a row onto a
    ``(org, kind, slug, source_repo)`` that another row already occupies is a
    unique violation. Surfaced as a 409 naming the occupant rather than a 500.
    """

    def __init__(self, *, kind: str, slug: str, existing_id: UUID | None) -> None:
        self.kind = kind
        self.slug = slug
        self.existing_id = existing_id
        super().__init__(
            f"another artifact already occupies kind={kind!r} slug={slug!r}"
            + (f" (id={existing_id})" if existing_id is not None else "")
        )


def normalize_status(status: str | None) -> str:
    """Fold an opaque status onto its comparison form.

    Uppercase, every run of non-alphanumerics collapsed to ``_``, edges
    trimmed — so ``"IN PROGRESS"``, ``"in-progress"`` and ``"In_Progress"``
    all compare equal. Mirrors the SQL expression :func:`_normalized_status`
    builds, and the two MUST stay in step.
    """
    return _NON_ALNUM.sub("_", (status or "").upper()).strip("_")


def _normalized_status() -> ColumnElement[str]:
    """The SQL twin of :func:`normalize_status`, over ``WorkArtifact.status``."""
    return func.btrim(
        func.regexp_replace(func.upper(WorkArtifact.status), "[^A-Z0-9]+", "_", "g"),
        "_",
    )


def is_terminal_status(status: str | None) -> bool:
    """True when this opaque status reads as "done"."""
    return normalize_status(status) in TERMINAL_STATUSES


def compute_content_sha256(body: str) -> str:
    """The canonical digest for an artifact body.

    Hex sha256 of the UTF-8 bytes. Named for the algorithm (see the model's
    ``content_sha256`` comment) so no reader has to guess which digest a
    ``checksum``/``content_hash`` column holds.
    """
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _org_scope(org_id: UUID | None):
    """The NULL-collapsing organization predicate.

    Mirrors ``uq_work_artifacts_identity``'s leading expression exactly.
    """
    return func.coalesce(
        WorkArtifact.organization_id, NIL_ORGANIZATION_ID
    ) == func.coalesce(org_id, NIL_ORGANIZATION_ID)


def _apply_filters(
    stmt: Select,
    *,
    org_id: UUID | None,
    kind: str | None,
    status: str | None,
    repo: str | None,
    q: str | None,
    since: datetime | None,
    work_unit_slug: str | None,
) -> Select:
    """Apply the shared list/count filters to a statement."""
    stmt = stmt.where(_org_scope(org_id))
    if kind is not None:
        stmt = stmt.where(WorkArtifact.kind == kind)
    if status is not None:
        # Opaque comparison — whatever string the caller sends is matched
        # verbatim. An unknown status yields an empty page, never a 422.
        stmt = stmt.where(WorkArtifact.status == status)
    if repo is not None:
        # A repo matches either the repos[] array or the originating repo.
        # Spelled as the array-containment operator ``@>`` rather than
        # ``= ANY(repos)``: ``@>`` is the one GIN can serve from
        # ix_work_artifacts_repos, ``= ANY`` forces a sequential scan.
        stmt = stmt.where(
            or_(
                WorkArtifact.repos.op("@>")(cast([repo], ARRAY(Text))),
                WorkArtifact.source_repo == repo,
            )
        )
    if q:
        # Spelled to match ix_work_artifacts_search's indexed expression.
        stmt = stmt.where(
            text(
                f"{SEARCH_TSVECTOR_SQL} @@ plainto_tsquery('english', :plan_lib_q)"
            ).bindparams(plan_lib_q=q)
        )
    if since is not None:
        stmt = stmt.where(WorkArtifact.updated_at >= since)
    if work_unit_slug is not None:
        stmt = stmt.where(WorkArtifact.work_unit_slug == work_unit_slug)
    return stmt


async def list_artifacts(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str | None = None,
    status: str | None = None,
    repo: str | None = None,
    q: str | None = None,
    since: datetime | None = None,
    work_unit_slug: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[WorkArtifact], int]:
    """A filtered page of artifacts plus the unpaged total."""
    base = _apply_filters(
        select(WorkArtifact),
        org_id=org_id,
        kind=kind,
        status=status,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
    )

    count_stmt = _apply_filters(
        select(func.count()).select_from(WorkArtifact),
        org_id=org_id,
        kind=kind,
        status=status,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
    )
    total = int((await db.execute(count_stmt)).scalar_one())

    rows = (
        (
            await db.execute(
                base.order_by(WorkArtifact.updated_at.desc(), WorkArtifact.id.desc())
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows), total


async def get_artifact(
    db: AsyncSession, artifact_id: UUID, *, org_id: UUID | None
) -> WorkArtifact | None:
    """One artifact, scoped to the caller's organization bucket."""
    stmt = select(WorkArtifact).where(
        WorkArtifact.id == artifact_id, _org_scope(org_id)
    )
    return (await db.execute(stmt)).scalars().first()


async def get_by_identity(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str,
    slug: str,
    source_repo: str | None,
) -> WorkArtifact | None:
    """Look a row up by the functional unique key."""
    stmt = select(WorkArtifact).where(
        _org_scope(org_id),
        WorkArtifact.kind == kind,
        WorkArtifact.slug == slug,
        func.coalesce(WorkArtifact.source_repo, "") == (source_repo or ""),
    )
    return (await db.execute(stmt)).scalars().first()


async def list_by_scan_identity(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    slug: str,
    source_repo: str | None,
) -> list[WorkArtifact]:
    """Every row matching ``(org, slug, source_repo)`` — ``kind`` IGNORED.

    This is the scanner's resolution key. Phase 1's identity index includes
    ``kind``, so a corrected artifact is invisible to a re-scan that
    re-derives the heuristic kind; keying without ``kind`` finds it.

    Returns a list, not one row, because an already-forked corpus legitimately
    has several. Ordered ``kind_locked`` first (the preferred winner), then
    oldest-first so the ordering is stable for the ambiguity report.
    """
    stmt = (
        select(WorkArtifact)
        .where(
            _org_scope(org_id),
            WorkArtifact.slug == slug,
            func.coalesce(WorkArtifact.source_repo, "") == (source_repo or ""),
        )
        .order_by(
            WorkArtifact.kind_locked.desc(),
            WorkArtifact.created_at,
            WorkArtifact.id,
        )
    )
    return list((await db.execute(stmt)).scalars().all())


def resolve_scan_target(
    matches: list[WorkArtifact], *, slug: str, source_repo: str | None
) -> WorkArtifact | None:
    """Pick the single row a heuristic-kind scan should update.

    * no match          → ``None`` (the caller inserts).
    * exactly one match → that row.
    * several matches   → the ONE ``kind_locked`` row if there is exactly one;
      otherwise :class:`AmbiguousArtifactKind`.

    The "several matches" case is a corpus that forked before the kind-lock
    fix landed (or a genuine same-slug/different-kind pair). Picking
    arbitrarily would let the scanner silently overwrite whichever copy it
    happened to sort first, so it refuses — the fork stays visible in
    ``/plan-library/divergent`` and the rows are left untouched.
    """
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    locked = [row for row in matches if row.kind_locked]
    if len(locked) == 1:
        return locked[0]
    raise AmbiguousArtifactKind(slug=slug, source_repo=source_repo, candidates=matches)


async def list_versions(
    db: AsyncSession, artifact_id: UUID
) -> list[WorkArtifactVersion]:
    """Every snapshot of an artifact, oldest first."""
    stmt = (
        select(WorkArtifactVersion)
        .where(WorkArtifactVersion.document_id == artifact_id)
        .order_by(WorkArtifactVersion.version_number)
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_version(
    db: AsyncSession, artifact_id: UUID, version_number: int
) -> WorkArtifactVersion | None:
    """One specific snapshot of an artifact, or ``None`` if it does not exist.

    Plan ``2026-08-16-plan-corpus-authority-and-run-provenance`` Phase 4 — the
    export can address a historical ``version_number``, not just head. Callers
    MUST scope the parent artifact to the caller's organization before calling
    this: ``document_id`` alone is not an authorization boundary.
    """
    stmt = select(WorkArtifactVersion).where(
        WorkArtifactVersion.document_id == artifact_id,
        WorkArtifactVersion.version_number == version_number,
    )
    return (await db.execute(stmt)).scalars().first()


async def list_for_export(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str | None = None,
    status: str | None = None,
    repo: str | None = None,
    q: str | None = None,
    since: datetime | None = None,
    work_unit_slug: str | None = None,
    limit: int,
) -> tuple[list[WorkArtifact], bool]:
    """Rows for a bulk export, plus whether ``limit`` truncated the result.

    Plan ``2026-08-16-plan-corpus-authority-and-run-provenance`` Phase 4.

    Shares :func:`_apply_filters` with :func:`list_artifacts` on purpose, so
    "export what I am looking at" is literally the same predicate as the list
    the operator page renders — an export whose filter grammar drifted from the
    list's would silently omit rows the caller believed were selected.

    Returns ``(rows, truncated)``. The bound is reported rather than applied
    silently: a bulk export that quietly stopped at N looks exactly like a
    corpus of N, and the caller cannot tell the difference. The route turns
    ``truncated`` into an explicit response header.
    """
    base = _apply_filters(
        select(WorkArtifact),
        org_id=org_id,
        kind=kind,
        status=status,
        repo=repo,
        q=q,
        since=since,
        work_unit_slug=work_unit_slug,
    )
    # Fetch one MORE than asked for: the presence of row limit+1 is what proves
    # truncation. A separate COUNT would race the SELECT on a live corpus.
    rows = list(
        (
            await db.execute(
                base.order_by(
                    WorkArtifact.kind, WorkArtifact.slug, WorkArtifact.id
                ).limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    truncated = len(rows) > limit
    return rows[:limit], truncated


async def list_edges(
    db: AsyncSession, artifact_id: UUID
) -> list[tuple[WorkArtifactEdge, str, WorkArtifact | None]]:
    """Edges touching ``artifact_id`` in BOTH directions.

    Returns ``(edge, direction, peer)`` triples where ``direction`` is
    ``"outgoing"`` when the artifact is the edge's ``from_id`` and
    ``"incoming"`` when it is the ``to_id``, and ``peer`` is the artifact at
    the far end (``None`` should not happen — the FKs cascade — but the read
    tolerates it rather than 500ing).
    """
    stmt = (
        select(WorkArtifactEdge)
        .where(
            or_(
                WorkArtifactEdge.from_id == artifact_id,
                WorkArtifactEdge.to_id == artifact_id,
            )
        )
        .order_by(WorkArtifactEdge.created_at, WorkArtifactEdge.id)
    )
    edges = list((await db.execute(stmt)).scalars().all())
    if not edges:
        return []

    peer_ids = {(e.to_id if e.from_id == artifact_id else e.from_id) for e in edges}
    peers = {
        row.id: row
        for row in (
            await db.execute(select(WorkArtifact).where(WorkArtifact.id.in_(peer_ids)))
        )
        .scalars()
        .all()
    }

    out: list[tuple[WorkArtifactEdge, str, WorkArtifact | None]] = []
    for edge in edges:
        if edge.from_id == artifact_id:
            out.append((edge, "outgoing", peers.get(edge.to_id)))
        else:
            out.append((edge, "incoming", peers.get(edge.from_id)))
    return out


async def upsert_artifact(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    user_id: UUID | None,
    kind: str,
    slug: str,
    title: str,
    status: str,
    body: str,
    source_path: str | None,
    source_repo: str | None,
    work_unit_slug: str | None,
    repos: list[str],
    authored_at: datetime | None,
    captured_by: str,
    change_description: str | None,
    created_by: str | None = None,
    kind_is_heuristic: bool = False,
) -> tuple[WorkArtifact, bool, bool]:
    """Insert-or-update by the functional unique key.

    Returns ``(artifact, created, changed)``.

    * A brand-new key inserts the head row AND its version-1 snapshot →
      ``(row, True, True)``.
    * An existing key whose body hashes to the stored digest is a **no-op**:
      ``current_version`` is untouched and no snapshot is appended →
      ``(row, False, False)``. Content metadata is deliberately NOT written on
      a no-op; the digest is the whole contract. The ONE exception is
      ``kind_locked`` (see below), which is an assertion about identity rather
      than content.
    * An existing key with different content bumps ``current_version``,
      rewrites the head row's metadata and appends a snapshot in the same
      transaction → ``(row, False, True)``.

    ``kind_is_heuristic``
        ``False`` (default) — an operator/agent write. Target resolution is
        the phase-1 EXACT identity, and the write SETS ``kind_locked`` because
        the caller is asserting the kind. That is what makes a correction
        survive later scans.

        ``True`` — a runner scan whose kind came from a filename/body
        heuristic. Target resolution IGNORES ``kind`` (see
        :func:`list_by_scan_identity`); a ``kind_locked`` row keeps its kind,
        an unlocked one lets the heuristic move it, and a missing row is
        inserted unlocked. Raises :class:`AmbiguousArtifactKind` rather than
        guessing when the kind-less key matches several rows.
    """
    digest = compute_content_sha256(body)

    if kind_is_heuristic:
        matches = await list_by_scan_identity(
            db, org_id=org_id, slug=slug, source_repo=source_repo
        )
        # Raises AmbiguousArtifactKind on an unresolvable fork — deliberately
        # NOT caught here: no row is touched and the endpoint 409s.
        existing = resolve_scan_target(matches, slug=slug, source_repo=source_repo)
    else:
        existing = await get_by_identity(
            db, org_id=org_id, kind=kind, slug=slug, source_repo=source_repo
        )

    if existing is None:
        artifact = WorkArtifact(
            organization_id=org_id,
            created_by_user_id=user_id,
            kind=kind,
            # A heuristic kind is a guess and must stay correctable; an
            # explicit one is an assertion and locks immediately.
            kind_locked=not kind_is_heuristic,
            slug=slug,
            title=title,
            status=status,
            body=body,
            content_sha256=digest,
            source_path=source_path,
            source_repo=source_repo,
            work_unit_slug=work_unit_slug,
            repos=list(repos),
            authored_at=authored_at,
            captured_by=captured_by,
            current_version=1,
        )
        db.add(artifact)
        try:
            await db.flush()
        except IntegrityError:
            # A concurrent writer won the race on uq_work_artifacts_identity.
            # Roll back to a clean session and fall through to the update
            # path against the row they inserted.
            await db.rollback()
            if kind_is_heuristic:
                existing = resolve_scan_target(
                    await list_by_scan_identity(
                        db, org_id=org_id, slug=slug, source_repo=source_repo
                    ),
                    slug=slug,
                    source_repo=source_repo,
                )
            else:
                existing = await get_by_identity(
                    db, org_id=org_id, kind=kind, slug=slug, source_repo=source_repo
                )
            if existing is None:  # pragma: no cover — the row must exist now
                raise
        else:
            db.add(
                WorkArtifactVersion(
                    document_id=artifact.id,
                    version_number=1,
                    body=body,
                    content_sha256=digest,
                    change_description=change_description or "initial capture",
                    created_by=created_by,
                )
            )
            await db.commit()
            await db.refresh(artifact)
            return artifact, True, True

    assert existing is not None  # narrowed by both branches above

    if existing.content_sha256 == digest:
        # 304-equivalent: no version bump, no snapshot, no content write.
        #
        # ``kind_locked`` is the ONE field still written here, and only in the
        # False → True direction on an explicit write. The lock records that a
        # caller ASSERTED this kind; that assertion is independent of whether
        # the body happened to change, and dropping it on a re-post would let
        # the very next scan un-stick a correction.
        if not kind_is_heuristic and not existing.kind_locked:
            existing.kind_locked = True
            await db.commit()
            await db.refresh(existing)
        return existing, False, False

    # Content differs, so a version row is about to be appended. Take a row
    # lock and re-read first: two writers that both saw current_version=1
    # would both try to insert version 2 and one would die on
    # uq_work_artifact_versions_doc_version. Under the lock the loser sees
    # the winner's digest and either no-ops or bumps to 3.
    await db.refresh(existing, with_for_update=True)
    if existing.content_sha256 == digest:
        if not kind_is_heuristic and not existing.kind_locked:
            existing.kind_locked = True
            await db.commit()
            await db.refresh(existing)
        return existing, False, False

    # Whether this write may move ``kind``. Evaluated AFTER the row lock, not
    # before: a concurrent correction that landed while we were resolving is
    # visible only in the re-read, and honouring the pre-lock value would let
    # this scan overwrite it.
    may_move_kind = not (kind_is_heuristic and existing.kind_locked)

    if may_move_kind and existing.kind != kind:
        # Only reachable on the heuristic path against an UNLOCKED row: the
        # exact-identity lookup can never hand back a differing kind. Moving
        # onto a kind another row already occupies would violate
        # uq_work_artifacts_identity — report it rather than 500.
        clash = await get_by_identity(
            db, org_id=org_id, kind=kind, slug=slug, source_repo=source_repo
        )
        if clash is not None and clash.id != existing.id:
            raise ArtifactKindConflict(kind=kind, slug=slug, existing_id=clash.id)
        existing.kind = kind
    if not kind_is_heuristic:
        existing.kind_locked = True

    existing.current_version += 1
    existing.title = title
    existing.status = status
    existing.body = body
    existing.content_sha256 = digest
    existing.source_path = source_path
    existing.work_unit_slug = work_unit_slug
    existing.repos = list(repos)
    existing.authored_at = authored_at
    existing.captured_by = captured_by
    existing.updated_at = datetime.now(UTC)

    db.add(
        WorkArtifactVersion(
            document_id=existing.id,
            version_number=existing.current_version,
            body=body,
            content_sha256=digest,
            change_description=change_description,
            created_by=created_by,
        )
    )
    await db.commit()
    await db.refresh(existing)
    return existing, False, True


async def set_artifact_kind(
    db: AsyncSession, artifact: WorkArtifact, *, kind: str, org_id: UUID | None
) -> WorkArtifact:
    """Correct an artifact's ``kind`` and LOCK it against future scans.

    The lock is set unconditionally — even when ``kind`` is unchanged — because
    the point of this door is to record that a human/agent asserted the kind,
    which is exactly what stops the next heuristic scan from moving it.

    Raises :class:`ArtifactKindConflict` when another row already occupies
    ``(org, kind, slug, source_repo)``; that is a genuine identity collision
    (``uq_work_artifacts_identity`` covers ``kind``) and merging the two rows
    is an operator decision, not something this write may guess at.
    """
    if artifact.kind != kind:
        clash = await get_by_identity(
            db,
            org_id=org_id,
            kind=kind,
            slug=artifact.slug,
            source_repo=artifact.source_repo,
        )
        if clash is not None and clash.id != artifact.id:
            raise ArtifactKindConflict(
                kind=kind, slug=artifact.slug, existing_id=clash.id
            )
        artifact.kind = kind

    artifact.kind_locked = True
    artifact.updated_at = datetime.now(UTC)
    try:
        await db.commit()
    except IntegrityError as exc:
        # A concurrent writer took the target identity between the check and
        # the commit. Same conflict, reported the same way.
        await db.rollback()
        raise ArtifactKindConflict(
            kind=kind, slug=artifact.slug, existing_id=None
        ) from exc
    await db.refresh(artifact)
    return artifact


async def create_edge(
    db: AsyncSession,
    *,
    from_artifact: WorkArtifact,
    to_artifact: WorkArtifact,
    relation: str,
    note: str | None,
    created_by: str | None,
) -> tuple[WorkArtifactEdge, bool]:
    """Create one edge, or return the existing identical one.

    Returns ``(edge, created)``. Re-posting the same
    ``(from, to, relation)`` triple is idempotent rather than a 409 — the
    library is fed by repeatable scans.
    """
    stmt = select(WorkArtifactEdge).where(
        WorkArtifactEdge.from_id == from_artifact.id,
        WorkArtifactEdge.to_id == to_artifact.id,
        WorkArtifactEdge.relation == relation,
    )
    found = (await db.execute(stmt)).scalars().first()
    if found is not None:
        return found, False

    edge = WorkArtifactEdge(
        from_id=from_artifact.id,
        to_id=to_artifact.id,
        relation=relation,
        note=note,
        created_by=created_by,
    )
    db.add(edge)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        found = (await db.execute(stmt)).scalars().first()
        if found is None:  # pragma: no cover — the row must exist now
            raise
        return found, False
    await db.refresh(edge)
    return edge, True


async def capture_health(
    db: AsyncSession, *, org_id: UUID | None
) -> list[tuple[str, int, datetime | None, datetime | None]]:
    """Per-``captured_by`` corpus census: ``(door, count, first, last_touched)``.

    The question this answers is "is the AGENT door being used, or is the
    scanner the only thing feeding the store?" — so the count alone is not
    enough. Three artifacts captured by an agent in March and none since is a
    door that WAS used, not one that is; recency is what separates the two,
    and ``first`` dates the door's opening.

    ⚠️ The recency figure is ``max(updated_at)``, which is a LAST-TOUCHED
    timestamp, not a last-captured one: any later mutation bumps it, so an
    operator's kind correction on a scanner-captured row moves the
    ``runner_scan`` door's date without the scanner having written anything.
    It is named ``last_touched`` all the way to the UI for exactly that reason
    — calling it "last write" would overstate what the column knows.

    Returns only the doors actually present in the data. Folding in the
    never-used ones (as explicit zeros, which is the honest rendering) is the
    endpoint's job — the vocabulary lives in the schema layer, not here.
    """
    stmt = (
        select(
            WorkArtifact.captured_by,
            # NOT labelled ``count``: ``Row`` is a tuple, so ``row.count`` would
            # resolve to ``tuple.count`` (the method) rather than the column.
            func.count().label("artifact_count"),
            func.min(WorkArtifact.created_at).label("first_at"),
            func.max(WorkArtifact.updated_at).label("last_touched_at"),
        )
        .where(_org_scope(org_id))
        .group_by(WorkArtifact.captured_by)
        .order_by(WorkArtifact.captured_by)
    )
    return [
        (row.captured_by, int(row.artifact_count), row.first_at, row.last_touched_at)
        for row in (await db.execute(stmt)).all()
    ]


async def find_divergent(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    kind: str | None = None,
) -> list[tuple[str, str, list[WorkArtifact]]]:
    """``(kind, slug)`` groups whose copies disagree on ``content_sha256``.

    A plan mirrored into two repos, or scanned from two checkouts, produces
    two rows sharing ``(kind, slug)`` but with different digests — that is
    the drift the library exists to surface.
    """
    group_stmt = (
        select(WorkArtifact.kind, WorkArtifact.slug)
        .where(_org_scope(org_id))
        .group_by(WorkArtifact.kind, WorkArtifact.slug)
        .having(func.count(func.distinct(WorkArtifact.content_sha256)) > 1)
        .order_by(WorkArtifact.kind, WorkArtifact.slug)
    )
    if kind is not None:
        group_stmt = group_stmt.where(WorkArtifact.kind == kind)

    groups = list((await db.execute(group_stmt)).all())
    if not groups:
        return []

    keys = {(g.kind, g.slug) for g in groups}
    rows_stmt = (
        select(WorkArtifact)
        .where(
            _org_scope(org_id),
            WorkArtifact.kind.in_({k for k, _ in keys}),
            WorkArtifact.slug.in_({s for _, s in keys}),
        )
        .order_by(WorkArtifact.kind, WorkArtifact.slug, WorkArtifact.updated_at.desc())
    )
    rows = (await db.execute(rows_stmt)).scalars().all()

    buckets: dict[tuple[str, str], list[WorkArtifact]] = {k: [] for k in keys}
    for row in rows:
        # The IN x IN product can pull in a (kind, slug) pair that is not
        # itself divergent; keep only the real groups.
        bucket = buckets.get((row.kind, row.slug))
        if bucket is not None:
            bucket.append(row)

    return [(g.kind, g.slug, buckets[(g.kind, g.slug)]) for g in groups]


async def find_kind_forks(
    db: AsyncSession, *, org_id: UUID | None
) -> list[tuple[str, str | None, list[WorkArtifact]]]:
    """``(slug, source_repo)`` keys carrying MORE THAN ONE ``kind``.

    The fork class the kind-lock fix exists to prevent, and the one a scanner
    now refuses to resolve (:class:`AmbiguousArtifactKind`). Reported
    separately from :func:`find_divergent` — which groups by ``(kind, slug)``
    and therefore cannot see a fork whose whole distinguishing feature is that
    the kinds differ.

    Returns ``(slug, source_repo, rows)`` with ``rows`` ordered locked-first so
    the operator can see immediately whether a winner already exists.
    """
    # ONE Label object reused across SELECT / GROUP BY / ORDER BY. Spelling
    # ``coalesce(source_repo, '')`` three times instead would emit three
    # DIFFERENT bind parameters ($4, $5, $6), and PostgreSQL compares grouped
    # expressions node-by-node — so the ORDER BY copy would not match the
    # GROUP BY copy and the query fails with "source_repo must appear in the
    # GROUP BY clause". (Observed, not theorised.)
    repo_key = func.coalesce(WorkArtifact.source_repo, "").label("repo_key")
    group_stmt = (
        select(WorkArtifact.slug, repo_key)
        .where(_org_scope(org_id))
        .group_by(WorkArtifact.slug, repo_key)
        .having(func.count(func.distinct(WorkArtifact.kind)) > 1)
        .order_by(WorkArtifact.slug, repo_key)
    )
    groups = list((await db.execute(group_stmt)).all())
    if not groups:
        return []

    keys = {(g.slug, g.repo_key) for g in groups}
    rows_stmt = (
        select(WorkArtifact)
        .where(
            _org_scope(org_id),
            WorkArtifact.slug.in_({s for s, _ in keys}),
        )
        .order_by(
            WorkArtifact.slug,
            WorkArtifact.kind_locked.desc(),
            WorkArtifact.kind,
            WorkArtifact.id,
        )
    )
    rows = (await db.execute(rows_stmt)).scalars().all()

    buckets: dict[tuple[str, str], list[WorkArtifact]] = {k: [] for k in keys}
    for row in rows:
        # The slug IN-list can pull in a (slug, repo) pair that is not itself
        # forked; keep only the real groups.
        bucket = buckets.get((row.slug, row.source_repo or ""))
        if bucket is not None:
            bucket.append(row)

    return [(g.slug, g.repo_key or None, buckets[(g.slug, g.repo_key)]) for g in groups]


# ===========================================================================
# Candidate selection (Phase 6) — SIGNALS ONLY, no score
# ===========================================================================
#
# Design decision D6: this read exposes the ranking INPUTS and the AGENT
# ranks. No criticality score, no weighting, no "priority" column — a
# hardcoded score would be a guess frozen into SQL, and every consumer would
# then be arguing with the guess instead of with the evidence.


async def list_plan_candidates(
    db: AsyncSession,
    *,
    org_id: UUID | None,
    offset: int = 0,
    limit: int = 25,
) -> tuple[list[WorkArtifact], int]:
    """Unshipped ``kind='plan'`` artifacts, oldest-vetted-first.

    "Unshipped" reads the OPAQUE ``status`` through
    :func:`normalize_status` against
    :data:`app.models.work_artifact.TERMINAL_STATUSES`. An unrecognised status
    counts as not-yet-shipped — the library mirrors what the fleet wrote and
    an unknown word must not silently hide a plan.

    Ordering is a STABLE DEFAULT and nothing more:
    ``coalesce(authored_at, created_at) ASC, id ASC``. ``authored_at`` is the
    plan's own front-matter timestamp when the scanner captured one, falling
    back to when the library first saw it; ``id`` breaks ties so paging is
    deterministic. There is no scoring pass.
    """
    base = select(WorkArtifact).where(
        _org_scope(org_id),
        WorkArtifact.kind == "plan",
        _normalized_status().not_in(tuple(sorted(TERMINAL_STATUSES))),
    )
    count_stmt = select(func.count()).select_from(base.order_by(None).subquery())
    total = int((await db.execute(count_stmt)).scalar_one())

    order_key = func.coalesce(WorkArtifact.authored_at, WorkArtifact.created_at)
    rows = (
        (
            await db.execute(
                base.order_by(order_key.asc(), WorkArtifact.id.asc())
                .offset(offset)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return list(rows), total


async def load_depends_on(
    db: AsyncSession, artifact_ids: list[UUID]
) -> dict[UUID, list[WorkArtifact]]:
    """``depends_on`` edge TARGETS per artifact, keyed by the dependent's id.

    Every target is returned; the caller filters to the UNMET ones with
    :func:`is_terminal_status` so the "met" reading stays in one place.
    """
    if not artifact_ids:
        return {}

    stmt = (
        select(WorkArtifactEdge.from_id, WorkArtifact)
        .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.to_id)
        .where(
            WorkArtifactEdge.from_id.in_(artifact_ids),
            WorkArtifactEdge.relation == "depends_on",
        )
        .order_by(WorkArtifactEdge.from_id, WorkArtifact.slug, WorkArtifact.id)
    )
    out: dict[UUID, list[WorkArtifact]] = {aid: [] for aid in artifact_ids}
    for from_id, target in (await db.execute(stmt)).all():
        out.setdefault(from_id, []).append(target)
    return out


async def load_prompt_chains(
    db: AsyncSession, artifact_ids: list[UUID]
) -> dict[UUID, list[tuple[WorkArtifact, str, int]]]:
    """Walk :data:`PROMPT_CHAIN_RELATIONS` BACKWARDS from each artifact.

    A plan's provenance runs ``investigation_prompt --produced_report-->
    investigation_report --feeds--> plan_authoring_prompt --authored_plan-->
    plan``, so reconstructing "what produced this plan" means following those
    edges from ``to_id`` toward ``from_id``.

    Returns ``{artifact_id: [(producer, relation, depth), ...]}`` ordered
    nearest-first (depth 1 = the artifact that directly produced the plan).
    Cycles are broken by a per-root visited set and the walk is capped at
    :data:`_PROMPT_CHAIN_MAX_DEPTH` levels — the graph is user-authored, so
    neither guarantee can be assumed away.

    Implemented as one query per LEVEL (not per artifact): every root advances
    together, so a page of N candidates with a chain of depth D costs D
    queries, not N*D.
    """
    if not artifact_ids:
        return {}

    chains: dict[UUID, list[tuple[WorkArtifact, str, int]]] = {
        aid: [] for aid in artifact_ids
    }
    # Per ROOT, the ids already emitted (plus the root itself) — a shared
    # visited set would let one root's traversal starve another's.
    seen: dict[UUID, set[UUID]] = {aid: {aid} for aid in artifact_ids}
    # The frontier: node id → the roots still expanding through it.
    frontier: dict[UUID, set[UUID]] = {aid: {aid} for aid in artifact_ids}

    for depth in range(1, _PROMPT_CHAIN_MAX_DEPTH + 1):
        if not frontier:
            break
        stmt = (
            select(WorkArtifactEdge.to_id, WorkArtifactEdge.relation, WorkArtifact)
            .join(WorkArtifact, WorkArtifact.id == WorkArtifactEdge.from_id)
            .where(
                WorkArtifactEdge.to_id.in_(list(frontier)),
                WorkArtifactEdge.relation.in_(PROMPT_CHAIN_RELATIONS),
            )
            .order_by(WorkArtifactEdge.to_id, WorkArtifact.kind, WorkArtifact.id)
        )
        next_frontier: dict[UUID, set[UUID]] = {}
        for child_id, relation, producer in (await db.execute(stmt)).all():
            for root in frontier.get(child_id, ()):
                if producer.id in seen[root]:
                    continue
                seen[root].add(producer.id)
                chains[root].append((producer, relation, depth))
                next_frontier.setdefault(producer.id, set()).add(root)
        frontier = next_frontier

    return chains
