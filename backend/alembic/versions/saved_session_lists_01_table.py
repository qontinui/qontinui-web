"""project.saved_session_lists — per-tab lists of a runner's open sessions, kept 14 days

Phase 2 (web backend) of plan
``2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days``.
Creates one new, empty, web-owned table and two indexes::

    project.saved_session_lists (id, device_id, runner_instance, runner_port,
                                 runner_build_id, title, created_by_user_id,
                                 captured_at, expires_at, tab_count,
                                 session_count, layout)
        ix_saved_session_lists_device_id_expires_at  (device_id, expires_at)
        ix_saved_session_lists_expires_at            (expires_at)

A row is a snapshot of one runner's terminal tabs and the sessions in them,
captured by ``POST /api/v1/saved-session-lists``: the web backend relays one
``GET /terminal-layout`` to the runner that owns the device's relay socket,
validates the body with the generated ``TerminalLayout`` model and keeps it
in ``layout`` (plus coord's per-session work status under ``coordStatus``).

* ``device_id`` has no foreign key: ``coord.devices`` is coord's table, read
  over coord's HTTP boundary. Access is checked there on every read.
* ``runner_instance`` / ``runner_port`` / ``runner_build_id`` are what the
  runner reported about itself, never caller input.
* ``created_by_user_id`` references ``auth.users`` with ``ON DELETE CASCADE``:
  a deleted account takes its saved lists with it.
* ``expires_at`` is ``captured_at + 14 days`` on the backend's clock. Every
  read filters ``expires_at > now()``; the hourly
  ``saved_session_lists_cleanup`` scheduler job deletes expired rows, which is
  what ``ix_saved_session_lists_expires_at`` serves. The list route's filter
  (a caller's devices, unexpired) is what the composite index serves.

Hand-authored (never ``--autogenerate``). Downgrade drops the table and its
indexes, which loses only snapshots that expire within 14 days anyway.

Revision ID: saved_session_lists_01
Revises: coord_ci_runs_head_sha_idx_01
Create Date: 2026-11-08

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "saved_session_lists_01"
down_revision: str | None = "coord_ci_runs_head_sha_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``project.saved_session_lists`` and its two indexes."""
    op.create_table(
        "saved_session_lists",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("device_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("runner_instance", sa.Text(), nullable=True),
        sa.Column("runner_port", sa.Integer(), nullable=True),
        sa.Column("runner_build_id", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tab_count", sa.Integer(), nullable=False),
        sa.Column("session_count", sa.Integer(), nullable=False),
        sa.Column("layout", postgresql.JSONB(), nullable=False),
        # Constraint names are Postgres's defaults, as the model's create_all
        # produces them, so a test database and a migrated one agree.
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["auth.users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="project",
    )
    op.create_index(
        "ix_saved_session_lists_device_id_expires_at",
        "saved_session_lists",
        ["device_id", "expires_at"],
        schema="project",
    )
    op.create_index(
        "ix_saved_session_lists_expires_at",
        "saved_session_lists",
        ["expires_at"],
        schema="project",
    )


def downgrade() -> None:
    """Drop ``project.saved_session_lists`` and its indexes."""
    op.drop_index(
        "ix_saved_session_lists_expires_at",
        table_name="saved_session_lists",
        schema="project",
    )
    op.drop_index(
        "ix_saved_session_lists_device_id_expires_at",
        table_name="saved_session_lists",
        schema="project",
    )
    op.drop_table("saved_session_lists", schema="project")
