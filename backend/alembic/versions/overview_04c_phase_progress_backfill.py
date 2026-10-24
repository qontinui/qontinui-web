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
schema half: it repairs every such row, logs each repair, then validates both
constraints.

The repair, per rule — each the least invention that makes the row coherent:

* **An actual end with no actual start** (``…_actual_end_has_start``): the
  recorded end is KEPT and the start is filled with the one the product
  already assumes for such a phase — the forecast reads a phase's start as
  ``actual_start or planned_start`` (``app.services.overview_forecast``) —
  capped at the end (``LEAST(COALESCE(planned_start, actual_end),
  actual_end)``), so ``ck_overview_phases_actual_order`` still holds. A phase
  with no planned start, or one planned to start after its recorded end, gets
  the end as its start. A recorded finish is a fact somebody entered; dropping
  it would lose more than an assumed start invents.
* **A pending gate carrying a decision date** (``…_gate_decision_dated``):
  the date is cleared — the status says nothing was decided.
* **A decided gate with no decision date** (the same CHECK): dated to when
  its progress was last recorded (``progress_updated_at``), else when the
  phase was last written (``updated_at``), else today — each taken as a UTC
  calendar date (``AT TIME ZONE 'UTC'``), so the result does not depend on the
  migrating session's ``TimeZone``. ``gate_decided_at`` is a ``DATE``;
  both sources are ``timestamptz``.

**One statement, not one per rule.** Every UPDATE of ``overview.phases`` is
checked against both (``NOT VALID``) constraints, so a row breaking BOTH
rules could be repaired by neither of two separate statements: the first
would leave it still breaking the other, and be refused. A single UPDATE
repairs every rule on a row at once.

**Every repair is logged, so every repair is recoverable.** The same
statement appends one ``overview.change_log`` row per repaired phase, in the
same transaction, in the shape a normal ``phase_progress`` write logs:
``resource = 'phase_progress'``, ``action = 'update'``, ``record_id`` the
phase id, ``tenant_id`` the phase's own, ``before``/``after`` the resource's
read shape (``PhaseProgressRead``) — ``before`` read from the statement's
snapshot, i.e. the pre-repair values — and ``version_before`` /
``version_after``. ``source`` is ``'import'`` (the change log's only
non-interactive source) and ``actor`` is :data:`ACTOR`, with no
``actor_user_id``: nobody made the edit, and the log says which migration did.

**The repaired rows' ``progress_version`` moves** (a NULL read as 1, as
the API reads it), so a Timeline holding the old copy gets a 409 with the
repaired one rather than silently writing over it. ``progress_updated_at`` /
``progress_updated_by`` and ``updated_at`` are left alone: the repair is not
somebody recording progress, and the change-log row is where it is recorded.

``ck_overview_phases_actual_order`` needs no repair: it has been a validated
CHECK since ``overview_01``, so no stored row can break it — and the filled
start above is capped so that no repaired row does either.

Then ``VALIDATE CONSTRAINT`` for both: a ``SHARE UPDATE EXCLUSIVE`` scan that
blocks no reads and no writes of its own, after which ``convalidated`` is true
and the planner may rely on them. alembic runs the repair and both validations
in one transaction, so the repaired rows stay row-locked until the scans end.

Downgrade is a deliberate no-op. A validated constraint cannot meaningfully be
returned to ``NOT VALID`` — dropping it is ``overview_04b``'s downgrade, not
this one's — and putting incoherent data back would be the wrong thing to
want. The pre-repair values are not lost: each is the ``before`` of this
revision's change-log rows (``actor`` = :data:`ACTOR`). So stepping back to
``overview_04b`` leaves the data repaired and the constraints validated, which
is a state ``overview_04b``'s schema fully admits.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_04c_phase_progress_backfill"
down_revision: str | Sequence[str] | None = "overview_04b_phase_progress_checks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: The ``overview.change_log.actor`` of every repair this revision makes.
ACTOR = "migration:overview_04c_phase_progress_backfill"

#: The rows breaking either rule.
_INCOHERENT = """(
        (p.actual_end IS NOT NULL AND p.actual_start IS NULL)
     OR (p.gate_status = 'pending' AND p.gate_decided_at IS NOT NULL)
     OR (p.gate_status <> 'pending' AND p.gate_decided_at IS NULL)
    )"""


def _utc_instant(column: str) -> str:
    """``column`` (a ``timestamptz``) as the JSON string pydantic writes for
    it — ``2026-03-04T23:30:00Z``, fractional seconds only when non-zero —
    whatever the migrating session's ``TimeZone``."""
    utc = f"({column} AT TIME ZONE 'UTC')"
    return (
        f"CASE WHEN {column} IS NULL THEN NULL ELSE "
        f"to_char({utc}, 'YYYY-MM-DD\"T\"HH24:MI:SS') || "
        f"CASE WHEN date_part('microseconds', {utc})::bigint % 1000000 = 0 "
        f"THEN '' ELSE to_char({utc}, '.US') END || 'Z' END"
    )


def _read_shape(r: str) -> str:
    """``PhaseProgressRead`` of row alias ``r``, as ``model_dump(mode="json")``
    serialises it — the ``before``/``after`` a normal write logs."""
    return f"""jsonb_build_object(
        'id', {r}.id::text,
        'estimate_id', {r}.estimate_id::text,
        'code', {r}.code,
        'name', {r}.name,
        'sort_order', {r}.sort_order,
        'planned_start', {r}.planned_start,
        'planned_end', {r}.planned_end,
        'gate_criteria', {r}.gate_criteria,
        'actual_start', {r}.actual_start,
        'actual_end', {r}.actual_end,
        'gate_status', {r}.gate_status,
        'gate_decided_at', {r}.gate_decided_at,
        'gate_notes', {r}.gate_notes,
        'version', COALESCE({r}.progress_version, 1),
        'updated_at', {_utc_instant(f"{r}.progress_updated_at")},
        'updated_by', {r}.progress_updated_by
    )"""


#: Repair every incoherent row and log each repair, in ONE statement (see the
#: module docstring for why one). ``old`` reads the statement's snapshot, so it
#: is the pre-repair row; ``repaired`` is the UPDATE's ``RETURNING``. The
#: predicate is on the UPDATE too, so a row a concurrent writer made coherent
#: meanwhile is neither repaired nor logged.
REPAIR = f"""
WITH old AS (
    SELECT p.* FROM overview.phases p WHERE {_INCOHERENT}
),
repaired AS (
    UPDATE overview.phases p SET
        actual_start = CASE
            WHEN p.actual_end IS NOT NULL AND p.actual_start IS NULL
            THEN LEAST(COALESCE(p.planned_start, p.actual_end), p.actual_end)
            ELSE p.actual_start
        END,
        gate_decided_at = CASE
            WHEN p.gate_status = 'pending' THEN NULL
            WHEN p.gate_decided_at IS NULL THEN COALESCE(
                (p.progress_updated_at AT TIME ZONE 'UTC')::date,
                (p.updated_at AT TIME ZONE 'UTC')::date,
                (now() AT TIME ZONE 'UTC')::date
            )
            ELSE p.gate_decided_at
        END,
        progress_version = COALESCE(p.progress_version, 1) + 1
    FROM old
    WHERE p.id = old.id AND {_INCOHERENT}
    RETURNING p.*
)
INSERT INTO overview.change_log (
    tenant_id, resource, record_id, action, source, actor, actor_user_id,
    version_before, version_after, before, after
)
SELECT
    r.tenant_id, 'phase_progress', r.id::text, 'update', 'import', '{ACTOR}',
    NULL, COALESCE(old.progress_version, 1), r.progress_version,
    {_read_shape("old")},
    {_read_shape("r")}
FROM repaired r JOIN old ON old.id = r.id
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
