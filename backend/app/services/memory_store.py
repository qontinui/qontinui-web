"""Data access for ``coord.memory_records`` — the tenant agentic memory.

Phases 1 + 4 + 5 of
``D:/qontinui-root/plans/2026-07-10-tenant-agentic-memory-web-backend.md``.

ALL SQL touching the memory substrate (``coord.memory_records`` +
``coord.tenant_policies`` quota knobs, plus the Phase 4 lifecycle
sweeps and the Phase 5 ``coord.memories_latest`` bridge reads) lives in
this one module, which is vetted into ``WRITE_PATH_FOLLOWUP`` in
``tests/test_coord_schema_boundary_guard.py``: web owns this substrate
(its schema ships in web's own alembic migration
``coord_memory_records``), so the memory API reads/writes it directly
over web's shared-Postgres session — the same posture as the
``Device`` / ``TestTarget`` write paths. Keeping every ``coord.*``
literal here keeps the boundary-guard allowlist to a single entry.

Schema reference: ``backend/alembic/versions/coord_memory_records.py``
(and ``coord_memories.py`` / ``coord_tenant_scope_columns.py`` for the
``coord.memories_latest`` view the MEMORY.md bridge mirrors).

Lifecycle SQL discipline: the decay sweep's retention-score expression
mirrors the pure-Python :func:`app.services.memory_lifecycle.retention_score`
formula exactly; ``tests/test_memory_lifecycle_db.py`` asserts the two
agree on seeded rows.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

import structlog
from sqlalchemy import CursorResult, Float, Text, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.memory import (
    MEMORY_KINDS,
    MEMORY_SCOPES,
    RECENT_TITLES_SAMPLE,
)
from app.services.memory_lifecycle import (
    DECAY_ACCESS_CAP,
    DECAY_BASE_HORIZON_DAYS,
    SYNTHESIS_IMPORTANCE_BONUS,
    ClusterItem,
    DupCandidate,
    MergeDecision,
    job_input_hash,
    synthesized_title,
)
from app.services.memory_redaction import log_redactions, redact_text

logger = structlog.get_logger(__name__)

# Mirror the migration's tenant_policies column defaults — used when the
# tenant has no ``coord.tenant_policies`` row (COALESCE on a LEFT JOIN,
# so a missing policy row means "the defaults", never a failure).
DEFAULT_MEMORY_QUOTA_BYTES = 256 * 1024 * 1024
DEFAULT_MEMORY_ROW_QUOTA = 500_000

# How many candidates each retrieval arm contributes to RRF fusion.
ARM_LIMIT = 50

# Scopes that are only visible when the caller explicitly requests them
# AND supplies the matching ``scope_ref``.
NARROW_SCOPES = ("agent", "session")

# The liveness predicate of the ``uq_memory_records_tenant_content_hash_live``
# partial unique index (see the ``coord_memory_records`` migration): only
# LIVE rows participate in content-hash dedup, so tombstoning / superseding /
# ending a row's validity frees its content_hash for a fresh write. Every
# dedup lookup and every ON CONFLICT target in this module MUST use exactly
# this predicate — a broader check would resurrect the swallowed-re-write
# data-loss bug this index exists to prevent.
#
# This is DEDUP-liveness and it is NOT what retrieval returns: ``valid_until
# IS NULL`` excludes a row whose validity is dated into the FUTURE, which
# ``/memory/query`` and ``GET /records`` both still return. Anything
# describing "what a query could find" must use
# :data:`_RETRIEVAL_LIVE_PREDICATE` instead.
#
# The supersede guard (`_supersede_target_is_safe`) deliberately keeps THIS
# one rather than the retrieval predicate: it asks "may this row be the target
# of a supersession", and a row whose validity is dated into the future is
# still on its way OUT. Superseding onto it would bury the lineage the moment
# that date passes.
#
# ⚠️ Must remain a FLAT ``AND``-chain of bare column atoms:
# `_live_predicate_for` splits it on " AND " to qualify each atom with a table
# alias. A parenthesised ``OR`` — e.g. "(valid_until IS NULL OR valid_until >
# now())" — would render as "tgt.(valid_until IS NULL ...". It fails at parse
# time rather than silently, but the coupling is easy to miss from here.
# :data:`_RETRIEVAL_LIVE_PREDICATE` HAS that shape, which is the concrete
# reason the two are not interchangeable here.
#
# ``prefix`` is a table alias with its trailing dot (``"live."``), empty for
# the unprefixed form an ``ON CONFLICT ... WHERE`` arbiter clause needs — and
# empty is what :data:`_LIVE_DEDUP_PREDICATE` below is built from, so the
# flat-``AND``-chain contract `_live_predicate_for` depends on is unchanged.
# The prefixed form exists for :func:`anchor_gone_sweep`'s live-twin probe,
# which correlates two references to this same table and therefore cannot rely
# on unqualified names resolving to the one it means.


def _live_dedup_predicate(prefix: str = "") -> str:
    return (
        f"{prefix}is_tombstone = false "
        f"AND {prefix}superseded_by IS NULL "
        f"AND {prefix}valid_until IS NULL"
    )


_LIVE_DEDUP_PREDICATE = _live_dedup_predicate()


class SupersedeRefused(RuntimeError):
    """An explicit ``superseded_by`` write was rejected by the safety guard.

    Raised only by :func:`mark_superseded` (the explicit, caller-initiated
    path). The automatic set-based writers skip and log instead — aborting a
    scheduled sweep is what turns a data defect into a fleet-wide outage.
    """


def _live_predicate_for(alias: str) -> str:
    """:data:`_LIVE_DEDUP_PREDICATE` with every column qualified by ``alias``.

    Derived from the one constant rather than re-typed, so a change to the
    liveness definition cannot drift between the dedup lookups and the
    supersede guard below.
    """
    return " AND ".join(
        f"{alias}.{atom.strip()}" for atom in _LIVE_DEDUP_PREDICATE.split(" AND ")
    )


def _supersede_target_is_safe(
    *,
    target: str,
    subject: str = "memory_records.memory_id",
    table: str = "coord.memory_records",
) -> str:
    """SQL guard every ``superseded_by`` write MUST carry.

    Two conditions, both as a WHERE **predicate** rather than a ranking key:

    1. **The target must be LIVE.** Pointing a supersession at a row that is
       itself tombstoned / superseded / validity-ended buries the lineage for
       nothing: the subject leaves retrieval and the row that replaced it is
       not in retrieval either, so the document is simply gone. This is the
       shape that orphaned ``4a14e94e…`` — part 1/2 was superseded onto a
       DEAD sync-conflict sidecar which itself pointed at the live part 2/2.
    2. **No back-edge.** Refuse A→B when B→A already exists, which is what
       mints a supersede 2-cycle. `memhold_adjudicate_01` created one
       (2026-08-01) because it treated liveness as an ``ORDER BY`` key and
       never checked the reverse edge; the resulting cycle failed
       `memhold_adjudicate_02`'s ``not_live`` invariant, which deferred every
       migration PR fleet-wide for >5h on 2026-08-04.

    Why a predicate and not a sort key: a ranking PREFERS a live target but
    with a single candidate returns it whatever its state, so ranking cannot
    express "never". Only a WHERE can.

    ⚠️ ``subject`` MUST stay a QUALIFIED column reference naming the UPDATE's
    own target table. An unqualified ``memory_id`` resolves against the
    INNERMOST range table — ``back`` — so the back-edge clause silently
    collapses to ``back.superseded_by = back.memory_id`` ("does the target
    point at itself"), which is never true. Postgres then plans it as an
    uncorrelated ``InitPlan`` that never reads the outer row at all, and the
    guard reads as present while doing nothing. All three call sites UPDATE
    ``coord.memory_records`` without an alias, so ``memory_records.memory_id``
    is the correlated reference.

    Under today's :data:`_LIVE_DEDUP_PREDICATE` the back-edge term is
    REDUNDANT: a row B with ``B.superseded_by = A`` is by definition not live,
    so condition 1 already refuses it. It is kept as the braces to condition
    1's belt — the day someone relaxes liveness (e.g. lets superseded-but-
    still-valid rows count as live), it becomes the only thing standing
    between this codebase and the 2026-08-04 cycle.

    ``target`` is a bind-parameter NAME (rendered ``:name``); ``subject`` and
    ``table`` are SQL identifiers. None of the three ever carries caller data —
    this fragment is interpolated into f-strings, so every call site passes a
    string literal. The guard below enforces that rather than trusting it.
    """
    if not target.isidentifier():
        raise ValueError(f"target must be a bind-parameter name, got {target!r}")
    for ident in (subject, table):
        if not all(part.isidentifier() for part in ident.split(".")):
            raise ValueError(f"not a plain SQL identifier: {ident!r}")
    return f"""
        EXISTS (
            SELECT 1 FROM {table} tgt
             WHERE tgt.memory_id = :{target}
               AND {_live_predicate_for("tgt")}
        )
        AND NOT EXISTS (
            SELECT 1 FROM {table} back
             WHERE back.memory_id = :{target}
               AND back.superseded_by = {subject}
        )
    """


# The KIND-AWARE liveness predicate of the ``uq_memory_jobs_live_input``
# partial unique index (see the ``memory_jobs_02_kind_aware_dedupe``
# migration). An in-flight (pending/claimed) job of either kind dedupes, and
# a DONE synthesis job keeps deduping (a completed cluster must never be
# redone) — but a DONE embedding job does NOT, so a done-but-unapplied
# embedding can re-queue (``fetch_reindex_batch`` gates the re-embed). The
# ``enqueue_jobs`` ON CONFLICT ... WHERE clause MUST match this index
# predicate exactly, so both read from this one constant. (The migration
# carries its own textual copy — a migration cannot import runtime code — but
# it is token-for-token identical modulo whitespace, which is all Postgres's
# partial-index arbiter compares. The test-setup DDL interpolates THIS very
# constant, so it can never drift.)
_LIVE_JOB_INPUT_DEDUP_PREDICATE = (
    "status IN ('pending', 'claimed') OR (status = 'done' AND kind = 'synthesis')"
)

# The dedup-merge for ``anchors`` (plan
# ``2026-07-29-memory-anchored-derived-records`` Phase 2).
#
# Content-hash dedup used to be ``ON CONFLICT ... DO NOTHING``, which made
# re-writing an identical record IN ORDER TO ATTACH AN ANCHOR a silent
# no-op — and that is precisely how Phase 6 backfills anchors ("anchors are
# added when a record is next written"). So the conflict action MERGES the
# incoming array into the stored one, and touches NOTHING else: dedup keeps
# its exact previous meaning (the existing row's id, ``deduped=True``, every
# other column as it was).
#
# * **UNION, never replace.** A second writer of the same content must not
#   be able to drop a first writer's anchor. Replacement would make the
#   last writer of any deduped content the sole owner of its anchors.
# * **Identity is the whole JSON object**, which is why every ``Anchor``
#   variant forbids extra keys — an unconstrained key would mint a
#   near-duplicate that is "the same anchor" to a human.
# * ``DISTINCT ... ORDER BY`` makes the merge IDEMPOTENT and
#   order-independent: writing the same record twice yields a byte-identical
#   array, so a sync mirror never sees spurious churn.
# * The guard ``WHERE excluded.anchors <> '[]'::jsonb`` restores DO NOTHING
#   for the overwhelmingly common anchorless write — no row is locked, no
#   ``updated_at`` moves, and RETURNING yields nothing, exactly as before.
#   (The ``::jsonb`` cast is load-bearing: ``jsonb <> unknown`` has no
#   resolvable operator.)
# * COALESCE is belt-and-braces for a NOT NULL column: the guard already
#   guarantees the concatenation is non-empty, so ``jsonb_agg`` cannot
#   return NULL here.
# * **The merge arm DOES move ``updated_at``, and must.** The anchorless
#   guard above is about not churning rows that gained nothing; a row that
#   actually gained an anchor has changed, and the incremental sync
#   (:func:`list_records_page`, which filters on
#   ``GREATEST(updated_at, created_at) > :since``) is exactly the consumer
#   ``MemoryRecordOut`` exists to feed anchors to. Leaving ``updated_at``
#   still would backfill an anchor that no mirror ever pulls — Phase 6
#   would land in the database and nowhere else.
# * The second guard, ``anchors IS DISTINCT FROM <merged>``, keeps that
#   from becoming churn of its own: re-writing a record with an anchor it
#   already carries computes the same array, changes nothing, and takes no
#   row lock. It also keeps the merge IDEMPOTENT at the ``updated_at``
#   level, not just at the value level. When it suppresses the update the
#   statement returns no row for that hash, which both callers already
#   read as "conflicted" and resolve through their existing-row lookup.
_ANCHOR_UNION_EXPR = """COALESCE(
            (SELECT jsonb_agg(DISTINCT elem ORDER BY elem)
               FROM jsonb_array_elements(
                        memory_records.anchors || excluded.anchors
                    ) AS elem),
            '[]'::jsonb)"""

_ANCHOR_MERGE_CONFLICT_ACTION = f"""
    DO UPDATE SET anchors = {_ANCHOR_UNION_EXPR},
                  updated_at = now()
        WHERE excluded.anchors <> '[]'::jsonb
          AND memory_records.anchors IS DISTINCT FROM {_ANCHOR_UNION_EXPR}
"""


def _anchors_json(anchors: list[dict[str, Any]] | None) -> str:
    """Render an anchor array for the ``CAST(:anchors AS jsonb)`` bind.

    ``None`` and ``[]`` are the same thing to the store — "this writer
    has no anchors" — and both must land as the empty array, never NULL:
    the column is NOT NULL and the merge guard compares against
    ``'[]'::jsonb``.
    """
    return json.dumps(anchors or [])


def format_pgvector(vector: list[float]) -> str:
    """Render a vector as pgvector's text literal (``[v1,v2,...]``)."""
    return "[" + ",".join(repr(float(v)) for v in vector) + "]"


def _format_pgvector_opt(vector: list[float] | None) -> str | None:
    """:func:`format_pgvector`, passing NULL through.

    ``None`` means "not vectorized (yet)" — a supported state since the
    request path stopped embedding (embeddings are client-supplied). It
    lands as a NULL ``embedding``, which :func:`fetch_reindex_batch`
    already targets for later vectorization.
    """
    return None if vector is None else format_pgvector(vector)


def _content_hash(content: str) -> str:
    """sha256 hex over stored content (same rule as the write API)."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class TenantMemoryUsage:
    """Current usage + effective quotas for one tenant."""

    row_count: int
    bytes: int
    quota_bytes: int
    quota_rows: int


async def get_usage(session: AsyncSession, tenant_id: UUID) -> TenantMemoryUsage:
    """Rows/bytes used by ``tenant_id`` plus its effective quotas.

    Only non-tombstone rows count against quota (a delete frees quota
    immediately); superseded / decay-invalidated rows still count until
    the physical prune — they remain retrievable-storage lineage. Bytes
    are ``octet_length(content)``. Both definitions match the coord
    twin-census observer, so quota posture and census never disagree.

    Quotas COALESCE against the migration defaults over a LEFT JOIN, so
    a tenant without a ``coord.tenant_policies`` row gets the defaults —
    matching how coord treats missing policy rows.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT
                    (SELECT count(*)
                       FROM coord.memory_records r
                      WHERE r.tenant_id = :tenant_id
                        AND r.is_tombstone = false) AS row_count,
                    (SELECT COALESCE(sum(octet_length(r.content)), 0)
                       FROM coord.memory_records r
                      WHERE r.tenant_id = :tenant_id
                        AND r.is_tombstone = false) AS bytes,
                    COALESCE(p.memory_quota_bytes, :default_quota_bytes)
                        AS quota_bytes,
                    COALESCE(p.memory_row_quota, :default_row_quota)
                        AS quota_rows
                FROM (SELECT 1) AS one
                LEFT JOIN coord.tenant_policies p
                       ON p.tenant_id = :tenant_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "default_quota_bytes": DEFAULT_MEMORY_QUOTA_BYTES,
                "default_row_quota": DEFAULT_MEMORY_ROW_QUOTA,
            },
        )
    ).one()
    return TenantMemoryUsage(
        row_count=int(row.row_count),
        bytes=int(row.bytes),
        quota_bytes=int(row.quota_bytes),
        quota_rows=int(row.quota_rows),
    )


async def embedding_coverage(session: AsyncSession, tenant_id: UUID) -> float:
    """Fraction of the tenant's rows carrying a non-NULL embedding.

    An empty store counts as fully covered (1.0) — no drift to report.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT count(*) AS total,
                       count(embedding) AS embedded
                FROM coord.memory_records
                WHERE tenant_id = :tenant_id
                """
            ),
            {"tenant_id": tenant_id},
        )
    ).one()
    total = int(row.total)
    return 1.0 if total == 0 else int(row.embedded) / total


@dataclass(frozen=True)
class MemoryFacetAge:
    """Age of the live corpus in days since ``created_at``.

    ``None`` on an empty corpus — there is no median age of nothing, and
    a fabricated ``0.0`` would read as "everything was written today".
    """

    p50_days: float | None
    p90_days: float | None
    oldest_days: float | None


@dataclass(frozen=True)
class MemoryFacetImportance:
    """Importance distribution of the live corpus."""

    p50: float | None
    p90: float | None
    above_0_8: int


@dataclass(frozen=True)
class MemoryContentFacets:
    """What is in the live corpus — see ``schemas.memory.MemoryFacets``
    for the response-level contract and the denominator invariant."""

    live_row_count: int
    by_kind: dict[str, int]
    by_scope: dict[str, int]
    age: MemoryFacetAge
    importance: MemoryFacetImportance
    recent_titles: list[str]


# The per-bucket FILTER columns, generated from the SAME tuples the
# zero-fill would have used, so the exhaustive-bucket guarantee cannot
# drift from the SQL. Both value sets are Literal members of this
# codebase (``[a-z_]+`` only) — never caller input — so interpolating
# them as SQL literals is safe; the assertion below keeps it that way if
# a future kind arrives with punctuation in it.
if not all(re.fullmatch(r"[a-z][a-z_]*", v) for v in (*MEMORY_KINDS, *MEMORY_SCOPES)):
    raise ValueError("memory kind/scope values must be bare lowercase identifiers")

_BUCKET_FACET_COLUMNS = "".join(
    f",\n                    count(*) FILTER (WHERE r.{column} = '{value}')"
    f" AS {column}_{value}"
    for column, values in (("kind", MEMORY_KINDS), ("scope", MEMORY_SCOPES))
    for value in values
)


async def facets(session: AsyncSession, tenant_id: UUID) -> MemoryContentFacets:
    """Content facets for ``tenant_id`` over RETRIEVAL-LIVE rows only.

    The companion to :func:`get_usage`: that one reports storage posture,
    this one reports what is actually IN the store.

    **Liveness is :data:`_RETRIEVAL_LIVE_PREDICATE`, not
    :data:`_LIVE_DEDUP_PREDICATE`.** The two differ on ``valid_until``,
    and the difference is not hypothetical:
    :func:`expire_closed_session_records` stamps ``valid_until = closed_at
    + interval '7 days'`` on session-scoped rows, so for up to a week
    those rows are returned by ``/memory/query`` and listed by ``GET
    /records`` while dedup-liveness counts them dead. Measuring them dead
    here would report ``by_scope["session"] == 0`` at a caller whose very
    next query returns session rows — the absence-reads-as-a-value bug
    this surface exists to prevent, in the dangerous direction.

    These counts therefore describe the retrieval-live corpus **modulo
    ``scope_ref`` narrowing**: ``_validity_filters`` additionally requires
    ``agent``/``session`` rows to carry the caller's own ``scope_ref``,
    which is caller-dependent and has no tenant-wide answer. A specific
    caller's ``agent``/``session`` buckets can therefore be SMALLER than
    reported; no bucket can be larger.

    **The predicate is deliberately NOT the one :func:`get_usage` uses**,
    and the two must not be reconciled. ``get_usage`` counts every
    non-tombstone row (superseded and validity-ended rows included)
    because that is what quota charges for and what the coord twin census
    mirrors; a live-only quota count would under-charge, and a
    non-tombstone facet count would promise retrieval hits that
    supersession and validity have already taken away.
    :func:`embedding_coverage` filters on nothing at all, a third
    definition again. The gap is real and is published as
    ``live_row_count`` so no caller has to infer which denominator a facet
    belongs to.

    **One statement, one snapshot.** Every number here — the two grouped
    tallies, the percentiles, ``live_row_count`` and the title sample —
    comes back from a SINGLE ``SELECT``. The request session runs at the
    Postgres default READ COMMITTED, so separate statements would each
    take a fresh snapshot and a concurrent write between them could make
    ``sum(by_kind) != sum(by_scope) != live_row_count`` under a
    ``corpus_complete=True`` flag. Folding them makes::

        sum(by_kind) == sum(by_scope) == live_row_count

    true BY CONSTRUCTION rather than by timing, and collapses three scans
    into one. The ``<= get_usage().row_count`` half of the published
    invariant is NOT snapshot-atomic — ``get_usage`` is a separate call in
    the handler — and the response schema says so.

    ``by_kind`` / ``by_scope`` are exhaustive over
    :data:`~app.schemas.memory.MEMORY_KINDS` /
    :data:`~app.schemas.memory.MEMORY_SCOPES` because the FILTER columns
    are GENERATED from those tuples: a kind with no rows comes back as
    ``0`` instead of vanishing. Omission and emptiness are different
    answers.

    ``recent_titles`` is a bounded vocabulary sample
    (:data:`~app.schemas.memory.RECENT_TITLES_SAMPLE` titles, newest
    first), not a listing — :func:`list_records_page` (``GET
    /memory/records``) is the paginated listing. It rides in the same
    statement as an uncorrelated scalar subquery, so it is drawn from the
    same snapshot as the counts.

    The bucket tallies ride existing indexes
    (``idx_memory_records_tenant_kind_created``,
    ``idx_memory_records_tenant_scope``).

    ``importance`` is REAL, so the 0.8 threshold is cast to REAL too:
    comparing a float4 against a float8 literal promotes the column to
    0.8000000119..., which would count a record stored at exactly 0.8 as
    being ABOVE 0.8. Casting the literal keeps the comparison in the
    column's own precision, where 0.8 is not above 0.8.
    """
    agg = (
        await session.execute(
            text(
                f"""
                SELECT
                    count(*) AS live_row_count{_BUCKET_FACET_COLUMNS},
                    percentile_cont(0.5) WITHIN GROUP (
                        ORDER BY {_FACET_AGE_DAYS_SQL}
                    ) AS age_p50_days,
                    percentile_cont(0.9) WITHIN GROUP (
                        ORDER BY {_FACET_AGE_DAYS_SQL}
                    ) AS age_p90_days,
                    max({_FACET_AGE_DAYS_SQL}) AS age_oldest_days,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY r.importance)
                        AS importance_p50,
                    percentile_cont(0.9) WITHIN GROUP (ORDER BY r.importance)
                        AS importance_p90,
                    count(*) FILTER (
                        WHERE r.importance > CAST(0.8 AS real)
                    ) AS importance_above_0_8,
                    (
                        SELECT COALESCE(
                            array_agg(
                                t.title
                                ORDER BY t.created_at DESC, t.memory_id DESC
                            ),
                            ARRAY[]::text[]
                        )
                        FROM (
                            SELECT r.title, r.created_at, r.memory_id
                            FROM coord.memory_records r
                            WHERE r.tenant_id = :tenant_id
                              AND {_RETRIEVAL_LIVE_PREDICATE}
                            ORDER BY r.created_at DESC, r.memory_id DESC
                            LIMIT :titles_limit
                        ) t
                    ) AS recent_titles
                FROM coord.memory_records r
                WHERE r.tenant_id = :tenant_id
                  AND {_RETRIEVAL_LIVE_PREDICATE}
                """
            ),
            {"tenant_id": tenant_id, "titles_limit": RECENT_TITLES_SAMPLE},
        )
    ).one()

    def _opt_float(value: Any) -> float | None:
        return None if value is None else float(value)

    return MemoryContentFacets(
        live_row_count=int(agg.live_row_count),
        by_kind={k: int(getattr(agg, f"kind_{k}")) for k in MEMORY_KINDS},
        by_scope={s: int(getattr(agg, f"scope_{s}")) for s in MEMORY_SCOPES},
        age=MemoryFacetAge(
            p50_days=_opt_float(agg.age_p50_days),
            p90_days=_opt_float(agg.age_p90_days),
            oldest_days=_opt_float(agg.age_oldest_days),
        ),
        importance=MemoryFacetImportance(
            p50=_opt_float(agg.importance_p50),
            p90=_opt_float(agg.importance_p90),
            above_0_8=int(agg.importance_above_0_8),
        ),
        recent_titles=[str(t) for t in (agg.recent_titles or [])],
    )


async def insert_record(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    scope: str,
    scope_ref: str | None,
    kind: str,
    title: str,
    content: str,
    content_hash: str,
    embedding: list[float] | None,
    embedding_model: str | None,
    importance: float,
    source: dict[str, Any],
    consolidated_from: list[UUID] | None = None,
    anchors: list[dict[str, Any]] | None = None,
) -> tuple[UUID, bool]:
    """Insert one record, deduping on ``(tenant_id, content_hash)``
    against LIVE rows only.

    The conflict target is the ``uq_memory_records_tenant_content_hash_live``
    partial unique index, so tombstoned / superseded / validity-ended
    rows never swallow a re-write of identical content. Returns
    ``(memory_id, deduped)`` — on conflict the EXISTING live row's id is
    returned with ``deduped=True``. ``consolidated_from`` carries the
    member lineage of a synthesized ``mental_model`` row (Phase 4).

    ``embedding`` / ``embedding_model`` are CLIENT-supplied and travel
    together; both may be ``None``, storing the row unvectorized (still
    FTS-retrievable) for the reindex sweep to embed later. Callers
    validate the pair — this layer stores what it is handed.

    ``anchors`` are MERGED on conflict rather than discarded — see
    :data:`_ANCHOR_MERGE_CONFLICT_ACTION`. A conflicting write with a
    non-empty array is still a dedup (``deduped=True``, the existing
    row's id, every other column untouched); it just no longer throws
    the anchor away.

    ``memory_id`` is generated HERE rather than by the column default.
    That is what makes ``deduped`` exact under the merge: with
    ``DO UPDATE`` the RETURNING clause yields a row for the insert AND
    the merge cases alike, so "did anything come back" no longer
    discriminates them — but "is the id the one I proposed" does,
    deterministically and without leaning on ``xmax`` implementation
    details.
    """
    proposed_id = uuid4()
    returned = (
        await session.execute(
            text(
                f"""
                INSERT INTO coord.memory_records
                    (memory_id, tenant_id, scope, scope_ref, kind, title,
                     content, content_hash, embedding, embedding_model,
                     importance, source, consolidated_from, anchors)
                VALUES
                    (:memory_id, :tenant_id, :scope, :scope_ref, :kind,
                     :title, :content, :content_hash,
                     CAST(:embedding AS vector),
                     :embedding_model, :importance, CAST(:source AS jsonb),
                     CAST(:consolidated_from AS uuid[]),
                     CAST(:anchors AS jsonb))
                ON CONFLICT (tenant_id, content_hash)
                    WHERE {_LIVE_DEDUP_PREDICATE}
                    {_ANCHOR_MERGE_CONFLICT_ACTION}
                RETURNING memory_id
                """
            ),
            {
                "memory_id": proposed_id,
                "tenant_id": tenant_id,
                "scope": scope,
                "scope_ref": scope_ref,
                "kind": kind,
                "title": title,
                "content": content,
                "content_hash": content_hash,
                "embedding": _format_pgvector_opt(embedding),
                "embedding_model": embedding_model,
                "importance": importance,
                "source": json.dumps(source),
                "consolidated_from": consolidated_from,
                "anchors": _anchors_json(anchors),
            },
        )
    ).scalar_one_or_none()
    if returned is not None:
        returned_id = UUID(str(returned))
        # The proposed id came back => the INSERT arm won. Any other id
        # is the pre-existing live row the merge arm updated.
        return returned_id, returned_id != proposed_id

    # Nothing returned: a conflict whose merge guard was false, which is
    # the old DO NOTHING path exactly. EITHER of the two guard terms can
    # be the reason — the incoming array was empty, or (since the
    # ``updated_at`` fix) every incoming anchor was already present, so
    # the union equals the stored array and the row is deliberately left
    # untouched. Both are a plain dedup and resolve the same way.
    existing = (
        await session.execute(
            text(
                f"""
                SELECT memory_id FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND content_hash = :content_hash
                  AND {_LIVE_DEDUP_PREDICATE}
                """
            ),
            {"tenant_id": tenant_id, "content_hash": content_hash},
        )
    ).scalar_one()
    return UUID(str(existing)), True


@dataclass(frozen=True)
class MemoryRecordInsert:
    """One record in a set-based :func:`insert_records_batch` call."""

    scope: str
    scope_ref: str | None
    kind: str
    title: str
    content: str
    content_hash: str
    # Client-supplied; ``None`` (both fields) stores the row unvectorized.
    embedding: list[float] | None
    embedding_model: str | None
    importance: float
    source: dict[str, Any]
    # Typed references to the ground truth this record asserts about
    # (plan §3.1). Defaulted so every existing construction site keeps
    # working and lands the empty array, i.e. today's behaviour.
    anchors: list[dict[str, Any]] = field(default_factory=list)


async def insert_records_batch(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    items: list[MemoryRecordInsert],
) -> list[tuple[UUID, bool]]:
    """Set-based multi-row insert with the same live-row dedup semantics
    as :func:`insert_record`, in ONE round-trip (plus one dedup lookup
    when any row conflicted).

    Returns ``(memory_id, deduped)`` per item, in item order — conflicts
    against an existing LIVE row report that row's id with
    ``deduped=True``, exactly like :func:`insert_record`.

    Anchors merge on conflict here too (:data:`_ANCHOR_MERGE_CONFLICT_ACTION`),
    and ids are proposed client-side for the same reason
    :func:`insert_record` proposes them — under ``DO UPDATE`` the returned
    id, not the presence of a returned row, is what separates an insert
    from a merge.

    **Intra-batch duplicate ``content_hash`` values are collapsed HERE,
    not left to the caller.** ``ON CONFLICT ... DO UPDATE`` cannot touch
    the same row twice in one command — Postgres raises ``ON CONFLICT DO
    UPDATE command cannot affect row a second time`` — where the previous
    ``DO NOTHING`` simply ignored the repeat. Leaving that as a caller
    precondition would be a new, unasserted way for a public store
    function to hard-error, protected only by a dict construction in a
    different module; the one live caller happens to satisfy it, and the
    next one would not.

    The collapse mirrors the write endpoint's own rule exactly, so the
    two cannot disagree: the FIRST occurrence supplies every column, and
    later occurrences contribute only their ANCHORS, unioned in. Union
    rather than "first wins" because dropping a later duplicate's anchors
    would be the same silent anchor loss the ON CONFLICT merge exists to
    prevent, just moved one layer out. Every occurrence still gets its
    own result entry; the later ones report ``deduped=True``.
    """
    if not items:
        return []
    unique: list[MemoryRecordInsert] = []
    first_of: dict[str, int] = {}
    for item in items:
        seen = first_of.get(item.content_hash)
        if seen is None:
            first_of[item.content_hash] = len(unique)
            unique.append(item)
            continue
        if item.anchors:
            head = unique[seen]
            union = list(head.anchors)
            union.extend(a for a in item.anchors if a not in union)
            unique[seen] = replace(head, anchors=union)
    proposed: dict[str, UUID] = {i.content_hash: uuid4() for i in unique}
    stmt = text(
        f"""
        INSERT INTO coord.memory_records
            (memory_id, tenant_id, scope, scope_ref, kind, title, content,
             content_hash, embedding, embedding_model, importance, source,
             anchors)
        SELECT CAST(u.memory_id AS uuid), :tenant_id, u.scope, u.scope_ref,
               u.kind, u.title, u.content, u.content_hash,
               CAST(u.embedding AS vector),
               u.embedding_model, u.importance, CAST(u.source AS jsonb),
               CAST(u.anchors AS jsonb)
        FROM unnest(
                 CAST(:memory_ids AS text[]),
                 CAST(:scopes AS text[]),
                 CAST(:scope_refs AS text[]),
                 CAST(:kinds AS text[]),
                 CAST(:titles AS text[]),
                 CAST(:contents AS text[]),
                 CAST(:content_hashes AS text[]),
                 CAST(:embeddings AS text[]),
                 CAST(:embedding_models AS text[]),
                 CAST(:importances AS float8[]),
                 CAST(:sources AS text[]),
                 CAST(:anchors AS text[])
             ) AS u(memory_id, scope, scope_ref, kind, title, content,
                    content_hash, embedding, embedding_model, importance,
                    source, anchors)
        ON CONFLICT (tenant_id, content_hash)
            WHERE {_LIVE_DEDUP_PREDICATE}
            {_ANCHOR_MERGE_CONFLICT_ACTION}
        RETURNING memory_id, content_hash
        """
    ).bindparams(
        bindparam("memory_ids", type_=ARRAY(Text())),
        bindparam("scopes", type_=ARRAY(Text())),
        bindparam("scope_refs", type_=ARRAY(Text())),
        bindparam("kinds", type_=ARRAY(Text())),
        bindparam("titles", type_=ARRAY(Text())),
        bindparam("contents", type_=ARRAY(Text())),
        bindparam("content_hashes", type_=ARRAY(Text())),
        bindparam("embeddings", type_=ARRAY(Text())),
        bindparam("embedding_models", type_=ARRAY(Text())),
        bindparam("importances", type_=ARRAY(Float())),
        bindparam("sources", type_=ARRAY(Text())),
        bindparam("anchors", type_=ARRAY(Text())),
    )
    rows = await session.execute(
        stmt,
        {
            "tenant_id": tenant_id,
            "memory_ids": [str(proposed[i.content_hash]) for i in unique],
            "scopes": [i.scope for i in unique],
            "scope_refs": [i.scope_ref for i in unique],
            "kinds": [i.kind for i in unique],
            "titles": [i.title for i in unique],
            "contents": [i.content for i in unique],
            "content_hashes": [i.content_hash for i in unique],
            "embeddings": [_format_pgvector_opt(i.embedding) for i in unique],
            "embedding_models": [i.embedding_model for i in unique],
            "importances": [i.importance for i in unique],
            "sources": [json.dumps(i.source) for i in unique],
            "anchors": [_anchors_json(i.anchors) for i in unique],
        },
    )
    returned: dict[str, UUID] = {
        str(r.content_hash): UUID(str(r.memory_id)) for r in rows
    }
    # Split the returned rows: the proposed id came back => INSERT arm;
    # any other id => the merge arm updated the pre-existing live row,
    # which is a dedup exactly as DO NOTHING was.
    inserted: dict[str, UUID] = {
        h: mid for h, mid in returned.items() if proposed.get(h) == mid
    }
    merged: dict[str, UUID] = {
        h: mid for h, mid in returned.items() if proposed.get(h) != mid
    }

    conflicted = [i.content_hash for i in unique if i.content_hash not in returned]
    existing: dict[str, UUID] = {}
    if conflicted:
        lookup = text(
            f"""
            SELECT memory_id, content_hash FROM coord.memory_records
            WHERE tenant_id = :tenant_id AND content_hash IN :hashes
              AND {_LIVE_DEDUP_PREDICATE}
            """
        ).bindparams(bindparam("hashes", expanding=True))
        found = await session.execute(
            lookup, {"tenant_id": tenant_id, "hashes": conflicted}
        )
        existing = {str(r.content_hash): UUID(str(r.memory_id)) for r in found}

    # One entry per ORIGINAL item, in the caller's order. A hash that
    # appeared more than once resolves to the same row every time; only
    # its first occurrence can report ``deduped=False``.
    results: list[tuple[UUID, bool]] = []
    emitted: set[str] = set()
    for item in items:
        repeat = item.content_hash in emitted
        emitted.add(item.content_hash)
        new_id = inserted.get(item.content_hash)
        if new_id is not None:
            results.append((new_id, repeat))
            continue
        merged_id = merged.get(item.content_hash)
        if merged_id is not None:
            # Anchors merged onto the pre-existing live row. Still a
            # dedup — same id, same every-other-column, deduped=True.
            results.append((merged_id, True))
            continue
        # Same invariant as insert_record's scalar_one: a conflict
        # means a live row with this hash exists.
        results.append((existing[item.content_hash], True))
    return results


async def existing_hashes(
    session: AsyncSession, tenant_id: UUID, hashes: list[str]
) -> set[str]:
    """Which of ``hashes`` already exist as LIVE rows for this tenant
    (pre-embed dedup check, so known-duplicate contents are never
    re-embedded). Dead rows (tombstoned / superseded / validity-ended)
    don't count — their content is re-writable."""
    if not hashes:
        return set()
    stmt = text(
        f"""
        SELECT content_hash FROM coord.memory_records
        WHERE tenant_id = :tenant_id AND content_hash IN :hashes
          AND {_LIVE_DEDUP_PREDICATE}
        """
    ).bindparams(bindparam("hashes", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "hashes": hashes})
    return {str(r.content_hash) for r in rows}


async def find_by_hash(
    session: AsyncSession, tenant_id: UUID, content_hash: str
) -> UUID | None:
    """The tenant's LIVE record id carrying ``content_hash``, if any."""
    found = (
        await session.execute(
            text(
                f"""
                SELECT memory_id FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND content_hash = :content_hash
                  AND {_LIVE_DEDUP_PREDICATE}
                """
            ),
            {"tenant_id": tenant_id, "content_hash": content_hash},
        )
    ).scalar_one_or_none()
    return UUID(str(found)) if found is not None else None


# The instant validity is evaluated at.
#
# ``valid_from`` and ``valid_until`` are stamped EXCLUSIVELY by the
# database, never by a caller: ``valid_from`` takes the column DEFAULT
# ``now()``, and the two writers that end validity
# (:func:`supersede_record`, :func:`tombstone_record`) both
# ``SET valid_until = now(), updated_at = now()`` in one statement. No
# request schema exposes either column. So every boundary a row carries
# was produced by the SAME transaction that stamped that row's
# ``created_at`` / ``updated_at``.
#
# Comparing those boundaries to a clock read LATER, on a different
# connection or a different host, is what made retrieval flaky:
#
# * Cross-HOST. Binding an app-side ``datetime.now(UTC)`` made this a
#   comparison between two machines' clocks. In production the API is
#   ECS and the database is RDS — two hosts, two NTP disciplines — so a
#   database clock a few hundred milliseconds ahead of the API host
#   makes a JUST-WRITTEN row fail ``valid_from <= :as_of`` and vanish,
#   and symmetrically leaves a JUST-DELETED row satisfying
#   ``valid_until > :as_of``. A read-your-own-write break either way.
#
# * Non-MONOTONIC. Even one clock is not enough: a wall clock can step
#   BACKWARD when time sync corrects it, so a later ``now()`` on the
#   same server can read EARLIER than the ``now()`` that stamped the
#   row. Measured on the containerised dev Postgres, ``valid_from``
#   landed up to 605 ms in the future of a subsequent ``now()``, hiding
#   freshly written records for the length of the correction.
#
# ``GREATEST(now(), r.updated_at, r.created_at)`` removes both. It is
# never less than any boundary the row itself carries — those were
# stamped by the same transaction as ``created_at``/``updated_at`` — so
# a live row is ALWAYS visible and a validity-ended row is IMMEDIATELY
# invisible, deterministically, whatever the wall clock is doing. It
# still tracks real time for a boundary genuinely dated into the future
# (no writer produces one today, but the columns permit it), because
# ``now()`` dominates the row's own timestamps in that case.
#
# COALESCE preserves the caller-chosen time-travel ``as_of``: an instant
# the CALLER names is legitimately theirs to supply, and asking "what
# did the corpus look like at X" is a wall-clock question by definition.
_EFFECTIVE_NOW_ROW_SQL = "GREATEST(now(), r.updated_at, r.created_at)"

_EFFECTIVE_NOW_SQL = f"COALESCE(CAST(:as_of AS timestamptz), {_EFFECTIVE_NOW_ROW_SQL})"

# RETRIEVAL-liveness: the rows ``/memory/query`` and ``GET /memory/records``
# can actually return, as opposed to the DEDUP-liveness of
# :data:`_LIVE_DEDUP_PREDICATE`. The difference is ``valid_until``: dedup
# demands it be NULL, retrieval admits any boundary still in the future.
# That gap is load-bearing — :func:`expire_closed_session_records` stamps
# ``valid_until = closed_at + interval '7 days'`` on session-scoped rows, so
# for up to a week those rows are retrievable while dedup counts them dead.
#
# Requires the table to be aliased ``r`` (it embeds
# :data:`_EFFECTIVE_NOW_ROW_SQL`), and it takes no ``:as_of`` bind: this is
# the predicate for aggregates over the corpus AS IT IS, not at a
# caller-named instant.
#
# NOT reproduced here: ``_validity_filters``'s scope rule
# (``scope NOT IN ('agent','session') OR scope_ref = :scope_ref``), which is
# caller-dependent and has no tenant-wide answer. Any aggregate built on
# this constant is therefore retrieval-live MODULO scope_ref narrowing, and
# must say so where it is published.
_RETRIEVAL_LIVE_PREDICATE = (
    "r.is_tombstone = false"
    " AND r.superseded_by IS NULL"
    f" AND r.valid_from <= {_EFFECTIVE_NOW_ROW_SQL}"
    f" AND (r.valid_until IS NULL OR r.valid_until > {_EFFECTIVE_NOW_ROW_SQL})"
)

# Row age in days, for :func:`facets`. Measured against the same
# clock-skew-safe effective now, NOT a bare ``now()``: the backward clock
# step documented above (605 ms, measured) can leave ``created_at`` AHEAD
# of a later ``now()``, which would render a freshly written corpus's
# ``p50_days`` as a small NEGATIVE number. ``GREATEST(now(), r.updated_at,
# r.created_at)`` is never less than the row's own ``created_at``, so the
# age is >= 0 by construction.
_FACET_AGE_DAYS_SQL = (
    f"EXTRACT(EPOCH FROM ({_EFFECTIVE_NOW_ROW_SQL} - r.created_at)) / 86400.0"
)


def _validity_filters(
    *,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
) -> tuple[str, dict[str, Any]]:
    """Shared WHERE fragment + params for both retrieval arms.

    Tenant binding, tombstone/validity filtering (against ``:as_of`` when
    the caller named an instant, otherwise transaction-consistently — see
    :data:`_EFFECTIVE_NOW_SQL`), the scope rule (``agent``/``session``
    rows require the matching ``scope_ref``), and the optional
    kind/importance/recency filters.
    """
    clauses = [
        "r.tenant_id = :tenant_id",
        "r.is_tombstone = false",
        f"r.valid_from <= {_EFFECTIVE_NOW_SQL}",
        f"(r.valid_until IS NULL OR r.valid_until > {_EFFECTIVE_NOW_SQL})",
        "r.scope IN :scopes",
        "(r.scope NOT IN ('agent', 'session') OR r.scope_ref = :scope_ref)",
    ]
    params: dict[str, Any] = {"scopes": scopes, "scope_ref": scope_ref}
    if kinds:
        clauses.append("r.kind IN :kinds")
        params["kinds"] = kinds
    if min_importance is not None:
        clauses.append("r.importance >= :min_importance")
        params["min_importance"] = min_importance
    if since is not None:
        clauses.append("r.created_at >= :since")
        params["since"] = since
    return " AND ".join(clauses), params


# Asks "is every tag in this tenant's scorable corpus the deployed one?"
# as MIN + MAX + an untagged check, rather than the obvious
# ``EXISTS (... WHERE embedding_model IS DISTINCT FROM :tag)``. Both of
# the obvious spellings measured badly:
#
# * ``IS DISTINCT FROM`` is not an indexable boundary — Postgres seeks to
#   the tenant's range and FILTERS every entry in it, so the steady state
#   (fully migrated, answer "no", nothing to stop early on) pays a scan
#   of the tenant's whole corpus on EVERY query.
# * Splitting it into ``< :tag`` / ``> :tag`` EXISTS branches does not
#   fix it either. EXISTS is startup-cost-dominated, and the planner
#   assumes ``tenant_id`` and ``embedding_model`` are independent — but a
#   migrated tenant's rows are perfectly ANTI-correlated with "some other
#   tag", so it estimates a fat match set, expects to hit one instantly,
#   picks a seq scan on startup cost, and then finds nothing. Measured at
#   100k rows: 79ms and 25k buffers for that one branch.
#
# ``ORDER BY embedding_model LIMIT 1`` removes the choice. A seq scan
# cannot produce it without a sort, so the (tenant_id, embedding_model)
# index wins on total cost regardless of selectivity estimates, and each
# subquery is an Index Only Scan fetching exactly ONE tuple.
#
# ``lo`` is ASC (NULLS LAST) and ``hi`` is DESC (NULLS FIRST), so both
# read straight off the index in its native order — no sort either way.
# ``hi``'s NULLS FIRST would mask the real maximum when an untagged row
# exists, which is exactly why ``untagged`` is probed separately and
# checked FIRST.
_UNMIGRATED_PROBE = text(
    """
    SELECT
        (SELECT r.embedding_model
           FROM coord.memory_records r
          WHERE r.tenant_id = :tenant_id AND r.is_tombstone = false
            AND r.embedding IS NOT NULL
          ORDER BY r.embedding_model ASC
          LIMIT 1) AS lo,
        (SELECT r.embedding_model
           FROM coord.memory_records r
          WHERE r.tenant_id = :tenant_id AND r.is_tombstone = false
            AND r.embedding IS NOT NULL
          ORDER BY r.embedding_model DESC
          LIMIT 1) AS hi,
        EXISTS (SELECT 1
                  FROM coord.memory_records r
                 WHERE r.tenant_id = :tenant_id AND r.is_tombstone = false
                   AND r.embedding IS NOT NULL
                   AND r.embedding_model IS NULL) AS untagged
    """
)


async def has_unmigrated_vectors(
    session: AsyncSession, *, tenant_id: UUID, current_tag: str
) -> bool:
    """True if this tenant still holds VECTORS at a non-deployed tag.

    Gates the cosine arm. The Phase 0 verdict on the fastembed-128 ->
    sentence-transformers-256 change was NOT interchangeable (min cosine
    0.71, k=10 exact-order agreement 0%), so the transition is atomic per
    tenant: a query vector in the new space must never be scored against
    documents still in the old one. While this returns True the caller
    serves FTS-only and reports ``vector_arm='skipped_migrating'``.

    Scoped to rows the vector arm could ACTUALLY score:

    * ``embedding IS NOT NULL`` — a NULL-embedding row is invisible to
      the cosine arm, so it cannot contaminate anything. This matters a
      lot: since Phase 2 the bridge sweep lands rows unvectorized by
      design, so counting them as "unmigrated" would pin every tenant to
      ``skipped_migrating`` permanently and silently kill the semantic
      arm forever.
    * ``is_tombstone = false`` — tombstoned rows are never scored.

    It is deliberately tenant-wide rather than mirroring the calling
    query's kind/scope/validity filters: those would make the answer
    depend on the filters (the same tenant flipping between hybrid and
    skipped_migrating query to query) and would cost an unindexable
    scan. Tenant-wide is the CONSERVATIVE direction — at worst a foreign
    vector outside the query's filters degrades it to FTS-only, which is
    the safe way to be wrong.

    ``embedding_model IS NULL`` alongside a non-NULL vector should not
    exist (the write path rejects a vector without its tag), but if it
    does the row is unattributable — treated as unmigrated, not trusted.
    """
    row = (await session.execute(_UNMIGRATED_PROBE, {"tenant_id": tenant_id})).one()
    if row.untagged:
        # An unattributable vector: we cannot prove which space it is in.
        return True
    if row.lo is None and row.hi is None:
        # No scorable vectors at all (a new tenant, or one whose rows are
        # all still awaiting the runner's sweep). Nothing can be
        # contaminated, so this is NOT a migration — reporting one here
        # would degrade tenants that simply have nothing vectorized yet.
        return False
    # No untagged rows, so `hi` is the true maximum. min == max == the
    # deployed tag proves the whole corpus sits in one space: ours.
    return bool(row.lo != current_tag or row.hi != current_tag)


async def vector_search(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    query_embedding: list[float],
    as_of: datetime | None,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
    arm_limit: int = ARM_LIMIT,
) -> list[tuple[UUID, float]]:
    """Semantic arm: HNSW cosine top-N as ``(memory_id, similarity)``.

    **Ties are broken in Python, deliberately not in SQL.** Cosine ties are
    common — any two records equidistant from the query, and under a sparse
    space every record sharing no vocabulary with it sits at the same
    distance — and Postgres returns tied rows in whatever physical order it
    finds them. Two identical queries therefore produced different
    rankings, which fed different RRF ranks and moved MRR by ~4% between
    runs: enough to masquerade as a ranking regression, and enough to make
    a recorded benchmark baseline meaningless (plan
    ``2026-07-29-memory-recall-efficacy-benchmark`` §6 item 2).

    Adding ``content_hash`` to the SQL ``ORDER BY`` fixes that and is the
    obvious move — but it silently **destroys the HNSW index scan**. A
    secondary sort key the index cannot provide forces the planner to a
    sequential scan plus a top-N sort: measured on 5k rows, `Index Scan
    using hnsw` (0.16 ms) became `Seq Scan` + heapsort (0.94 ms), and that
    gap widens LINEARLY with corpus size against a 500k-row per-tenant
    quota. So the SQL keeps its index-friendly distance-only ordering, and
    the stable tiebreak happens on the ``arm_limit``-bounded result set
    here, where it is free.

    ``content_hash`` is the tiebreak key because it derives from the
    content and is therefore identical across machines and across a
    re-seed; ``memory_id`` is a random UUID, so ordering on it alone is
    reproducible only within one corpus instance.
    """
    where, params = _validity_filters(
        kinds=kinds,
        scopes=scopes,
        scope_ref=scope_ref,
        min_importance=min_importance,
        since=since,
    )
    stmt = text(
        f"""
        SELECT r.memory_id,
               1 - (r.embedding <=> CAST(:qvec AS vector)) AS cosine_similarity,
               r.content_hash
        FROM coord.memory_records r
        WHERE {where} AND r.embedding IS NOT NULL
        ORDER BY r.embedding <=> CAST(:qvec AS vector)
        LIMIT :arm_limit
        """
    ).bindparams(bindparam("scopes", expanding=True))
    if "kinds" in params:
        stmt = stmt.bindparams(bindparam("kinds", expanding=True))
    rows = await session.execute(
        stmt,
        {
            **params,
            "tenant_id": tenant_id,
            "as_of": as_of,
            "qvec": format_pgvector(query_embedding),
            "arm_limit": arm_limit,
        },
    )
    # Stable tiebreak over the bounded result set — see the docstring for why
    # this is not an ORDER BY. Sorting on the NEGATED similarity keeps
    # best-first while making `content_hash` the ascending secondary key.
    hits = [
        (UUID(str(r.memory_id)), float(r.cosine_similarity), str(r.content_hash))
        for r in rows
    ]
    hits.sort(key=lambda h: (-h[1], h[2]))
    return [(memory_id, similarity) for memory_id, similarity, _hash in hits]


async def fts_search(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    query_text: str,
    as_of: datetime | None,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
    arm_limit: int = ARM_LIMIT,
) -> list[UUID]:
    """Lexical arm: websearch FTS top-N ids, ``ts_rank_cd``-ordered.

    ``content_hash`` then ``memory_id`` close the ordering for the same
    reproducibility reason as :func:`vector_search`: ``created_at`` alone
    does not break every tie, since records written in one batch share a
    transaction timestamp.

    Here the tiebreak IS in the SQL, unlike the vector arm — and the
    asymmetry is deliberate rather than an oversight. ``ts_rank_cd`` is
    computed per row, so no index can supply this ordering and the plan
    already pays for a top-N heapsort over the ``@@``-matched set; adding
    sort keys to a sort that must happen anyway is free (measured
    identical plan and runtime on 5k rows). The vector arm's ordering, by
    contrast, IS index-supplied, so the same change there would trade the
    HNSW scan for a sequential one.
    """
    where, params = _validity_filters(
        kinds=kinds,
        scopes=scopes,
        scope_ref=scope_ref,
        min_importance=min_importance,
        since=since,
    )
    stmt = text(
        f"""
        SELECT r.memory_id,
               ts_rank_cd(r.content_tsv,
                          websearch_to_tsquery('english', :q)) AS fts_score
        FROM coord.memory_records r
        WHERE {where}
          AND r.content_tsv @@ websearch_to_tsquery('english', :q)
        ORDER BY fts_score DESC, r.created_at DESC, r.content_hash, r.memory_id
        LIMIT :arm_limit
        """
    ).bindparams(bindparam("scopes", expanding=True))
    if "kinds" in params:
        stmt = stmt.bindparams(bindparam("kinds", expanding=True))
    rows = await session.execute(
        stmt,
        {
            **params,
            "tenant_id": tenant_id,
            "as_of": as_of,
            "q": query_text,
            "arm_limit": arm_limit,
        },
    )
    return [UUID(str(r.memory_id)) for r in rows]


# POSIX character-class names Postgres accepts inside a bracket expression.
# Anything else (``[:nope:]``) raises "invalid character class" AT MATCH TIME,
# which on this code path means a 500 on a request, so the translator emits a
# named class only when the name is in this set.
_POSIX_CLASS_NAMES = frozenset(
    {
        "alnum",
        "alpha",
        "ascii",
        "blank",
        "cntrl",
        "digit",
        "graph",
        "lower",
        "print",
        "punct",
        "space",
        "upper",
        "word",
        "xdigit",
    }
)


def _scan_bracket_group(glob: str, start: int) -> int | None:
    """Index of the ``]`` closing the group opened at ``start``, or None.

    ``start`` points at the ``[``. Handles the two positions where a
    ``]`` is NOT a terminator: immediately after the (optionally negated)
    opening bracket, where it is a literal; and inside a POSIX
    ``[: :]`` / ``[= =]`` / ``[. .]`` sub-expression, whose own closing
    ``]`` belongs to the sub-expression.

    That second case is the one the first cut of this function got wrong:
    scanning ``[[:alpha:]]`` naively stopped at the class's own ``]``,
    emitted ``[[:alpha:]`` and then escaped the real terminator, handing
    Postgres ``brackets [] not balanced``.
    """
    n = len(glob)
    j = start + 1
    if j < n and glob[j] in ("!", "^"):
        j += 1
    if j < n and glob[j] == "]":
        j += 1
    while j < n:
        if glob[j] == "[" and j + 1 < n and glob[j + 1] in (":", "=", "."):
            close = glob.find(glob[j + 1] + "]", j + 2)
            if close == -1:
                return None
            j = close + 2
            continue
        if glob[j] == "]":
            return j
        j += 1
    return None


def _translate_bracket_group(inner: str) -> str | None:
    """A provably-valid ARE bracket expression, or None to reject.

    This is a WHITELIST, not a sanitizer, and deliberately so. Postgres —
    not Python's ``re`` — is the authority on what ``~`` accepts, and the
    two genuinely disagree (Python happily compiles the malformed
    ``[[:alpha:]\\]`` this function's predecessor emitted). A
    compile-check against ``re`` would therefore hand back false
    confidence. Emitting only shapes we have positively verified is the
    only way a pure function can guarantee the operator will not raise.

    Accepted atoms: an optional leading negation, an optional leading
    literal ``]``, POSIX ``[:name:]`` classes with a known name, single
    literal characters, and ``a-b`` ranges with ``ord(a) <= ord(b)``.
    Everything else — an empty group, a backslash (special inside ARE
    brackets, unlike POSIX), an unknown class name, an equivalence class,
    a reversed range like ``[z-a]``, a ``-`` in a position ARE does not
    allow (``[a-b-c]``) — returns None, and the caller then emits the
    whole group as literal text.
    """
    body: list[str] = []
    if inner[:1] in ("!", "^"):
        body.append("^")
        inner = inner[1:]
    if not inner:
        return None
    out: list[str] = []
    i = 0
    n = len(inner)
    if inner[0] == "]":
        # A literal ']' is only legal as the first element.
        out.append("]")
        i = 1
    while i < n:
        c = inner[i]
        if c == "[" and i + 1 < n and inner[i + 1] == ":":
            close = inner.find(":]", i + 2)
            if close == -1:
                return None
            name = inner[i + 2 : close]
            if name not in _POSIX_CLASS_NAMES:
                return None
            out.append(f"[:{name}:]")
            i = close + 2
            continue
        if c in ("\\", "]") or (c == "[" and i + 1 < n and inner[i + 1] in ("=", ".")):
            return None
        # A range, but only when '-' sits between two literals.
        if i + 2 < n and inner[i + 1] == "-":
            lo, hi = c, inner[i + 2]
            if lo in ("\\", "[") or hi in ("\\", "]", "["):
                return None
            if ord(lo) > ord(hi):
                return None
            out.append(f"{lo}-{hi}")
            i += 3
            # ``[a-b-c]`` is invalid ARE: a '-' straight after a COMPLETED
            # range is neither a literal nor the start of another one.
            # Only a trailing '-' is a literal there.
            if i < n and inner[i] == "-" and i != n - 1:
                return None
            continue
        # A bare '-' is a literal only as the first or the last element.
        if c == "-" and out and i != n - 1:
            return None
        out.append(c)
        i += 1
    if not out:
        return None
    return "[" + "".join(body) + "".join(out) + "]"


def glob_to_posix_regex(glob: str) -> str:
    """Translate a path glob into an anchored POSIX ARE for Postgres ``~``.

    ``*`` -> ``.*``, ``?`` -> ``.``, ``[...]`` (with ``!`` negation
    normalised to ``^``) becomes a bracket expression, and every other
    character is escaped to a literal. ``**`` collapses to ``*``.

    ``*`` deliberately crosses ``/``, so ``backend/*`` matches
    ``backend/app/services/memory_store.py``. This is the FORGIVING
    direction on purpose: the failure this feature must not have is
    silently withholding a memory the session needed, and a
    slightly-over-inclusive recall is visible to the reader while a
    missing one is not.

    Translating rather than using ``LIKE`` is what keeps ``[...]``
    working — ``LIKE`` has no character classes, so a glob-to-LIKE
    rewrite would silently mis-match a class instead of failing.

    **The output is always a valid ARE.** This function feeds an operator
    on a REQUEST path, where an invalid pattern is not a bad match but a
    500 — and the inputs that produce one (``[z-a]``, ``[[:alpha:]]``)
    are ordinary glob syntax a caller can reasonably send, not attacks.
    Any bracket group :func:`_translate_bracket_group` will not vouch for
    is emitted as LITERAL text instead: the glob then matches a path that
    contains those characters verbatim. That is a DIFFERENT match set,
    not a subset — ``[z-a]`` stops matching ``a`` and starts matching the
    four characters ``[z-a]`` — so a degraded group can both miss records
    it was meant to find and, in principle, find one it was not. It is
    still the right trade against a 500: recall is advisory here (this is
    the proactive arm, and the caller also gets ``hits``), the degradation
    is confined to the one malformed clause, and the alternative is that
    the whole query fails.

    Catastrophic backtracking is NOT addressed here — a pathological
    ``*a*a*a*`` is still expensive. That is a separate, non-blocking
    concern (a statement timeout is its proper remedy, not a translator).
    """
    out: list[str] = ["^"]
    i = 0
    n = len(glob)
    while i < n:
        c = glob[i]
        if c == "*":
            while i + 1 < n and glob[i + 1] == "*":
                i += 1
            out.append(".*")
        elif c == "?":
            out.append(".")
        elif c == "[":
            end = _scan_bracket_group(glob, i)
            group = None if end is None else _translate_bracket_group(glob[i + 1 : end])
            if end is not None and group is not None:
                out.append(group)
                i = end
            else:
                # Unterminated, or a shape we will not vouch for: the
                # whole group degrades to literal text rather than
                # risking an invalid pattern at the operator.
                literal_end = i if end is None else end
                out.append(re.escape(glob[i : literal_end + 1]))
                i = literal_end
        else:
            out.append(re.escape(c))
        i += 1
    out.append("$")
    return "".join(out)


async def anchored_search(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    anchored_to: list[tuple[str, str]],
    as_of: datetime | None,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
    limit: int,
) -> list[UUID]:
    """Anchor-keyed proactive recall (plan §3.4 / Phase 5).

    Live records anchored to any of the ``(repo, path_glob)`` clauses,
    best-first by ``importance x freshness``. Tenant-bound and
    validity-filtered through the SAME :func:`_validity_filters` fragment
    the two retrieval arms use, so this arm can never surface a record
    the query arms would have hidden.

    Two-stage by construction, which is the whole reason the Phase 1 GIN
    index exists:

    1. ``anchors @> '[{"repo": ...}]'::jsonb`` per clause, OR-ed —
       a containment probe the default-``jsonb_ops`` GIN index answers,
       narrowing the corpus to rows anchored in those repos.
    2. The glob is applied AFTER, over the narrowed rows only, by
       expanding each row's array with ``jsonb_array_elements`` and
       matching ``path`` against the translated regex. Anchor types with
       no ``path`` (``pr`` / ``migration`` / ``schema`` / ``flag``) yield
       SQL NULL there and therefore never match — a ``pr`` anchor on the
       right repo is correctly not a path hit.

    Both stages must pass on the SAME anchor object, which is why stage 2
    re-checks ``repo``: without it, a record anchored to ``repo A/path X``
    and ``repo B/path Y`` would match the clause ``(A, Y*)`` that
    describes neither anchor.
    """
    if not anchored_to:
        return []
    where, params = _validity_filters(
        kinds=kinds,
        scopes=scopes,
        scope_ref=scope_ref,
        min_importance=min_importance,
        since=since,
    )
    containment: list[str] = []
    element_match: list[str] = []
    for idx, (repo, path_glob) in enumerate(anchored_to):
        containment.append(f"r.anchors @> CAST(:anchor_repo_{idx} AS jsonb)")
        element_match.append(
            f"(a->>'repo' = :anchor_repo_name_{idx}"
            f" AND a->>'path' ~ :anchor_path_re_{idx})"
        )
        params[f"anchor_repo_{idx}"] = json.dumps([{"repo": repo}])
        params[f"anchor_repo_name_{idx}"] = repo
        params[f"anchor_path_re_{idx}"] = glob_to_posix_regex(path_glob)
    stmt = text(
        f"""
        SELECT r.memory_id
        FROM coord.memory_records r
        WHERE {where}
          AND r.anchors <> '[]'::jsonb
          AND ({" OR ".join(containment)})
          AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(r.anchors) AS a
              WHERE {" OR ".join(element_match)}
          )
        ORDER BY {_retention_score_sql("now()")} DESC,
                 r.created_at DESC, r.memory_id DESC
        LIMIT :limit
        """
    ).bindparams(bindparam("scopes", expanding=True))
    if "kinds" in params:
        stmt = stmt.bindparams(bindparam("kinds", expanding=True))
    rows = await session.execute(
        stmt,
        {
            **params,
            "tenant_id": tenant_id,
            "as_of": as_of,
            "limit": limit,
        },
    )
    return [UUID(str(r.memory_id)) for r in rows]


async def fetch_records(
    session: AsyncSession, tenant_id: UUID, memory_ids: list[UUID]
) -> dict[UUID, dict[str, Any]]:
    """Full rows for ``memory_ids``, keyed by id. Tenant-bound."""
    if not memory_ids:
        return {}
    stmt = text(
        """
        SELECT memory_id, title, content, kind, scope, scope_ref,
               importance, created_at, source, anchors, anchor_state
        FROM coord.memory_records
        WHERE tenant_id = :tenant_id AND memory_id IN :ids
        """
    ).bindparams(bindparam("ids", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "ids": memory_ids})
    out: dict[UUID, dict[str, Any]] = {}
    for r in rows.mappings():
        d = dict(r)
        out[UUID(str(d["memory_id"]))] = d
    return out


async def bump_access(
    session: AsyncSession, tenant_id: UUID, memory_ids: list[UUID]
) -> None:
    """Single UPDATE: increment access counters on the returned rows."""
    if not memory_ids:
        return
    stmt = text(
        """
        UPDATE coord.memory_records
        SET access_count = access_count + 1,
            last_accessed_at = now()
        WHERE tenant_id = :tenant_id AND memory_id IN :ids
        """
    ).bindparams(bindparam("ids", expanding=True))
    await session.execute(stmt, {"tenant_id": tenant_id, "ids": memory_ids})


async def get_record(
    session: AsyncSession, tenant_id: UUID, memory_id: UUID
) -> dict[str, Any] | None:
    """One row by id, tenant-bound (cross-tenant reads come back None).

    Carries ``anchors`` because this is the row the supersede path
    inherits from: a successor that omits ``anchors`` takes its
    predecessor's, and it can only do that if they are read here.
    ``anchor_state`` is deliberately NOT selected — it is the watcher's
    verdict about the OLD row and is never inherited.
    """
    row = (
        (
            await session.execute(
                text(
                    """
                SELECT memory_id, tenant_id, scope, scope_ref, kind, title,
                       content, content_hash, importance, source, anchors,
                       is_tombstone, superseded_by, valid_from, valid_until,
                       created_at
                FROM coord.memory_records
                WHERE tenant_id = :tenant_id AND memory_id = :memory_id
                """
                ),
                {"tenant_id": tenant_id, "memory_id": memory_id},
            )
        )
        .mappings()
        .one_or_none()
    )
    return dict(row) if row is not None else None


async def mark_superseded(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    old_memory_id: UUID,
    new_memory_id: UUID,
) -> None:
    """Point the old row at its replacement and end its validity.

    Deliberately ignores ``source.lifecycle_hold``, unlike
    :func:`supersede_many`. This is NOT because every caller is explicit —
    it is not. Two callers reach here:

    * the memory API's supersede endpoint (explicit, human-initiated —
      how a held record is adjudicated), and
    * ``memory_bridge.bridge_sync_once``, which is fully AUTOMATIC (the
      scheduler's 15-minute ``memory_bridge_sync`` cadence).

    The hold is honoured for the automatic caller at its own SELECTOR
    instead: :func:`list_bridged_records` excludes held rows, so the
    bridge never obtains a held ``memory_id`` to pass here (or to
    :func:`tombstone_record`). Gating THIS function would break the
    explicit path, which must be able to override a hold — that override
    is what landing an adjudication means.

    So the rule is not "explicit callers only" but "automatic callers are
    gated at their selector". Any NEW automatic caller of this function
    must bring its own gate; adding one without it silently re-opens the
    hole this comment exists to name.

    Carries :func:`_supersede_target_is_safe`. This path is EXPLICIT, so a
    refused write RAISES rather than no-opping: a human asked for this edge
    and must be told it was rejected. The automatic set-based writers skip
    and log instead — a sweep must never abort (qontinui-web#904).
    """
    result = await session.execute(
        text(
            f"""
            UPDATE coord.memory_records
            SET superseded_by = :new_memory_id,
                valid_until = now(),
                updated_at = now()
            WHERE tenant_id = :tenant_id AND memory_id = :old_memory_id
              AND {_supersede_target_is_safe(target="new_memory_id")}
            """
        ),
        {
            "tenant_id": tenant_id,
            "old_memory_id": old_memory_id,
            "new_memory_id": new_memory_id,
        },
    )
    if int(cast("CursorResult[Any]", result).rowcount or 0) == 0:
        raise SupersedeRefused(
            f"refusing to supersede {old_memory_id} onto {new_memory_id}: "
            "either the subject row does not exist in this tenant, or the "
            "target is not live (tombstoned / superseded / validity ended), or "
            "the target already points back at this row, which would form a "
            "supersede cycle. Revive or re-point the target first."
        )


async def tombstone_record(
    session: AsyncSession, tenant_id: UUID, memory_id: UUID
) -> bool:
    """Tombstone one row; False when it doesn't exist for this tenant."""
    deleted = (
        await session.execute(
            text(
                """
                UPDATE coord.memory_records
                SET is_tombstone = true,
                    valid_until = now(),
                    updated_at = now()
                WHERE tenant_id = :tenant_id AND memory_id = :memory_id
                RETURNING memory_id
                """
            ),
            {"tenant_id": tenant_id, "memory_id": memory_id},
        )
    ).scalar_one_or_none()
    return deleted is not None


# ===========================================================================
# Librarian Phase 4 — coord.memory_links graph layer
# ===========================================================================
#
# Typed, directed edges between memory records (schema:
# ``backend/alembic/versions/coord_memory_links.py``). All edge SQL lives
# here with the rest of the ``coord.*`` memory literals.

# Ranking weights for the link-expansion retrieval arm
# (``2026-07-29-memory-link-expansion-retrieval-arm.md`` §3). Relation is
# WEIGHTED, never filtered: a stronger relation orders its neighbour
# earlier in the arm, but the arm's fused contribution is still
# ``1/(k + rank)``, so no weight can swamp the semantic arm. Higher is
# better. ``supersedes`` leads because the successor is almost always the
# record the caller actually wanted. Any relation absent from this map
# (a future vocabulary addition) weighs 0.0 — ranked last, never dropped.
LINK_RELATION_WEIGHTS: dict[str, float] = {
    "supersedes": 1.0,
    "depends_on": 0.8,
    "implements": 0.6,
    "related": 0.4,
}


@dataclass(frozen=True)
class MemoryLinkInsert:
    """One edge in a set-based :func:`insert_links_batch` call."""

    source_id: UUID
    target_id: UUID
    relation: str
    description: str | None


async def resolve_link_targets(
    session: AsyncSession, tenant_id: UUID, refs: list[str]
) -> dict[str, UUID]:
    """Resolve link ``target_ref`` strings to LIVE record ids, tenant-bound.

    Each ref is tried as a ``memory_id`` (UUID string) first, then as a
    ``content_hash``. Only LIVE rows (the dedup-liveness predicate —
    tombstoned / superseded / validity-ended rows never anchor an edge)
    resolve. Returns ``{ref: memory_id}`` for the refs that resolved;
    unresolved refs are simply absent (the caller drops + counts them).
    """
    if not refs:
        return {}
    unique_refs = list(dict.fromkeys(refs))
    resolved: dict[str, UUID] = {}

    uuid_by_ref: dict[str, UUID] = {}
    for ref in unique_refs:
        try:
            uuid_by_ref[ref] = UUID(ref)
        except ValueError:
            continue
    if uuid_by_ref:
        stmt = text(
            f"""
            SELECT memory_id FROM coord.memory_records
            WHERE tenant_id = :tenant_id AND memory_id IN :ids
              AND {_LIVE_DEDUP_PREDICATE}
            """
        ).bindparams(bindparam("ids", expanding=True))
        rows = await session.execute(
            stmt, {"tenant_id": tenant_id, "ids": list(set(uuid_by_ref.values()))}
        )
        found_ids = {UUID(str(r.memory_id)) for r in rows}
        for ref, candidate in uuid_by_ref.items():
            if candidate in found_ids:
                resolved[ref] = candidate

    remaining = [r for r in unique_refs if r not in resolved]
    if remaining:
        stmt = text(
            f"""
            SELECT memory_id, content_hash FROM coord.memory_records
            WHERE tenant_id = :tenant_id AND content_hash IN :hashes
              AND {_LIVE_DEDUP_PREDICATE}
            """
        ).bindparams(bindparam("hashes", expanding=True))
        rows = await session.execute(
            stmt, {"tenant_id": tenant_id, "hashes": remaining}
        )
        by_hash = {str(r.content_hash): UUID(str(r.memory_id)) for r in rows}
        for ref in remaining:
            if ref in by_hash:
                resolved[ref] = by_hash[ref]
    return resolved


async def insert_links_batch(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    items: list[MemoryLinkInsert],
) -> int:
    """Set-based edge upsert: ``ON CONFLICT DO NOTHING`` on the edge key.

    The conflict target is the ``uq_memory_links_edge`` unique index
    ``(tenant_id, source_id, target_id, relation)`` — re-declaring an
    existing edge is a silent no-op. Returns the number of edges
    actually inserted.
    """
    if not items:
        return 0
    stmt = text(
        """
        INSERT INTO coord.memory_links
            (tenant_id, source_id, target_id, relation, description)
        SELECT :tenant_id, u.source_id, u.target_id, u.relation, u.description
        FROM unnest(
                 CAST(:source_ids AS uuid[]),
                 CAST(:target_ids AS uuid[]),
                 CAST(:relations AS text[]),
                 CAST(:descriptions AS text[])
             ) AS u(source_id, target_id, relation, description)
        ON CONFLICT (tenant_id, source_id, target_id, relation) DO NOTHING
        RETURNING link_id
        """
    ).bindparams(
        bindparam("source_ids", type_=ARRAY(Text())),
        bindparam("target_ids", type_=ARRAY(Text())),
        bindparam("relations", type_=ARRAY(Text())),
        bindparam("descriptions", type_=ARRAY(Text())),
    )
    rows = await session.execute(
        stmt,
        {
            "tenant_id": tenant_id,
            "source_ids": [str(i.source_id) for i in items],
            "target_ids": [str(i.target_id) for i in items],
            "relations": [i.relation for i in items],
            "descriptions": [i.description for i in items],
        },
    )
    return len(rows.fetchall())


async def fetch_outbound_links(
    session: AsyncSession, tenant_id: UUID, source_ids: list[UUID]
) -> dict[UUID, list[dict[str, Any]]]:
    """Outbound edges for ``source_ids``, grouped by source. Tenant-bound."""
    if not source_ids:
        return {}
    stmt = text(
        """
        SELECT link_id, source_id, target_id, relation, description, created_at
        FROM coord.memory_links
        WHERE tenant_id = :tenant_id AND source_id IN :ids
        ORDER BY created_at ASC, link_id ASC
        """
    ).bindparams(bindparam("ids", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "ids": source_ids})
    out: dict[UUID, list[dict[str, Any]]] = {}
    for r in rows.mappings():
        d = dict(r)
        d["link_id"] = UUID(str(d["link_id"]))
        d["source_id"] = UUID(str(d["source_id"]))
        d["target_id"] = UUID(str(d["target_id"]))
        out.setdefault(d["source_id"], []).append(d)
    return out


async def link_expansion(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    seed_ids: list[UUID],
    as_of: datetime | None,
    kinds: list[str] | None,
    scopes: list[str],
    scope_ref: str | None,
    min_importance: float | None,
    since: datetime | None,
    arm_limit: int = ARM_LIMIT,
) -> list[UUID]:
    """Graph arm: one-hop neighbours of ``seed_ids``, best-first ids.

    The third RRF arm
    (``2026-07-29-memory-link-expansion-retrieval-arm.md``). ``seed_ids``
    are the head of the vector+FTS fuse, in rank order; the result is the
    records one edge away from them that the caller is allowed to see.

    Four properties are load-bearing:

    * **Bidirectional, spelled as a ``UNION ALL`` of two directional
      halves — never a single ``OR``.** An ``implements`` edge is
      evidence in both directions, so restricting to outbound (as
      :func:`graph_edges` does) would halve the recall benefit. But
      ``WHERE tenant_id = :t AND (source_id = ANY(...) OR target_id =
      ANY(...))`` leaves the planner to find a BitmapOr and degrades to a
      scan of the tenant's edge partition when it doesn't. Two halves let
      each drive its own index (``idx_memory_links_tenant_source`` /
      ``idx_memory_links_tenant_target``).
    * **Each half is a correlated ``LATERAL`` per seed, not a join
      against a seed relation.** This is the difference between the arm
      costing one index descent per seed and costing a scan of the
      tenant's whole edge partition, and it is NOT a matter of taste —
      it was measured (PostgreSQL 16, 100k records / 60k edges for the
      subject tenant among 201 tenants, EXPLAIN of the SQL SQLAlchemy
      actually emits, ``plan_cache_mode = force_generic_plan``). Spelled
      as a join against a ``seeds`` relation, PostgreSQL prices
      ``tenant_id = $1`` off ``ndistinct`` under a **generic** plan —
      ~309 rows, not the tenant's real ~60k — and picks a hash join,
      reading every edge the tenant owns and discarding ~99.9% of them:
      ``Index Cond: (tenant_id = $4)`` alone with **59,990 rows scanned
      to produce 7**, at 317 ms cold / 131 ms warm. Which half flips is
      planner-dependent
      (a variant of the same shape degraded in both halves at 72 ms), so
      neither half can be assumed safe. Two candidate fixes were measured
      and both FAILED: ``NOT MATERIALIZED`` on the seeds CTE still hash
      joins the full partition (25 ms), and the seed ids inlined as
      ``= ANY(:seeds)`` or ``IN (...)`` land the ScalarArrayOp as a
      post-scan ``Filter`` rather than an index cond (16 / 24 ms — still
      59,990 rows removed by filter). A ``LATERAL`` carrying a ``LIMIT``
      cannot be flattened into a hash join, so the parameterized inner
      index scan is *structural* rather than a planner preference:
      measured
      ``Index Cond: ((tenant_id = $4) AND (source_id = s.seed_id))`` on
      ``idx_memory_links_tenant_source`` and
      ``Index Cond: ((tenant_id = $4) AND (target_id = s_1.seed_id))``
      on ``idx_memory_links_tenant_target``, no ``Seq Scan`` at any node,
      at 1.6 ms. (Plan §7 item 7 is exactly this assertion.)
    * **Validity- and scope-filtered exactly like the other two arms.**
      The neighbour is JOINed to ``coord.memory_records`` and put through
      :func:`_validity_filters`. Without that join this arm would surface
      tombstoned records, validity-expired records, and — worst — another
      agent's or another session's ``scope_ref``-gated rows to a caller
      who never named that ref. That is a cross-principal leak, not a
      staleness bug. (:func:`graph_edges` has this hole today; the plan
      leaves ``POST /graph`` alone but the arm must not inherit it.)
    * **Seeds are excluded.** A seed already ranks in the arms that
      produced it; re-emitting it here would double-count it in the fuse.
      The exclusion sits INSIDE each ``LATERAL`` so a seed-to-seed edge
      cannot consume a fan-out slot it can never be emitted from.

    **Ranking is round-robin across seeds, not seed-major.** Each seed's
    neighbours are ranked within that seed (``relation_weight``
    descending — :data:`LINK_RELATION_WEIGHTS` — then ``neighbour_id`` as
    the deterministic tie-break), and the arm is ordered by
    ``(fanout_rank, seed_rank, relation_weight DESC, neighbour_id)``:
    every seed's best neighbour before any seed's second. Ordering
    seed-major instead (``seed_rank`` first) lets ONE hub seed drain the
    whole arm — a seed with 200 ``related`` edges would fill all
    ``arm_limit`` slots ordered by lowest UUID, which is uncorrelated
    with relevance, and seeds 2..N would contribute nothing. ``seed_rank``
    is 1-based (``WITH ORDINALITY``) and stays in the key as the
    tie-break between seeds at equal fan-out depth, so seed quality still
    matters — it just no longer starves.

    **Fan-out is capped per seed, before the validity join and the
    sort.** ``arm_limit`` doubles as the per-seed bound: no single seed
    can contribute more than the whole arm, so a tighter cap would be
    lossy (one seed legitimately supplies all 50 when the others have no
    neighbours) and a looser one would let a hub's degree drive the join
    and the sort. Uncapped, every edge touching any seed was
    materialized, joined and ``DISTINCT ON``-sorted before being cut to
    ``arm_limit`` — join and sort work that scaled with the hub's degree
    rather than with the arm's size. Measured on the same fixture, the
    validity join dropped from 217 probes to 66.

    A neighbour reachable from several seeds or relations is emitted
    ONCE, under its BEST (lowest fan-out rank, then lowest seed_rank,
    then highest weight) pairing.
    """
    if not seed_ids:
        return []
    where, params = _validity_filters(
        kinds=kinds,
        scopes=scopes,
        scope_ref=scope_ref,
        min_importance=min_importance,
        since=since,
    )
    stmt = text(
        f"""
        WITH seeds(seed_id, seed_rank) AS (
            SELECT s.seed_id, s.ord
            FROM unnest(CAST(:seed_ids AS uuid[]))
                 WITH ORDINALITY AS s(seed_id, ord)
        ),
        weights(relation, weight) AS (
            SELECT w.relation, w.weight
            FROM unnest(CAST(:link_relations AS text[]),
                        CAST(:link_weights AS float8[]))
                 AS w(relation, weight)
        ),
        neighbours(neighbour_id, seed_rank, relation_weight) AS (
            SELECT n.neighbour_id, s.seed_rank, n.relation_weight
            FROM seeds s
            CROSS JOIN LATERAL (
                SELECT l.target_id AS neighbour_id,
                       COALESCE(w.weight, 0.0) AS relation_weight
                FROM coord.memory_links l
                LEFT JOIN weights w ON w.relation = l.relation
                WHERE l.tenant_id = :tenant_id
                  AND l.source_id = s.seed_id
                  AND l.target_id <> ALL (CAST(:seed_ids AS uuid[]))
                ORDER BY COALESCE(w.weight, 0.0) DESC, l.target_id ASC
                LIMIT :arm_limit
            ) n
            UNION ALL
            SELECT n.neighbour_id, s.seed_rank, n.relation_weight
            FROM seeds s
            CROSS JOIN LATERAL (
                SELECT l.source_id AS neighbour_id,
                       COALESCE(w.weight, 0.0) AS relation_weight
                FROM coord.memory_links l
                LEFT JOIN weights w ON w.relation = l.relation
                WHERE l.tenant_id = :tenant_id
                  AND l.target_id = s.seed_id
                  AND l.source_id <> ALL (CAST(:seed_ids AS uuid[]))
                ORDER BY COALESCE(w.weight, 0.0) DESC, l.source_id ASC
                LIMIT :arm_limit
            ) n
        ),
        per_seed AS (
            SELECT DISTINCT ON (n.seed_rank, n.neighbour_id)
                   n.seed_rank AS seed_rank,
                   n.neighbour_id AS neighbour_id,
                   n.relation_weight AS relation_weight
            FROM neighbours n
            ORDER BY n.seed_rank, n.neighbour_id, n.relation_weight DESC
        ),
        capped AS (
            SELECT q.neighbour_id, q.seed_rank, q.relation_weight, q.fanout_rank
            FROM (
                SELECT p.neighbour_id, p.seed_rank, p.relation_weight,
                       ROW_NUMBER() OVER (
                           PARTITION BY p.seed_rank
                           ORDER BY p.relation_weight DESC, p.neighbour_id ASC
                       ) AS fanout_rank
                FROM per_seed p
            ) q
            WHERE q.fanout_rank <= :arm_limit
        ),
        best AS (
            SELECT DISTINCT ON (c.neighbour_id)
                   c.neighbour_id AS neighbour_id,
                   c.fanout_rank AS fanout_rank,
                   c.seed_rank AS seed_rank,
                   c.relation_weight AS relation_weight
            FROM capped c
            JOIN coord.memory_records r ON r.memory_id = c.neighbour_id
            WHERE {where}
            ORDER BY c.neighbour_id, c.fanout_rank ASC, c.seed_rank ASC,
                     c.relation_weight DESC
        )
        SELECT neighbour_id
        FROM best
        ORDER BY fanout_rank ASC, seed_rank ASC,
                 relation_weight DESC, neighbour_id ASC
        LIMIT :arm_limit
        """
    ).bindparams(
        bindparam("scopes", expanding=True),
        bindparam("seed_ids", type_=ARRAY(Text())),
        bindparam("link_relations", type_=ARRAY(Text())),
        bindparam("link_weights", type_=ARRAY(Float())),
    )
    if "kinds" in params:
        stmt = stmt.bindparams(bindparam("kinds", expanding=True))
    rows = await session.execute(
        stmt,
        {
            **params,
            "tenant_id": tenant_id,
            "as_of": as_of,
            "seed_ids": [str(s) for s in seed_ids],
            "link_relations": list(LINK_RELATION_WEIGHTS),
            "link_weights": list(LINK_RELATION_WEIGHTS.values()),
            "arm_limit": arm_limit,
        },
    )
    return [UUID(str(r.neighbour_id)) for r in rows]


async def graph_edges(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    root_id: UUID,
    depth: int,
    relations: list[str] | None,
) -> list[dict[str, Any]]:
    """Bounded outbound traversal from ``root_id`` over ``coord.memory_links``.

    One ``WITH RECURSIVE`` walk: level 1 is the root's outbound edges;
    each further level follows the targets' outbound edges, up to
    ``depth`` levels. Every arm is tenant-bound. Cycle safety is the
    depth cap itself — a cycle re-surfaces edges at increasing depth
    until the cap terminates the recursion, and the final DISTINCT
    collapses the repeats. Returns unique edge rows.
    """
    rel_clause = " AND l.relation IN :relations" if relations else ""
    stmt = text(
        f"""
        WITH RECURSIVE walk
            (link_id, source_id, target_id, relation, description,
             created_at, depth) AS (
            SELECT l.link_id, l.source_id, l.target_id, l.relation,
                   l.description, l.created_at, 1
            FROM coord.memory_links l
            WHERE l.tenant_id = :tenant_id
              AND l.source_id = :root_id{rel_clause}
            UNION
            SELECT l.link_id, l.source_id, l.target_id, l.relation,
                   l.description, l.created_at, w.depth + 1
            FROM coord.memory_links l
            JOIN walk w ON l.source_id = w.target_id
            WHERE l.tenant_id = :tenant_id
              AND w.depth < :depth{rel_clause}
        )
        SELECT DISTINCT link_id, source_id, target_id, relation,
                        description, created_at
        FROM walk
        ORDER BY created_at ASC, link_id ASC
        """
    )
    if relations:
        stmt = stmt.bindparams(bindparam("relations", expanding=True))
    params: dict[str, Any] = {
        "tenant_id": tenant_id,
        "root_id": root_id,
        "depth": depth,
    }
    if relations:
        params["relations"] = relations
    rows = await session.execute(stmt, params)
    out: list[dict[str, Any]] = []
    for r in rows.mappings():
        d = dict(r)
        d["link_id"] = UUID(str(d["link_id"]))
        d["source_id"] = UUID(str(d["source_id"]))
        d["target_id"] = UUID(str(d["target_id"]))
        out.append(d)
    return out


async def list_records_page(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    kinds: list[str] | None,
    since: datetime | None,
    cursor: tuple[datetime, UUID] | None,
    limit: int,
    now: datetime | None,
) -> list[dict[str, Any]]:
    """One keyset page of LIVE records, newest-first-stable.

    Liveness = not tombstoned, not superseded, validity not ended
    (matching retrieval visibility, and evaluated the same
    transaction-consistent way — ``now=None`` means "not at a
    caller-named instant", see :data:`_EFFECTIVE_NOW_SQL`). Ordering
    (and the keyset) is
    ``(created_at DESC, memory_id DESC)``; ``since`` filters on the
    freshest of ``updated_at`` / ``created_at`` so a sync pull picks up
    both new rows and in-place updates.
    """
    clauses = [
        "r.tenant_id = :tenant_id",
        "r.is_tombstone = false",
        "r.superseded_by IS NULL",
        "(r.valid_until IS NULL OR r.valid_until > COALESCE("
        "CAST(:now AS timestamptz), GREATEST(now(), r.updated_at, r.created_at)))",
    ]
    params: dict[str, Any] = {"tenant_id": tenant_id, "now": now, "limit": limit}
    if kinds:
        clauses.append("r.kind IN :kinds")
        params["kinds"] = kinds
    if since is not None:
        clauses.append("GREATEST(r.updated_at, r.created_at) > :since")
        params["since"] = since
    if cursor is not None:
        clauses.append(
            "(r.created_at, r.memory_id)"
            " < (CAST(:cursor_created_at AS timestamptz),"
            " CAST(:cursor_memory_id AS uuid))"
        )
        params["cursor_created_at"] = cursor[0]
        params["cursor_memory_id"] = cursor[1]
    stmt = text(
        f"""
        SELECT r.memory_id, r.title, r.content, r.kind, r.scope, r.scope_ref,
               r.importance, r.content_hash, r.created_at, r.updated_at,
               r.source, r.anchors, r.anchor_state
        FROM coord.memory_records r
        WHERE {" AND ".join(clauses)}
        ORDER BY r.created_at DESC, r.memory_id DESC
        LIMIT :limit
        """
    )
    if kinds:
        stmt = stmt.bindparams(bindparam("kinds", expanding=True))
    rows = await session.execute(stmt, params)
    out: list[dict[str, Any]] = []
    for r in rows.mappings():
        d = dict(r)
        d["memory_id"] = UUID(str(d["memory_id"]))
        d["importance"] = float(d["importance"])
        out.append(d)
    return out


# ===========================================================================
# Phase 4 — lifecycle sweeps (decay / consolidation / reindex)
# ===========================================================================


# The SQL retention-score expression. MUST stay in lockstep with
# ``memory_lifecycle.retention_score`` — the DB test asserts agreement.
# Age is measured against COALESCE(last_accessed_at, created_at) in days.
#
# ``now_expr`` exists so the SAME expression can serve two different
# clocks without being written twice. The sweeps bind an explicit
# ``:now`` (one instant for the whole pass, and the instant the test
# asserts Python agreement at); the Phase 5 anchored-recall ranking uses
# the database's ``now()`` directly, because it is a RANKING and has no
# business introducing an app-host clock read (or a second meaning for
# ``:now``) into a request path that deliberately has none — see
# :data:`_EFFECTIVE_NOW_SQL`. ``importance * exp(-age/horizon)`` IS
# "importance x freshness", so the anchored arm ranks on the store's one
# freshness curve rather than inventing a second one.
def _retention_score_sql(now_expr: str = "CAST(:now AS timestamptz)") -> str:
    return f"""
    importance * exp(
        -(EXTRACT(EPOCH FROM ({now_expr}
                              - COALESCE(last_accessed_at, created_at)))
          / 86400.0)
        / ({DECAY_BASE_HORIZON_DAYS}
           * (0.5 + LEAST(access_count, {DECAY_ACCESS_CAP})
                    / CAST({DECAY_ACCESS_CAP} AS double precision)))
    )
"""


_RETENTION_SCORE_SQL = _retention_score_sql()


def parse_pgvector(literal: str) -> list[float]:
    """Parse pgvector's text literal (``[v1,v2,...]``) back to floats."""
    inner = literal.strip().strip("[]")
    if not inner:
        return []
    return [float(part) for part in inner.split(",")]


async def compute_retention_scores(
    session: AsyncSession, tenant_id: UUID, *, now: datetime
) -> dict[UUID, float]:
    """SQL-side retention scores for a tenant's non-tombstone rows.

    Exists so tests can assert the SQL formula agrees with the pure
    Python :func:`memory_lifecycle.retention_score` on the same rows.
    """
    rows = await session.execute(
        text(
            f"""
            SELECT memory_id, {_RETENTION_SCORE_SQL} AS score
            FROM coord.memory_records
            WHERE tenant_id = :tenant_id AND is_tombstone = false
            """
        ),
        {"tenant_id": tenant_id, "now": now},
    )
    return {UUID(str(r.memory_id)): float(r.score) for r in rows}


def _anchor_restorable(prefix: str = "") -> str:
    """SQL predicate: this row is one :func:`anchor_gone_sweep` may un-hide.

    A row THIS sweep hid (``source.anchor_gone_at`` — never a user-set
    ``valid_until``, which carries no marker) whose watcher verdict is no
    longer ``gone``, and which no other mechanism has since terminated.

    Prefixable for the same reason :func:`_live_dedup_predicate` is: the
    restore correlates this table against ITSELF to break a tie between
    two mutually-restorable rows, so both sides need the identical
    predicate under different aliases. Writing it twice by hand is
    exactly how the tie-break and the set it is meant to arbitrate would
    drift apart.

    ``prefix`` is a table alias with its trailing dot (``"r."``).
    """
    return f"""
        {prefix}anchor_state <> 'gone'
        AND {prefix}anchors <> '[]'::jsonb
        AND jsonb_exists({prefix}source, 'anchor_gone_at')
        AND {prefix}valid_until IS NOT NULL
        AND {prefix}is_tombstone = false
        AND {prefix}superseded_by IS NULL
        AND {_not_lifecycle_held(prefix)}
    """


async def decay_invalidate(
    session: AsyncSession, *, now: datetime, threshold: float
) -> int:
    """Set-based decay sweep: end validity of rows scoring below threshold.

    Rows become retrieval-invisible (``valid_until = :now``) — NOT
    deleted. Each is stamped ``source.decayed_at`` so the later physical
    prune can distinguish decay-invalidated rows from rows whose
    ``valid_until`` was set by an explicit temporal validity. Returns
    the number of rows invalidated.

    Rows held by :func:`_not_lifecycle_held` are skipped. Decay is fully
    automatic (daily ``memory_decay``), so it is exactly the class of
    writer the hold exists to hold OFF: a held record left to decay goes
    retrieval-invisible while a human is still adjudicating it, and the
    ``source.decayed_at`` stamp it earns here is what later makes it
    eligible for the PHYSICAL delete in :func:`decay_prune`.

    **ANCHORED rows are exempt** (``anchors = '[]'::jsonb``; plan
    ``2026-07-29-memory-anchored-derived-records`` §3.2). A record that
    names its ground truth is not a timeless narrative assertion whose
    confidence erodes with age — it is true exactly as long as the
    artifact holds, so age is evidence neither way and its visibility is
    governed by ``anchor_state`` via :func:`anchor_gone_sweep` instead.
    Keying the exemption on the anchor ARRAY (rather than on a separate
    provenance enum) is what makes "decay-exempt but uninvalidatable"
    unrepresentable: exempt and anchored are the same bit.

    The ``::jsonb`` cast is load-bearing, not decorative — ``jsonb =
    unknown`` has no resolvable operator, and it is the same spelling the
    migration's partial index predicate uses, so the planner can match it.
    """
    result = await session.execute(
        text(
            f"""
            UPDATE coord.memory_records
            SET valid_until = :now,
                updated_at = :now,
                source = source
                    || jsonb_build_object('decayed_at',
                                          CAST(:now_iso AS text))
            WHERE is_tombstone = false
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
              AND anchors = '[]'::jsonb
              AND {_not_lifecycle_held()}
              AND {_RETENTION_SCORE_SQL} < :threshold
            """
        ),
        {"now": now, "now_iso": now.isoformat(), "threshold": threshold},
    )
    return int(cast("CursorResult[Any]", result).rowcount or 0)


async def anchor_gone_sweep(
    session: AsyncSession, *, now: datetime
) -> tuple[int, int, int]:
    """The ``gone``/un-``gone`` half of the daily pass (plan §3.2 + Phase 3).

    Two set-based UPDATEs over disjoint row sets plus one observability
    count, returning ``(hidden, restored, restore_blocked)``:

    1. **Hide.** ``anchor_state = 'gone'`` — every anchor the record has
       resolved to "no longer exists" (the roll-up is unanimity-gated, so
       a single dead anchor among live ones is ``moved``, never this) —
       gets ``valid_until = :now``, which is the existing retrieval
       -invisibility mechanism and needs no new machinery.
    2. **Restore.** A row this sweep hid whose ``anchor_state`` is no
       longer ``gone`` gets ``valid_until`` back to NULL.

    Two constraints make this safe, and both are load-bearing:

    * **It must NOT stamp ``source.decayed_at``.** :func:`decay_prune`
      physically DELETEs any row whose ``valid_until`` is older than the
      90-day grace AND which carries a terminal marker — tombstone,
      ``superseded_by``, or ``jsonb_exists(source, 'decayed_at')``.
      Reusing ``decayed_at`` would let a single watcher misfire
      permanently destroy a true memory 90 days later. This sweep stamps
      a DISTINCT ``source.anchor_gone_at``, which no prune predicate
      reads — so a ``gone`` record is hidden but always recoverable.
      Hiding is reversible; deletion is not.
    * **``anchor_gone_at`` is also the provenance token that makes
      un-invalidation safe.** A file is restored, a revert lands, a
      resolver bug is fixed — without step 2 a single false ``gone`` is
      permanent, which is exactly what the watcher's failure discipline
      was written to avoid. Step 2 therefore keys on the marker, NEVER on
      ``valid_until`` alone: a user-set ``valid_until`` carries no marker
      and is never touched.

    Both halves honour :func:`_not_lifecycle_held`, symmetrically. The
    hide half must (it is an automatic writer that hides a live record —
    the hold's whole purpose); the restore half does for the same reason
    read the other way — while a human is mid-adjudication the automatic
    path leaves the row exactly as they found it. A held row is not
    stranded by this: ``anchor_gone_at`` is not a prune marker, and
    releasing the hold lets the next daily pass restore it.

    Both halves are idempotent: after the hide, ``valid_until`` is no
    longer in the future so the row drops out; after the restore, the
    marker is gone so the row drops out.

    **The restore is the only writer in this module that sets
    ``valid_until`` back to NULL, which makes it the only one that can
    push a row back INTO the partial unique index**
    ``uq_memory_records_tenant_content_hash_live`` (partial on
    ``is_tombstone = false AND superseded_by IS NULL AND valid_until IS
    NULL``). Ending validity is what FREES a content hash for a fresh
    write; un-ending it can therefore collide with whatever took the hash
    in the meantime. Three guards follow from that, and none is
    optional — the first two each close a DIFFERENT way the collision
    arises, and the third keeps the restore from resurrecting a row some
    other mechanism deliberately terminated:

    * **The live-twin guard.** Row R is hidden as ``gone``; any writer
      re-writes the same content, sees no live row for that hash, and
      inserts R2; the anchor comes back and the restore tries to make R
      live again -> ``duplicate key value violates unique constraint``.
      Because the whole daily pass runs in ONE transaction
      (``scheduler._run_committed``), that exception rolls back
      :func:`decay_invalidate` and skips :func:`decay_prune` and
      :func:`expire_closed_session_records` — and it re-raises at 03:10
      every night thereafter. One restorable anchor would permanently
      disable the entire memory lifecycle. So a row with a live twin is
      SKIPPED, and — deliberately — **keeps its ``anchor_gone_at``
      marker** so a later night retries once the twin is gone. Dropping
      the marker would make R permanently unrestorable; tombstoning R
      would destroy a row on the strength of a watcher verdict. Nothing
      is lost by waiting: R2 carries byte-identical content and is live.
      The skip is counted and returned so it is observable rather than
      silent.
    * **The mutual-restore tie-break.** The live-twin probe alone is not
      enough, because two rows sharing a hash can BOTH be restorable in
      the same pass, and then neither has a live twin — being non-live is
      what makes them restorable. One statement would push both into the
      index and raise the same fatal violation. The restore is therefore
      capped at one row per ``(tenant_id, content_hash)``, lowest
      ``memory_id`` winning, with the deferred rows folded into the
      blocked count. See ``earlier_restorable_peer`` below for the full
      reachability argument; the short version is that it needs no race,
      only a re-post of identical content while the anchor is gone.
    * **The liveness guards.** The restore carries ``is_tombstone =
      false`` and ``superseded_by IS NULL`` — the hide half's guard plus
      the one it did not need. A hidden row is still supersedable
      (:func:`get_record` has no liveness gate), and
      :func:`_validity_filters` enforces supersession PURELY through
      ``valid_until``, never through ``superseded_by``. So NULLing
      ``valid_until`` on a superseded row would return it to retrieval to
      compete with its own successor, and leave it permanently
      unprunable. §7.5b is about un-hiding a WATCHER verdict; it is never
      about resurrecting a row a human or the consolidation path
      terminated.

    ``anchors <> '[]'::jsonb`` on both halves is what lets the planner
    use the partial index ``idx_memory_records_tenant_anchor_state``; it
    is also simply true of every row either half can legitimately touch.
    """
    # One text for the restorable set and one each for the two ways a
    # restore must stand down, all shared by the UPDATE and the
    # blocked-count query so they can never drift into disagreeing about
    # what was skipped.
    restorable = _anchor_restorable("r.")
    live_twin = f"""
        EXISTS (
            SELECT 1
            FROM coord.memory_records live
            WHERE live.tenant_id = r.tenant_id
              AND live.content_hash = r.content_hash
              AND live.memory_id <> r.memory_id
              AND {_live_dedup_predicate("live.")}
        )
    """
    # The MUTUAL-restore collision the live-twin probe cannot see. Two
    # rows can share a content hash and both be restorable at once, and
    # then neither has a LIVE twin — being non-live is exactly what makes
    # them restorable — so the probe above passes for both and one
    # statement pushes both into the partial unique index.
    #
    # It is reachable by ordinary operations, not by a race: row A
    # anchored to X is hidden when X goes gone, which frees hash H;
    # ``existing_hashes`` and the ON CONFLICT arbiter both key on
    # :data:`_LIVE_DEDUP_PREDICATE`, so a writer re-posting identical
    # content sees nothing live and inserts B with the same H — and,
    # identical content implying identical ground truth, the same anchor;
    # X is still gone so B is hidden too; X comes back and A and B roll
    # up to ``fresh`` in lockstep.
    #
    # So the restore is made AT MOST ONE ROW PER (tenant_id,
    # content_hash) by a deterministic tie-break: lowest ``memory_id``
    # wins. UUIDs carry a total order, so the winner is stable across
    # runs and does not depend on scan order. The deferred rows keep
    # their ``anchor_gone_at`` marker and are folded into the blocked
    # count, so the warning fires for them; from the next pass on they
    # are blocked by the ordinary live-twin probe instead, because the
    # winner is live by then. Nothing is lost either way — every row in
    # the group carries byte-identical content.
    earlier_restorable_peer = f"""
        EXISTS (
            SELECT 1
            FROM coord.memory_records o
            WHERE o.tenant_id = r.tenant_id
              AND o.content_hash = r.content_hash
              AND o.memory_id < r.memory_id
              AND {_anchor_restorable("o.")}
        )
    """
    hidden = await session.execute(
        text(
            f"""
            UPDATE coord.memory_records
            SET valid_until = :now,
                updated_at = :now,
                source = source
                    || jsonb_build_object('anchor_gone_at',
                                          CAST(:now_iso AS text))
            WHERE anchor_state = 'gone'
              AND anchors <> '[]'::jsonb
              AND is_tombstone = false
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
              AND {_not_lifecycle_held()}
            """
        ),
        {"now": now, "now_iso": now.isoformat()},
    )
    restored = await session.execute(
        text(
            f"""
            UPDATE coord.memory_records AS r
            SET valid_until = NULL,
                updated_at = :now,
                source = r.source - 'anchor_gone_at'
            WHERE {restorable}
              AND NOT {live_twin}
              AND NOT {earlier_restorable_peer}
            """
        ),
        {"now": now},
    )
    blocked = (
        await session.execute(
            text(
                f"""
                SELECT count(*)
                FROM coord.memory_records AS r
                WHERE {restorable}
                  AND ({live_twin} OR {earlier_restorable_peer})
                """
            )
        )
    ).scalar_one()
    return (
        int(cast("CursorResult[Any]", hidden).rowcount or 0),
        int(cast("CursorResult[Any]", restored).rowcount or 0),
        int(blocked),
    )


async def decay_prune(session: AsyncSession, *, now: datetime, grace_days: int) -> int:
    """Physically delete rows invisible for longer than the grace period.

    Eligible rows: ``valid_until`` older than ``grace_days`` AND at
    least one terminal marker — tombstoned, superseded, or
    decay-invalidated (``source.decayed_at``). Rows with an explicit
    (user-set) ``valid_until`` and no terminal marker are never pruned.

    Inbound ``superseded_by`` references from surviving rows are NULLed
    in the same statement so the self-FK never blocks the delete.

    One CTE-based statement: victims are derived in SQL, never
    materialized into bind lists (a large sweep would otherwise expand
    thousands of ``IN (...)`` binds three times over).

    Rows held by :func:`_not_lifecycle_held` are never victims, and this
    is the most important of the hold's gates. Every other sweep only
    makes a record invisible; this one DELETES it, and permanent loss of
    the evidence a human is mid-adjudication over is the worst outcome
    the lifecycle can produce — a hold that still permits it protects
    nothing.

    It also matters INDEPENDENTLY of :func:`decay_invalidate`'s gate. The
    ``superseded_by IS NOT NULL`` arm makes any already-superseded row a
    victim once the grace window passes, including rows superseded BEFORE
    the hold was applied — which is the common case, since being wrongly
    auto-superseded is usually what prompts the hold. Without this
    predicate a hold would preserve that evidence only until the grace
    expired; with it, indefinitely.
    """
    prune_predicate = f"""
        valid_until IS NOT NULL
        AND valid_until < CAST(:now AS timestamptz)
                          - make_interval(days => :grace_days)
        AND (is_tombstone = true
             OR superseded_by IS NOT NULL
             OR jsonb_exists(source, 'decayed_at'))
        AND {_not_lifecycle_held()}
    """
    # The UPDATE and DELETE target disjoint row sets (cleared explicitly
    # excludes victims), and the self-FK's deferred check runs after the
    # whole statement — by which point every surviving inbound reference
    # has been NULLed.
    result = await session.execute(
        text(
            f"""
            WITH victims AS (
                SELECT memory_id FROM coord.memory_records
                WHERE {prune_predicate}
            ),
            cleared AS (
                UPDATE coord.memory_records
                SET superseded_by = NULL, updated_at = :now
                WHERE superseded_by IN (SELECT memory_id FROM victims)
                  AND memory_id NOT IN (SELECT memory_id FROM victims)
            )
            DELETE FROM coord.memory_records
            WHERE memory_id IN (SELECT memory_id FROM victims)
            """
        ),
        {"now": now, "grace_days": grace_days},
    )
    return int(cast("CursorResult[Any]", result).rowcount or 0)


async def list_tenants_with_live_records(
    session: AsyncSession, *, now: datetime
) -> list[UUID]:
    """Tenants holding at least one live (visible) memory record."""
    rows = await session.execute(
        text(
            """
            SELECT DISTINCT tenant_id
            FROM coord.memory_records
            WHERE is_tombstone = false
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
            ORDER BY tenant_id
            """
        ),
        {"now": now},
    )
    return [UUID(str(r.tenant_id)) for r in rows]


# A canonical UUID text shape — used to guard ``scope_ref::uuid`` casts so a
# malformed (non-UUID) scope_ref never reaches the cast and aborts the sweep.
_UUID_TEXT_RE = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"
    r"-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


async def expire_closed_session_records(session: AsyncSession, *, now: datetime) -> int:
    """Expire ``scope='session'`` rows 7 days after their session closed.

    Two set-based UPDATEs, both idempotent (a second run is a no-op) and
    both defended against a malformed ``scope_ref``:

    1. **Closed-session rows.** Live (``is_tombstone=false`` &&
       ``superseded_by IS NULL``) ``scope='session'`` rows whose
       ``scope_ref`` names a ``coord.sessions`` row in ``state='closed'``
       get ``valid_until = closed_at + 7 days`` — but only when that
       tightens (or first sets) their validity, so re-running changes
       nothing.
    2. **Orphan rows.** Live ``scope='session'`` rows older than 24h
       whose ``scope_ref`` matches NO ``coord.sessions`` row (including
       non-UUID scope_refs) get ``valid_until = created_at + 7 days``.
       A session id that never existed must not grant a row immortality.

    The ``scope_ref::uuid`` cast is only ever reached for rows whose
    ``scope_ref`` matches :data:`_UUID_TEXT_RE`: pass 1 filters + casts
    inside a MATERIALIZED CTE (the regex WHERE runs before the projected
    cast, and MATERIALIZED forbids the planner from inlining/reordering);
    pass 2 wraps the cast in a ``CASE`` so a non-matching scope_ref
    yields NULL (no session match) instead of a cast error.

    Both passes skip rows held by :func:`_not_lifecycle_held`. This sweep
    is automatic (bundled into the daily ``decay_once``) and ends a live
    row's validity, so a held session-scoped record would go
    retrieval-invisible mid-adjudication — and, once invisible, becomes
    prune-eligible by way of any other terminal marker it carries.

    Returns the total number of rows expired across both passes.
    """
    closed = await session.execute(
        text(
            f"""
            WITH candidates AS MATERIALIZED (
                SELECT r.memory_id,
                       r.valid_until,
                       r.scope_ref::uuid AS session_uuid
                FROM coord.memory_records r
                WHERE r.scope = 'session'
                  AND r.is_tombstone = false
                  AND r.superseded_by IS NULL
                  AND {_not_lifecycle_held("r.")}
                  AND r.scope_ref ~ '{_UUID_TEXT_RE}'
            )
            UPDATE coord.memory_records r
            SET valid_until = s.closed_at + interval '7 days',
                updated_at = CAST(:now AS timestamptz)
            FROM candidates c
            JOIN coord.sessions s ON s.id = c.session_uuid
            WHERE r.memory_id = c.memory_id
              AND s.state = 'closed'
              AND s.closed_at IS NOT NULL
              AND (
                    c.valid_until IS NULL
                    OR c.valid_until > s.closed_at + interval '7 days'
                  )
            """
        ),
        {"now": now},
    )
    closed_count = int(cast("CursorResult[Any]", closed).rowcount or 0)

    orphans = await session.execute(
        text(
            f"""
            UPDATE coord.memory_records r
            SET valid_until = r.created_at + interval '7 days',
                updated_at = CAST(:now AS timestamptz)
            WHERE r.scope = 'session'
              AND r.is_tombstone = false
              AND r.superseded_by IS NULL
              AND {_not_lifecycle_held("r.")}
              AND r.created_at < CAST(:now AS timestamptz) - interval '24 hours'
              AND (
                    r.valid_until IS NULL
                    OR r.valid_until > r.created_at + interval '7 days'
                  )
              AND NOT EXISTS (
                    SELECT 1
                    FROM coord.sessions s
                    WHERE s.id = CASE
                        WHEN r.scope_ref ~ '{_UUID_TEXT_RE}'
                        THEN r.scope_ref::uuid
                        ELSE NULL
                    END
                  )
            """
        ),
        {"now": now},
    )
    orphan_count = int(cast("CursorResult[Any]", orphans).rowcount or 0)

    total = closed_count + orphan_count
    if total:
        logger.info(
            "memory_session_expiry_completed",
            closed_expired=closed_count,
            orphans_expired=orphan_count,
        )
    return total


def _not_lifecycle_held(prefix: str = "") -> str:
    """SQL predicate: this row is NOT held out of the automatic lifecycle path.

    ``source.lifecycle_hold = true`` takes one record out of every
    AUTOMATIC lifecycle sweep while a human adjudicates it. That is more
    than supersession — every scheduled writer that can end, hide or
    delete a record must honour it, or the hold protects nothing:

    * consolidation — :func:`find_near_duplicate_pairs` (1 supersede per
      pair), :func:`fetch_cluster_candidates` (N-1 per cluster) and
      :func:`supersede_many` (the in-flight-job apply gate),
    * decay — :func:`decay_invalidate` and :func:`decay_prune`,
    * session expiry — :func:`expire_closed_session_records`,
    * the MEMORY.md bridge — :func:`list_bridged_records`.

    Honouring only some leaves the record reachable by the rest.

    The comparison is on TEXT (``->>``), deliberately never a
    ``::boolean`` cast. A cast raises on a malformed value
    (``"lifecycle_hold": "yes"``) and that error aborts the ENTIRE sweep
    for EVERY tenant — the same failure class :data:`_UUID_TEXT_RE`
    exists to keep away from ``scope_ref::uuid``. Text comparison cannot
    throw. It fails OPEN (a malformed value leaves that record eligible),
    which is the correct trade: a mis-set flag on one record is
    recoverable, a sweep that aborts fleet-wide is not.

    ``lower(...)`` keeps that no-cast/never-throws property while still
    catching a hand-typed ``"True"``/``"TRUE"``, and a case mismatch would
    silently leave the record fully collectable while reading as
    protected. :func:`set_lifecycle_hold` is now the supported writer and
    emits a real JSON boolean, so nothing this predicate reads from the
    API path can be mis-cased or malformed — but holds applied by raw SQL
    before it existed are still out there, and raw SQL remains available,
    so the case-folding and the fail-open text comparison both stay. This
    predicate defends against the value it CANNOT constrain, not against
    the one writer that is well-behaved.

    ``IS DISTINCT FROM`` (not ``!=``) because ``->>`` yields NULL for an
    absent key, and NULL ``!= 'true'`` is NULL, not TRUE — every unflagged
    row would drop out of the result set. It also gives the explicit
    ``"lifecycle_hold": false`` its meaning: NOT held. That value records
    "this record was adjudicated and released", a state a presence-only
    check (``jsonb_exists``, the idiom used for ``source.decayed_at``)
    could not express.

    ``prefix`` is a table alias with its trailing dot (``"a."``) for the
    self-join, empty for a single-table query.
    """
    return f"lower({prefix}source->>'lifecycle_hold') IS DISTINCT FROM 'true'"


async def set_lifecycle_hold(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    memory_id: UUID,
    held: bool,
    now: datetime,
) -> bool:
    """Apply (``held=True``) or release (``held=False``) one record's hold.

    The WRITER for the flag :func:`_not_lifecycle_held` reads. Until this
    existed the seven gates listed there were reachable only by raw SQL
    against the live database, which is why that predicate case-folds:
    hand-typed was the only way a hold could be set.

    Three properties this writer establishes that raw SQL could not:

    * **The value is a real JSON boolean**, built by
      ``jsonb_build_object`` from a bound ``bool`` — never a string. So
      ``source->>'lifecycle_hold'`` is exactly ``'true'`` or ``'false'``
      here, and the malformed (``"yes"``) and mixed-case (``"True"``)
      values that forced the predicate's ``lower()`` and its fail-open
      text comparison cannot ORIGINATE from this path. Those defences
      stay: they still cover the holds already applied by hand, and
      fail-open on a value this function cannot produce is strictly
      better than a cast that aborts a fleet-wide sweep.
    * **Release writes an explicit ``false``, never a key deletion.**
      ``false`` means "adjudicated and released" — a state
      :func:`_not_lifecycle_held` deliberately distinguishes from an
      absent key, and the marker that makes "still held" a countable
      measure of what is left to adjudicate (see
      :func:`count_lifecycle_held`).
    * **Shallow-merges into ``source``**, so the ``origin`` / ``import``
      / ``decayed_at`` keys other paths key on survive untouched.

    Deliberately carries NO liveness filter, and that is a load-bearing
    choice rather than an omission. The hold's most important gate is
    :func:`decay_prune`, whose ``superseded_by IS NOT NULL`` arm makes
    an ALREADY-superseded row a victim once the grace window passes — and
    a record that was wrongly auto-superseded is the common reason to
    apply a hold in the first place. A liveness filter here would refuse
    the hold on exactly the rows that most need it, leaving their
    evidence to be physically deleted at the grace boundary. Tombstoned
    and superseded records are therefore holdable, matching
    :func:`get_record`, which the API's 404 check uses and which is
    likewise validity-blind.

    Returns True when a row in ``tenant_id`` matched (False maps to 404;
    a cross-tenant ``memory_id`` is never disclosed as existing).
    """
    updated = (
        await session.execute(
            text(
                """
                UPDATE coord.memory_records
                SET source = COALESCE(source, '{}'::jsonb)
                             || jsonb_build_object('lifecycle_hold',
                                                   CAST(:held AS boolean)),
                    updated_at = :now
                WHERE tenant_id = :tenant_id AND memory_id = :memory_id
                RETURNING memory_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "memory_id": memory_id,
                "held": held,
                "now": now,
            },
        )
    ).scalar_one_or_none()
    return updated is not None


async def count_lifecycle_held(session: AsyncSession, tenant_id: UUID) -> int:
    """How many of ``tenant_id``'s records are held out of the lifecycle.

    Expressed as the exact negation of :func:`_not_lifecycle_held` rather
    than as its own copy of the comparison, so the count and the seven
    gates can never drift apart — including on the malformed-value
    edge, where a row the gates leave collectable is correctly NOT
    counted as held.

    Counts regardless of liveness, for the same reason
    :func:`set_lifecycle_hold` writes regardless of it: a hold on a
    superseded row is the case that matters most, and a live-only count
    would under-report the adjudication backlog by exactly the rows the
    hold is protecting from :func:`decay_prune`.
    """
    row = (
        await session.execute(
            text(
                f"""
                SELECT count(*) AS held
                FROM coord.memory_records
                WHERE tenant_id = :tenant_id
                  AND NOT ({_not_lifecycle_held()})
                """
            ),
            {"tenant_id": tenant_id},
        )
    ).one()
    return int(row.held)


async def find_near_duplicate_pairs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    now: datetime,
    min_similarity: float,
    window_days: int,
    pair_limit: int,
) -> list[tuple[DupCandidate, DupCandidate]]:
    """Near-duplicate candidate pairs via a bounded pgvector self-join.

    Same tenant, same kind, both live and embedded, cosine similarity
    above ``min_similarity`` (``<=>`` distance below ``1 - min_similarity``).
    The left side is bounded to rows created inside ``window_days`` and
    the pair batch is capped at ``pair_limit`` per run, tightest pairs
    first. ``a.memory_id < b.memory_id`` de-duplicates the symmetric join.

    Rows held by :func:`_not_lifecycle_held` are excluded from BOTH sides:
    a held row is under human adjudication, and ``apply_merge`` supersedes
    the loser of every pair returned here, so a held row that reached this
    result set would be collapsed by the heuristic the hold exists to
    pre-empt. Excluding one side would not be enough — the hold has to
    survive whichever side of the join the row lands on.

    **ANCHORED rows are excluded from BOTH sides too, on the same
    grounds and by the same both-sides reasoning** (plan
    ``2026-07-29-memory-anchored-derived-records`` §3.2; the predicate is
    spelled exactly as in :func:`decay_invalidate` and
    :func:`fetch_cluster_candidates` so all three read as ONE rule).
    :func:`apply_merge` supersedes the loser unconditionally, and
    ``superseded_by`` IS one of :func:`decay_prune`'s terminal markers —
    so without this a near-dup merge invalidates an anchored record as
    thoroughly as decay would have AND puts it on a path to a physical
    delete, which is precisely what the exemption exists to prevent.

    This arm is BROADER than the clustering one: 0.95 cosine over a
    90-day window across ALL kinds, where :func:`fetch_cluster_candidates`
    only ever sees ``episode`` (it read ``episode``/``observation`` until
    #932 narrowed it, which widens this gap rather than closing it). It
    also runs FIRST in
    ``consolidate_tenant``, so an anchored row reaches it before the
    clustering gate ever gets a chance.

    Gating the SELECTOR (rather than :func:`apply_merge`) is the hold's
    precedent: with anchored rows excluded from both join sides, no pair
    this returns was anchored AS OF THIS SELECT, so ``apply_merge``'s
    fold — which carries ``importance`` and ``access_count`` across but
    NOT ``anchors`` — has nothing to drop.

    **"As of this SELECT" is the whole caveat, and it is a real window,
    not a formality.** ``consolidate_tenant`` runs at READ COMMITTED, so
    an anchor committed BETWEEN this SELECT and :func:`apply_merge` is
    invisible here and the loser is still superseded — exactly the window
    that function's own docstring already documents for the sibling
    lifecycle-hold gate, and left open there for the same reasons. The
    consequence is worse for anchors than for holds: ``apply_merge`` sets
    ``superseded_by``, which IS one of :func:`decay_prune`'s terminal
    markers, so a record anchored inside that window is not merely hidden
    but on a 90-day path to physical deletion.

    Re-checking in :func:`apply_merge`'s loser UPDATE would NOT be the
    fix — it would no-op the loser while the survivor UPDATE still folded
    in that loser's ``importance`` and ``access_count``, double-counting
    them into a row whose partner never died. Closing this properly means
    making the pair application atomic with its selection, which is the
    same open question the hold has; it is deliberately not solved here.
    Do not read the paragraph above as "anchored rows cannot reach
    ``apply_merge``" — read it as "anchored rows cannot be SELECTED",
    which is a narrower claim and the only one this predicate makes.
    """
    rows = await session.execute(
        text(
            f"""
            SELECT a.memory_id  AS id_a,
                   a.importance AS importance_a,
                   a.access_count AS access_a,
                   a.created_at AS created_a,
                   b.memory_id  AS id_b,
                   b.importance AS importance_b,
                   b.access_count AS access_b,
                   b.created_at AS created_b
            FROM coord.memory_records a
            JOIN coord.memory_records b
              ON b.tenant_id = a.tenant_id
             AND b.kind = a.kind
             AND b.memory_id > a.memory_id
            WHERE a.tenant_id = :tenant_id
              AND a.is_tombstone = false AND b.is_tombstone = false
              AND (a.valid_until IS NULL
                   OR a.valid_until > CAST(:now AS timestamptz))
              AND (b.valid_until IS NULL
                   OR b.valid_until > CAST(:now AS timestamptz))
              AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
              AND a.created_at > CAST(:now AS timestamptz)
                                 - make_interval(days => :window_days)
              AND a.anchors = '[]'::jsonb
              AND b.anchors = '[]'::jsonb
              AND {_not_lifecycle_held("a.")}
              AND {_not_lifecycle_held("b.")}
              AND (a.embedding <=> b.embedding) < :max_distance
            ORDER BY (a.embedding <=> b.embedding)
            LIMIT :pair_limit
            """
        ),
        {
            "tenant_id": tenant_id,
            "now": now,
            "window_days": window_days,
            "max_distance": 1.0 - min_similarity,
            "pair_limit": pair_limit,
        },
    )
    pairs: list[tuple[DupCandidate, DupCandidate]] = []
    for r in rows:
        pairs.append(
            (
                DupCandidate(
                    memory_id=UUID(str(r.id_a)),
                    importance=float(r.importance_a),
                    access_count=int(r.access_a),
                    created_at=r.created_a,
                ),
                DupCandidate(
                    memory_id=UUID(str(r.id_b)),
                    importance=float(r.importance_b),
                    access_count=int(r.access_b),
                    created_at=r.created_b,
                ),
            )
        )
    return pairs


async def apply_merge(
    session: AsyncSession,
    tenant_id: UUID,
    decision: MergeDecision,
    *,
    now: datetime,
) -> None:
    """Apply one near-dup merge: supersede loser, then fold into survivor.

    The supersede runs FIRST, and the fold is skipped when it is refused.
    Folding first would leave the fold standing on a refusal — and
    ``folded_access_count`` is a SUM, so a pair that keeps failing the guard
    (both rows still live, same kind, still inside the ``window_days``
    selector) re-folds every pass and the survivor's ``access_count`` compounds
    without bound. ``access_count`` feeds ``retention_score``, so that inflates
    the survivor's decay resistance off a merge that never happened.
    """
    result = await session.execute(
        text(
            f"""
            UPDATE coord.memory_records
            SET superseded_by = :survivor_id,
                valid_until = :now,
                updated_at = :now
            WHERE tenant_id = :tenant_id AND memory_id = :loser_id
              AND {_supersede_target_is_safe(target="survivor_id")}
            """
        ),
        {
            "tenant_id": tenant_id,
            "survivor_id": decision.survivor_id,
            "loser_id": decision.loser_id,
            "now": now,
        },
    )
    if int(cast("CursorResult[Any]", result).rowcount or 0) != 0:
        await session.execute(
            text(
                """
                UPDATE coord.memory_records
                SET importance = :importance,
                    access_count = :access_count,
                    updated_at = :now
                WHERE tenant_id = :tenant_id AND memory_id = :survivor_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "survivor_id": decision.survivor_id,
                "importance": decision.folded_importance,
                "access_count": decision.folded_access_count,
                "now": now,
            },
        )
    if int(cast("CursorResult[Any]", result).rowcount or 0) == 0:
        logger.warning(
            "memory_supersede_refused_near_duplicate_fold",
            loser_id=str(decision.loser_id),
            survivor_id=str(decision.survivor_id),
            tenant_id=str(tenant_id),
            reason=(
                "survivor is not live, or it already points back at the loser "
                "(back-edge). The importance/access_count fold was SKIPPED too, "
                "so the merge is a complete no-op; the two rows stay separate "
                "and live."
            ),
        )


async def fetch_cluster_candidates(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    now: datetime,
    limit: int,
) -> list[dict[str, Any]]:
    """Live ``episode`` rows for synthesis clustering.

    Returns oldest-first dicts with the parsed embedding (each carries
    ``memory_id, title, content, importance, created_at, embedding``).

    ## Why ``episode`` only

    This selector used to read ``kind IN ('episode', 'observation')``, and that
    ``observation`` term cost 597 hand-authored documents.

    Consolidation is destructive by construction: `record_synthesis_result`
    supersedes every member behind the distilled ``mental_model``, and
    ``superseded_by`` is one of the three terminal markers `decay_prune` reads,
    so a consumed member is deleted 90 days later. That endpoint is correct for
    EPISODES — a hundred "ran the suite, green" events genuinely are disposable
    once you hold "the suite is stable" — and this function's own producer says
    so: `synthesis_job_input` is documented as "One episode cluster, as a
    ``synthesis`` job."

    ``observation`` is a different animal. It is the DEFAULT kind for
    general-purpose writes (`coord_memory_record`'s mapping sends `project`
    notes there), so including it pointed a summarizer at the general case
    rather than the episodic one. On 2026-07-28 the weekly sweep consumed 597
    imported topic-file documents that way — an 11,235-byte document replaced in
    retrieval by a 1,203-byte paraphrase, 1.5 ms after the paraphrase was
    written. Measured afterwards: 643 invisible ``origin='topic-file'`` rows,
    597 superseded onto a ``source.synthesis_job`` row, and ZERO clock-decayed.
    Supersession, not decay, is what consumed the corpus.

    Narrowing to the kind this path was designed for fixes that at the source
    rather than by exempting classes one at a time. The alternative considered
    and rejected was re-keying those documents onto a non-consolidatable kind:
    it repairs a closed historical population (the file sync retired in Phase
    3b) while leaving every NEW ``observation`` — which is what agents write
    today — enrolled in the same lifecycle.

    Near-duplicate merge (`find_near_duplicate_pairs`, cosine > 0.95) is a
    SEPARATE supersede path, and the KIND narrowing above deliberately does
    not extend to it: collapsing genuine duplicates is not lossy in the way
    distillation is, so it still runs across all kinds. (It does carry the
    anchor term below — that exemption is about the anchor, not the kind, and
    applies to every path that supersedes a row it did not author.)

    Rows held by :func:`_not_lifecycle_held` are excluded. This is the
    DOMINANT supersede path of the two: a cluster that survives synthesis
    has every member but the distilled replacement superseded (N-1 rows
    per cluster, via ``supersede_many`` when the runner posts its result),
    and clustering only needs cosine > ``CLUSTER_SIMILARITY`` (0.75) — far
    looser than the near-dup 0.95. Excluding a held row here is what keeps
    it out of a cluster in the first place, so no synthesis job enqueued
    AFTER the flag was set ever names it as a member. Jobs enqueued
    BEFORE it was set already do, which is why ``supersede_many`` re-checks
    the hold at apply time.

    **ANCHORED rows are excluded on exactly the same grounds as the decay
    exemption**, and the predicate is written byte-for-byte the same
    (``anchors = '[]'::jsonb``) so the two read as ONE rule applied to the
    two lifecycle mechanisms rather than as two coincidences —
    see :func:`decay_invalidate`, plan
    ``2026-07-29-memory-anchored-derived-records`` §3.2. Without it the
    plan's thesis is defeated in the most direct way available: Phase 3
    makes an anchored record immune to the clock, and then a clustering
    job supersedes it anyway. Supersession invalidates it exactly as
    thoroughly as decay would have, and is STRICTLY WORSE — unlike the
    ``anchor_gone_at`` marker, ``superseded_by`` IS one of
    :func:`decay_prune`'s terminal markers, so it ends in a physical
    delete 90 days later. A record that survives the clock and dies to a
    clustering job has not been invalidated by its ground truth.

    Keyed on ``anchors``, never on kind or origin — §3.2's "one column
    decides both the lifecycle and the invalidation source", so no record
    can sit in an inconsistent combination of the two. Do not "clean up"
    this predicate without also removing the decay one; they are the same
    rule and neither is meaningful alone.

    ## The two terms are INDEPENDENT — do not collapse them

    ``kind = 'episode'`` and ``anchors = '[]'::jsonb`` arrived from two
    different investigations and neither implies the other. Spelled out
    because they now sit on adjacent lines of one ``WHERE``, which is exactly
    the shape that invites a future reader to delete one as redundant:

    * The KIND term says ``observation`` was never the right kind for a
      distillation path that supersedes its members — it is about which
      POPULATION consolidation was designed for. It would be correct even if
      anchors had never been built.
    * The ANCHOR term says a record whose truth is owned by an external
      artifact is invalidated by that artifact and by nothing else — it is
      about the INVALIDATION SOURCE, and it is applied identically to
      ``decay_invalidate``, ``supersede_many`` and both join sides of
      ``find_near_duplicate_pairs``, none of which carry the kind term.
      It would be correct even if consolidation still read observations.

    Their conjunction has a real, INTENDED consequence: **an anchored episode
    stops consolidating.** That is not an accident of stacking two filters. An
    anchored episode is a claim about a live artifact, and the whole point of
    Phase 3 is that such a claim is retired by its anchor going ``gone``, not
    by being folded into a summary that then prunes it. Removing either term
    to "let anchored episodes cluster again" reopens a defect that cost 597
    documents (the kind term) or defeats the plan's central thesis (the anchor
    term). Remove neither without the other's investigation redone.
    """
    rows = await session.execute(
        text(
            f"""
            SELECT memory_id, title, content, importance, created_at,
                   CAST(embedding AS text) AS embedding_text
            FROM coord.memory_records
            WHERE tenant_id = :tenant_id
              AND kind = 'episode'
              AND is_tombstone = false
              AND superseded_by IS NULL
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
              AND embedding IS NOT NULL
              AND anchors = '[]'::jsonb
              AND {_not_lifecycle_held()}
            ORDER BY created_at ASC, memory_id ASC
            LIMIT :limit
            """
        ),
        {"tenant_id": tenant_id, "now": now, "limit": limit},
    )
    out: list[dict[str, Any]] = []
    for r in rows.mappings():
        d = dict(r)
        d["memory_id"] = UUID(str(d["memory_id"]))
        d["embedding"] = parse_pgvector(d.pop("embedding_text"))
        d["importance"] = float(d["importance"])
        out.append(d)
    return out


async def supersede_many(
    session: AsyncSession,
    tenant_id: UUID,
    member_ids: list[UUID],
    new_memory_id: UUID,
    *,
    now: datetime,
) -> None:
    """Point ``member_ids`` at their consolidated replacement (set-based).

    Rows held by :func:`_not_lifecycle_held` are skipped. This is the LAST
    gate of the automatic supersede path, and it is what makes "a held
    record is never superseded automatically" a TOTAL invariant rather
    than a best-effort one. ``fetch_cluster_candidates`` keeps a held row
    out of new clusters, but a synthesis job enqueued BEFORE the flag was
    set already names it in ``target_ids``, and this is the only place
    that job's supersession is applied. Consolidation enqueues every 10
    minutes, so there is almost always such a job in flight at the moment
    a hold is set: without this predicate the hold has a race window, and
    a hold with a race window is worse than no hold — it reads as
    protection while silently failing.

    The one objection — a ``mental_model`` whose ``consolidated_from``
    cites a still-live row — is benign. ``consolidated_from`` is
    PROVENANCE, not an exclusivity claim, and a live member alongside an
    additive synthesized row is exactly the pre-supersession state. It
    self-corrects when the hold is released and the next cluster forms.

    Deliberately ASYMMETRIC with :func:`mark_superseded`, which honours no
    hold: automatic supersession respects the flag, explicit
    caller-initiated supersession (how a held record is adjudicated)
    overrides it.

    **The anchor exemption is applied here too, for the same reason the
    hold is** — and following the hold's idiom rather than inventing a
    second one. :func:`fetch_cluster_candidates` keeps an anchored row out
    of NEW clusters, but consolidation enqueues every 10 minutes, so a job
    that named a row while it was still anchorless is almost always in
    flight at the moment Phase 6's dedup-merge backfills an anchor onto
    it. This is the only place that job's supersession is applied, so
    without the re-check the exemption has exactly the race window the
    hold's own docstring calls "worse than no hold — it reads as
    protection while silently failing".
    """
    if not member_ids:
        return
    stmt = text(
        f"""
        UPDATE coord.memory_records
        SET superseded_by = :new_memory_id,
            valid_until = :now,
            updated_at = :now
        WHERE tenant_id = :tenant_id AND memory_id IN :member_ids
          AND anchors = '[]'::jsonb
          AND {_not_lifecycle_held()}
          AND {_supersede_target_is_safe(target="new_memory_id")}
        """
    ).bindparams(bindparam("member_ids", expanding=True))
    result = await session.execute(
        stmt,
        {
            "tenant_id": tenant_id,
            "member_ids": member_ids,
            "new_memory_id": new_memory_id,
            "now": now,
        },
    )
    # A skipped member is either lifecycle-HELD or guard-REFUSED, and the two
    # mean opposite things: a held member is routine (the hold is working), a
    # refusal means the target is dead or a cycle exists. Reporting one mixed
    # count would bury the corruption signal in routine noise on every pass.
    #
    # They separate cleanly because the guard reads the TARGET only, and the
    # target is the same for every member: either it is safe and every skip is
    # a hold, or it is unsafe and every member was refused. So one probe of the
    # target attributes the whole batch — no per-row query.
    skipped = len(member_ids) - int(cast("CursorResult[Any]", result).rowcount or 0)
    if skipped > 0:
        # Spelled out rather than reusing `_supersede_target_is_safe`: that
        # fragment's back-edge arm is CORRELATED to the UPDATE's current row
        # (`memory_records.memory_id`), which has no referent in a bare SELECT.
        # The batch question is "does the target point back at ANY member".
        target_safe = bool(
            await session.scalar(
                text(
                    f"""
                    SELECT EXISTS (
                        SELECT 1 FROM coord.memory_records tgt
                         WHERE tgt.memory_id = :new_memory_id
                           AND {_live_predicate_for("tgt")}
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM coord.memory_records back
                         WHERE back.memory_id = :new_memory_id
                           AND back.superseded_by
                               = ANY(CAST(:member_ids AS uuid[]))
                    )
                    """
                ),
                {
                    "new_memory_id": new_memory_id,
                    "member_ids": [str(m) for m in member_ids],
                },
            )
        )
        if target_safe:
            logger.info(
                "memory_supersede_skipped_held_members",
                held=skipped,
                requested=len(member_ids),
                new_memory_id=str(new_memory_id),
                tenant_id=str(tenant_id),
            )
        else:
            logger.warning(
                "memory_supersede_refused_unsafe_target",
                refused=skipped,
                requested=len(member_ids),
                new_memory_id=str(new_memory_id),
                tenant_id=str(tenant_id),
                reason=(
                    "the consolidation target is not live, or it already points "
                    "back at a member (a back-edge that would form a cycle)"
                ),
            )


# ===========================================================================
# Corruption detection (Change 4)
#
# The 2026-08-04 incident's whole cost was that supersede corruption was only
# discoverable by wedging a migration — and therefore the fleet. These are the
# cheap periodic reads that surface it BEFORE it becomes a migration-time
# abort. Read-only by construction: none of them writes.
# ===========================================================================

# A part-suffixed title, reduced to its DOCUMENT identity. Chunked imports
# title parts "<doc> (part i/n)"; `memhold_adjudicate_02._CHUNK_TITLE` matches
# the same shape.
_PART_SUFFIX_RE = r"\s*\(part\s+\d+\s*/\s*\d+\)\s*$"


async def find_supersede_cycles(
    session: AsyncSession, *, tenant_id: UUID | None = None
) -> list[dict[str, Any]]:
    """Supersede 2-cycles: A→B while B→A. Expected empty.

    This is the shape `memhold_adjudicate_01` minted on 2026-08-01 and the
    one that failed `_02`'s ``not_live`` invariant. Measured 0 fleet-wide on
    2026-08-05 — this exists to keep it 0.

    ``a.memory_id < b.memory_id`` de-duplicates the symmetric join: a cycle
    satisfies the join from BOTH ends, so without it every cycle is reported
    twice and any count derived from this reads double.
    """
    where = "WHERE b.superseded_by = a.memory_id AND a.memory_id < b.memory_id"
    params: dict[str, Any] = {}
    if tenant_id is not None:
        where += " AND a.tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id
    rows = await session.execute(
        text(
            f"""
            SELECT a.memory_id AS a_id, b.memory_id AS b_id,
                   a.tenant_id, a.title AS a_title, b.title AS b_title
              FROM coord.memory_records a
              JOIN coord.memory_records b ON b.memory_id = a.superseded_by
            {where}
            """
        ),
        params,
    )
    return [dict(r) for r in rows.mappings()]


async def find_supersede_edges_into_non_live(
    session: AsyncSession, *, tenant_id: UUID | None = None
) -> list[dict[str, Any]]:
    """Rows superseded onto a target that is itself NOT live.

    The GENERAL defect a liveness-as-sort-key ranking produces; the 2-cycle
    is only its most spectacular special case. A cycle check alone would have
    MISSED ``4a14e94e…``, whose damage is a chain — part 1/2 → a dead
    sync-conflict sidecar → the live part 2/2 — not a cycle.
    """
    where = (
        "WHERE m.superseded_by IS NOT NULL AND NOT (" + _live_predicate_for("s") + ")"
    )
    params: dict[str, Any] = {}
    if tenant_id is not None:
        where += " AND m.tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id
    rows = await session.execute(
        text(
            f"""
            SELECT m.memory_id, m.tenant_id, m.title,
                   s.memory_id AS target_id, s.title AS target_title
              FROM coord.memory_records m
              JOIN coord.memory_records s ON s.memory_id = m.superseded_by
            {where}
            ORDER BY m.title
            """
        ),
        params,
    )
    return [dict(r) for r in rows.mappings()]


async def find_orphaned_document_parts(
    session: AsyncSession, *, tenant_id: UUID | None = None
) -> list[dict[str, Any]]:
    """Non-live part-N of a multi-part document whose other parts are LIVE.

    The shape that silently loses half a document: the orphan leaves
    retrieval while its siblings stay, and `decay_prune` physically DELETEs
    it once ``valid_until`` passes the 90-day grace.

    ⚠️ The predicate requires the superseder to be a DIFFERENT document.
    Without that term this also matches ordinary re-import dedup — part 1 of
    an import superseded onto part 1 of a LATER import of the same file — and
    "reviving" one of those resurrects a duplicate. Measured 2026-08-05: the
    loose shape matches 8 rows, of which 1 is exactly that false positive
    (``f689235f``, ``MEMORY.pre-compaction-2026-07-08``).
    """
    where = ""
    params: dict[str, Any] = {}
    if tenant_id is not None:
        where = "AND p.tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id
    rows = await session.execute(
        text(
            f"""
            WITH parts AS (
                SELECT memory_id, tenant_id, title, source,
                       regexp_replace(title, '{_PART_SUFFIX_RE}', '') AS doc,
                       superseded_by, valid_until, is_tombstone,
                       ({_LIVE_DEDUP_PREDICATE}) AS is_live
                  FROM coord.memory_records
                 WHERE title ~ '\\(part\\s+\\d+\\s*/\\s*\\d+\\)'
            )
            SELECT p.memory_id, p.tenant_id, p.doc, p.valid_until,
                   p.superseded_by, s.title AS superseder_title
              FROM parts p
              JOIN coord.memory_records s ON s.memory_id = p.superseded_by
             WHERE NOT p.is_live
               AND p.is_tombstone = false
               AND EXISTS (
                    SELECT 1 FROM parts sib
                     WHERE sib.tenant_id = p.tenant_id AND sib.doc = p.doc
                       AND sib.is_live AND sib.memory_id <> p.memory_id
               )
               AND regexp_replace(s.title, '{_PART_SUFFIX_RE}', '')
                   IS DISTINCT FROM p.doc
               {where}
             ORDER BY p.doc
            """
        ),
        params,
    )
    return [dict(r) for r in rows.mappings()]


def cluster_items_from_rows(rows: list[dict[str, Any]]) -> list[ClusterItem]:
    """Adapt :func:`fetch_cluster_candidates` rows to clustering items."""
    return [
        ClusterItem(
            memory_id=r["memory_id"],
            embedding=r["embedding"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


async def fetch_reindex_batch(
    session: AsyncSession, *, current_tag: str, limit: int
) -> list[tuple[UUID, UUID, str]]:
    """One batch of ``(tenant_id, memory_id, content)`` needing (re-)embedding.

    ``tenant_id`` rides along because the sweep now ENQUEUES these rows
    rather than embedding them, and a job is tenant-bound (the claim is);
    the sweep itself stays tenant-agnostic, so its caller groups by tenant.

    Targets rows whose ``embedding_model`` differs from the deployed tag
    (including NULL) or whose ``embedding`` is NULL (the Bug-1b drift
    class), skipping tombstones. Oldest-first for stable progress.

    Rows with an IN-FLIGHT (``pending`` / ``claimed``) embedding job are
    excluded. This is what makes the sweep's enqueue loop TERMINATE: the
    sweep no longer embeds inline, so a row it queues stays un-embedded
    until a runner drains it, and without this exclusion every batch in
    the loop — and every subsequent daily run — would re-select the same
    oldest rows forever. ``done`` is deliberately NOT excluded here: a
    row that was actually embedded now has a non-NULL ``embedding`` at the
    deployed tag, so it drops out of this query on its own merits
    regardless of any ``done`` job. A ``done``-BUT-UNAPPLIED embedding job
    (the runner marked the job done without writing vectors, so the row's
    ``embedding`` is still NULL / at the wrong tag) legitimately
    re-selects here — and the kind-aware ``enqueue_jobs`` dedupe (a done
    embedding no longer participates in the live-input index) is what lets
    it be re-queued, even under the SAME tag. Excluding only in-flight
    jobs here is therefore the exact complement of that dedupe: together
    they let a stuck row heal without ever double-queuing a live one.
    """
    rows = await session.execute(
        text(
            """
            SELECT r.tenant_id, r.memory_id, r.content
            FROM coord.memory_records r
            WHERE r.is_tombstone = false
              AND (r.embedding_model IS DISTINCT FROM :current_tag
                   OR r.embedding IS NULL)
              AND NOT EXISTS (
                  SELECT 1
                  FROM coord.memory_jobs j
                  WHERE j.kind = 'embedding'
                    AND j.status IN ('pending', 'claimed')
                    AND j.target_ids @> ARRAY[r.memory_id]
              )
            ORDER BY r.created_at ASC, r.memory_id ASC
            LIMIT :limit
            """
        ),
        {"current_tag": current_tag, "limit": limit},
    )
    return [
        (UUID(str(r.tenant_id)), UUID(str(r.memory_id)), str(r.content)) for r in rows
    ]


async def update_embeddings(
    session: AsyncSession,
    updates: list[tuple[UUID, list[float]]],
    *,
    tag: str,
    now: datetime,
) -> None:
    """Write re-computed embeddings + the current model tag (executemany)."""
    if not updates:
        return
    await session.execute(
        text(
            """
            UPDATE coord.memory_records
            SET embedding = CAST(:embedding AS vector),
                embedding_model = :tag,
                updated_at = :now
            WHERE memory_id = :memory_id
            """
        ),
        [
            {
                "memory_id": memory_id,
                "embedding": format_pgvector(vector),
                "tag": tag,
                "now": now,
            }
            for memory_id, vector in updates
        ],
    )


# ===========================================================================
# Phase 5 — MEMORY.md bridge (coord.memories_latest → memory_records)
# ===========================================================================

# ``source.bridge`` discriminator on bridged reference records.
BRIDGE_SOURCE_NAME = "coord.memories"


async def list_bridge_source_keys(
    session: AsyncSession,
) -> list[tuple[UUID, str, int]]:
    """(tenant_id, name, version) for every latest live coord memory.

    Reads the ``coord.memories_latest`` view (latest non-tombstoned
    version per name). Rows without a tenant binding are skipped — the
    bridge writes into ``coord.memory_records``, whose ``tenant_id`` is
    NOT NULL.
    """
    rows = await session.execute(
        text(
            """
            SELECT tenant_id, name, version
            FROM coord.memories_latest
            WHERE tenant_id IS NOT NULL
            """
        )
    )
    return [(UUID(str(r.tenant_id)), str(r.name), int(r.version)) for r in rows]


async def fetch_bridge_source_contents(
    session: AsyncSession, tenant_id: UUID, names: list[str]
) -> dict[str, tuple[int, str]]:
    """``{name: (version, content)}`` for the named latest coord memories."""
    if not names:
        return {}
    stmt = text(
        """
        SELECT name, version, content
        FROM coord.memories_latest
        WHERE tenant_id = :tenant_id AND name IN :names
        """
    ).bindparams(bindparam("names", expanding=True))
    rows = await session.execute(stmt, {"tenant_id": tenant_id, "names": names})
    return {str(r.name): (int(r.version), str(r.content)) for r in rows}


async def list_bridged_records(
    session: AsyncSession, *, now: datetime
) -> dict[tuple[UUID, str], tuple[UUID, int]]:
    """Live bridged records: ``{(tenant_id, name): (memory_id, version)}``.

    A bridged record is a live (non-tombstone, non-superseded, valid)
    ``reference`` row whose ``source.bridge`` names the coord memories
    bridge.

    Rows held by :func:`_not_lifecycle_held` are excluded, and THIS is the
    bridge's lifecycle-hold gate. ``bridge_sync_once`` is fully automatic
    (15-minute cadence) and this selector is the sole source of the ids it
    hands to :func:`mark_superseded` (a version bump on an existing name)
    and :func:`tombstone_record` (a name that vanished upstream) — both of
    which deliberately honour no hold, because the explicit API path uses
    them to LAND an adjudication. Gating them would break that; gating
    this selector closes both automatic writes at once.

    A held row therefore drops out of ``bridged``, which makes its name
    look absent to the diff, so the pass re-upserts it as a NEW record
    (or dedups onto the held row itself when the content is unchanged).
    That is additive and harmless — the adjudicator's row stays live and
    intact — and it converges the moment the hold is released.
    """
    rows = await session.execute(
        text(
            f"""
            SELECT tenant_id, memory_id,
                   source->>'memory_name' AS memory_name,
                   CAST(source->>'version' AS bigint) AS version
            FROM coord.memory_records
            WHERE kind = 'reference'
              AND source->>'bridge' = :bridge
              AND is_tombstone = false
              AND superseded_by IS NULL
              AND (valid_until IS NULL OR valid_until > CAST(:now AS timestamptz))
              AND source->>'memory_name' IS NOT NULL
              AND {_not_lifecycle_held()}
            """
        ),
        {"bridge": BRIDGE_SOURCE_NAME, "now": now},
    )
    return {
        (UUID(str(r.tenant_id)), str(r.memory_name)): (
            UUID(str(r.memory_id)),
            int(r.version),
        )
        for r in rows
    }


async def merge_record_source(
    session: AsyncSession,
    tenant_id: UUID,
    memory_id: UUID,
    patch: dict[str, Any],
    *,
    now: datetime,
) -> None:
    """Shallow-merge ``patch`` into a record's ``source`` JSONB."""
    await session.execute(
        text(
            """
            UPDATE coord.memory_records
            SET source = source || CAST(:patch AS jsonb),
                updated_at = :now
            WHERE tenant_id = :tenant_id AND memory_id = :memory_id
            """
        ),
        {
            "tenant_id": tenant_id,
            "memory_id": memory_id,
            "patch": json.dumps(patch),
            "now": now,
        },
    )


# ===========================================================================
# Phase 2 — the generic, kind-dispatched job queue (coord.memory_jobs)
# ===========================================================================
#
# Backend-initiated work that the RUNNER executes and pays for. Two kinds
# ride the one queue:
#
# * ``synthesis`` — this backend clusters episode memories but ships no
#   LLM client, so it cannot distill them into a ``mental_model``.
# * ``embedding`` — this backend no longer loads an embedding model on any
#   path (``2026-07-13-runner-paid-embedding``), so rows land unvectorized
#   and something else must compute their vectors.
#
# Both are the same shape of thing — "here is text; do local compute; post
# the result back" — so they share one table, one claim endpoint, one
# reaper and one runner loop, dispatched on ``kind``. The alternative
# (a second queue) would have duplicated all four for no gain.
#
# Every ``coord.*`` SQL literal for this flow lives here alongside the
# memory_records SQL.

# A claimed job that has sat this long without a result is presumed dead
# and requeued by the reaper (its runner crashed / lost its lease).
JOB_CLAIM_STALE_MINUTES = 30

# After this many failed attempts a job is abandoned (status='failed')
# rather than requeued again.
JOB_MAX_ATTEMPTS = 3

# The queue's dispatch discriminator — mirrors the migration's CHECK.
JOB_KINDS: tuple[str, ...] = ("synthesis", "embedding")


class JobNotClaimedError(Exception):
    """A result/failure was posted for a job not in ``'claimed'`` status.

    The contract is claim -> result: a runner posts back only for a job it
    holds a live claim on. A job that is ``pending`` (never claimed, or
    requeued to the queue by the reaper), ``done`` (already applied), or
    ``failed`` (abandoned) must not be re-terminated — applying a
    requeued/done job again would double-insert a mental_model and
    re-supersede members. The result endpoint maps this to HTTP 409.
    """

    def __init__(self, status: str) -> None:
        super().__init__(f"memory job is '{status}', not 'claimed'")
        self.status = status


class JobKindMismatchError(Exception):
    """A result was posted in the wrong shape for the job's ``kind``.

    The result payload is kind-specific (a synthesized text vs. a list of
    vectors), so posting one against the other kind is a caller bug, not a
    job failure. The endpoint maps this to HTTP 422 and the job is left
    ``claimed`` — the runner can still post the right shape (or a failure)
    before its lease expires.
    """


class JobResultShapeError(Exception):
    """A result payload was structurally wrong for its job (-> HTTP 422).

    Distinct from the pydantic-level checks (vector dim, model tag), which
    need no DB: this is the arity check that can only be made against the
    stored job — one vector per input text, in order.
    """


@dataclass(frozen=True)
class MemoryJobInput:
    """One job to enqueue: what it is about, and what to compute over."""

    kind: str
    target_ids: list[UUID]
    input_texts: list[str]
    input_hash: str


@dataclass(frozen=True)
class ClaimedMemoryJob:
    """A job handed to a runner: only what the runner needs to execute it."""

    job_id: UUID
    kind: str
    target_ids: list[UUID]
    input_texts: list[str]


def _parse_input_texts(raw: Any) -> list[str]:
    """input_texts JSONB -> list[str] (asyncpg may hand back str or list)."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    return [str(t) for t in raw]


def synthesis_job_input(
    member_ids: list[UUID], member_texts: list[str]
) -> MemoryJobInput:
    """One episode cluster, as a ``synthesis`` job.

    ``target_ids`` are the cluster members (what the eventual
    ``mental_model`` consolidates and supersedes); ``input_texts`` are
    their redacted contents, so a runner needs zero read-back into the
    memory store to synthesize.
    """
    return MemoryJobInput(
        kind="synthesis",
        target_ids=list(member_ids),
        input_texts=list(member_texts),
        input_hash=job_input_hash(list(member_ids)),
    )


def embedding_job_input(
    targets: list[tuple[UUID, str]], *, model_tag: str
) -> MemoryJobInput:
    """A batch of unvectorized rows, as an ``embedding`` job.

    ``input_texts[i]`` is the content of ``target_ids[i]`` — the ORDER IS
    THE CONTRACT: the runner posts back one vector per input text in the
    same order, and that is what maps a vector onto its row.
    ``model_tag`` is the tag the result is expected to carry, and is
    folded into the dedupe hash (see :func:`job_input_hash`).
    """
    return MemoryJobInput(
        kind="embedding",
        target_ids=[memory_id for memory_id, _ in targets],
        input_texts=[content for _, content in targets],
        input_hash=job_input_hash(
            [memory_id for memory_id, _ in targets], model_tag=model_tag
        ),
    )


async def enqueue_jobs(
    session: AsyncSession,
    tenant_id: UUID,
    jobs: list[MemoryJobInput],
) -> int:
    """Insert one pending job per input, deduped by ``input_hash``.

    The dedupe is KIND-AWARE, via the ``uq_memory_jobs_live_input``
    partial unique index (predicate ``status IN ('pending','claimed') OR
    (status = 'done' AND kind = 'synthesis')``). The ``ON CONFLICT ...
    WHERE`` clause below MUST match that index predicate verbatim — a
    partial-index conflict target restates the index predicate exactly.

    Why kind-aware:

    * An in-flight (``pending`` / ``claimed``) job of EITHER kind blocks a
      duplicate enqueue — that is what makes the enqueuers idempotent, and
      they lean on it hard: ``memory_bridge_sync`` runs every 15 minutes
      and ``memory_reindex`` every 10, each enqueuing whatever it finds
      outstanding. Without the guard every tick would pile up another copy
      of the same work between runner drains.
    * A ``done`` **synthesis** job STILL blocks re-enqueue: a completed
      synthesis already inserted its ``mental_model`` and superseded its
      members, so redoing it would double-insert and re-supersede.
    * A ``done`` **embedding** job does NOT block re-enqueue. A
      done-but-unapplied embedding job (its vectors were never written, so
      the row's ``embedding`` is still NULL) would otherwise deadlock the
      row forever: ``fetch_reindex_batch`` re-fetches it every run (it
      only excludes rows with an IN-FLIGHT embedding job), but the
      re-enqueue was deduped against the stale ``done`` job → the row was
      fetched yet never re-queued and never embedded. Letting the
      embedding kind re-queue after ``done`` is safe precisely because
      ``fetch_reindex_batch`` gates re-embedding on the row still being
      un-embedded, so no duplicate embedding work can accumulate.

    ``kind`` is IN the key, so the same rows under a different kind are a
    distinct job. A ``failed`` job sits outside the partial index and so
    does NOT block re-enqueue — a permanent failure can be retried.
    Returns the number of jobs actually inserted.
    """
    inserted = 0
    for job in jobs:
        result = await session.execute(
            text(
                f"""
                INSERT INTO coord.memory_jobs
                    (tenant_id, kind, target_ids, input_texts, input_hash)
                VALUES
                    (:tenant_id, :kind, CAST(:target_ids AS uuid[]),
                     CAST(:input_texts AS jsonb), :input_hash)
                ON CONFLICT (tenant_id, kind, input_hash)
                    WHERE {_LIVE_JOB_INPUT_DEDUP_PREDICATE}
                    DO NOTHING
                RETURNING job_id
                """
            ),
            {
                "tenant_id": tenant_id,
                "kind": job.kind,
                "target_ids": [str(t) for t in job.target_ids],
                "input_texts": json.dumps(job.input_texts),
                "input_hash": job.input_hash,
            },
        )
        if result.scalar_one_or_none() is not None:
            inserted += 1
    return inserted


async def claim_jobs(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    limit: int,
    kinds: list[str],
    worker: str,
) -> list[ClaimedMemoryJob]:
    """Atomically claim up to ``limit`` pending jobs of ``kinds``.

    ``FOR UPDATE SKIP LOCKED`` is mandatory: two runners polling the same
    tenant concurrently must split the queue, never double-claim a row.
    ``kinds`` filters the dispatch, so a runner that can only embed never
    claims a synthesis job it would have to fail. The claimed rows flip to
    ``status='claimed'`` stamped with ``claimed_by`` / ``claimed_at`` and
    are returned oldest-first.
    """
    if not kinds:
        return []
    rows = await session.execute(
        text(
            """
            UPDATE coord.memory_jobs
            SET status = 'claimed',
                claimed_by = :worker,
                claimed_at = now()
            WHERE job_id IN (
                SELECT job_id
                FROM coord.memory_jobs
                WHERE tenant_id = :tenant_id
                  AND status = 'pending'
                  AND kind = ANY(CAST(:kinds AS text[]))
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT :limit
            )
            RETURNING job_id, kind, target_ids, input_texts
            """
        ),
        {
            "tenant_id": tenant_id,
            "worker": worker,
            "limit": limit,
            "kinds": list(kinds),
        },
    )
    claimed: list[ClaimedMemoryJob] = []
    for r in rows.mappings():
        claimed.append(
            ClaimedMemoryJob(
                job_id=UUID(str(r["job_id"])),
                kind=str(r["kind"]),
                target_ids=[UUID(str(m)) for m in r["target_ids"]],
                input_texts=_parse_input_texts(r["input_texts"]),
            )
        )
    return claimed


async def get_job_kind(
    session: AsyncSession, tenant_id: UUID, job_id: UUID
) -> str | None:
    """This job's ``kind``, or ``None`` when it is not in this tenant.

    An unlocked peek, used only to pick the parser for a posted result:
    ``kind`` is set at enqueue and never updated, so it cannot change
    under the caller. The authoritative check is the locked one inside
    :func:`_lock_claimed_job`, which is what actually refuses a result
    posted in the wrong shape.
    """
    kind = (
        await session.execute(
            text(
                """
                SELECT kind FROM coord.memory_jobs
                WHERE tenant_id = :tenant_id AND job_id = :job_id
                """
            ),
            {"tenant_id": tenant_id, "job_id": job_id},
        )
    ).scalar_one_or_none()
    return None if kind is None else str(kind)


async def _lock_claimed_job(
    session: AsyncSession,
    tenant_id: UUID,
    job_id: UUID,
    *,
    expect_kind: str,
) -> Any:
    """Load + lock a job that a runner is posting back for.

    Returns ``None`` when the job is not in this tenant (-> 404, never
    disclosed). Raises :class:`JobNotClaimedError` when it exists but is
    not ``'claimed'`` (-> 409) and :class:`JobKindMismatchError` on a
    kind/payload mismatch (-> 422). The ``FOR UPDATE`` row lock serializes
    concurrent posts: the first sees ``'claimed'`` and applies; the second
    then sees ``'done'`` and 409s.
    """
    job = (
        (
            await session.execute(
                text(
                    """
                    SELECT kind, status, target_ids, input_texts
                    FROM coord.memory_jobs
                    WHERE tenant_id = :tenant_id AND job_id = :job_id
                    FOR UPDATE
                    """
                ),
                {"tenant_id": tenant_id, "job_id": job_id},
            )
        )
        .mappings()
        .one_or_none()
    )
    if job is None:
        return None
    if str(job["status"]) != "claimed":
        raise JobNotClaimedError(str(job["status"]))
    if str(job["kind"]) != expect_kind:
        raise JobKindMismatchError(
            f"job is kind '{job['kind']}', but the posted result is shaped "
            f"for '{expect_kind}'"
        )
    return job


async def record_synthesis_result(
    session: AsyncSession,
    tenant_id: UUID,
    job_id: UUID,
    result_text: str,
    *,
    embedding: list[float] | None,
    embedding_model: str | None,
    now: datetime | None = None,
) -> UUID | None:
    """Apply a runner's synthesis result: insert the mental_model, mark done.

    One atomic transaction (the caller commits): load + lock the job,
    redact the runner-supplied text, read the members' max importance,
    insert the ``mental_model`` row (``consolidated_from`` = targets,
    ``importance`` = min(max_member + 0.1, 1.0),
    ``source.synthesis_job`` = job id), supersede the member rows, and
    flip the job to ``done``. Returns the new ``mental_model`` memory id,
    or ``None`` when the job does not exist for this tenant (-> 404).

    ``embedding`` is the RUNNER's vector for ``result_text`` (validated by
    the endpoint); it is never computed here — the runner already ran an
    LLM over this cluster and owns the embedding cost too. ``None`` stores
    the ``mental_model`` unvectorized for the reindex sweep.

    Redaction runs BEFORE hashing/insert so a runner can never smuggle a
    secret into the store through the synthesized text. NOTE: the vector
    is the runner's, computed over its PRE-redaction text — a property
    every client-supplied embedding on this API shares.
    """
    now = now or datetime.now(UTC)

    job = await _lock_claimed_job(session, tenant_id, job_id, expect_kind="synthesis")
    if job is None:
        return None
    member_ids = [UUID(str(m)) for m in job["target_ids"]]

    redaction = redact_text(result_text)
    log_redactions("memory_synthesis_result", redaction.counts)
    redacted = redaction.text

    max_importance = float(
        (
            await session.execute(
                text(
                    """
                    SELECT COALESCE(MAX(importance), 0.5) AS max_importance
                    FROM coord.memory_records
                    WHERE tenant_id = :tenant_id
                      AND memory_id = ANY(CAST(:member_ids AS uuid[]))
                    """
                ),
                {
                    "tenant_id": tenant_id,
                    "member_ids": [str(m) for m in member_ids],
                },
            )
        ).scalar_one()
    )
    importance = min(max_importance + SYNTHESIS_IMPORTANCE_BONUS, 1.0)

    new_id, _deduped = await insert_record(
        session,
        tenant_id=tenant_id,
        scope="tenant",
        scope_ref=None,
        kind="mental_model",
        title=synthesized_title(redacted),
        content=redacted,
        content_hash=_content_hash(redacted),
        embedding=embedding,
        embedding_model=embedding_model,
        importance=importance,
        source={"synthesis_job": str(job_id)},
        consolidated_from=member_ids,
    )

    await supersede_many(
        session,
        tenant_id,
        [m for m in member_ids if m != new_id],
        new_id,
        now=now,
    )

    await _finish_job(
        session,
        tenant_id,
        job_id,
        status="done",
        result={"result_text": redacted},
        now=now,
    )
    return new_id


async def record_embedding_result(
    session: AsyncSession,
    tenant_id: UUID,
    job_id: UUID,
    *,
    embeddings: list[list[float]],
    embedding_model: str,
    now: datetime | None = None,
) -> bool | None:
    """Apply a runner's embedding result: write the vectors, mark done.

    One atomic transaction (the caller commits): load + lock the job,
    write ``embeddings[i]`` onto ``target_ids[i]`` (the order IS the
    mapping — the runner was handed ``input_texts`` in that order), stamp
    ``embedding_model``, and flip the job to ``done``. Returns ``True`` on
    success, or ``None`` when the job does not exist for this tenant
    (-> 404).

    Raises :class:`JobResultShapeError` (-> 422) when the vector count does
    not match the job's input count: a short/long list would silently
    mis-map vectors onto rows (or, with ``strict=True`` zip, blow up
    mid-write), and a wrong-space vector on the cosine arm is exactly the
    failure this whole phase is built to make impossible. Per-vector
    dimension and the model tag are validated a layer up, by the schema.
    The job is left ``claimed`` on this error, not ``done``.
    """
    now = now or datetime.now(UTC)

    job = await _lock_claimed_job(session, tenant_id, job_id, expect_kind="embedding")
    if job is None:
        return None

    target_ids = [UUID(str(t)) for t in job["target_ids"]]
    input_texts = _parse_input_texts(job["input_texts"])
    if len(embeddings) != len(input_texts):
        raise JobResultShapeError(
            f"job has {len(input_texts)} input_texts but the result carries "
            f"{len(embeddings)} embeddings; send exactly one vector per "
            "input text, in the same order"
        )

    await update_embeddings(
        session,
        list(zip(target_ids, embeddings, strict=True)),
        tag=embedding_model,
        now=now,
    )
    await _finish_job(
        session,
        tenant_id,
        job_id,
        status="done",
        result={"embedded": len(embeddings), "embedding_model": embedding_model},
        now=now,
    )
    return True


async def record_job_failure(
    session: AsyncSession,
    tenant_id: UUID,
    job_id: UUID,
    reason: str,
) -> bool:
    """Mark a CLAIMED job ``failed`` with the runner-supplied reason.

    Kind-agnostic: any job a runner cannot execute fails the same way.
    Returns False when the job does not exist for this tenant (-> 404), and
    raises :class:`JobNotClaimedError` when it exists but is not in
    ``'claimed'`` status (-> 409): a runner may only fail a job it holds a
    live claim on, so a requeued/abandoned/already-terminal job is never
    re-terminated. The ``reason`` is stored in ``result`` (the job is
    terminal; no memory row is produced). The ``FOR UPDATE`` lock keeps the
    status check and the flip atomic against a concurrent post.
    """
    status_row = (
        await session.execute(
            text(
                """
                SELECT status FROM coord.memory_jobs
                WHERE tenant_id = :tenant_id AND job_id = :job_id
                FOR UPDATE
                """
            ),
            {"tenant_id": tenant_id, "job_id": job_id},
        )
    ).scalar_one_or_none()
    if status_row is None:
        return False
    if str(status_row) != "claimed":
        raise JobNotClaimedError(str(status_row))
    await _finish_job(
        session,
        tenant_id,
        job_id,
        status="failed",
        result={"failure": reason},
        now=datetime.now(UTC),
    )
    return True


async def _finish_job(
    session: AsyncSession,
    tenant_id: UUID,
    job_id: UUID,
    *,
    status: str,
    result: dict[str, Any],
    now: datetime,
) -> None:
    """Flip a job terminal (``done`` / ``failed``) with its result payload."""
    await session.execute(
        text(
            """
            UPDATE coord.memory_jobs
            SET status = :status,
                finished_at = CAST(:now AS timestamptz),
                result = CAST(:result AS jsonb)
            WHERE tenant_id = :tenant_id AND job_id = :job_id
            """
        ),
        {
            "tenant_id": tenant_id,
            "job_id": job_id,
            "status": status,
            "now": now,
            "result": json.dumps(result),
        },
    )


async def reap_stale_claims(session: AsyncSession, *, now: datetime) -> dict[str, int]:
    """Requeue (or fail) claims a dead runner never finished.

    Kind-agnostic — one reaper for the whole queue. Any ``claimed`` job
    whose ``claimed_at`` is older than :data:`JOB_CLAIM_STALE_MINUTES` has
    its ``attempt`` bumped and is returned to ``pending`` — unless that
    pushes ``attempt`` past :data:`JOB_MAX_ATTEMPTS`, in which case it is
    abandoned (``failed``). ``SKIP LOCKED`` so a live claim being finished
    right now is never disturbed. Returns ``{"requeued": n, "failed": m}``.
    """
    rows = await session.execute(
        text(
            """
            WITH stale AS (
                SELECT job_id
                FROM coord.memory_jobs
                WHERE status = 'claimed'
                  AND claimed_at
                      < CAST(:now AS timestamptz)
                        - make_interval(mins => :stale_minutes)
                FOR UPDATE SKIP LOCKED
            )
            UPDATE coord.memory_jobs j
            SET attempt = j.attempt + 1,
                status = CASE
                    WHEN j.attempt + 1 > :max_attempts THEN 'failed'
                    ELSE 'pending'
                END,
                claimed_by = NULL,
                claimed_at = NULL,
                finished_at = CASE
                    WHEN j.attempt + 1 > :max_attempts
                    THEN CAST(:now AS timestamptz)
                    ELSE j.finished_at
                END,
                result = CASE
                    WHEN j.attempt + 1 > :max_attempts
                    THEN jsonb_build_object(
                        'failure',
                        'abandoned after ' || (j.attempt + 1) || ' attempts'
                    )
                    ELSE j.result
                END
            FROM stale
            WHERE j.job_id = stale.job_id
            RETURNING j.status
            """
        ),
        {
            "now": now,
            "stale_minutes": JOB_CLAIM_STALE_MINUTES,
            "max_attempts": JOB_MAX_ATTEMPTS,
        },
    )
    requeued = 0
    failed = 0
    for r in rows:
        if r.status == "failed":
            failed += 1
        else:
            requeued += 1
    if requeued or failed:
        logger.info("memory_job_reap_completed", requeued=requeued, failed=failed)
    return {"requeued": requeued, "failed": failed}


async def job_counts(
    session: AsyncSession, tenant_id: UUID, *, kind: str
) -> dict[str, int]:
    """Per-status job counts for one tenant + kind (backlog visibility)."""
    rows = await session.execute(
        text(
            """
            SELECT status, count(*) AS n
            FROM coord.memory_jobs
            WHERE tenant_id = :tenant_id AND kind = :kind
            GROUP BY status
            """
        ),
        {"tenant_id": tenant_id, "kind": kind},
    )
    counts = {"pending": 0, "claimed": 0, "done": 0, "failed": 0}
    for r in rows:
        counts[str(r.status)] = int(r.n)
    return counts
