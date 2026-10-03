"""overview.* — the Timeline: milestones, and a phase's progress version

Revision ID: overview_04_timeline
Revises: coord_agent_sessions_context_01
Create Date: 2026-10-03

Phase 4 of ``2026-09-20-overview-authoring-layer`` (the overview plan's Phase 3
data model): the Timeline, where a project records what actually happened
against the estimate's plan.

``overview.milestones``
    A dated marker — a pilot, the date of first value, any other milestone —
    optionally tied to a phase. ``phase_id`` is SET NULL, never cascaded, when
    the phase goes: a milestone outlives a re-planned schedule. A milestone is
    ``done`` exactly when it has a ``completed_date``
    (``ck_overview_milestones_done_has_date``). Gates are phases, not
    milestones, so they are not duplicated here.

``overview.phases`` — three columns for the ``phase_progress`` resource
    A phase's actual dates and gate outcome already live on the phase. What
    they lacked is a version of their own: the estimate's version covers the
    whole plan, so recording a gate outcome through it would make every
    open estimate editor's save a conflict, and a save built before the
    outcome was recorded would write the old one back. ``progress_version``
    is the progress fields' own version; ``progress_updated_at`` /
    ``progress_updated_by`` say who last recorded progress (the row's
    ``updated_*`` move with every estimate save, so they cannot).

Written to be provably additive for coord's migration classifier: a guarded
``CREATE TABLE IF NOT EXISTS`` (constraints inline, which the classifier admits
because a new table holds no rows); ``ADD COLUMN IF NOT EXISTS`` with every
added column NULLABLE (``progress_version`` takes a constant default, which
Postgres fills without a rewrite — a reader maps a NULL to 1); and each index
``CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_04_timeline"
down_revision: str | Sequence[str] | None = "coord_agent_sessions_context_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS overview.milestones (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            title text NOT NULL,
            description text NOT NULL DEFAULT '',
            kind text NOT NULL DEFAULT 'milestone',
            phase_id uuid
                REFERENCES overview.phases (id) ON DELETE SET NULL,
            target_date date NOT NULL,
            completed_date date,
            status text NOT NULL DEFAULT 'planned',
            version integer NOT NULL DEFAULT 1,
            created_by text,
            updated_by text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_overview_milestones_kind
                CHECK (kind IN ('milestone', 'pilot', 'first_value', 'other')),
            CONSTRAINT ck_overview_milestones_status
                CHECK (status IN ('planned', 'in_progress', 'done', 'at_risk')),
            CONSTRAINT ck_overview_milestones_done_has_date
                CHECK ((status = 'done') = (completed_date IS NOT NULL))
        )
        """
    )
    op.execute(
        "ALTER TABLE overview.phases "
        "ADD COLUMN IF NOT EXISTS progress_version integer DEFAULT 1"
    )
    op.execute(
        "ALTER TABLE overview.phases "
        "ADD COLUMN IF NOT EXISTS progress_updated_at timestamptz"
    )
    op.execute(
        "ALTER TABLE overview.phases ADD COLUMN IF NOT EXISTS progress_updated_by text"
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_overview_milestones_tenant "
            "ON overview.milestones (tenant_id, target_date)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_overview_milestones_phase "
            "ON overview.milestones (phase_id)"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS overview.milestones")
    op.execute("ALTER TABLE overview.phases DROP COLUMN IF EXISTS progress_updated_by")
    op.execute("ALTER TABLE overview.phases DROP COLUMN IF EXISTS progress_updated_at")
    op.execute("ALTER TABLE overview.phases DROP COLUMN IF EXISTS progress_version")
