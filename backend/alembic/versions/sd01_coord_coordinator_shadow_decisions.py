"""coord.coordinator_shadow_decisions — shadow-mode audit table for Rust coordinator soak

Revision ID: sd01_coord_coordinator_shadow_decisions
Revises: 7c5e4d3b2a1f
Create Date: 2026-05-09

Backs the soak window comparing the in-process Rust coordinator scheduler
(``qontinui-runner/src-tauri/src/coordinator/``) against the legacy
``/coordinate`` Claude-skill loop. When ``QONTINUI_COORDINATOR_SHADOW=1``
the Rust scheduler still observes + decides on every tick but does NOT
acquire the leader lease and does NOT call ``act::apply``; instead it
writes the would-be-action here. The diff endpoint at
``GET /coordinator/shadow-diff`` joins these rows against the live
``coord.coordinator_decisions`` rows by ``observation_hash`` to surface
divergence per-rule.

Idempotent. NO-OP on a DB that already has the table.
"""

from collections.abc import Sequence

from alembic import op


revision: str = "sd01_coord_coordinator_shadow_decisions"
down_revision: str = "c0bdef_coord_build_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.coordinator_shadow_decisions (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            instance_id       TEXT NOT NULL,
            iteration         BIGINT NOT NULL,
            observation_hash  TEXT NOT NULL,
            rule              TEXT NOT NULL,
            action            TEXT NOT NULL,
            target_id         TEXT,
            reasoning         TEXT NOT NULL,
            would_have_acted  BOOLEAN NOT NULL,
            taken_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Time-range queries for the diff endpoint and the soak dashboard.
        CREATE INDEX IF NOT EXISTS idx_csd_taken_at
            ON coord.coordinator_shadow_decisions(taken_at DESC);

        -- Join key for shadow ↔ live correlation. Both tables (shadow + live
        -- coordinator_decisions) carry the same observation_hash on every
        -- decision row, so diff queries reduce to an INNER JOIN on this column.
        CREATE INDEX IF NOT EXISTS idx_csd_obs_hash
            ON coord.coordinator_shadow_decisions(observation_hash);

        -- Per-instance filtering so multiple parallel rust-shadow runners
        -- (rare but possible during multi-machine soak) can be separated.
        CREATE INDEX IF NOT EXISTS idx_csd_instance
            ON coord.coordinator_shadow_decisions(instance_id, taken_at DESC);

        -- Phase 2 (this same migration): backfill an observation_hash column
        -- on the live decisions table so the join works in both directions.
        -- Empty-string default keeps existing rows non-null; the Rust
        -- insert path stamps real hashes going forward. NO INDEX on the
        -- live side until usage warrants — the diff query filters by
        -- shadow.taken_at first, then joins.
        ALTER TABLE coord.coordinator_decisions
            ADD COLUMN IF NOT EXISTS observation_hash TEXT NOT NULL DEFAULT '';
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE coord.coordinator_decisions DROP COLUMN IF EXISTS observation_hash")
    op.execute("DROP TABLE IF EXISTS coord.coordinator_shadow_decisions CASCADE")
