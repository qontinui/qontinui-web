"""coord.work_unit_phase_attestations — evidence for a phase that ships no PR

Revision ID: phaseatt_01
Revises: merge_20260920_ci_contspawn_pdpub_rsslocal
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
  defeated by re-inserting the same evidence, which the dedupe index below
  refuses. ``DELETE`` is not a supported verb and coord issues none; the index
  guarantees nothing about a row that has been removed, and the dedupe note
  below says so.
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

  Stated precisely, because the weaker claim is the true one: the index blocks
  a second INSERT only for as long as the retracted row is THERE. A ``DELETE``
  followed by an ``INSERT`` yields a fresh live attestation with no trace of
  the retraction, and nothing in this schema forbids a ``DELETE``. What makes
  that acceptable is the direction rather than the constraint — deleting an
  attestation REMOVES coverage, so it can never forge ``shipped`` — plus the
  fact that ``DELETE`` is not a supported verb: the correction verb is the
  retraction column set, and coord issues no delete against this table.

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
  ``(work_unit_id)`` for the per-unit read, which coord performs on every
  delivery derivation. It mirrors ``idx_work_unit_pr_citations_work_unit`` on
  the sibling table (``coord_workunits_04:105-108``), and being one narrow
  column it is marginally cheaper to scan and to maintain than the four-column
  unique index.

  That is the whole justification, and it is deliberately not a performance
  claim. The dedupe index LEADS on ``work_unit_id``, so it can serve this
  lookup on its own; and neither index carries ``retracted_at``, so the
  ``retracted_at IS NULL`` filter that follows costs the same heap fetch either
  way. An earlier draft of this paragraph asserted the opposite and was wrong.
  A partial ``WHERE retracted_at IS NULL`` index would make that filter free,
  and is deliberately NOT taken: it would contradict the no-partial-predicate
  posture below for a saving nobody has measured on a table with no rows in it.

No CHECK, no trigger, no partial predicate.

``evidence_kind`` is a vocabulary column, and the house posture for those in
``coord.*`` is Rust-side enforcement: a ``CHECK`` here would make a vocabulary
widening a web migration ordered ahead of the coord deploy that uses it.

``phase_index`` carries no ``CHECK (phase_index >= 0)`` either, and that is a
decision rather than an oversight. The real invariant is not a bound — it is
*"this index is a member of the unit's DECLARED phase set"*, which lives on
``coord.work_units.metadata.phases`` and which no column constraint can
express. Phase 3 must therefore intersect against the declared set anyway —
guard 2 of qontinui-coord
``crates/coord/src/citation_scope_backfill.rs:500`` is the precedent, read
against coord ``origin/main`` ``54b6249a6`` — and that check strictly subsumes
``>= 0``: index ``99`` on a seven-phase unit is exactly as wrong as ``-1``, and
only the Rust side can see it. Putting the weaker half
in the database would duplicate a validation that has to exist in full
elsewhere, and would answer a caller error with a ``23514`` instead of the
typed refusal the coord door owes it. Keep the refusal in one place, where it
can be complete.

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

**Re-pointed at the merged head at land time**, which is this directory's
convention rather than an afterthought. It was authored against qontinui-web
``origin/main`` ``c514c36b2``, where the chain carried **581 revisions and FOUR
live heads** — ``ci_job_mem_01``,
``contspawn_01_gates_continuation_spawn_attempts``, ``pdpub_03`` and
``rsslocal_02_drop_coord_tables`` — so a head was a CHOICE there rather than a
lookup, and ``contspawn_01_gates_continuation_spawn_attempts`` was the one
taken (newest, and the only one in this revision's own ``coord.*`` lineage).
Resolving that fork was never this revision's job: qontinui-web #1430 owned it
and landed the merge revision ``merge_20260920_ci_contspawn_pdpub_rsslocal``.

Re-measured after #1430 landed, at ``origin/main`` ``ce5fe2356``: **582
revisions, exactly ONE head**, that merge revision — which is now this
revision's parent. Chaining off it keeps the count at one.

The re-point edited two places and deliberately NOT a third: the token below
and the ``Revises:`` line in this docstring. This revision's test asserts the
chain is WELL-FORMED (exactly one parent, and that parent is a real sibling)
without pinning WHICH revision it is, so a re-point never touches the test. A
test that pinned the parent would fail on every land-time re-point and wedge
coord's rebase.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "phaseatt_01"
down_revision: str | Sequence[str] | None = "merge_20260920_ci_contspawn_pdpub_rsslocal"
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
    # re-inserting — for as long as the row is there. DELETE is not a supported
    # verb and coord issues none; a deleted row is outside this index's reach,
    # and that direction is safe because deleting coverage cannot forge
    # shipped. NULLS NOT DISTINCT states the intended semantics at the one
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
        'the same evidence cannot be defeated by re-inserting. DELETE is not a '
        'supported verb and coord issues none: the dedupe index refuses a second '
        'INSERT only while the retracted row is there, and a deleted attestation '
        'simply removes coverage, which cannot forge shipped.'
        """
    )


def downgrade() -> None:
    """Reverse: indexes first, then the table."""
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_phase_attestations_work_unit")
    op.execute("DROP INDEX IF EXISTS coord.uq_work_unit_phase_attestations_dedupe")
    op.execute("DROP TABLE IF EXISTS coord.work_unit_phase_attestations")
