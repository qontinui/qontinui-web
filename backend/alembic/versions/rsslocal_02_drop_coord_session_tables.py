"""rsslocal 02 — drop four vestigial coord session-state tables

Revision ID: rsslocal_02_drop_coord_tables
Revises: cciobs_01
Create Date: 2026-09-08

Phase 2 of plan
``2026-09-08-runner-session-state-is-machine-local-and-partly-vestigial``.

Drops, from the ``coord`` schema:

* ``coord.session_touched_files``
* ``coord.process_sessions``
* ``coord.process_session_output``
* ``coord.session_file_snapshots``

## Why — these are a completed migration's vacated origin, not orphans

This is deliberately NOT a "nobody seems to use it, so remove it" drop. All
four are the **source side of a migration that already finished**.

Plan ``2026-08-18-runner-embedded-pg-parity-and-coord-http-migration``, P3,
moved the runner's use of every one of these tables out of ``coord.*`` and
into ``project.*``. The moved set is named in
``qontinui-runner/src-tauri/src/database/pg/mod.rs`` as
``REHOMED_MACHINE_LOCAL_TABLES``, whose doc comment gives the reason: the
runner ships a **private, per-machine PostgreSQL** and alembic never runs
against it. So every ``coord.``-qualified statement the runner issued against
one of these tables was one of two things — an error against a table that had
never been provisioned in the runner's own database, or a write into a private
table that no other fleet member could ever read. Neither is coordination
state. P3 rehomed them; this revision finishes that migration's cleanup by
removing the vacated ``coord.*`` definitions.

## Evidence that nothing reads them (recorded so this is not re-litigated)

Verified against ``qontinui-coord`` ``origin/main`` before authoring:

* ``process_sessions``, ``process_session_output`` and
  ``session_file_snapshots`` — **zero** occurrences of any kind anywhere under
  ``crates/coord/src``. No SELECT, no INSERT, no route, no model, no comment.
* ``session_touched_files`` — six occurrences, **all of them comments** in
  ``dirty_state.rs``. No executable reference.

Verified in this repository (``qontinui-web``):

* No ``coord.``-qualified reference to any of the four exists under
  ``backend/app/`` or ``frontend/src/``.
* ``backend/app/api/v1/endpoints/runner_logs.py``,
  ``backend/app/db/runner_db.py`` and
  ``backend/app/models/runner_process_log.py`` DO name ``process_sessions`` and
  ``process_session_output`` — but they are a read-only proxy onto the
  **RUNNER's** database (``RUNNER_DATABASE_URL``, connected with
  ``search_path = runner, public``), never onto ``coord``. Their SQL is
  deliberately unqualified so it resolves inside the runner's own schema. This
  revision does not touch that database and those endpoints are unaffected.

## What this reverses

* ``consolidation_phase1_12_coord_sessions_worktrees`` created
  ``coord.session_touched_files`` (composite PK ``task_run_id, file_path``)
  with ``idx_session_touched_files_task_run`` and
  ``idx_session_touched_files_recorded_at``.
* ``consolidation_phase1_14_workflows_flows_cross`` created
  ``coord.process_sessions`` and ``coord.process_session_output``, the latter
  with an ``ON DELETE CASCADE`` FK onto the former.
* ``consolidation_phase1_20_tail_specialty`` **and**
  ``consolidation_phase2_v_30_productivity_knowledge`` each created
  ``coord.session_file_snapshots`` — see the next section.
* ``projdash_01_stf_prefix_idx`` added the expression index
  ``idx_session_touched_files_lower_path_prefix`` on
  ``lower(file_path) text_pattern_ops``. Dropping the table drops the index
  with it, so ``upgrade()`` names only the table; ``downgrade()`` restores the
  index explicitly, because that revision is an ancestor of this one and its
  own ``downgrade()`` is a bare ``DROP INDEX IF EXISTS``.

## ``session_file_snapshots`` has two creators — which shape downgrade restores

The drop must not assume a single creator, and the ``downgrade()`` has to pick
a shape. Both creators were read; the choice is that **there is no fork to
resolve**:

* ``consolidation_phase1_20_tail_specialty`` creates it unconditionally via
  ``op.create_table``.
* ``consolidation_phase2_v_30_productivity_knowledge`` creates it with raw
  ``CREATE TABLE IF NOT EXISTS`` — and its own docstring says of the canonical
  database, "On fresh canonical DB: NO-OP. Phase 1 batch 20 created both tables
  in their canonical schemas with the same FK shape."

Column-for-column the two agree: ``id UUID PK DEFAULT gen_random_uuid()``,
``session_id TEXT NOT NULL``, ``file_path TEXT NOT NULL``,
``snapshot_blob_path TEXT NOT NULL``, ``blob_sha256 TEXT NOT NULL``,
``captured_before BOOLEAN NOT NULL``, ``taken_at TIMESTAMPTZ NOT NULL DEFAULT
now()``; and both create the same two indexes, ``idx_sfs_session`` and
``idx_sfs_session_file``. So ``downgrade()`` restores that single shape, which
is simultaneously what batch 20 built and what v_30's ``IF NOT EXISTS`` would
have found already present. A later downgrade past v_30 then runs its
``DROP TABLE IF EXISTS ... CASCADE`` against exactly the table it expects, and
one past batch 20 runs its ``drop_table`` against the same.

## Idempotence

Every drop is ``if_exists=True`` — the same posture as the surrounding
intentional-drop revisions (``ud03_drop_remap_table``,
``consolidation_phase2_v_30_productivity_knowledge``'s downgrade), which spell
it as raw ``DROP TABLE IF EXISTS``. A database that somehow never received one
of these four does not fail the migration. ``downgrade()`` is symmetric:
``checkfirst``-style ``IF NOT EXISTS`` on the recreated indexes, and the tables
recreated in FK order.

## Data

These tables hold machine-local session residue that no fleet member reads;
the drop discards it. Confirming zero rows in production is an operator step
taken before this revision is applied — it is deliberately not attempted here,
and this revision runs against no live database as part of authoring.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "rsslocal_02_drop_coord_tables"
down_revision: str | Sequence[str] | None = "cciobs_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # process_session_output holds an ON DELETE CASCADE FK onto
    # process_sessions, so the child goes first.
    op.drop_table("process_session_output", if_exists=True, schema="coord")
    op.drop_table("process_sessions", if_exists=True, schema="coord")
    op.drop_table("session_touched_files", if_exists=True, schema="coord")
    op.drop_table("session_file_snapshots", if_exists=True, schema="coord")


def downgrade() -> None:
    # --- coord.session_touched_files -------------------------------------
    # Shape from consolidation_phase1_12_coord_sessions_worktrees.
    op.create_table(
        "session_touched_files",
        sa.Column("task_run_id", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("worktree_id", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("task_run_id", "file_path"),
        schema="coord",
    )
    op.create_index(
        "idx_session_touched_files_task_run",
        "session_touched_files",
        ["task_run_id"],
        schema="coord",
        if_not_exists=True,
    )
    op.create_index(
        "idx_session_touched_files_recorded_at",
        "session_touched_files",
        ["recorded_at"],
        schema="coord",
        if_not_exists=True,
    )
    # Restored from projdash_01_stf_prefix_idx, an ancestor of this revision:
    # an expression index that op.create_index cannot spell (lower() with the
    # text_pattern_ops opclass, which is what makes the prefix scan a range
    # scan rather than a sequential one).
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_session_touched_files_lower_path_prefix "
        "ON coord.session_touched_files (lower(file_path) text_pattern_ops)"
    )

    # --- coord.process_sessions / coord.process_session_output ------------
    # Shape from consolidation_phase1_14_workflows_flows_cross. The parent is
    # recreated first so the child's FK resolves.
    op.create_table(
        "process_sessions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("process_config_id", sa.Text(), nullable=False),
        sa.Column("process_name", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("state", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index(
        "idx_process_sessions_config_id",
        "process_sessions",
        ["process_config_id"],
        schema="coord",
        if_not_exists=True,
    )
    op.create_index(
        "idx_process_sessions_started_at",
        "process_sessions",
        ["started_at"],
        schema="coord",
        if_not_exists=True,
    )

    op.create_table(
        "process_session_output",
        sa.Column("id", sa.BigInteger(), nullable=False, autoincrement=True),
        sa.Column(
            "session_id",
            sa.Text(),
            sa.ForeignKey("coord.process_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("timestamp", sa.Text(), nullable=False),
        sa.Column("stream", sa.Text(), nullable=False),
        sa.Column("line", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index(
        "idx_process_session_output_session",
        "process_session_output",
        ["session_id"],
        schema="coord",
        if_not_exists=True,
    )

    # --- coord.session_file_snapshots -------------------------------------
    # The single shape shared by both creators — see the module docstring.
    op.create_table(
        "session_file_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("snapshot_blob_path", sa.Text(), nullable=False),
        sa.Column("blob_sha256", sa.Text(), nullable=False),
        sa.Column("captured_before", sa.Boolean(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        schema="coord",
    )
    op.create_index("idx_sfs_session", "session_file_snapshots", ["session_id"], schema="coord", if_not_exists=True)
    op.create_index(
        "idx_sfs_session_file",
        "session_file_snapshots",
        ["session_id", "file_path"],
        schema="coord",
        if_not_exists=True,
    )
