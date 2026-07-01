"""coord.helper_tasks + coord.helper_answers (helper-task queue broker)

Revision ID: coord_helper_tasks_01
Revises: resq_02_drop_reservation_lifecycle_cols
Create Date: 2026-06-29

Phase 1.2 of plan
``2026-06-29-helper-task-queue-non-programmer-dev.md``
(coord task-broker layer for human-judgment micro-tasks).

Additive schema for the helper-task queue: a runner emits a
``coord.helper_tasks`` row (a small unit of human judgment — "does this
screen look right?"), a non-technical helper submits a
``coord.helper_answers`` row, and the broker folds the verdict back once
``required_votes`` answers are collected. Both tables mirror the canonical
Rust DTOs in ``qontinui_types::helper_task`` (``HelperTask`` /
``HelperAnswer``); the composite sub-objects (``payload``,
``answer_schema``, ``source``, ``reasons``) are stored as JSONB and
round-trip through serde on the coord side.

``kind``/``status``/``verdict`` are stored as OPAQUE TEXT — coord does NOT
validate them against a CHECK constraint (the enum vocabulary lives in the
Rust source of truth; a DB CHECK would fossilize it and break the
add-a-kind path). ``tenant_id`` is nullable and resolved from the JWT at
DML time, mirroring ``coord.work_units`` / ``coord.plans``.

alembic is the sole author of this schema. Unlike the load-bearing coord
tables, these are NOT added to coord's ``ALEMBIC_OWNED_TABLES`` /
``require_table`` boot assertions: the helper-task queue is an OPTIONAL
feature, so a boot-gate would crash-loop coord if this migration has not
yet deployed. This follows the ``commit_effects.rs`` "deliberately NO
require_table" precedent — coord DMLs against these tables best-effort and
degrades gracefully when they are absent.

Collision-safe raw ``IF NOT EXISTS`` — see ``coord_singleauthored_01_gates``.

Chained off ``resq_02_drop_reservation_lifecycle_cols`` — the single live
alembic head at authoring time — so the chain stays single-headed (the
``alembic-heads-pr`` gate). coord's land-time re-point engine re-anchors this
to the live head on land if another migration merges first.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_helper_tasks_01"
down_revision: str | Sequence[str] | None = "resq_02_drop_reservation_lifecycle_cols"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.helper_tasks`` + ``coord.helper_answers``. Idempotent."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")

    # helper_tasks — a human-judgment micro-task emitted by a runner. kind /
    # status are OPAQUE TEXT (no CHECK); tenant_id nullable (resolved from the
    # JWT at DML time). The composite DTO sub-objects are JSONB.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.helper_tasks (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id      UUID REFERENCES coord.tenants(tenant_id),
            app_id         TEXT NOT NULL,
            kind           TEXT NOT NULL,
            prompt         TEXT NOT NULL,
            payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
            answer_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
            required_votes INTEGER NOT NULL DEFAULT 1,
            status         TEXT NOT NULL DEFAULT 'open',
            source         JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            expires_at     TIMESTAMPTZ
        )
        """
    )
    # (tenant_id, status) — the list-open-for-tenant query's access path.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_helper_tasks_tenant_status
            ON coord.helper_tasks(tenant_id, status)
        """
    )
    # created_at — supports the answers-since poll's ordering / the task-side
    # time scans.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_helper_tasks_created_at
            ON coord.helper_tasks(created_at)
        """
    )

    # helper_answers — one helper's answer to a task. verdict is OPAQUE TEXT
    # (no CHECK); reasons is the JSONB array of preset reason codes. FK against
    # coord.helper_tasks(id), cascade on delete.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.helper_answers (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id        UUID NOT NULL
                REFERENCES coord.helper_tasks(id) ON DELETE CASCADE,
            helper_user_id TEXT NOT NULL,
            verdict        TEXT NOT NULL,
            reasons        JSONB NOT NULL DEFAULT '[]'::jsonb,
            free_text      TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    # (task_id, helper_user_id) UNIQUE — makes answer submission idempotent
    # per-helper (the broker's ON CONFLICT upsert target).
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_helper_answers_task_helper
            ON coord.helper_answers(task_id, helper_user_id)
        """
    )
    # created_at — the answers-since poll's ordering / range scan.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_helper_answers_created_at
            ON coord.helper_answers(created_at)
        """
    )


def downgrade() -> None:
    """Reverse: drop answers (FK child) first, then tasks + indexes."""
    op.execute("DROP INDEX IF EXISTS coord.idx_helper_answers_created_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_helper_answers_task_helper")
    op.execute("DROP TABLE IF EXISTS coord.helper_answers")
    op.execute("DROP INDEX IF EXISTS coord.idx_helper_tasks_created_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_helper_tasks_tenant_status")
    op.execute("DROP TABLE IF EXISTS coord.helper_tasks")
