"""consolidation phase1 01 infrastructure

Revision ID: consolidation_phase1_01_infrastructure
Revises: b4d8e1c93f27
Create Date: 2026-04-29

Phase 1, batch 1 of the migration consolidation (see
``D:/qontinui-root/tmp_migration_consolidation_plan.md``).

Creates the four canonical schemas (``project``, ``coord``, ``agent``,
``auth``) per topology plan §4 and enables the ``vector`` extension.
Replaces the runner's self-bootstrap at ``mod.rs:1497-1502`` (which
ran ``CREATE SCHEMA IF NOT EXISTS runner`` on every connect) and the
``qontinui-web/init-scripts/01-create-runner-schema.sql`` bootstrap.

This is the first revision off ``b4d8e1c93f27`` (current alembic head
as of 2026-04-29). All subsequent Phase 1 batches depend on this.

Note on the legacy ``runner`` schema:
After all Phase 1 + Phase 2 revisions land, a final cleanup revision
renames ``runner.*`` survivors (e.g. ``runner.users`` from
``d7e2f1a8b3c4_repoint_user_fks_to_runner_schema.py``) into the
canonical schemas. This revision deliberately does not drop the
``runner`` schema — that happens at the end of the chain when the
schema is empty.

Idempotency:
``CREATE SCHEMA IF NOT EXISTS`` and ``CREATE EXTENSION IF NOT EXISTS``
are inherently idempotent. Re-applying this revision is a no-op on a
DB that already has the schemas.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "consolidation_phase1_01_infrastructure"
down_revision: str = "b4d8e1c93f27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS project")
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute("CREATE SCHEMA IF NOT EXISTS agent")
    op.execute("CREATE SCHEMA IF NOT EXISTS auth")

    op.execute("GRANT ALL ON SCHEMA project TO qontinui_user")
    op.execute("GRANT ALL ON SCHEMA coord TO qontinui_user")
    op.execute("GRANT ALL ON SCHEMA agent TO qontinui_user")
    op.execute("GRANT ALL ON SCHEMA auth TO qontinui_user")

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade() -> None:
    """Best-effort downgrade.

    Cannot ``DROP SCHEMA project CASCADE`` here without orphaning every
    table downstream batches will create. This downgrade only drops the
    schemas if they're empty — i.e., only when run as part of an
    end-to-end downgrade-all that has already removed all tables.

    The ``vector`` extension is not dropped: it may be used outside
    this chain's tables and ``DROP EXTENSION vector`` is destructive.
    """
    op.execute("DROP SCHEMA IF EXISTS project RESTRICT")
    op.execute("DROP SCHEMA IF EXISTS coord RESTRICT")
    op.execute("DROP SCHEMA IF EXISTS agent RESTRICT")
    op.execute("DROP SCHEMA IF EXISTS auth RESTRICT")
