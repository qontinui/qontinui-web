"""coord.work_unit_pr_citations.delivery_scope — the per-citation phase attribution

Revision ID: partdel_01
Revises: presetprov01_allow_preset_provisional_profile_source
Create Date: 2026-09-13

Phase 2a of plan
``plans/2026-09-13-coord-delivery-cannot-express-partial-delivery.md``
("coord's delivery predicate cannot express PARTIAL delivery"). Mechanism B of
dossier ``plan-record-vs-reality-divergence``.

The defect
==========

coord's delivery predicate is *"at least one cited PR positively landed, and no
cited PR still blocking"* (``crates/coord/src/delivery_view.rs``,
``reduce_delivery_inputs``). It is NOT *"all phases done"*, and it cannot be:
the reduction sees only citations, while a plan's phase LIST lives on the work
unit (``coord.work_units.metadata.phases``). So ONE landed phase of a six-phase
plan derives ``shipped`` for the whole plan — **26 work units measured in
exactly that state on 2026-09-13** (finding ``9c877d5a``), each carrying a
genuine, merged, multi-file implementation PR that correctly back-references its
plan.

That population is unreachable by every remedy keyed on the citation's SHAPE
(the sole-docs-only classifier shipped as ``document_citation``), because
mechanism B's citation is exactly what a CORRECT citation looks like.

What this column adds
=====================

* ``delivery_scope  JSONB`` — NULLABLE, no default. The phases the cited PR
  declares it delivers, captured from the remainder of the ``Plan:`` marker
  line that ``parse_plan_citations`` (coord
  ``crates/coord/src/data/repo_branches.rs``) currently discards.

  Accepted shapes, mirroring ``delivery_view::PhaseScope``::

      "complete"            -- this PR delivers the whole plan
      {"phases": [1, 2]}    -- this PR delivers exactly those phases
      [1, 2]                -- shorthand for the above
      "partial"             -- partial, phases unspecified

**NULL is UNKNOWN, and that is load-bearing.** Every citation written before
this convention existed — the ~953 ``phase1_backref_reconcile`` rows included —
has no scope. Reading NULL as "delivers the whole plan" would silently
re-assert the very defect this plan closes; reading it as "delivers nothing"
would demote genuinely-complete units (the ``91d106c5`` control: nine landed
implementation citations, no scope on any of them). Neither is an observation,
so coord takes neither — see ``PhaseCoverage::gate``, whose middle arm leaves
the verdict alone and raises an evidence gap instead. A unit demotes because
coord ACQUIRED evidence about it, never because coord assumed something in the
absence of evidence.

Why JSONB and not a column pair
===============================

The scope is a small closed sum type (``complete`` | a phase set), not two
independent scalars. A ``(is_complete BOOLEAN, phases INTEGER[])`` pair makes
the illegal state ``(true, {1,2})`` representable and needs a CHECK constraint
to forbid it; one JSONB column makes the sum type the storage shape and keeps
the parse in one place, on the Rust side, where its degradation rule
(anything unrecognized ⇒ UNKNOWN) already lives.

Idempotency / authorship posture
================================

* ``ADD COLUMN IF NOT EXISTS`` raw ``op.execute``, matching the ``coord.*``
  migration house style. coord boots against this same schema, so re-running
  against an already-applied DB must be a no-op.
* **alembic is the SOLE author of the coord.* schema.** No Rust
  ``CREATE``/``ALTER`` self-heal — the coord crate only SELECTs / INSERTs
  [policy: ``production-and-cost`` ``alembic-sole-authorship``]. This revision
  was HAND-AUTHORED; ``alembic revision --autogenerate`` is never run here.
* **This web migration MUST be applied BEFORE the coord image that SELECTs the
  column deploys.** The coord-side predicate (plan Phase 3) is deliberately
  written to read an ABSENT key as UNKNOWN, so a coord build that predates this
  column behaves exactly as it does today rather than failing — but the
  projection that reads it (plan Phase 2c) is strictly downstream of this.
* The dedupe key ``UNIQUE NULLS NOT DISTINCT (work_unit_id, repo, pr_number,
  commit_sha)`` is deliberately UNTOUCHED. A scope is an attribute OF a
  citation, not part of its identity: two rows differing only in scope are the
  same citation re-observed, and must continue to collide rather than
  accumulate.

``down_revision`` is pointed at a live head as of authoring
(``presetprov01_allow_preset_provisional_profile_source``). Per this directory's convention, RE-POINT it at the
merged head at land time rather than hand-ordering it now.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "partdel_01"
down_revision: str | Sequence[str] | None = "presetprov01_allow_preset_provisional_profile_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        "ALTER TABLE IF EXISTS coord.work_unit_pr_citations "
        "ADD COLUMN IF NOT EXISTS delivery_scope JSONB"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE IF EXISTS coord.work_unit_pr_citations "
        "DROP COLUMN IF EXISTS delivery_scope"
    )
