"""coord.work_unit_deps — first-class work-unit dependency-edge table

Revision ID: coord_workunit_deps_01
Revises: gateverdict_01_misconfigured
Create Date: 2026-06-24

Phase 3 of plan
``D:/qontinui-root/plans/2026-06-24-coord-workunit-dag-execution-dispatch.md``
(coord work-unit DAG execution / dispatch).

Adds ``coord.work_unit_deps``, a first-class edge table expressing the
dependency DAG over the generic ``coord.work_units`` primitive (created by
``coord_workunits_01_work_units``). A row ``(from_unit, to_unit)`` means
**``from_unit`` DEPENDS ON ``to_unit``** — i.e. ``from_unit`` is the
downstream/dependent unit and ``to_unit`` is the upstream prerequisite.
``from_unit`` cannot dispatch until ``to_unit`` has completed.

## Indexes / access paths

* PRIMARY KEY ``(from_unit, to_unit)`` — enforces edge uniqueness AND, via
  its leftmost-prefix, serves the forward query "what are ``from_unit``'s
  upstream prerequisites?".
* ``idx_work_unit_deps_to_from (to_unit, from_unit)`` — the reverse-traversal
  index named in plan §3: "which units depend ON ``to_unit``?". This is the
  dispatch recompute query — when an upstream unit completes, coord looks up
  its dependents to re-evaluate their readiness.
* ``idx_work_unit_deps_tenant (tenant_id)`` — tenant-scoped reads.

Both endpoints carry a FK to ``coord.work_units(id)`` with ``ON DELETE
CASCADE`` so deleting a unit cleans up its incident edges automatically.
``tenant_id`` is nullable — mirroring ``coord.work_units.tenant_id``
(resolved from the JWT at DML time) — denormalized here for tenant-scoped
edge reads.

alembic is the sole author of this schema. Rust (coord) only DMLs against
this table; this web migration MUST be applied to prod RDS BEFORE the coord
image that reads/writes it deploys (same deploy-order rule as the rest of
the ``coord`` schema).

## House conventions followed

Raw ``op.execute`` (not ``op.create_table``) with ``CREATE TABLE IF NOT
EXISTS`` + ``CREATE INDEX IF NOT EXISTS`` so the migration is collision-safe
against any canonical PG that already carries the objects from a self-heal
mirror — same convention as ``coord_workunits_01_work_units`` and
``coord_singleauthored_01_gates``.
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
# NOTE: this slot is RESERVED via the coord migration head-claim
# (reservation_id 43594e8d-6ee1-40b8-87d7-f4c7025231f5, down_revision
# gateverdict_01_misconfigured) — do not re-derive from a later
# ``alembic heads``. ``gateverdict_01_misconfigured`` is an in-flight
# migration (PR-641) ahead of this one in the merge queue; the coordinator
# binds the PR + enforces land order.
revision: str = "coord_workunit_deps_01"
down_revision: str | Sequence[str] | None = "gateverdict_01_misconfigured"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.work_unit_deps`` + its two indexes. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # work_unit_deps — dependency-edge table over coord.work_units.
    # Row (from_unit, to_unit) ==> from_unit DEPENDS ON to_unit.
    # Both endpoints FK coord.work_units(id) ON DELETE CASCADE.
    # PK (from_unit, to_unit): uniqueness + forward "upstream of from_unit".
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.work_unit_deps (
            from_unit   UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            to_unit     UUID NOT NULL
                REFERENCES coord.work_units(id) ON DELETE CASCADE,
            tenant_id   UUID,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (from_unit, to_unit)
        )
        """
    )
    # Reverse-traversal index (plan §3): "which units depend ON to_unit?" —
    # the dispatch recompute query when an upstream completes.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_unit_deps_to_from
            ON coord.work_unit_deps (to_unit, from_unit)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_work_unit_deps_tenant
            ON coord.work_unit_deps (tenant_id)
        """
    )


def downgrade() -> None:
    """Reverse: drop the table (indexes drop implicitly with it)."""
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_deps_tenant")
    op.execute("DROP INDEX IF EXISTS coord.idx_work_unit_deps_to_from")
    op.execute("DROP TABLE IF EXISTS coord.work_unit_deps")
