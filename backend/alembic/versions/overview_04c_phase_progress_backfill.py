"""overview.phases — repair legacy incoherent progress, then VALIDATE the checks

Revision ID: overview_04c_phase_progress_backfill
Revises: overview_04b_phase_progress_checks
Create Date: 2026-10-03

``overview_04b_phase_progress_checks`` added
``ck_overview_phases_actual_end_has_start`` and
``ck_overview_phases_gate_decision_dated`` ``NOT VALID``, because coord's
merge-train migration classifier admits no data change in an ``AutoSafe``
revision. Until they are validated a phase row stored incoherently before
them refuses EVERY later UPDATE of itself (the API answers that with a 422
``incoherent_recorded_progress`` naming the phase, so it is visible, but the
user still has to repair it by hand on the Timeline). This revision is the
data half, shipped on its own so the classifier escalates it rather than the
schema half: it repairs every such row, then validates both constraints.

The repair, per rule — each the least invention that makes the row coherent:

* **An actual end with no actual start** (``…_actual_end_has_start``): the
  end is cleared. Inventing a start date would be a claim nobody recorded;
  dropping the end only returns the phase to "not recorded as finished",
  which the Timeline shows and a user can re-record.
* **A pending gate carrying a decision date** (``…_gate_decision_dated``):
  the date is cleared — the status says nothing was decided.
* **A decided gate with no decision date** (the same CHECK): dated to when
  its progress was last recorded (``progress_updated_at``), else when the
  phase was last written (``updated_at``), else today — each taken as a UTC
  calendar date (``AT TIME ZONE 'UTC'``), so the result does not depend on the
  migrating session's ``TimeZone``. ``gate_decided_at`` is a ``DATE``;
  both sources are ``timestamptz``.

**One UPDATE, not one per rule.** Every UPDATE of ``overview.phases`` is
checked against both (``NOT VALID``) constraints, so a row breaking BOTH
rules could be repaired by neither of two separate statements: the first
would leave it still breaking the other, and be refused. A single statement
repairs every rule on a row at once.

**The repaired rows' ``progress_version`` moves** (a NULL read as 1, as
the API reads it), so a Timeline holding the
old copy gets a 409 with the repaired one rather than silently writing over
it; ``progress_updated_at`` / ``progress_updated_by`` are left alone — the
repair is not somebody recording progress. (No change-log row is written: a
migration has no request, actor or tenant context; the ``updated_at`` stamp
is left alone for the same reason.)

``ck_overview_phases_actual_order`` needs no repair: it has been a validated
CHECK since ``overview_01``, so no stored row can break it.

Then ``VALIDATE CONSTRAINT`` for both: a ``SHARE UPDATE EXCLUSIVE`` scan that
blocks no reads and no writes, after which ``convalidated`` is true and the
planner may rely on them.

Downgrade is a deliberate no-op. The repaired values are not recorded
anywhere a downgrade could restore them from (and restoring incoherent data
would be the wrong thing to want), and a validated constraint cannot be
returned to ``NOT VALID`` — dropping it is ``overview_04b``'s downgrade, not
this one's. So stepping back to ``overview_04b`` leaves the data repaired and
the constraints validated, which is a state ``overview_04b``'s schema fully
admits.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_04c_phase_progress_backfill"
down_revision: str | Sequence[str] | None = "overview_04b_phase_progress_checks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The rows breaking either rule, each repaired in one statement (see the
#: module docstring for why one).
REPAIR = """
UPDATE overview.phases SET
    actual_end = CASE
        WHEN actual_end IS NOT NULL AND actual_start IS NULL THEN NULL
        ELSE actual_end
    END,
    gate_decided_at = CASE
        WHEN gate_status = 'pending' THEN NULL
        WHEN gate_decided_at IS NULL THEN COALESCE(
            (progress_updated_at AT TIME ZONE 'UTC')::date,
            (updated_at AT TIME ZONE 'UTC')::date,
            (now() AT TIME ZONE 'UTC')::date
        )
        ELSE gate_decided_at
    END,
    progress_version = COALESCE(progress_version, 1) + 1
WHERE (actual_end IS NOT NULL AND actual_start IS NULL)
   OR (gate_status = 'pending' AND gate_decided_at IS NOT NULL)
   OR (gate_status <> 'pending' AND gate_decided_at IS NULL)
"""

VALIDATE = (
    "ALTER TABLE overview.phases "
    "VALIDATE CONSTRAINT ck_overview_phases_actual_end_has_start",
    "ALTER TABLE overview.phases "
    "VALIDATE CONSTRAINT ck_overview_phases_gate_decision_dated",
)


def upgrade() -> None:
    op.execute(REPAIR)
    for statement in VALIDATE:
        op.execute(statement)


def downgrade() -> None:
    """Nothing to undo — see the module docstring."""
