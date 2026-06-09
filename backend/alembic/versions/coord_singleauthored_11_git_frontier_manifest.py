"""coord.git_frontier_manifest — durable (token -> (ref, sha)) frontier record

Revision ID: coord_singleauthored_11_git_frontier_manifest
Revises: twin_04_coord_infra_health_observations
Create Date: 2026-06-09

Activation prerequisite for the durable-substrate Phase 3a manifest
(qontinui-coord PR #490, ``git_replication.rs::record_frontier_manifest``,
behind the dark flag ``COORD_FRONTIER_MANIFEST_ENABLED``). On each critical-ref
frontier advance the leader records the ``(critical_ref, sha)`` set that the new
``synced_through_token`` covers; a future Phase 3b self-promote ``git rev-parse``-
verifies the local bare repo against the latest row per ``(repo, critical_ref)``
to prove it physically holds the ack-frontier (RPO-0-safe self-promote without a
live peer). Mirrors the Rust ``#[cfg(test)] ensure_git_frontier_manifest_table``
fixture (the prod author is alembic; the Rust copy is a throwaway-PG fixture).
Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.
The coord writer is best-effort (``-> ()``, WARN-and-swallow), so until this
migration applies the dark flag stays inert with no impact on the ack path.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_11_git_frontier_manifest"
down_revision: str | Sequence[str] | None = "twin_04_coord_infra_health_observations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.git_frontier_manifest (
            frontier_token BIGINT      NOT NULL,
            repo           TEXT        NOT NULL,
            critical_ref   TEXT        NOT NULL,
            sha            TEXT        NOT NULL,
            recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (frontier_token, repo, critical_ref)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS git_frontier_manifest_ref_token_idx
            ON coord.git_frontier_manifest (repo, critical_ref, frontier_token DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS coord.git_frontier_manifest")
