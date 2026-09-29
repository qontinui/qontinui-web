"""coord.work_unit_citation_candidates — inferred PR references, never citations

Revision ID: citecand_01
Revises: coordinput_01_operator_inputs
Create Date: 2026-09-29

Phase 1 of plan
``plans/2026-09-20-coord-reads-a-clean-not-delivered-for-work-that-landed-without-a-plan-trailer.md``
(dossier ``delivered-but-uncited-reads-unshipped``). Authored by alembic in
``qontinui-web`` — coord authors zero ``coord.*`` DDL (served policy
``production-and-cost`` ``alembic-sole-authorship``).

The defect
==========

coord derives a work unit's delivery from ``coord.work_unit_pr_citations`` and
nothing else, and a citation has exactly one producer at the source: a PR-body
or commit-message line that starts with ``Plan:`` / ``Work-Unit:`` / ``Unit:``.
With ZERO citation rows the reduction pushes no gap, so coord answers
``{shipped: false, evidence_complete: true, evidence_gaps: []}`` — the cleanest
not-delivered it can give — and that answer is byte-identical for a plan nobody
started and a plan six PRs finished. Every consumer (``/vet-plan``, the sweeps,
``/chart``) reads it as an observation, so every landed-without-a-trailer plan
is found by a session about to re-implement it.

What this table is — and is NOT (plan R1)
=========================================

This table holds **INFERRED** references from a work unit to a PR. Every row is
a **CANDIDATE, never a citation.** A candidate never derives ``shipped``, never
contributes to ``landed_count``, and never carries a ``delivery_scope``.

That separation is the whole design, and it is forced by measured evidence in
the other direction: a prose line that merely began with ``Plan:`` was captured
as a citation, could not be retracted, and flipped a unit to ``shipped: true``
with half the plan unbuilt. A PR saying *"follow-up to plan X"* is not delivery
of X. So inferred references live in their own table rather than as a new
``source`` literal on ``coord.work_unit_pr_citations``: that table has many
reader files in coord, and any ONE reader that forgot
to exclude an inferred source would forge ``shipped``. A separate table makes
the safe reading the default one — a reader that has never heard of candidates
cannot mistake one for delivery.

What a candidate DOES do (plan R2): a unit that is not delivered and holds an
unresolved candidate whose PR is observed merged gets a citation GAP on the
coord side, so ``evidence_complete`` goes ``false`` and the clean zero is
broken — every consumer then reads UNKNOWN instead of "not delivered".

A candidate leaves the queue only by an explicit resolution: ``confirmed``
(a caller promoted it through coord's existing citation writer,
``record_work_unit_citation``, declaring any ``delivery_scope`` itself — plan
R3: an inferred scope is never written) or ``dismissed`` (a caller judged the
reference not to be delivery). There is no auto-promotion of any source.

The four ``source`` values
==========================

* ``worktree_link`` — the PR's head branch is the branch coord ALLOCATED for
  this unit: ``coord.agent_worktrees`` has a row with this ``(repo, branch)``
  and ``work_unit_id`` set (``POST /agents/allocate`` records it). A recorded
  fact rather than text inference — but still only a candidate, because an
  allocation for plan X whose PR lands Phase 1 of 4 is not delivery of X.
* ``inferred_branch`` — the trailing slug segment of an
  ``agent/<dev>-<agent>/<slug>`` head ref (truncated by coord's ``slugify``)
  is a prefix of EXACTLY ONE ``coord.work_units.slug`` (run ≥ 24 chars; zero
  or several matches yield no candidate).
* ``inferred_prose`` — a dated-slug token in the PR title or body, on a line
  the ``Plan:`` citation parser did not already consume, that exactly matches
  a ``coord.work_units.slug`` after normalization.
* ``plan_body_link`` — the plan file's own status blockquote reads SHIPPED and
  names this PR (the runner sends it as ``file_status`` / ``file_pr_refs``
  work-unit metadata). A plan's SHIPPED stamp has been measured wrong in both
  directions, so it stays a candidate like the rest.

Schema
======

* ``id           UUID PRIMARY KEY DEFAULT gen_random_uuid()`` — surrogate key.
* ``tenant_id    UUID NOT NULL`` — the owning tenant. NOT NULL, unlike the
  older citation tables: every writer (the PR-webhook ingest and the work-unit
  upsert) resolves the tenant before it writes, and the tenant-wide unresolved
  queue (``idx_work_unit_citation_candidates_tenant_open``) is read by tenant,
  so a row with no tenant would be a row no queue reader ever surfaces.
* ``work_unit_id UUID NOT NULL REFERENCES coord.work_units(id) ON DELETE
  CASCADE`` — the unit the reference points at. A candidate about a unit that
  no longer exists is not evidence of anything.
* ``repo         TEXT NOT NULL`` — canonical ``owner/name``. The writers
  resolve a bare name before inserting and skip an unresolvable or ambiguous
  one; they never guess.
* ``pr_number    INTEGER NOT NULL CHECK (pr_number > 0)`` — a candidate is
  always a PR reference. Commit-only delivery is a real citation source
  (``landed_commit``, plan Phase 5), not a candidate.
* ``source       TEXT NOT NULL CHECK (source IN (...))`` — the four values
  above. This IS a CHECK, unlike the ``coord.*`` vocabulary columns whose
  posture is Rust-only enforcement (``phaseatt_01``'s ``evidence_kind``): a new
  inference source is a change to what coord is allowed to treat as a
  candidate — a design change under R1, not a routine widening — and the plan
  sequences web before coord for every such change anyway. The CHECK makes an
  unintended writer (a typo'd literal, a citation source written to the wrong
  table) a loud ``23514`` rather than a silently unreadable row.
* ``evidence     TEXT NOT NULL CHECK (char_length(evidence) <= 500)`` — the
  matched line / branch name / link, truncated by the writer to 500 chars.
  It is what a resolving caller reads to judge the candidate; the bound keeps
  a pasted PR body out of the row.
* ``created_at   TIMESTAMPTZ NOT NULL DEFAULT now()`` — capture time.
* ``resolved_at  TIMESTAMPTZ`` / ``resolution TEXT CHECK (resolution IN
  ('confirmed', 'dismissed'))`` / ``resolved_by TEXT`` — NULL while the
  candidate is open. ``CHECK ((resolved_at IS NULL) = (resolution IS NULL))``
  makes a half-resolved row unrepresentable: "resolved, verdict unknown" and
  "verdict recorded, still open" are both states no reader can act on.
  ``resolved_by`` is the resolving caller's identity, taken from the coord
  side, never from a caller argument.

Identity key
============

* ``CONSTRAINT work_unit_citation_candidates_unit_repo_pr_uq UNIQUE
  (work_unit_id, repo, pr_number)`` — one candidate per PR per unit, whatever
  the source and whatever the resolution. Writers insert with ``ON CONFLICT DO
  NOTHING``, so a ``dismissed`` row is never re-raised by the next webhook
  delivery, and the first source to observe a reference owns the row. Every
  key column is NOT NULL, so no ``NULLS NOT DISTINCT`` is needed.

Indexes (both partial on the open queue)
========================================

* ``idx_work_unit_citation_candidates_open ON (work_unit_id) WHERE resolved_at
  IS NULL`` — the per-unit read coord's delivery derivation makes on every
  verdict. Only open candidates break the clean zero, so only they are indexed.
* ``idx_work_unit_citation_candidates_tenant_open ON (tenant_id, created_at)
  WHERE resolved_at IS NULL`` — the tenant-wide unresolved queue that the
  list door (``GET /coord/agent-work-units/citation-candidates``) pages
  oldest-first.

How coord reads it: fail-closed behind a schema-readiness observation
=====================================================================

coord MUST read and write this table ONLY behind a POSITIVE schema-readiness
observation (``schema_readiness.rs``, ``citation_candidates_observed`` — the
twin of ``citation_delivery_scope_observed``; added by Phase 2 of plan
``2026-09-20-coord-reads-a-clean-not-delivered-for-work-that-landed-without-a-plan-trailer``,
which lands in qontinui-coord AFTER this revision). Until coord has observed this
table present, every candidate WRITE is skipped (fail-closed: nothing is
written to a table coord has not seen) and the delivery reduction treats the
candidate axis as unobserved rather than empty — an absent table is UNKNOWN,
never "no candidates exist", and never a boot failure.

Idempotency / authorship posture
================================

* ``CREATE SCHEMA IF NOT EXISTS coord`` first, then ``CREATE TABLE IF NOT
  EXISTS`` (with its CHECKs, identity key and FK inline) and the ``COMMENT
  ON`` statements through raw ``op.execute`` — matching ``coord_workunits_04``
  and ``phaseatt_01``. coord boots against this same schema, so re-running
  against an already-applied DB must be a no-op.
* Both indexes are built LAST, as ``CREATE INDEX CONCURRENTLY IF NOT EXISTS``
  inside ``with op.get_context().autocommit_block():`` — the
  ``twin_10_served_bundle_target_columns`` idiom. That is the only index form
  coord's merge-train migration classifier (qontinui-coord
  ``pr_merge/migration_classifier.rs``) admits as auto-safe: it rejects every
  non-concurrent ``CREATE INDEX``, even on a brand-new table, and admits
  ``CONCURRENTLY`` only when it can prove the statement runs outside a
  transaction. The block commits the table first, so a failed index build
  leaves the table in place and un-stamped, and the re-run the guard makes
  safe picks up where it stopped. A CONCURRENTLY build can still be cancelled
  or hit a ``statement_timeout``, and it waits for older transactions on the
  database to finish, so a long-running coord transaction can stall this
  revision. A build that fails part-way leaves an INVALID index that
  ``IF NOT EXISTS`` then skips on re-run, so after deploy confirm both indexes
  read ``pg_index.indisvalid = true`` (the ``coord_iops_idx_01`` /
  ``coord_alerts_pagedidx_01`` precedent); if one does not, drop it and re-run.
  Uniqueness never depends on either index — the identity key is a constraint.
  The identity key stays an inline table constraint, not a unique index: it is
  built with the empty table in one statement, which the classifier admits
  under ``CREATE TABLE IF NOT EXISTS``.
* Every statement names its schema explicitly (the ``alembic-schema-arg-gate``
  pre-commit hook audits raw ``op.execute`` SQL for that).
* **alembic is the SOLE author of the ``coord.*`` schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the coord crate only SELECTs / INSERTs /
  UPDATEs. This revision was **HAND-AUTHORED**; ``alembic revision
  --autogenerate`` is never run here.
* ``IF NOT EXISTS`` is idempotent in each object's EXISTENCE only, not its
  SHAPE — the house idiom's known property, not worked around here.

Ordering
========

**This migration MUST be applied to the serving database BEFORE the coord image
that reads it deploys** (plan Phases 2 and 3). Because coord gates on the
readiness observation above, the wrong order degrades to "candidates are not
captured yet", not to a crash — but the plan's population stays unreachable
until this revision is live. Phase 1 is done when a ``coord_query_schema_object``
read reports the table ``present`` in production, not when this PR merges.

``down_revision``
=================

Authored against qontinui-web ``origin/main`` ``ee23f9b28``, where
``scripts/ci/count_alembic_heads.py`` scanned 611 revisions and reported
exactly ONE head, ``sched_cond_01_scheduled_tasks_conditions`` — this
revision's parent. Re-point it at the merged head at land time if the chain has
moved (edit the token below AND the ``Revises:`` line above).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "citecand_01"
down_revision: str | Sequence[str] | None = "coordinput_01_operator_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the candidate store, its identity key and its two open-queue indexes."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_citation_candidates (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id     UUID NOT NULL,
            work_unit_id  UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            repo          TEXT NOT NULL,
            pr_number     INTEGER NOT NULL
                CONSTRAINT work_unit_citation_candidates_pr_number_ck
                CHECK (pr_number > 0),
            source        TEXT NOT NULL
                CONSTRAINT work_unit_citation_candidates_source_ck
                CHECK (source IN (
                    'worktree_link',
                    'inferred_branch',
                    'inferred_prose',
                    'plan_body_link'
                )),
            evidence      TEXT NOT NULL
                CONSTRAINT work_unit_citation_candidates_evidence_len_ck
                CHECK (char_length(evidence) <= 500),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved_at   TIMESTAMPTZ,
            resolution    TEXT
                CONSTRAINT work_unit_citation_candidates_resolution_ck
                CHECK (resolution IN ('confirmed', 'dismissed')),
            resolved_by   TEXT,
            CONSTRAINT work_unit_citation_candidates_resolved_pair_ck
                CHECK ((resolved_at IS NULL) = (resolution IS NULL)),
            CONSTRAINT work_unit_citation_candidates_unit_repo_pr_uq
                UNIQUE (work_unit_id, repo, pr_number)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.work_unit_citation_candidates IS
        'INFERRED work unit -> PR references. Every row is a CANDIDATE, never a '
        'citation: a candidate never derives shipped, never counts as landed and '
        'never carries a delivery_scope. An open candidate whose PR is merged only '
        'breaks the clean not-delivered answer (a citation gap, so '
        'evidence_complete goes false). Promotion is an explicit caller act '
        'through coord''s citation writer. coord must read and write this table '
        'only behind a positive schema-readiness observation (fail-closed).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_candidates.source IS
        'worktree_link = the PR head branch is the branch coord allocated for the '
        'unit; inferred_branch = the head-ref slug is a prefix of exactly one unit '
        'slug; inferred_prose = a dated-slug token in the PR title/body outside a '
        'Plan: line; plan_body_link = the plan file''s SHIPPED status blockquote '
        'names the PR.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_citation_candidates.resolution IS
        'NULL while open. confirmed = a caller promoted it to a real citation; '
        'dismissed = a caller judged it not delivery. Set together with '
        'resolved_at, never one without the other. The identity key keeps a '
        'dismissed row from being re-raised by a later webhook.'
        """
    )

    # Both indexes CONCURRENTLY, inside autocommit_block(): it commits the
    # table and comments above first, then builds each index outside a
    # transaction. coord's merge-train migration classifier admits an index
    # build in no other form (a plain CREATE INDEX locks writes), and the
    # IF NOT EXISTS guard keeps a re-run a no-op. Last in upgrade() so every
    # statement above commits together before the first build starts, and the
    # version stamp is the only thing that runs after it.
    with op.get_context().autocommit_block():
        # The per-unit read: coord's delivery derivation asks "does this unit
        # hold an OPEN candidate?" on every verdict. Resolved rows never break
        # the clean zero, so only the open queue is indexed.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_work_unit_citation_candidates_open
                ON coord.work_unit_citation_candidates (work_unit_id)
                WHERE resolved_at IS NULL
            """
        )
        # The tenant-wide unresolved queue the list door pages oldest-first.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_work_unit_citation_candidates_tenant_open
                ON coord.work_unit_citation_candidates (tenant_id, created_at)
                WHERE resolved_at IS NULL
            """
        )


def downgrade() -> None:
    """Reverse: indexes first, then the table (its constraints go with it)."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_work_unit_citation_candidates_tenant_open"
    )
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_citation_candidates_open")
    op.execute("DROP TABLE IF EXISTS coord.work_unit_citation_candidates")
