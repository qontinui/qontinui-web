"""coord.plans + coord.plan_status_history (Phase 2 substrate)

Revision ID: coord_plans
Revises: coord_primary_trees
Create Date: 2026-05-19

Phase 2 of plan
``D:/qontinui-root/plans/2026-05-19-coordinator-production-readiness.md``.

Stands up ``coord.plans`` and ``coord.plan_status_history`` so that
markdown plans authored under ``D:/qontinui-root/plans/`` can be
mirrored into the coordinator as first-class rows. The eventual coord
``plan_ingest_worker`` will tail the filesystem and UPSERT plan content
+ status here; the operator dashboard (qontinui-web) reads from these
tables to render the plans surface.

Schema:

* ``coord.plans``
  * ``plan_id UUID PRIMARY KEY``       — synthetic id; not the filename.
  * ``slug TEXT NOT NULL UNIQUE``      — stable filesystem-derived key,
    e.g. ``2026-05-19-coordinator-production-readiness``.
  * ``title TEXT NOT NULL``            — parsed from the markdown's H1.
  * ``content TEXT NOT NULL``          — full markdown body. Kept inline
    (not S3) — plans are small (<200KB typical) and operator UI needs
    immediate read.
  * ``status TEXT NOT NULL``           — one of ``draft|active|gated|
    deferred|shipped|archived``. The plans dashboard filters on this.
  * ``authored_at TIMESTAMPTZ``        — filesystem ctime / first-seen.
  * ``updated_at TIMESTAMPTZ``         — last-seen mtime; the
    plan_ingest_worker UPSERTs on this.
  * ``authored_by TEXT``               — best-effort attribution.
  * ``origin_path TEXT``               — original filesystem path
    relative to ``D:/qontinui-root/plans/``.
  * ``archive_path TEXT``              — set when plan moves to
    ``qontinui-dev-notes/plans/`` per
    [[feedback_shipped_plans_archive_location]].
  * ``metadata JSONB``                 — open-ended; phase counts,
    SHIPPED stamps, etc.

* ``coord.plan_status_history``
  * Append-only audit log of every status transition. The plans
    dashboard renders the timeline from this; the planning-discipline
    watcher (later phase) detects stuck-in-gated plans here.

Indices:

* ``idx_plans_status`` covers the dashboard's "all active plans" query.
* ``idx_plans_updated_at`` covers "most recently touched plans".
* ``idx_plan_status_history_plan`` covers per-plan timeline lookup.

Idempotency: ``CREATE TABLE IF NOT EXISTS`` + ``CREATE INDEX IF NOT
EXISTS``. Mirrors the runtime self-heal posture used by ``coord.alerts``
/ ``coord.primary_trees`` per [[feedback_canonical_db_behind_alembic]];
coord will gain an ``ensure_plans_tables`` self-heal alongside the
ingest worker.

Chains off ``coord_primary_trees`` (Phase 1 head on origin/main 2026-05-19
per [[feedback_verify_origin_state_before_phase_start]]).
"""

from collections.abc import Sequence

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "coord_plans"
down_revision: str = "coord_primary_trees"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create ``coord.plans`` + ``coord.plan_status_history``. Idempotent."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.plans (
            plan_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slug             TEXT NOT NULL UNIQUE,
            title            TEXT NOT NULL,
            content          TEXT NOT NULL,
            status           TEXT NOT NULL,
            authored_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            authored_by      TEXT,
            origin_path      TEXT,
            archive_path     TEXT,
            metadata         JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plans_status
            ON coord.plans(status)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plans_updated_at
            ON coord.plans(updated_at DESC)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.plan_status_history (
            history_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            plan_id          UUID NOT NULL
                REFERENCES coord.plans(plan_id) ON DELETE CASCADE,
            from_status      TEXT,
            to_status        TEXT NOT NULL,
            transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            by_actor         TEXT,
            reason           TEXT
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plan_status_history_plan
            ON coord.plan_status_history(plan_id, transitioned_at DESC)
        """
    )


def downgrade() -> None:
    """Drop ``coord.plans`` + history table + indices."""
    op.execute(
        "DROP INDEX IF EXISTS coord.idx_plan_status_history_plan"
    )
    op.execute("DROP TABLE IF EXISTS coord.plan_status_history")
    op.execute("DROP INDEX IF EXISTS coord.idx_plans_updated_at")
    op.execute("DROP INDEX IF EXISTS coord.idx_plans_status")
    op.execute("DROP TABLE IF EXISTS coord.plans")
