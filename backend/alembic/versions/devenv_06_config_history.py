"""devenv_06: machine config history (drift over time)

Revision ID: devenv_06_config_history
Revises: a1cc120c0fba
Create Date: 2026-07-18

P2 of plan ``2026-07-01-devenv-phase2-binding-history-remediation-sharing``.
``devenv.machine_environment_configs`` keeps only the LATEST snapshot per
(environment, machine) — every agent re-report overwrites the prior envelope,
so "how did this machine's config drift over time?" was unanswerable.

Creates ``devenv.machine_environment_config_history`` — an append-only
capture timeline written alongside the latest-snapshot upsert in the agent
``report_config`` path. Consecutive duplicates are deduplicated by
``content_hash`` (the ~15-min runner capture is mostly no-change noise), so a
row is appended only when the envelope actually changed.

Column notes:
* ``environment_id`` — FK ``devenv.environments(id)`` ``ON DELETE CASCADE``.
* ``machine_id`` — FK ``devenv.machines(id)`` ``ON DELETE CASCADE``. Unlike
  the canonical change log's soft machine refs, history dies with its
  machine: a machine's private capture timeline has no audit value after the
  machine is gone (the canonical log records *decisions*; this records
  *self-observations*).
* ``owner_user_id`` — FK ``auth.users(id)`` ``ON DELETE CASCADE`` (same
  owner-scoping as ``machine_environment_configs``).
* ``config`` — the full post-backstop envelope (secret-free by construction;
  the ``env_contract`` section was already coerced to present/absent before
  the latest-snapshot upsert, and history stores the same envelope).
* ``content_hash`` — sha256 hex of the canonical-JSON envelope (sorted keys,
  compact separators, ``captured_at`` excluded so a re-capture of identical
  content dedups). Drives the consecutive-dedup on append.

Forward-only + additive (a brand-new table). Safe for a running app on the
prior schema.

``down_revision`` = the current alembic head (``a1cc120c0fba``).
Per the fleet convention (and as ``devenv_05`` did), coord re-points at land
time if main advances, and ``alembic-graph-pr`` CI guards forks.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

# revision identifiers
revision = "devenv_06_config_history"
down_revision = "a1cc120c0fba"
branch_labels = None
depends_on = None

_SCHEMA = "devenv"


def upgrade() -> None:
    op.create_table(
        "machine_environment_config_history",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            primary_key=True,
        ),
        sa.Column(
            "environment_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.environments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # History dies with its machine (see module docstring) — a hard FK,
        # unlike the canonical change log's soft machine references.
        sa.Column(
            "machine_id",
            UUID(as_uuid=True),
            sa.ForeignKey("devenv.machines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "owner_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("config", JSONB, nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema=_SCHEMA,
    )
    # History reads are "give me this (environment, machine)'s captures,
    # newest first" — also the access path for the dedup lookup + the pruner.
    op.create_index(
        "idx_devenv_config_history_env_machine_captured",
        "machine_environment_config_history",
        ["environment_id", "machine_id", sa.text("captured_at DESC")],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index(
        "idx_devenv_config_history_env_machine_captured",
        table_name="machine_environment_config_history",
        schema=_SCHEMA,
    )
    op.drop_table("machine_environment_config_history", schema=_SCHEMA)
