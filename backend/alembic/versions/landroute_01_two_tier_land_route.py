"""coord.merge_proposals — two-tier durable route marker (land_route)

Revision ID: landroute_01_two_tier_land_route
Revises: dev_action_01_snapshot_tables
Create Date: 2026-06-08

Phase 1 of plan
``D:/qontinui-root/plans/2026-06-06-coord-two-tier-durable-route-marker.md``
(durable route marker — off-lock CI wait for CI-required Independent proposals).

The shipped two-tier merge-classification (plan ``2026-05-31``) computes the
dequeue-time route decision (``RouteDecision::decide``) once, in memory, for a
single tick. The awaiting-ci landing path runs on a LATER tick — possibly under
a different leader — and has no way to learn that the proposal was routed
FastLand, so v1 fails closed: it acquires ``MainMerge`` before ``awaiting-ci``
and holds it through the entire CI wait. This column persists that route
decision so the awaiting-ci landing path can re-derive "lease held or not"
leader-independently.

* ``land_route TEXT`` (nullable) — ``'fast'`` | NULL. NULL means legacy /
  normal (today's ``transition_and_land`` held-lease path — the safe fallback).
  Stamped ``'fast'`` at *dequeue* ONLY when ``RouteDecision::FastLand`` AND the
  row took the no-claims path (``!settle_disabled``), i.e. exactly when no
  ``MainMerge`` lease was held at dequeue. A Normal route leaves it NULL (we do
  NOT stamp ``'normal'`` — NULL already means normal, and not-writing keeps the
  common-case dequeue write count unchanged). The marker records the historical
  fact "leases were NOT held when this proposal was dispatched," which the
  ``check_and_land`` green path reads to decide whether to release a lease.

Routing (``land_route``) is kept INDEPENDENT of classification
(``merge_class``): a row may be stamped ``merge_class='independent'`` while its
route failed closed to normal (the in-flight fail-closed tighten, or the flag
forced Normal), so the Phase-3 observability counters stay pure.

Expand-only / forward-only, nullable, no backfill, no index — a per-proposal
derived fact; legacy rows carry NULL (the safe fallback) and there is nothing
meaningful to backfill (closed/merged proposals never re-enter the queue). Read
in the dequeue stamp + awaiting-ci land scan alongside the other
``merge_proposals`` columns, never point-looked-up by this column, so no index
is added (matches ``coord_singleauthored_11_merge_class_columns``).

Idempotency: ``ADD COLUMN IF NOT EXISTS`` so a re-apply (or a canonical-PG that
already carries the column from a manual reconcile) is a strict no-op —
matching the ``coord.merge_proposals`` house style and the coord
boot-against-this-same-schema posture.

alembic is the SOLE author of ``coord.*`` schema
(``proj_alembic_sole_author_coord_schema``); the coord Rust binary asserts
table presence at boot and never authors DDL in production. This column is
authored here, not in Rust (guarded by
``qontinui-coord/tests/coord_schema_authorship.rs``; the Rust ``stamp_land_route``
UPDATE is DML, not DDL, so the guard's CREATE/ALTER scan does not trip).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "landroute_01_two_tier_land_route"
down_revision: str = "dev_action_01_snapshot_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the durable route-marker column. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        "ALTER TABLE coord.merge_proposals "
        "ADD COLUMN IF NOT EXISTS land_route TEXT"
    )


def downgrade() -> None:
    """Drop the durable route-marker column."""
    op.execute("ALTER TABLE coord.merge_proposals DROP COLUMN IF EXISTS land_route")
