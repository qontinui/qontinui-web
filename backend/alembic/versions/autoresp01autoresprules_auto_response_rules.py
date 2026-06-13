"""auth.auto_response_rules — org-scoped fleet-wide auto-response rules

Revision ID: autoresp01autoresprules
Revises: coord_plans_ingested_status
Create Date: 2026-06-13

Creates the ``auth.auto_response_rules`` table backing the fleet-wide
auto-response rules feature. A rule matches runner output against a regex
``pattern`` and injects ``prompt`` as an auto-continue response on an
exponential ``backoff`` schedule. Rules are org-scoped; one built-in default
rule is seeded per-org on first read (in application code, not here).

Pure ``op.execute`` DDL, every statement schema-qualified to ``auth`` (the
``check_alembic_schema_args.py`` gate requires it). ``IF NOT EXISTS``
everywhere keeps the migration idempotent; the ``auth`` schema already exists
(it owns ``auth.organizations`` / ``auth.users``) so it is NOT created here.
No app-code imports, no backfill — the prod migrator container lacks app deps.

down_revision chains off ``chkguard_02_parked_pr_head_sha`` — the slot coord
assigned via ``/coord/migrations/reserve`` (position 2); the alembic-heads-pr
+ verify-claim CI gates are the authoritative single-head / reservation guard.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "autoresp01autoresprules"
down_revision: str = "chkguard_02_parked_pr_head_sha"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the auth.auto_response_rules table + org index."""
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


def downgrade() -> None:
    """Drop the table (index drops with it)."""
    op.execute("DROP TABLE IF EXISTS auth.auto_response_rules")
