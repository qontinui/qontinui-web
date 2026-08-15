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
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Select, Text, cast, func, or_, select, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.work_artifact import (
    NIL_ORGANIZATION_ID,
    SEARCH_TSVECTOR_SQL,
    WorkArtifact,
    WorkArtifactEdge,
    WorkArtifactVersion,
)


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
) -> tuple[WorkArtifact, bool, bool]:
    """Insert-or-update by the functional unique key.

    Returns ``(artifact, created, changed)``.

    * A brand-new key inserts the head row AND its version-1 snapshot →
      ``(row, True, True)``.
    * An existing key whose body hashes to the stored digest is a **no-op**:
      ``current_version`` is untouched and no snapshot is appended →
      ``(row, False, False)``. Metadata differences are deliberately NOT
      written on a no-op; the digest is the whole contract.
    * An existing key with different content bumps ``current_version``,
      rewrites the head row's metadata and appends a snapshot in the same
      transaction → ``(row, False, True)``.
    """
    digest = compute_content_sha256(body)

    existing = await get_by_identity(
        db, org_id=org_id, kind=kind, slug=slug, source_repo=source_repo
    )

    if existing is None:
        artifact = WorkArtifact(
            organization_id=org_id,
            created_by_user_id=user_id,
            kind=kind,
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
        # 304-equivalent. No version bump, no snapshot, no metadata write.
        return existing, False, False

    # Content differs, so a version row is about to be appended. Take a row
    # lock and re-read first: two writers that both saw current_version=1
    # would both try to insert version 2 and one would die on
    # uq_work_artifact_versions_doc_version. Under the lock the loser sees
    # the winner's digest and either no-ops or bumps to 3.
    await db.refresh(existing, with_for_update=True)
    if existing.content_sha256 == digest:
        return existing, False, False

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
