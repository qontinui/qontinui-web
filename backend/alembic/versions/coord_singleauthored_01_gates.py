"""coord.gates — migrate single-authored Rust self-heal to alembic

Revision ID: coord_singleauthored_01_gates
Revises: decision_engine_phase1_kind_nullable
Create Date: 2026-05-29

First of the chain that drains the `coord_schema_authorship.rs` allowlist to
zero (plan
``2026-05-29-migrate-single-authored-coord-tables-to-alembic.md``). Each
revision mirrors a previously single-authored Rust `ensure_*_table` self-heal
byte-for-byte so a fresh canonical PG ends up with the exact shape the
self-heal produced; the Rust DDL is deleted in the companion coord PR and the
table is added to `main.rs::ALEMBIC_OWNED_TABLES` so the boot gate fail-fasts
on its absence.

Mirrors ``qontinui-coord/src/gates.rs::ensure_gates_table``.

Raw ``op.execute`` (not ``op.create_table``) and ``IF NOT EXISTS`` so the
migration is collision-safe against any canonical PG that already has the
table from the pre-deletion self-heal — same convention as
``coord_substrate_03_stack_edges.py``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "coord_singleauthored_01_gates"
down_revision: str | Sequence[str] | None = "decision_engine_phase1_kind_nullable"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.gates (
            gate_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            claim_kind         TEXT,
            resource_key       TEXT,
            plan_id            UUID,
            phase_name         TEXT,
            predicate          JSONB NOT NULL,
            verdict            TEXT NOT NULL DEFAULT 'open'
                CHECK (verdict IN ('open', 'cleared', 'failed')),
            verdict_reason     TEXT,
            continuation_spawn JSONB,
            registered_by      UUID,
            tenant_id          UUID NOT NULL,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
            evaluated_at       TIMESTAMPTZ,
            cleared_at         TIMESTAMPTZ,
            CONSTRAINT ck_gates_anchor CHECK (
                (claim_kind IS NOT NULL AND resource_key IS NOT NULL
                 AND plan_id IS NULL AND phase_name IS NULL)
                OR (claim_kind IS NULL AND resource_key IS NULL
                    AND plan_id IS NOT NULL AND phase_name IS NOT NULL)
            )
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_open
            ON coord.gates (verdict) WHERE verdict = 'open'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_claim
            ON coord.gates (claim_kind, resource_key) WHERE claim_kind IS NOT NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_gates_plan
            ON coord.gates (plan_id, phase_name) WHERE plan_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_plan")
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_claim")
    op.execute("DROP INDEX IF EXISTS coord.idx_gates_open")
    op.execute("DROP TABLE IF EXISTS coord.gates")
