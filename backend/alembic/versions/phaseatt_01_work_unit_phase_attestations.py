"""coord.work_unit_phase_attestations — evidence for a phase that ships no PR

Revision ID: phaseatt_01
Revises: contspawn_01_gates_continuation_spawn_attempts
Create Date: 2026-09-20

Phase 2 of plan
``plans/2026-09-20-coord-delivery-has-no-verb-for-a-phase-that-ships-no-pr.md``
("coord delivery has no verb for a phase that ships no PR and no commit").
Mechanism B of dossier ``plan-record-vs-reality-divergence``. Authored by
alembic in ``qontinui-web`` — coord authors zero ``coord.*`` DDL (served policy
``production-and-cost`` ``alembic-sole-authorship``).

The defect
==========

coord's delivery verdict has carried a per-phase coverage axis since
``2026-09-13-coord-delivery-cannot-express-partial-delivery``. The **only**
carrier of a phase attribution is
``coord.work_unit_pr_citations.delivery_scope`` (added by ``partdel_01``,
read at ``crates/coord/src/delivery_view.rs:1084``), and coverage is
accumulated **only inside the ``landed`` arm of a NUMBERED citation** —
``reduce_delivery_inputs`` tests ``if pr_number.is_some()`` before it ever
looks at a scope (``delivery_view.rs:1926``, ``:1960-1970``).

So a plan phase whose correct output is **not a code change** — a verification
phase, a coord prompt-document version bump, a finding recorded and superseded
— can never be attributed. It is not *undelivered*; it is
**unrepresentable**, and coord renders the two identically: the phase sits in
``phases_remaining`` forever and holds ``shipped: false`` permanently.

Measured 2026-09-20 on work unit ``23517cee-10be-44b5-8634-65b4d240fd7d``
(``2026-09-15-captured-vs-authored-coverage-is-a-set-difference``):
``phases_declared: 7``, ``phases_delivered: [1,2,3,4,5]``,
``phases_remaining: [0,6]``, ``shipped: false`` — where phase 0 is a VERIFY
phase that by design ships no PR and no commit, and phase 6's deliverable is a
coord prompt-document version bump that lives inside coord itself with an id,
a version number and an attributed editor. This is
``verification-and-evidence`` ``unknown-must-not-render-as-a-default`` applied
to the delivery axis.

What this table adds
====================

A **per-phase attestation that stores a POINTER, never a verdict**. Coverage is
recomputed on every read by re-resolving that pointer against coord's own
tables, the same derived-per-read discipline that makes a reopened PR re-pin its
unit (``terminal_unlanded``, ``delivery_view.rs:1040``). If the cited finding is
retracted, the prompt document is withdrawn, or its version is rolled back below
the attested floor, coverage evaporates for free on the next read. Nothing is
deleted and nothing becomes editable.

Column by column, and why each is shaped the way it is:

* ``id`` — surrogate key, so a retraction can address one row.
* ``tenant_id`` — NULLABLE, matching every sibling ``coord.*`` table
  (``work_units``, ``work_unit_pr_citations``). Tenant scoping in this schema
  is applied by the reader, not by a NOT NULL here; diverging would make this
  the only coord table that refuses a tenant-agnostic row.
* ``work_unit_id`` — ``NOT NULL REFERENCES coord.work_units(id) ON DELETE
  CASCADE``, exactly as ``work_unit_pr_citations`` and
  ``work_unit_status_history`` are wired. An attestation about a unit that no
  longer exists is not evidence of anything.
* ``phase_index`` — ``INTEGER NOT NULL``. **0 IS a valid phase**, and that is
  load-bearing: ``23517cee``'s phase 0 is half the live blocking instance, and
  ``PhaseScope::collect`` (``delivery_view.rs:1246``) already treats index 0 as
  a phase. Nothing here may treat 0 as absent.
* ``evidence_kind`` — ``TEXT NOT NULL``. A closed vocabulary **enforced in
  Rust**, deliberately with no ``CHECK`` constraint: the same posture as
  ``coord.notifications.kind`` and ``coord.ci_runner_quarantines.state``.
  Widening a vocabulary must be a coord deploy, not a second web migration
  ordered ahead of it — which is the ordering hazard this whole file exists to
  respect. The refusal lives where the caller gets a typed error
  (``add_citation_source_refusal``, ``work_unit_registry.rs:181``, is the
  in-repo precedent).
* ``evidence_ref`` — ``TEXT NOT NULL``. A coord row id, or a ``kind/name``
  pair for an artifact addressed that way (a prompt document). TEXT rather
  than UUID because the vocabulary spans both shapes; the parse belongs with
  the vocabulary, in Rust.
* ``evidence_min_version`` — ``INTEGER``, **NULLABLE, and NULL is a real
  value**: the attested kind has no version axis at all (a finding id is not
  versioned). It is NOT "unknown version". For a kind that does have one (a
  prompt document), this is the FLOOR the re-resolution checks, so a rollback
  below it evaporates coverage.
* ``note`` — free text for the human reading the axis later. Never parsed.
* ``attested_by`` — ``TEXT NOT NULL``, taken from ``CallerIdentity`` on the
  coord side and **never from an argument**. An evidence store whose author
  field is caller-supplied attributes nothing.
* ``attested_at`` — ``TIMESTAMPTZ NOT NULL DEFAULT now()``.
* ``retracted_at`` / ``retracted_by`` / ``retraction_reason`` — the correction
  verb. ``retracted_at IS NULL`` means live; a set value means retracted.
  **A retraction is a column UPDATE on the attestation row, never a DELETE and
  never a second row** — so the history survives, and the correction cannot be
  defeated by re-inserting the same evidence (see the dedupe index below).
  Shipping the correction verb in the same revision as the store is a hard
  constraint inherited from
  ``2026-09-20-a-recorded-delivery-scope-is-permanent-so-a-mis-declared-phase-is-uncorrectable``
  — an evidence store that ships without one mints the next occurrence of
  dossier ``evidence-store-has-no-correction-verb``.

Indexes
=======

* ``uq_work_unit_phase_attestations_dedupe`` — UNIQUE on
  ``(work_unit_id, phase_index, evidence_kind, evidence_ref)``
  ``NULLS NOT DISTINCT``, the same identity discipline as
  ``uq_work_unit_pr_citations_dedupe``
  (``coord_workunits_04_work_unit_pr_citations.py:100-104``). Re-attesting the
  same evidence for the same phase is **idempotent** — it collides with the
  existing row rather than accumulating a second one — which is what makes a
  retraction durable: a re-attest after a retraction must be an UPDATE that
  clears ``retracted_at``, decided by coord, rather than a fresh INSERT that
  quietly routes around the correction.

  Honest note on ``NULLS NOT DISTINCT``: all four key columns are ``NOT NULL``
  today, so the clause changes nothing at this moment. It is written anyway
  because it states the intended identity semantics at the one place the
  identity is defined, and because the sibling index it mirrors needs it for
  real. It is not load-bearing until a key column becomes nullable, and no
  reader may infer from its presence that one is.

  It is implemented as a unique INDEX rather than a table constraint so
  ``ON CONFLICT`` can bind to it by name, exactly as the citations dedupe key
  is.

* ``idx_work_unit_phase_attestations_work_unit`` — plain index on
  ``(work_unit_id)`` for the per-unit read. That read is the hot path: coord
  resolves every attestation for a unit on each delivery derivation, and the
  unique index above cannot serve it as cheaply for the ``retracted_at IS
  NULL`` scan that follows.

No CHECK, no trigger, no partial predicate. ``evidence_kind`` is a vocabulary
column and the house posture for those in ``coord.*`` is Rust-side enforcement;
a ``CHECK`` here would make a vocabulary widening a migration ordered ahead of
the coord deploy that uses it.

Idempotency / authorship posture
================================

* ``CREATE SCHEMA IF NOT EXISTS coord`` first, then ``CREATE TABLE IF NOT
  EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` through raw ``op.execute`` —
  matching ``coord_workunits_04`` and ``partdel_01``. coord boots against this
  same schema, so re-running against an already-applied DB must be a no-op.
* Every statement names its schema explicitly, which is what the
  ``alembic-schema-arg-gate`` pre-commit hook
  (``.pre-commit-hooks/check_alembic_schema_args.py``) audits for raw
  ``op.execute`` SQL. Note it is NOT ``forbid-public-schema`` that covers this
  file — that check's ``EXCLUDE_PATHSPECS`` contains
  ``":!backend/alembic/versions/*"`` and never sees this directory.
* **alembic is the SOLE author of the ``coord.*`` schema.** No Rust
  ``CREATE``/``ALTER`` self-heal anywhere: the coord crate only SELECTs and
  INSERTs [policy: ``production-and-cost`` ``alembic-sole-authorship``]. This
  revision was **HAND-AUTHORED**; ``alembic revision --autogenerate`` is never
  run here.
* The ``IF NOT EXISTS`` idiom is idempotent in each object's EXISTENCE only,
  not in its SHAPE. If ``coord.work_unit_phase_attestations`` somehow already
  exists in another shape — from a partially-applied run or a hand-made mirror
  — this statement silently no-ops and the columns below are never applied.
  That is a pre-existing property of the house idiom and is deliberately not
  worked around here; the consequence belongs to the coord side, which should
  ASSERT this table at boot (``require_table``) rather than trust it.

Ordering: this is a correctness requirement, not a nicety
=========================================================

**This web migration MUST be applied to the serving database BEFORE the coord
image that reads this table deploys** (plan Phase 3), for the same reason
``partdel_01`` carries the rule: coord and qontinui-web deploy independently.
A coord build that SELECTs a table this migration has not yet created cannot
observe an attestation, so every phase it would have covered degrades to
**UNKNOWN** — the axis reads exactly as it does today, ``shipped`` stays
pinned, and the plan's whole population stays unreachable. Phase 3 is written
to fail open (an absent table is UNKNOWN, never "no attestations exist", never
a boot failure), which is what makes the degradation safe rather than
catastrophic — but it is still a degradation, and the only thing that lifts it
is this revision being live first. Plan Phase 2's own exit criterion is
therefore *"on ``origin/main`` **and applied to the serving database**, verified
by a ``coord_query_schema_object`` read of the table, not by the merge."*

``down_revision``
=================

Pointed at a live head as of authoring. Measured against qontinui-web
``origin/main`` ``c514c36b2`` on 2026-09-20: **581 revisions and FOUR live
heads** — ``ci_job_mem_01``, ``contspawn_01_gates_continuation_spawn_attempts``,
``pdpub_03`` and ``rsslocal_02_drop_coord_tables``. A head is therefore a
CHOICE here rather than a lookup, and ``contspawn_01_gates_continuation_spawn_attempts``
is the one taken: it is the newest of the four (2026-09-20) and the only one in
the same ``coord.*``-schema lineage as this revision, so the chain reads in the
order the work happened.

Chaining off one existing head keeps the head COUNT at four; it does not add a
fifth. Resolving the existing fork is **not this revision's job** — qontinui-web
#1430 (``merge_20260920_ci_contspawn_pdpub_rsslocal``) owns it, and a second
merge revision authored here would be permanent bookkeeping added for nothing.

Per this directory's convention the ``down_revision`` above is **RE-POINTED at
the merged head at land time** rather than hand-ordered now; once #1430 lands,
the correct parent is its merge revision. The re-point edits two places — the
token below and the ``Revises:`` line in this docstring — and deliberately NOT
a third: this revision's test asserts the chain is WELL-FORMED (one parent, and
that parent is a real sibling) without pinning WHICH revision it is, so a
re-point never touches the test. A test that pinned the parent would fail on
every land-time re-point and wedge coord's rebase.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "phaseatt_01"
down_revision: str | Sequence[str] | None = (
    "contspawn_01_gates_continuation_spawn_attempts"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the phase-attestation store and its two indexes."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_phase_attestations (
            id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id             UUID,
            work_unit_id          UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            phase_index           INTEGER NOT NULL,
            evidence_kind         TEXT NOT NULL,
            evidence_ref          TEXT NOT NULL,
            evidence_min_version  INTEGER,
            note                  TEXT,
            attested_by           TEXT NOT NULL,
            attested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            retracted_at          TIMESTAMPTZ,
            retracted_by          TEXT,
            retraction_reason     TEXT
        )
        """
    )
    # Identity key. Re-attesting the same evidence for the same phase collides
    # with the existing row instead of accumulating a second one, so a
    # retraction (a column UPDATE on this row) cannot be defeated by
    # re-inserting. NULLS NOT DISTINCT states the intended semantics at the one
    # place identity is defined and mirrors uq_work_unit_pr_citations_dedupe;
    # every key column is NOT NULL today, so it changes nothing yet. A unique
    # INDEX rather than a constraint so ON CONFLICT can bind to it by name.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS "
        "uq_work_unit_phase_attestations_dedupe "
        "ON coord.work_unit_phase_attestations "
        "(work_unit_id, phase_index, evidence_kind, evidence_ref) "
        "NULLS NOT DISTINCT"
    )
    # The per-unit read: coord re-resolves every attestation for a unit on each
    # delivery derivation.
    op.execute(
        "CREATE INDEX IF NOT EXISTS "
        "idx_work_unit_phase_attestations_work_unit "
        "ON coord.work_unit_phase_attestations (work_unit_id)"
    )

    op.execute(
        """
        COMMENT ON TABLE coord.work_unit_phase_attestations IS
        'Per-phase evidence for a plan phase that correctly ships no PR and no '
        'commit. Owned by coord delivery_view (PhaseCoverage). Each row stores a '
        'POINTER to a durable, attributed artifact in coord''s own store, never a '
        'verdict: coverage is re-resolved on every read, so a retracted finding or '
        'a withdrawn prompt document evaporates it for free. An attestation may '
        'COVER a phase but never constitutes ATTRIBUTION, and can never create '
        'delivery: shipped still requires a landed, numbered, non-document PR '
        'citation.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_phase_attestations.phase_index IS
        'Zero-based phase index. 0 IS a valid phase and must never be read as '
        'absent — it is half the live blocking instance this table was built for.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_phase_attestations.evidence_kind IS
        'Closed vocabulary, enforced in Rust rather than by a CHECK, so widening '
        'it is a coord deploy and not a web migration ordered ahead of one.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_phase_attestations.evidence_ref IS
        'A coord row id, or a kind/name pair for an artifact addressed that way. '
        'TEXT because the vocabulary spans both shapes; parsed on the Rust side '
        'beside the vocabulary.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_phase_attestations.evidence_min_version IS
        'Version FLOOR the per-read re-resolution checks. NULL is a real value — '
        'the attested kind has no version axis at all — and is NOT "unknown '
        'version".'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_phase_attestations.attested_by IS
        'Taken from CallerIdentity on the coord side, never from a caller '
        'argument. An evidence store with a caller-supplied author attributes '
        'nothing.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.work_unit_phase_attestations.retracted_at IS
        'NULL = live. A retraction sets this column on the existing row — never a '
        'DELETE, never a second row — so the history survives and a re-attest of '
        'the same evidence cannot route around the correction.'
        """
    )


def downgrade() -> None:
    """Reverse: indexes first, then the table."""
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_phase_attestations_work_unit")
    op.execute("DROP INDEX IF EXISTS coord.uq_work_unit_phase_attestations_dedupe")
    op.execute("DROP TABLE IF EXISTS coord.work_unit_phase_attestations")
