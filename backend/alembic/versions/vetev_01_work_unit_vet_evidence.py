"""coord vet-evidence manifest — per-anchor rows, a per-tick oplog, and the roll-up

Revision ID: vetev_01
Revises: grantorig_01
Create Date: 2026-09-01

Phase 2 of plan ``2026-09-01-vet-evidence-manifest-and-decay`` — "``vetted``
gates on WHO, not WHAT: carry a vet manifest and re-verify it".

DDL ONLY. No route change, no query change, no coord change. Coord's half of
Phase 2 (the two table names in ``schema_manifest::ALEMBIC_OWNED_TABLES``, and
the ``TableMissing`` tri-state read modelled on
``work_unit_pr_citations::CitationRead``) lives in the coord repo and is NOT
made here.

What this revision stands up
============================

Today a ``→ vetted`` work-unit transition asks exactly one question — is the
caller's actor key different from the row's ``owner_actor_key``? — and coord
reads no plan content, ever. The plan replaces that identity gate with an
*evidence* gate: the transition carries a machine-checkable manifest of the
anchors the vet actually verified, and a leader-gated worker re-resolves that
manifest on a timer against coord's local bare mirror. This revision is the
storage for both halves, plus the derived roll-up column the re-verify worker
writes back.

1. ``coord.work_unit_vet_evidence`` — **one row per anchor**.
2. ``coord.work_unit_vet_observations`` — the per-tick oplog, posture copied
   verbatim from ``coord.memory_anchor_observations``.
3. ``coord.work_units.vet_state`` + ``.vet_checked_at`` — the derived roll-up,
   written only by coord's re-verify worker.

Design notes
============

Why a row per anchor, not a JSONB blob on the unit
--------------------------------------------------
Decided in the plan (§Phase 2) and not an option here. The re-verify worker
must (a) dedupe anchors **fleet-wide** before resolving — the same
``BTreeSet`` posture as ``anchor_observer::run_one_cycle`` — and (b) record a
per-anchor result. Both are ordinary queries against this shape; neither is
expressible over a single JSONB column without unnesting the whole corpus on
every tick. Write cost is one INSERT per anchor per vet: a vet emits tens of
anchors, not thousands, and a vet happens once per plan.

Row-level tenant scoping
------------------------
The hard ``REFERENCES coord.work_units(id) ON DELETE CASCADE`` is what makes
an evidence row tenant-scoped at row level, exactly as
``coord.work_unit_pr_citations`` is (``work_unit_pr_citations.rs``, the FK is
the anchor and the doc comment says so). A work-unit row already exists in
coord before its manifest can be submitted, so the hard FK is safe and the
cascade keeps the edge clean.

``tenant_id UUID NOT NULL`` — a deliberate divergence from the siblings
-----------------------------------------------------------------------
``coord.work_unit_deps``, ``coord.work_unit_dispatches`` and
``coord.work_unit_pr_citations`` all make ``tenant_id`` NULLABLE, each citing
"mirroring ``coord.work_units.tenant_id``", which is itself nullable. This
table does not mirror it, and the reason is the read pattern rather than a
preference:

* Those three are edge/queue rows read **by ``work_unit_id``**; the tenant is
  a denormalized convenience on them.
* An evidence row is read **tenant-first**. The re-verify worker resolves each
  distinct anchor once fleet-wide and then fans the *result* back per tenant
  (the ``anchor_observer`` posture), and every tick writes one
  ``work_unit_vet_observations`` census row **per tenant**. A row with a NULL
  tenant could be neither fanned back nor counted — it would be evidence that
  nothing can act on and nothing can report, which is worse than no row.

The constraint is satisfiable at every real write site because the value comes
from the **authenticated caller**, not from the parent row: coord's Phase 3
persist runs inside a ``→ vetted`` transition whose auth context always
carries a tenant. This is the same "resolved from the JWT at DML time" rule
the sibling tables document; only the nullability differs.

Retirement is an explicit ``retired_at``, NOT a generation comparison
---------------------------------------------------------------------
The plan offers either. This revision picks ``retired_at TIMESTAMPTZ`` (NULL
== live) and is consistent about it everywhere, for two reasons — the second
of which is decisive:

* **Scalability.** The worker's hot query is "every live anchor, fleet-wide,
  oldest-checked first, under a per-tick cap". With ``retired_at`` that is a
  flat partial-index scan. With a generation comparison it is a correlated
  ``MAX(vet_generation) PER work_unit_id`` over the whole table on **every**
  tick, which is the one query shape that must not grow with the corpus.
* **A generation comparison cannot express the retirement Phase 3 actually
  performs.** Phase 3 retires the prior generation on **every**
  ``→ vetted`` / ``→ vetted_unattested``, *manifest or not* — that is the fix
  for "a stale manifest outliving its plan" (plan §8). On a manifest-less
  re-vet no new-generation row is written at all, so ``MAX(vet_generation)``
  still points at the generation that was just retired and the "live" set
  computed by comparison would be exactly inverted. An explicit
  ``retired_at`` stamp is the only spelling that survives that case.

Retirement **marks**; it never deletes. The audit trail is the point of the
table — ``submitted_by`` records who asserted what, and a retired manifest is
the evidence for a vet that has since been superseded.

``vet_state`` is NULLABLE, and NULL means something ``'none'`` does not
-----------------------------------------------------------------------
``coord.memory_records.anchor_state`` is ``TEXT NOT NULL DEFAULT 'none'``.
``vet_state`` deliberately is **not**, because the plan needs the two apart:

* SQL ``NULL``  — never checked (a pre-migration unit, or one the worker has
  not reached yet).
* ``'none'``    — checked, and the manifest was **empty**.
  ``anchor_observer::roll_up`` returns the literal string ``"none"`` for an
  empty anchor slice, *before* it reaches the unresolved arm. Conflating that
  with ``NULL`` was a live bug the plan's own vet caught: Phase 6's ``ready``
  conjunct was written ``vet_state ∈ {fresh, NULL}`` and would have withheld
  ``ready`` from every manifest-less unit fleet-wide.

The CHECK therefore admits exactly ``none | fresh | moved | gone`` **and**
NULL. ``'none'`` is inside the constraint, not forbidden by it. The invariant
the whole design rests on: **only a positively observed ``moved`` or ``gone``
may withhold ``ready``** — an absence of evidence is never evidence of decay.

``last_result`` is CHECK-constrained; ``anchor_kind`` deliberately is not
-------------------------------------------------------------------------
* ``last_result`` is the four-valued ``anchor_observer::Resolution``
  vocabulary (``unchanged`` / ``moved`` / ``gone`` / ``unresolved``), whose
  entire purpose is that a failed *check* can never read as a *deletion*. It
  is a closed contract that must never quietly gain a fifth member, and
  nothing is ever gained by extending it. CHECK it.
* ``anchor_kind`` is NOT constrained. The anchor vocabulary is pinned by
  coord's ``parse_anchor``, and its resolver registry is explicitly designed
  so that a sixth anchor type is "a new impl plus one line". A DB CHECK would
  convert that one line into a cross-repo, deploy-ordered web migration —
  paying an extension tax on the one axis the design means to keep cheap. The
  column comment names today's set (``region|blob|pr|migration|schema|flag|
  probe``) as documentation, not as enforcement.

``vet_generation >= 1`` is CHECKed because it is written as
``max(existing) + 1``: a zero or negative value would silently invert
retirement ordering, and the guard costs nothing.

Index set — three on the evidence table, one on the oplog, one on work_units
-----------------------------------------------------------------------------
Each index answers exactly one query the plan names, and there is no index for
a query nobody makes (the census counts are read, never filtered on):

* ``idx_work_unit_vet_evidence_unit_gen (work_unit_id, vet_generation DESC)``
  — NOT partial, so it also covers retired rows. Serves the
  ``max(vet_generation) + 1`` lookup on persist, the retirement UPDATE, the
  per-unit roll-up read, and the full per-unit audit history.
* ``idx_work_unit_vet_evidence_live_stale (last_checked_at NULLS FIRST)
  WHERE retired_at IS NULL`` — the fleet-wide, staleness-ordered scan the
  per-tick cap slices. ``NULLS FIRST`` is explicit because a never-checked
  anchor must sort ahead of a checked one, and a plain ASC index is
  ``NULLS LAST``.
* ``idx_work_unit_vet_evidence_tenant_result (tenant_id, last_result)
  WHERE retired_at IS NULL`` — the per-tenant census the oplog row carries,
  as an index-only grouping. Same shape as
  ``idx_memory_records_tenant_anchor_state``.

There is deliberately **no index on ``anchor``**. Fan-back does not need one:
the worker already holds the ids of the rows it scanned this tick, so writing
the resolved result back is ``WHERE id = ANY(...)`` — by primary key. A btree
index over a variable-length JSONB would also risk the 2704-byte index-tuple
ceiling on a pathological anchor, turning a large manifest into an INSERT
failure.

``coord.work_units`` gets ``idx_work_units_tenant_vet_state``, partial on
``vet_state IS NOT NULL`` — the "which of my units have a decayed vet" listing
Phase 6 surfaces. Partial because NULL is the whole corpus until the worker
first runs, and nobody queries *for* NULL.

Oplog posture — copied, not re-derived
--------------------------------------
``coord.work_unit_vet_observations`` mirrors ``coord.memory_anchor_observations``
column for column: surrogate ``UUID PRIMARY KEY DEFAULT gen_random_uuid()``;
``tenant_id UUID NOT NULL`` **carrying no FK** (history rows must never block a
tenant delete, and are pruned by the watcher rather than by cascade);
``observed_at TIMESTAMPTZ NOT NULL DEFAULT now()``; BIGINT census counts
(an oplog column that can only ever be widened by a table rewrite is not worth
the four bytes); ``detail JSONB NOT NULL DEFAULT '[]'::jsonb`` with the
``::jsonb`` cast stated explicitly, because an untyped ``'[]'`` leaves the
literal's type unresolved where a ``jsonb`` one is required; a lone
``(tenant_id, observed_at DESC)`` index; and **no unique constraint** — the
same tenant recurs every tick, nothing dedupes. Consistency with the sibling
oplog is worth more than any local preference.

One column is renamed, because the subject changed. The memory oplog's
``anchored_records`` counts *memory records*; here the anchored thing is a
work unit, so the column is ``anchored_units``. Every other census column
(``fresh`` / ``moved`` / ``gone`` / ``unresolved`` / ``distinct_anchors``)
keeps its name and its meaning: ``gone`` only on unanimity, so the first three
sum to ``anchored_units`` minus ``unresolved``; and ``distinct_anchors`` is a
*citation* count rather than a fetch count, since anchors are resolved once
fleet-wide and the result fanned back per tenant.

Idempotency / authorship posture
================================

* Every DDL statement uses ``IF NOT EXISTS`` / ``IF EXISTS`` and raw
  ``op.execute`` (not ``op.create_table``), matching the ``coord.*`` house
  style: coord boots against this same schema, so a re-run against an
  already-applied DB must be a no-op.
* Hand-written. ``alembic revision --autogenerate`` is never run in this repo
  — served policy ``production-and-cost`` ``alembic-sole-authorship``.
* alembic is the SOLE author of ``coord.*``. Coord only SELECTs / INSERTs /
  UPDATEs against these objects; there is no Rust ``CREATE``/``ALTER``
  self-heal.
* The named CHECKs are dropped-then-added so a re-run is a no-op. Alembic runs
  the migration inside one transaction, so no window exists in which a column
  is unconstrained.

Deploy order — load-bearing
===========================

This web migration MUST be applied to prod RDS **BEFORE** the coord image
carrying the reads deploys. That is the 2026-07-13 missing-column incident
class: a coord binary naming a ``coord.*`` column its migration has not
shipped answers PostgreSQL 42703 on every affected request.

The ordering is enforced, not merely documented. Coord's ``coord-db-tests``
CI job runs a read-contract scanner that asserts every ``coord.<table>.<column>``
coord reads exists at qontinui-web's alembic head, so a phase that lands out of
order fails CI rather than production. The coord PR therefore carries
``coord:downstream-of`` on this one. Note that label's scope: it orders the
**cross-repo web→coord deploy**, not the alembic chain — the
``alembic-graph-pr.yml`` gate (qontinui-web only; coord's workflows have no
alembic graph job) owns revision ordering, and coord re-points
``down_revision`` to the live merged head at land time. Do not hand-order this
revision with dependency labels, and do not author an ``alembic merge``.

Head resolution
===============

``down_revision = "pmf_scope_cols_01"``, RE-POINTED at implementation closeout
(2026-09-01) and this is the second value it has held — the first is why this
section exists.

Authored against ``grantorig_01``, which was the single head of 519 revisions
when this file was written. By closeout ``main`` had gained four commits
carrying ``coord_wusod_01`` (the adjacent work-unit-SoD plan) and
``pmf_scope_cols_01`` on top of it, both chaining off ``grantorig_01`` — so
this revision and ``pmf_scope_cols_01`` were siblings and the tree had TWO
heads. Re-pointed to the live tip; the chain is now
``grantorig_01 -> coord_wusod_01 -> pmf_scope_cols_01 -> vetev_01``, 522
revisions, exactly one head.

Re-resolved both times by AST-parsing every revision file in
``backend/alembic/versions`` and taking each ``revision`` id that is no other
file's ``down_revision`` (handling tuple ``down_revision``s). If main moves
again before this merges, re-chain — and prove it with
``ScriptDirectory.from_config(...).get_heads()`` returning exactly ONE head,
never by reading one file. The ``Revises:`` line in this docstring is the
only other place the parent is written; re-point it in the same edit.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "vetev_01"
down_revision: str | Sequence[str] | None = "pmf_scope_cols_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Vocabularies, stated once so the CHECKs and the prose cannot drift.
#
# The re-verify worker's roll-up over a unit's live manifest. ``none`` is the
# empty-manifest verdict (checked, nothing claimed) and is DISTINCT from SQL
# NULL (never checked) — see the docstring.
_VET_STATES = "'none', 'fresh', 'moved', 'gone'"
# anchor_observer::Resolution, per anchor. A failed CHECK can never read as a
# deletion: ``unresolved`` is its own member precisely so ``gone`` stays a
# positive observation.
_LAST_RESULTS = "'unchanged', 'moved', 'gone', 'unresolved'"

# Object names, stated once so upgrade and downgrade cannot drift.
_EVIDENCE = "coord.work_unit_vet_evidence"
_OBSERVATIONS = "coord.work_unit_vet_observations"

_CK_LAST_RESULT = "work_unit_vet_evidence_last_result_check"
_CK_GENERATION = "work_unit_vet_evidence_generation_check"
_CK_VET_STATE = "work_units_vet_state_check"

_IX_EVIDENCE_UNIT_GEN = "idx_work_unit_vet_evidence_unit_gen"
_IX_EVIDENCE_LIVE_STALE = "idx_work_unit_vet_evidence_live_stale"
_IX_EVIDENCE_TENANT_RESULT = "idx_work_unit_vet_evidence_tenant_result"
_IX_OBSERVATIONS_TENANT_OBSERVED = "idx_work_unit_vet_observations_tenant_observed"
_IX_WORK_UNITS_TENANT_VET_STATE = "idx_work_units_tenant_vet_state"


def upgrade() -> None:
    """Stand up the evidence table, the oplog, and the two derived columns."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # ------------------------------------------------------------------
    # 1. The manifest — one row per anchor.
    #
    #    Raw SQL rather than op.create_table for the same reason as the
    #    sibling coord.* tables: the IF NOT EXISTS idempotency guard and
    #    the '{}'::jsonb default both want to be stated literally.
    # ------------------------------------------------------------------
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {_EVIDENCE} (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            work_unit_id     UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            tenant_id        UUID NOT NULL,
            anchor           JSONB NOT NULL,
            anchor_kind      TEXT NOT NULL,
            submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            submitted_by     TEXT,
            vet_generation   INTEGER NOT NULL,
            retired_at       TIMESTAMPTZ,
            last_result      TEXT,
            last_checked_at  TIMESTAMPTZ,
            detail           JSONB NOT NULL DEFAULT '{{}}'::jsonb
        )
        """
    )

    # Column comments carry the two vocabularies that are documentation
    # rather than enforcement, so a reader of \\d+ sees them without
    # opening this file.
    op.execute(
        f"""
        COMMENT ON COLUMN {_EVIDENCE}.anchor_kind IS
            'region|blob|pr|migration|schema|flag|probe — pinned by coord''s '
            'parse_anchor, deliberately NOT a DB CHECK so the resolver '
            'registry keeps its one-line extension promise'
        """
    )
    op.execute(
        f"""
        COMMENT ON COLUMN {_EVIDENCE}.submitted_by IS
            'the attester''s actor key — AUDIT ONLY, never a gate'
        """
    )
    op.execute(
        f"""
        COMMENT ON COLUMN {_EVIDENCE}.retired_at IS
            'NULL == live. Retirement MARKS, it never deletes: the audit '
            'trail is the point of this table'
        """
    )

    # last_result is the closed four-valued Resolution vocabulary. Dropped
    # then added so a re-run is a no-op.
    op.execute(f"ALTER TABLE {_EVIDENCE} DROP CONSTRAINT IF EXISTS {_CK_LAST_RESULT}")
    op.execute(
        f"""
        ALTER TABLE {_EVIDENCE}
            ADD CONSTRAINT {_CK_LAST_RESULT}
                CHECK (last_result IS NULL OR last_result IN ({_LAST_RESULTS}))
        """
    )
    # Generations are written as max(existing) + 1; a zero or negative value
    # would silently invert retirement ordering.
    op.execute(f"ALTER TABLE {_EVIDENCE} DROP CONSTRAINT IF EXISTS {_CK_GENERATION}")
    op.execute(
        f"""
        ALTER TABLE {_EVIDENCE}
            ADD CONSTRAINT {_CK_GENERATION} CHECK (vet_generation >= 1)
        """
    )

    # Per-unit history + the max(vet_generation) lookup on persist + the
    # retirement UPDATE. NOT partial: it must cover retired rows too.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_IX_EVIDENCE_UNIT_GEN}
            ON {_EVIDENCE} (work_unit_id, vet_generation DESC)
        """
    )
    # The fleet-wide, staleness-ordered scan the per-tick cap slices.
    # NULLS FIRST is explicit: a never-checked anchor must sort ahead of a
    # checked one, and a plain ASC index is NULLS LAST.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_IX_EVIDENCE_LIVE_STALE}
            ON {_EVIDENCE} (last_checked_at NULLS FIRST)
            WHERE retired_at IS NULL
        """
    )
    # The per-tenant census the oplog row carries, as an index-only grouping.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_IX_EVIDENCE_TENANT_RESULT}
            ON {_EVIDENCE} (tenant_id, last_result)
            WHERE retired_at IS NULL
        """
    )

    # ------------------------------------------------------------------
    # 2. The per-tick oplog. Posture copied from
    #    coord.memory_anchor_observations; only the subject noun changes
    #    (anchored_records -> anchored_units).
    # ------------------------------------------------------------------
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {_OBSERVATIONS} (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id         UUID NOT NULL,
            observed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            anchored_units    BIGINT NOT NULL,
            fresh             BIGINT NOT NULL,
            moved             BIGINT NOT NULL,
            gone              BIGINT NOT NULL,
            unresolved        BIGINT NOT NULL,
            distinct_anchors  BIGINT NOT NULL,
            detail            JSONB NOT NULL DEFAULT '[]'::jsonb
        )
        """
    )
    op.execute(
        f"""
        COMMENT ON COLUMN {_OBSERVATIONS}.anchored_units IS
            'work units with a live (non-retired) manifest — the watcher''s '
            'working set for this tenant on this tick'
        """
    )
    op.execute(
        f"""
        COMMENT ON COLUMN {_OBSERVATIONS}.distinct_anchors IS
            'distinct anchors CITED by this tenant''s live manifests — a '
            'citation count, not a fetch count: anchors are resolved once '
            'fleet-wide and the result fanned back per tenant'
        """
    )
    # Latest-per-tenant lookup + staleness window, the same index posture as
    # idx_memory_anchor_observations_tenant_observed. No unique constraint:
    # this is a history oplog and the same tenant recurs every tick.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_IX_OBSERVATIONS_TENANT_OBSERVED}
            ON {_OBSERVATIONS} (tenant_id, observed_at DESC)
        """
    )

    # ------------------------------------------------------------------
    # 3. The derived roll-up on coord.work_units. Metadata-only on
    #    PG >= 11 — existing rows are served NULL without a rewrite, and
    #    NULL is exactly the right value for them: never checked.
    # ------------------------------------------------------------------
    op.execute(
        """
        ALTER TABLE coord.work_units
            ADD COLUMN IF NOT EXISTS vet_state TEXT,
            ADD COLUMN IF NOT EXISTS vet_checked_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_units.vet_state IS
            'DERIVED — written only by coord''s vet re-verify worker. '
            'none|fresh|moved|gone, or NULL for never-checked. NULL and none '
            'are DISTINCT: none means checked with an empty manifest. Only a '
            'positively observed moved/gone withholds ready.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_units.vet_checked_at IS
            'DERIVED — when the re-verify worker last produced a verdict for '
            'this unit; lets a reader tell a fresh verdict from a stale one'
        """
    )
    op.execute(
        f"""
        ALTER TABLE coord.work_units
            DROP CONSTRAINT IF EXISTS {_CK_VET_STATE}
        """
    )
    op.execute(
        f"""
        ALTER TABLE coord.work_units
            ADD CONSTRAINT {_CK_VET_STATE}
                CHECK (vet_state IS NULL OR vet_state IN ({_VET_STATES}))
        """
    )
    # "Which of my units have a decayed vet." Partial because NULL is the
    # whole corpus until the worker first runs, and nobody queries for NULL.
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {_IX_WORK_UNITS_TENANT_VET_STATE}
            ON coord.work_units (tenant_id, vet_state)
            WHERE vet_state IS NOT NULL
        """
    )


def downgrade() -> None:
    """Reverse the upgrade exactly, in mirror order.

    Dropping a table takes its indexes and CHECKs with it, and dropping a
    column takes the constraints and indexes that reference it — but each is
    dropped explicitly first, for symmetry with its explicit CREATE and so
    that a PARTIALLY-applied upgrade still downgrades cleanly. Index names are
    schema-qualified: an index lives in its table's schema, and ``DROP INDEX``
    does not resolve through ``search_path`` the way a table reference does.

    Column comments need no explicit reversal — they are dropped with their
    column (or, for the two on ``coord.work_units``, with the ``DROP COLUMN``
    below).
    """
    # 3. coord.work_units — index, CHECK, then both columns.
    op.execute(f"DROP INDEX IF EXISTS coord.{_IX_WORK_UNITS_TENANT_VET_STATE}")
    op.execute(
        f"ALTER TABLE coord.work_units DROP CONSTRAINT IF EXISTS {_CK_VET_STATE}"
    )
    op.execute(
        """
        ALTER TABLE coord.work_units
            DROP COLUMN IF EXISTS vet_checked_at,
            DROP COLUMN IF EXISTS vet_state
        """
    )

    # 2. The oplog — index, then table.
    op.execute(f"DROP INDEX IF EXISTS coord.{_IX_OBSERVATIONS_TENANT_OBSERVED}")
    op.execute(f"DROP TABLE IF EXISTS {_OBSERVATIONS}")

    # 1. The manifest — indexes, CHECKs, then table. Nothing references it,
    #    so a plain DROP TABLE suffices once the FK-owning table is gone.
    op.execute(f"DROP INDEX IF EXISTS coord.{_IX_EVIDENCE_TENANT_RESULT}")
    op.execute(f"DROP INDEX IF EXISTS coord.{_IX_EVIDENCE_LIVE_STALE}")
    op.execute(f"DROP INDEX IF EXISTS coord.{_IX_EVIDENCE_UNIT_GEN}")
    # ``ALTER TABLE IF EXISTS`` (not the bare form): ``DROP CONSTRAINT IF
    # EXISTS`` still errors when the TABLE is missing, which is exactly the
    # partially-applied state this ordering is meant to survive.
    op.execute(
        f"ALTER TABLE IF EXISTS {_EVIDENCE} DROP CONSTRAINT IF EXISTS {_CK_GENERATION}"
    )
    op.execute(
        f"ALTER TABLE IF EXISTS {_EVIDENCE} DROP CONSTRAINT IF EXISTS {_CK_LAST_RESULT}"
    )
    op.execute(f"DROP TABLE IF EXISTS {_EVIDENCE}")
