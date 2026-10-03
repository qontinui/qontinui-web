"""overview.phases — the database refuses incoherent phase progress

Revision ID: overview_04b_phase_progress_checks
Revises: overview_04_timeline
Create Date: 2026-10-03

Until now only the API (``phase_progress_problem`` in
``app.schemas.overview``) refused a phase whose progress does not add up; a
write that bypassed it — a script, a hand-run statement, a future writer that
forgets the check — could store one. This revision puts the two rules the API
enforces, and the database did not, on the table itself. Each mirrors the API
EXACTLY, so a row the API accepts is a row the database accepts:

``ck_overview_phases_actual_end_has_start``
    ``actual_end IS NULL OR actual_start IS NOT NULL`` — a phase cannot have
    finished without having started. (The other half of the API's date rule,
    ``actual_end >= actual_start``, has been ``ck_overview_phases_actual_order``
    since ``overview_01``.)

``ck_overview_phases_gate_decision_dated``
    ``(gate_status = 'pending') = (gate_decided_at IS NULL)`` — a decided gate
    (``passed`` / ``failed`` / ``waived``) carries the date it was decided, and
    a pending one carries none. Both directions, because the API refuses both.
    ``gate_status`` is ``NOT NULL`` (``overview_01``), so the comparison is
    never NULL and the CHECK cannot pass vacuously.

The API's own 422 is unchanged and still comes first: it checks the progress
as it would stand before anything reaches the database, so these constraints
fire only for a writer that went around it.

Why ``NOT VALID``, and why no backfill here
===========================================
coord's merge-train migration classifier
(``qontinui-coord`` ``crates/coord/src/pr_merge/migration_classifier.rs``)
must answer ``AutoSafe`` for this revision, and on the upgrade path it admits
neither of the statements a backfill-then-validate would need:

* ``UPDATE`` — "data DML / backfill has unbounded blast radius";
* ``ALTER TABLE … VALIDATE CONSTRAINT`` — an ALTER TABLE action other than
  ``ADD COLUMN`` / ``ADD CONSTRAINT … NOT VALID`` is "unrecognized ALTER TABLE
  action (fail-closed)";
* and a ``DO $$ … $$`` catalog guard is refused by its lexer outright.

What it does admit is ``ADD CONSTRAINT … NOT VALID``, which is what this is:
``ACCESS EXCLUSIVE`` for the catalog update only (no scan), after which every
INSERT and every UPDATE of ``overview.phases`` is checked. Rows already stored
are not scanned, so a row written incoherently before this revision — the
only way one exists, since the API has refused them since
``overview_04_timeline``'s Phase 4 and the estimate's content write stopped
accepting progress fields then — stays as it is until it is next written, and
that next write must leave it coherent. ``convalidated`` stays false until a
``VALIDATE CONSTRAINT`` is run; that, and any repair of such rows, is a
data change for a revision of its own that the classifier escalates, not this
one.

Re-runnable: each ``ADD CONSTRAINT`` (PostgreSQL has no ``IF NOT EXISTS`` for
it) is guarded by the constraint's NAME in the inspector's catalog read, which
lists a ``NOT VALID`` constraint as well — so a re-run, or a database whose
tables ``Base.metadata.create_all`` built with the model's (validated) copies
of these constraints, skips it.

Downgrade drops the two constraints (``IF EXISTS``); no data changes either way.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "overview_04b_phase_progress_checks"
down_revision: str | Sequence[str] | None = "overview_04_timeline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CK_ACTUAL_END_HAS_START = "ck_overview_phases_actual_end_has_start"
CK_GATE_DECISION_DATED = "ck_overview_phases_gate_decision_dated"


def _phase_check_names() -> set[str]:
    """The CHECK constraints ``overview.phases`` carries now, validated or not."""
    inspector = sa.inspect(op.get_bind())
    return {
        str(c["name"])
        for c in inspector.get_check_constraints("phases", schema="overview")
        if c.get("name")
    }


def upgrade() -> None:
    present = _phase_check_names()
    if CK_ACTUAL_END_HAS_START not in present:
        op.execute(
            "ALTER TABLE overview.phases "
            "ADD CONSTRAINT ck_overview_phases_actual_end_has_start "
            "CHECK (actual_end IS NULL OR actual_start IS NOT NULL) NOT VALID"
        )
    if CK_GATE_DECISION_DATED not in present:
        op.execute(
            "ALTER TABLE overview.phases "
            "ADD CONSTRAINT ck_overview_phases_gate_decision_dated "
            "CHECK ((gate_status = 'pending') = (gate_decided_at IS NULL)) NOT VALID"
        )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE overview.phases "
        "DROP CONSTRAINT IF EXISTS ck_overview_phases_gate_decision_dated"
    )
    op.execute(
        "ALTER TABLE overview.phases "
        "DROP CONSTRAINT IF EXISTS ck_overview_phases_actual_end_has_start"
    )
