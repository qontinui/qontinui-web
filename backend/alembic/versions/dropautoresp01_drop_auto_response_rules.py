"""drop auth.auto_response_rules — unified-automation-rule cutover

Revision ID: dropautoresp01_drop_auto_response_rules
Revises: gate_progress_samples_observed_idx_01
Create Date: 2026-06-14

Drops the ``auth.auto_response_rules`` table (and its org index) created by
``autoresp01autoresprules``. The org-scoped #580 auto-response store is
superseded by the unified automation-rule framework: rules now live in coord
(tenant-scoped), are served to the fleet by coord's ``/coord/policies/*``
routes, and are authored through the Admin Coord Console coord-proxy. The web
backend no longer owns this table, so it is dropped here.

Pure ``op.execute`` DDL, every statement schema-qualified to ``auth`` (the
``check_alembic_schema_args.py`` gate requires it). No app-code imports, no
backfill — the prod migrator container lacks app deps.

down_revision chains off ``gate_progress_samples_observed_idx_01`` — the current
tip of the auto_response lineage on origin/main and coord's reservation-tracked
head for this repo:
``autoresp01autoresprules`` → ``coord_wip_attribution`` →
``migprov01_migration_provenance`` → ``gate_progress_samples_observed_idx_01``.
It is a descendant of ``autoresp01autoresprules`` (the table-create), so the drop
runs after the create; it matches coord's migration-reservation assignment so the
``verify-claim`` gate binds; and it extends the lineage rather than forking at
``migprov01`` (which gained ``gate_progress_samples_observed_idx_01`` as a child
after this branch was first authored).

NOTE: qontinui-web's alembic tree is intentionally multi-headed (~25 heads);
chaining off the current lineage tip is correct and expected — no attempt is made
to collapse the multi-head state.

downgrade() RE-CREATES the table by mirroring the upgrade DDL of
``autoresp01autoresprules_auto_response_rules.py`` exactly, so the drop is
reversible (the table comes back empty — row data is not preserved).
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "dropautoresp01_drop_auto_response_rules"
down_revision: str = "gate_progress_samples_observed_idx_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the auth.auto_response_rules table (index drops with it)."""
    op.execute("DROP TABLE IF EXISTS auth.auto_response_rules")


def downgrade() -> None:
    """Re-create the auth.auto_response_rules table + org index.

    Mirrors the upgrade DDL of ``autoresp01autoresprules`` so the drop is
    reversible. The recreated table is empty.
    """
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS auth.auto_response_rules (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id  UUID NOT NULL
                REFERENCES auth.organizations (id) ON DELETE CASCADE,
            name             VARCHAR(200) NOT NULL,
            pattern          VARCHAR(1000) NOT NULL,
            prompt           TEXT NOT NULL,
            enabled          BOOLEAN NOT NULL DEFAULT TRUE,
            is_built_in      BOOLEAN NOT NULL DEFAULT FALSE,
            sort_order       INTEGER NOT NULL DEFAULT 0,
            backoff          JSON NOT NULL,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_auto_response_rule_org
            ON auth.auto_response_rules (organization_id)
        """
    )
