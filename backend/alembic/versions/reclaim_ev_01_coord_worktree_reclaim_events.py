"""coord.worktree_reclaim_events — durable reclaim-efficacy event log

Revision ID: reclaim_ev_01_wt_reclaim_events
Revises: coord_session_handles
Create Date: 2026-07-23

Substrate slice (§2b) of the worktree-reclaim census-freshness plan
(``2026-07-23-worktree-reclaim-census-freshness-lock``).

Creates one ``coord.*`` table (append-only as first shipped; see the
``'arm'`` note below) consumed by qontinui-coord (Rust), which cannot author
DDL — Alembic in qontinui-web is the sole author of the ``coord.*`` schema
(enforced coord-side by ``tests/coord_schema_authorship.rs``):

* ``coord.worktree_reclaim_events`` — reclaim-attribution rows keyed by
  ``action`` (free ``TEXT``, no DDL needed to add a value). ``'remove'`` is one
  row per observed worktree removal: which device, which repo/path
  disappeared. Coord renders the monotonic
  ``coord_worktree_reclaim_removals_total{device}`` counter from the
  ``action = 'remove'`` rows only, so the metric survives deploys. Since
  qontinui-coord#2605 (``570bef576``) the table ALSO carries ``action = 'arm'``
  rows: the persisted attribution arming set (a path coord instructed removed
  and is waiting to see disappear), rehydrated on a coord process's first
  tick for each device and deleted when its ``'remove'`` row is written —
  so it is no longer append-only, and ``count(*)`` is not a removal count.
  The consuming coord PR fails open until this migration has run.

Design notes (mirrors ``twin_07_coord_worktree_census`` conventions):

* No unique constraints — intentionally a history oplog (for ``'remove'``);
  the same ``(device_id, repo, path)`` tuple may recur across reclaim cycles.
* **No foreign keys** — deliberate. Sibling coord tables
  (``worktree_census``, gates, work_units) carry no FKs; an FK here would
  couple prune order across tables and revives a known incident class
  (derived stamps FK-throwing on INSERT).
* ``coord`` already exists (created by ``consolidation_phase1_01_infrastructure``);
  this migration does NOT ``CREATE SCHEMA``.
* The ``now()`` default is a plain column default (evaluated per-row at
  INSERT) — fine; only a problem inside a partial-index predicate (none here).
* Hot lookup is ``(device_id, observed_missing_at DESC)`` — the latest
  reclaim events for a given machine's runner.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "reclaim_ev_01_wt_reclaim_events"
down_revision: str = "coord_session_handles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- coord.worktree_reclaim_events : 'remove' + 'arm' rows (see docstring) -
    op.create_table(
        "worktree_reclaim_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        # Which machine's runner observed the removal.
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("repo", sa.Text(), nullable=False),
        # Absolute worktree path (as previously censused) that disappeared.
        sa.Column("path", sa.Text(), nullable=False),
        # The reclaim instruction class whose disappearance was observed,
        # e.g. 'remove'.
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column(
            "observed_missing_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="coord",
    )
    # Hot lookup: the latest reclaim events for a given machine's runner.
    op.create_index(
        "idx_worktree_reclaim_events_device_observed_missing_at",
        "worktree_reclaim_events",
        ["device_id", sa.text("observed_missing_at DESC")],
        schema="coord",
    )


def downgrade() -> None:
    # Reverse order of upgrade().
    op.drop_index(
        "idx_worktree_reclaim_events_device_observed_missing_at",
        table_name="worktree_reclaim_events",
        schema="coord",
    )
    op.drop_table("worktree_reclaim_events", schema="coord")
