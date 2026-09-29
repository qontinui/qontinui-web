"""overview.* — the authoring core: change_log, and settings.editing_roles

Revision ID: overview_02_authoring_core
Revises: route_serving_host_passes_01
Create Date: 2026-09-23

Phase 1 of ``2026-09-20-overview-authoring-layer``: every overview resource is
edited through one contract, and that contract needs two things the estimate
schema (``overview_01_estimate_baseline``) did not carry.

``overview.change_log``
    One append-only row per write to any overview resource: who, when, which
    resource and record, the action, where the write came from (``ui`` /
    ``api`` / ``import``), and the resource's read shape before and after.
    ``record_id`` is TEXT because not every resource is keyed by a UUID —
    coord's intent documents, the first resource on this contract, are
    addressed ``<kind>:<name>``. A partial unique index on
    ``idempotency_key`` is what makes a retried create return the record the
    first attempt made instead of making a second one.

``overview.settings.editing_roles``
    Which coord tenant roles may edit the project's overview. Defaults to
    ``{admin}`` — the posture every write had before this revision — so the
    migration changes nobody's access. The CHECK keeps ``admin`` in the set
    (widening is the setting's purpose; locking the project's administrators
    out is not) and limits it to the roles coord actually grants.

Written to be provably additive for coord's migration classifier
(``pr_merge/migration_classifier.rs``), which lands a migration unattended only
when every upgrade statement is one it can prove safe on a live, populated
database:

* The column is NULLABLE with a constant ``DEFAULT``. PostgreSQL fills existing
  rows from the default without a rewrite, so every current row reads
  ``{admin}``; ``NULL`` is still representable, and the application reads it
  as ``{admin}`` too (``app.overview.permissions``), so no value can widen
  access. ``NOT NULL`` is what the classifier refuses: it cannot prove the
  add will not rewrite or lock the table.
* The CHECK is declared inline on the added column, which the classifier
  admits (PostgreSQL validates it against the existing rows, which all hold the
  default and so pass).
* Every statement is guarded (``IF NOT EXISTS``) so a re-run is a no-op, and
  the indexes are built ``CONCURRENTLY`` inside ``autocommit_block`` — the table
  is new and empty, so the build is instant, but a non-concurrent index is a
  shape the classifier cannot tell from one on a populated table.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_02_authoring_core"
down_revision: str | Sequence[str] | None = "route_serving_host_passes_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE overview.settings
        ADD COLUMN IF NOT EXISTS editing_roles text[] DEFAULT '{admin}'::text[]
        CONSTRAINT ck_overview_settings_editing_roles CHECK (
            editing_roles IS NULL
            OR (
                'admin' = ANY(editing_roles)
                AND editing_roles <@ '{admin,agent_supervisor,operator}'::text[]
            )
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS overview.change_log (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            resource text NOT NULL,
            record_id text NOT NULL,
            action text NOT NULL,
            source text NOT NULL,
            actor text,
            actor_user_id uuid,
            version_before integer,
            version_after integer,
            before jsonb,
            after jsonb,
            idempotency_key text,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_overview_change_log_source
                CHECK (source IN ('ui', 'api', 'import')),
            CONSTRAINT ck_overview_change_log_action
                CHECK (action IN ('create', 'update', 'delete'))
        )
        """
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_overview_change_log_record "
            "ON overview.change_log (tenant_id, resource, record_id, created_at)"
        )
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
            "uq_overview_change_log_idempotency "
            "ON overview.change_log (tenant_id, resource, idempotency_key) "
            "WHERE idempotency_key IS NOT NULL"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS overview.change_log")
    op.execute("ALTER TABLE overview.settings DROP COLUMN IF EXISTS editing_roles")
