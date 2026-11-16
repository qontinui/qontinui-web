"""coord.fleet_focus + coord.fleet_focus_targets — the operator's fleet focus

Phase 1 (the qontinui-web half, which lands FIRST) of plan
``2026-11-16-fleet-focus-prioritize-a-tenant-or-subproject-and-postpone-everything-else``.
Creates two new, empty tables, their indexes and two table comments in ONE
transaction::

    coord.fleet_focus (id, tenant_id, revision, set_by, set_at)
        uq_fleet_focus_tenant   UNIQUE (tenant_id)

    coord.fleet_focus_targets (id, focus_id, target_kind, target_id, tenant_id,
                               added_at)
        uq_fleet_focus_targets_focus_target UNIQUE (focus_id, target_kind, target_id)
        idx_fleet_focus_targets_tenant      (tenant_id)

Column authority
================

* ``coord.fleet_focus`` holds AT MOST ONE row per coord tenant (plan vet
  correction C9): the fleet-wide focus of that tenant, like ``fleet_drain``'s
  ownership floor. Cross-tenant reach is by setting the focus in each tenant.
  ``revision bigint`` is bumped on every replacement so a hold reason can name
  which focus held it and a re-drive can tell a stale hold from a current one.
  ``set_by`` names the setter (operator subject or agent session) and ``set_at``
  the last replacement. There is NO end-time column and NO history: a focus
  lasts until the operator clears or replaces it, and clearing deletes the row
  (plan D1, operator decision 2026-11-16).
* ``coord.fleet_focus_targets`` lists what the focus prioritises.
  ``target_kind`` is ``tenant`` or ``subproject``; ``target_id`` is that
  tenant's id or the subproject's id; ``tenant_id`` is the tenant that OWNS the
  target (equal to ``target_id`` for a ``tenant`` target). ``focus_id``
  references ``coord.fleet_focus (id)`` with ON DELETE CASCADE, so clearing the
  focus (deleting its row) removes its targets in the same statement.
  Neither id carries a foreign key to a subproject or tenant: a subproject that
  is archived or merged leaves a target that coord resolves, never one the
  database refuses.
* No hold-code columns: holds are recorded as reason strings on the rows that
  are held (plan vet correction C4).

Lock posture
============

Nothing here touches an existing table; every index is built on a table this
transaction created, so no lock on a live table is requested and no
``lock_timeout`` is needed. The downgrade drops only these two tables.

Idempotency / authorship posture
================================

``CREATE TABLE IF NOT EXISTS`` / ``CREATE [UNIQUE] INDEX IF NOT EXISTS`` /
``COMMENT ON``, all in one transaction, and a symmetric ``downgrade()``.
**alembic is the SOLE author of the ``coord.*`` schema** (served policy
``production-and-cost`` ``alembic-sole-authorship``): coord only INSERTs,
UPDATEs, DELETEs and SELECTs these tables, and this revision must be APPLIED in
production before the coord PR that reads them deploys. No backfill: no rows
are written. Every SQL string is a static literal with no ``:word`` sequence
and no ``%``.

Chaining
========

``down_revision = "design_refs_01"`` -- ``main``'s single alembic head,
measured 2026-11-16 with ``scripts/ci/count_alembic_heads.py``
(``HEAD_COUNT=1``) at ``origin/main`` ``6d075de1d``. A re-point is three
coupled edits: ``down_revision``, the ``Revises:`` line below, and
``_PARENT_REVISION_ID`` in ``tests/test_coord_fleet_focus_01_migration.py``.

Revision ID: coord_fleet_focus_01
Revises: design_refs_01
Create Date: 2026-11-16

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_fleet_focus_01"
down_revision: str | None = "design_refs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create both tables, their comments and their indexes in ONE transaction."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.fleet_focus (
            id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   uuid         NOT NULL,
            revision    bigint       NOT NULL DEFAULT 1,
            set_by      text         NOT NULL,
            set_at      timestamptz  NOT NULL DEFAULT now(),
            CONSTRAINT uq_fleet_focus_tenant UNIQUE (tenant_id),
            CONSTRAINT ck_fleet_focus_revision CHECK (revision >= 1)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.fleet_focus_targets (
            id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
            focus_id     uuid         NOT NULL,
            target_kind  text         NOT NULL,
            target_id    uuid         NOT NULL,
            tenant_id    uuid         NOT NULL,
            added_at     timestamptz  NOT NULL DEFAULT now(),
            CONSTRAINT fk_fleet_focus_targets_focus
                FOREIGN KEY (focus_id) REFERENCES coord.fleet_focus (id)
                ON DELETE CASCADE,
            CONSTRAINT ck_fleet_focus_targets_kind CHECK (target_kind IN
                ('tenant', 'subproject')),
            CONSTRAINT uq_fleet_focus_targets_focus_target
                UNIQUE (focus_id, target_kind, target_id)
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.fleet_focus IS
            'The operator fleet focus, at most one row per coord tenant (plan '
            '2026-11-16-fleet-focus-prioritize-a-tenant-or-subproject-and-postpone-everything-else). '
            'revision is bumped on every replacement. There is no end time and no '
            'history: clearing the focus deletes the row. Written by coord only, '
            'alembic authors the DDL.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.fleet_focus_targets IS
            'The targets of a coord.fleet_focus row: target_kind tenant or subproject, '
            'target_id the tenant or subproject id, tenant_id the tenant that owns the '
            'target. Deleted with its focus row (ON DELETE CASCADE).'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_fleet_focus_targets_tenant
            ON coord.fleet_focus_targets (tenant_id)
        """
    )


def downgrade() -> None:
    """Drop the index, then ``coord.fleet_focus_targets``, then ``coord.fleet_focus``."""
    op.execute("DROP INDEX IF EXISTS coord.idx_fleet_focus_targets_tenant")
    op.execute("DROP TABLE IF EXISTS coord.fleet_focus_targets")
    op.execute("DROP TABLE IF EXISTS coord.fleet_focus")
