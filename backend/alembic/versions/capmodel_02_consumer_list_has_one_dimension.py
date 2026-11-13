"""capacity_model_off_consumers holds at most one dimension

Revision ID: capmodel_02
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-13

Coord finding ``c096b745`` (plan
``2026-11-05-one-free-resource-model-places-sessions-builds-and-ci``, deferred
from qontinui-coord#3844). ``capmodel_01`` typed
``capacity_model_off_consumers`` as ``TEXT[]`` on both
``coord.fleet_runtime_policy`` and ``coord.fleet_runtime_policy_versions``, and
Postgres stores a multi-dimensional value in a ``TEXT[]`` column without
complaint (``'{{merge_train},{local_builds}}'``). No write through coord
produces one (its route binds a list of names), but a hand edit can, and the
list decode coord used refuses an array of more than one dimension. That
refusal failed the decode of the WHOLE controls row: the fleet-policy GET served
no controls, and every write to the row (a controls PUT, a drain, an undrain)
answered 500, because each reads the row first, so only SQL could repair it.

This revision rules the value out where it is applied, with
``CHECK (array_ndims(capacity_model_off_consumers) <= 1)`` on both tables. A
NULL column passes, and so does the empty array, whose ``array_ndims`` is NULL;
so does every list coord writes. The paired coord change reads such a value as
its elements instead of failing, which covers a catalog without this revision
and a row written before it. Neither depends on the other, so they deploy in
either order.

Why NOT VALID, on both tables
=============================

* coord's merge-train migration classifier admits ``ADD CONSTRAINT`` only with
  ``NOT VALID``: a validated CHECK scans every existing row under the ALTER's
  lock.
* The versions table's rows are immutable snapshots (its column COMMENTs: never
  UPDATE or DELETE a row there), and ``capmodel_01`` records the rule for a
  narrowing CHECK on that table: add it ``NOT VALID``, or an old snapshot row
  fails it.
* On the parent, ``NOT VALID`` skips the scan of the rows that predate it, and
  nothing here rewrites one (the classifier rejects DML in a migration). A
  ``NOT VALID`` CHECK is still enforced on every row inserted or updated from
  now on. So a hand UPDATE that writes a nested list is refused, and so is one
  that leaves a pre-existing nested list in place. A coord write is not: it
  assigns every control column from the controls it merged over its own read of
  the row, and with the paired coord change that read turns a nested list into
  one dimension. The by-hand repair for a parent row that predates this
  revision is the one the finding names:
  ``UPDATE coord.fleet_runtime_policy SET capacity_model_off_consumers = NULL
  WHERE array_ndims(capacity_model_off_consumers) > 1``. Once the coord change
  is deployed, any controls write does the same without losing the names.

Locking: ``ADD CONSTRAINT ... NOT VALID`` is a catalog update, but it still
takes ACCESS EXCLUSIVE on the table for that moment, and coord reads the parent
on every spawn admission and policy GET. So each ALTER's wait is bounded with
``SET LOCAL lock_timeout = '3s'``, restored with ``= DEFAULT`` afterwards (the
``coord_alerts_onset_01`` posture: ``env.py`` runs every revision of one upgrade
in a single transaction, so an unrestored bound would leak into the revisions
after this one; coord's classifier admits ``= DEFAULT`` and rejects ``RESET``).

Re-runs: PostgreSQL cannot guard ``ADD CONSTRAINT`` with ``IF NOT EXISTS``, but
the constraints commit in the same transaction as the version stamp, so a run
that died partway leaves neither and re-runs cleanly.

Downgrade drops both constraints, the exact reverse. Every ``op.execute`` is a
static string literal, which is what coord's migration classifier can inspect.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "capmodel_02"
# down_revision is the single alembic head on origin/main at authoring time. If
# `alembic-heads-pr` reports HEAD_COUNT=2 after another revision lands, re-point
# this line and `_PARENT_REVISION_ID` in
# tests/test_capmodel_02_consumer_list_has_one_dimension_migration.py together.
down_revision = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, constraint name) — the interface the migration test pins. Postgres
# truncates an identifier past 63 bytes, so the names are short enough to keep
# whole (the longer is 51).
_CONSTRAINTS: tuple[tuple[str, str], ...] = (
    ("coord.fleet_runtime_policy", "fleet_runtime_policy_consumers_ndims_check"),
    (
        "coord.fleet_runtime_policy_versions",
        "fleet_runtime_policy_versions_consumers_ndims_check",
    ),
)

# The predicate both CHECKs carry, spelled once for the test to compare against
# the static literals below.
_PREDICATE = "array_ndims(capacity_model_off_consumers) <= 1"


def upgrade() -> None:
    """Add the one-dimension CHECK to the parent and the versions table, NOT VALID."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            ADD CONSTRAINT fleet_runtime_policy_consumers_ndims_check
            CHECK (array_ndims(capacity_model_off_consumers) <= 1) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            ADD CONSTRAINT fleet_runtime_policy_versions_consumers_ndims_check
            CHECK (array_ndims(capacity_model_off_consumers) <= 1) NOT VALID
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop both CHECKs. Exact reverse of upgrade(); no data is touched."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy_versions
            DROP CONSTRAINT IF EXISTS fleet_runtime_policy_versions_consumers_ndims_check
        """
    )
    op.execute(
        """
        ALTER TABLE coord.fleet_runtime_policy
            DROP CONSTRAINT IF EXISTS fleet_runtime_policy_consumers_ndims_check
        """
    )
    op.execute("SET LOCAL lock_timeout = DEFAULT")
