"""requeue-count 01 — coord.merge_proposals.requeue_count durable churn counter

Revision ID: requeuecount_01_merge_proposals
Revises: commitlockfix_01_strip_lock_branches
Create Date: 2026-06-07

Adds ``requeue_count INTEGER NOT NULL DEFAULT 0`` to ``coord.merge_proposals``.

## Why DB-durable, not a Prometheus counter

The leader-takeover recovery sweep bumps this per requeue so requeue churn
(starvation) is visible on the dashboard. The existing process metric
``coord_proposals_resumed_after_failover_total``
(``qontinui-coord/src/merge_scheduler.rs:330-334``) is "since this process
booted", and ``/metrics`` is process-local and resets on every deploy — i.e.
it is reset by the exact takeovers it is meant to measure. A per-proposal DB
column survives those deploys, so the dashboard can show true cumulative churn.

The sweep's requeue UPDATE (``merge_scheduler.rs:4853``) increments this; the
adopt-in-place branch leaves it untouched (an adopt is not a requeue).

## coord.* schema is Alembic-owned

Per the ``wave_6_01_coord_merge_batches`` precedent, ``coord.*`` schema lives
in this repo's alembic versions. coord's ``main.rs`` canonical-schema boot gate
asserts column presence, so this migration must deploy before (or with) the
coord binary that reads ``requeue_count``.

## Safety

A single-statement ``ADD COLUMN ... NOT NULL DEFAULT 0`` on PG >= 11 is a
metadata-only operation (no table rewrite); the table is small regardless.

## Chains off ``commitlockfix_01_strip_lock_branches``

The current single head at authoring time:

    commitlockfix_01_strip_lock_branches   ← previous head
      └─ requeuecount_01_merge_proposals    ← this revision
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "requeuecount_01_merge_proposals"
down_revision: str = "commitlockfix_01_strip_lock_branches"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merge_proposals",
        sa.Column(
            "requeue_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="coord",
    )


def downgrade() -> None:
    op.drop_column("merge_proposals", "requeue_count", schema="coord")
