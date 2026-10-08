"""coord.fleet_runtime_policy(+_versions).workload_census_enabled — the census off-switch

Revision ID: fcap_02
Revises: fcap_01
Create Date: 2026-10-08

Phase 1 of plan
``2026-10-01-fleet-capacity-page-finds-the-bottleneck-and-the-idle-hardware``
(Decision 6: ships enabled, one off-switch per scope).

The workload class census (``fcap_01``'s ``workloads`` column) and the GPU axes
publish by default ``[policy: capability-ships-enabled]``. The tenant-scope
off-switch is this one column on the ``fleet_resources`` domain of
``coord.fleet_runtime_policy``; the per-machine one is the runner kill switch
``QONTINUI_WORKLOAD_CENSUS=0``. The never-argv rule (``fcap_01``) is the
safeguard and is a separate mechanism — switching the census off is a choice,
not the privacy control.

Both tables, together
=====================

Fleet-resource controls are typed columns on the parent AND on
``coord.fleet_runtime_policy_versions``, widened in the same revision — the
rule the versions table's own ``COMMENT ON TABLE`` states and that
``fleet_res_tel_03`` and ``sess_guard_01`` follow: a snapshot table that can
hold less than its parent is an audit trail that lies while still reporting as
versioned. coord composes the parent SELECT, the parent UPSERT and the snapshot
INSERT from one ``CONTROL_COLS`` constant (``fleet_policy.rs``), bound
**positionally**, so the coord PR tail-appends ``workload_census_enabled`` to
it; the column order here does not matter to that binding, only the name does.

Tri-state, and NULL means ON
============================

``BOOLEAN NULL`` with no DEFAULT:

* ``NULL`` = no override — the census runs (the shipped default). Every
  pre-existing policy row and every snapshot written before this revision reads
  NULL, which is the honest record that no off-switch could have been in force.
* ``true`` = explicitly on (same behaviour as NULL, recorded as a decision).
* ``false`` = the tenant switched the census off; runners publish
  ``workloads = NULL`` and ``gpu = NULL`` (UNKNOWN), never ``[]``.

A ``DEFAULT true`` would erase the distinction between "never decided" and
"decided on", and a ``NOT NULL`` would force a backfill of every snapshot row
— rewriting immutable history. Neither is wanted.

Degrade obligation on the coord side
====================================

The coord PR that tail-appends ``workload_census_enabled`` to ``CONTROL_COLS``
(qontinui-coord ``crates/coord/src/fleet_policy.rs``) must:

(a) add the name to the **refuse-on-miss** set next to ``SESSION_FLOOR_COLS``
    (``is_session_floor_miss`` / ``session_floor_miss_matches``, around
    ``fleet_policy.rs:420-427`` at authoring time) — or to a generalised
    tail-column set that replaces it — so a 42703 naming this column returns
    **503**. Left to the generic degrade path, a coord deploy that lands ahead
    of this revision would silently degrade every policy read to
    ``controls: null`` and the write path to an identity-only snapshot (around
    ``fleet_policy.rs:850-856`` and ``:1776-1784``) — a versions row that
    records a write while dropping every control it carried, i.e. an audit
    trail that lies.
(b) merge only after this revision has been applied
    ``[policy: alembic-sole-authorship]``.

Idempotency and locking
=======================

Raw static ``op.execute`` with ``ADD COLUMN IF NOT EXISTS``; every statement is
a static literal because coord's merge-train migration classifier rejects a
dynamic ``op.execute`` argument (``sess_guard_01`` predates that and generates
its snapshot comments with f-strings; this revision does not). A nullable
column with no default is a catalogue-only change. ``lock_timeout`` bounds the
wait for the ``ACCESS EXCLUSIVE`` lock, which is held until the alembic
transaction commits. PostgreSQL DDL is transactional and ``env.py`` runs the
whole upgrade in one transaction, so both tables gain the column or neither
does.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fcap_02"
down_revision: str | Sequence[str] | None = "fcap_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The one column, as data — the interface the migration test pins against the
# static SQL below, on BOTH tables. Same shape as `fleet_res_tel_03`'s
# `_CONTROL_COLUMNS` and `sess_guard_01`'s `_SESSION_FLOOR_COLUMNS`.
_CENSUS_CONTROL_COLUMNS: tuple[tuple[str, str], ...] = (
    ("workload_census_enabled", "BOOLEAN"),
)

_TABLES: tuple[str, ...] = (
    "coord.fleet_runtime_policy",
    "coord.fleet_runtime_policy_versions",
)


def upgrade() -> None:
    """Add workload_census_enabled to the parent AND the versions table."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            ADD COLUMN IF NOT EXISTS workload_census_enabled BOOLEAN
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            ADD COLUMN IF NOT EXISTS workload_census_enabled BOOLEAN
        """
    )
    # SET LOCAL is transaction-scoped and env.py wraps the WHOLE run in one
    # transaction, so put it back or it leaks into every later revision.
    op.execute("SET LOCAL lock_timeout = DEFAULT")

    op.execute(
        """
        COMMENT ON COLUMN coord.fleet_runtime_policy.workload_census_enabled IS
            'Tenant off-switch for the workload class census and GPU axes on '
            'coord.device_resource_samples (workloads, gpu; revision fcap_01), '
            'on the fleet_resources domain. NULL = no override, the census '
            'RUNS (it ships enabled); true = explicitly on; false = switched '
            'off, and runners then publish workloads = NULL and gpu = NULL '
            '(UNKNOWN), never []. The per-machine switch is QONTINUI_WORKLOAD_CENSUS=0 on the '
            'runner. Not the privacy control: argv, cwd and env never leave '
            'the host whatever this says.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN
            coord.fleet_runtime_policy_versions.workload_census_enabled IS
            'Snapshot of coord.fleet_runtime_policy.workload_census_enabled — '
            'see that column for its meaning and for why NULL is ON, not off. '
            'Snapshot rows written BEFORE revision fcap_02 carry NULL here: the '
            'column did not exist, so no off-switch could have been in force, '
            'and NULL is the honest record of that history rather than a gap '
            'to be backfilled. Immutable: never UPDATE or DELETE a row here.'
        """
    )


def downgrade() -> None:
    """Drop the column from both tables. Exact reverse of upgrade().

    Both tables again: leaving the snapshot column behind after removing the
    parent's would produce a versions table that can hold payload the parent
    cannot. Static literals inside `downgrade()`, out of
    `scripts/ci/check_coord_column_drops.py`'s upgrade-path scan.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            DROP COLUMN IF EXISTS workload_census_enabled
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            DROP COLUMN IF EXISTS workload_census_enabled
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
