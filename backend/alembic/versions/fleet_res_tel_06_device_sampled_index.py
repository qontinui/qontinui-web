"""coord.device_resource_samples: (device_id, sampled_at DESC) index

Revision ID: fleet_res_tel_06
Revises: coord_policy_outcome_counts_02
Create Date: 2026-11-21

Phase 0 of plan
``2026-11-21-coord-sample-readers-outside-fleet-placement-key-on-the-tenant-stamp``
(``qontinui-dev-notes/plans``). Additive, index-only. **coord authors zero
``coord.*`` DDL** — alembic is the sole author (served policy
``production-and-cost`` ``alembic-sole-authorship``) — so the index lands here,
hand-authored, before the coord readers that need it.

Why the index now exists
==========================================================================

``fleet_res_tel_01`` deliberately declined a ``(device_id, sampled_at DESC)``
index: its one question then, "newest sample of any lane for this device", was
answered by the per-anchor rows the dispatcher already joined. That reasoning
no longer holds. A device bound to more than one tenant stamps its samples
with ONE tenant, so the coord readers outside ``fleet_placement`` (the
``computers.rs`` readers and ``computer_alerts_watcher``) are moving off the
tenant stamp and onto ``device_id`` through the ``coord.tenant_devices``
bridge. Those reads ask for the newest row(s) per device across every lane.

The existing indexes cannot serve that:

- ``(device_id, lane, COALESCE(lane_instance, ''), sampled_at DESC)`` — the
  anchor index — orders by ``sampled_at`` only within one ``(lane,
  lane_instance)`` group, so a newest-per-device read across lanes sorts;
- ``(sampled_at)`` — the retention prune — has no ``device_id`` at all;
- the partial ``(computer_id, sampled_at DESC)`` index keys the computer, and
  the bridge resolves ``device_id`` rather than ``computer_id``.

With ``device_id`` leading and ``sampled_at DESC`` trailing, ``WHERE device_id
= $1 ORDER BY sampled_at DESC LIMIT n`` (and ``device_id = ANY($1)`` with a
per-device lateral) is a single index descent. Write cost: one more btree
entry per INSERT on an append-only table pruned by retention.

``CONCURRENTLY``, and the INVALID-index trap
==========================================================================

``coord.device_resource_samples`` is written every 30 s per lane by every
runner, so a plain ``CREATE INDEX`` would take a write-blocking ``SHARE`` lock
for the build. CONCURRENTLY cannot run inside a transaction and ``env.py``
wraps the migration batch in one, hence ``op.get_context().autocommit_block()``
— the ``coord_alerts_firstseen_01`` / ``coord_iops_idx_01`` shape.

No in-migration guards, deliberately (the ``coord_alerts_firstseen_01``
reasoning): coord's fail-closed migration classifier rejects a read through
``op.get_bind().execute`` and any ``DROP`` on the upgrade path, so this is the
provable form. The hazard is checked AFTER the deploy instead::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'ix_device_resource_samples_device_sampled';

It must read ``indisvalid = true``. A killed build leaves an INVALID index that
``IF NOT EXISTS`` skips on any later run; the recovery is a follow-up revision
that runs ``DROP INDEX CONCURRENTLY IF EXISTS
coord.ix_device_resource_samples_device_sampled`` and then this CREATE again.
Never a plain ``DROP INDEX``.

Every reader is correct WITHOUT this index, only slower, so there is no
column-before-migration hazard with coord. ``downgrade`` drops it
CONCURRENTLY.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fleet_res_tel_06"
# One line, unannotated — see plan_library_06_scan_root_slug_census.
down_revision = "coord_policy_outcome_counts_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Additive: one CONCURRENTLY composite index. Idempotent."""
    with op.get_context().autocommit_block():
        # Plain literal, never an f-string: the `alembic-schema-arg-gate`
        # pre-commit hook parses the raw SQL to prove it names its schema.
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_device_resource_samples_device_sampled
            ON coord.device_resource_samples (device_id, sampled_at DESC)
            """
        )


def downgrade() -> None:
    """Reverse the additive index. The table and every other index survive."""
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS "
            "coord.ix_device_resource_samples_device_sampled"
        )
