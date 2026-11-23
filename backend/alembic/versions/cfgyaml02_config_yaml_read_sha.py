"""add config_yaml_read_sha TEXT to coord.tenant_repo_profiles

Plan ``2026-11-23-coord-config-yml-snapshot-and-large-pr-files-never-refresh``
Phase 3 step 1 (the qontinui-web half). ``config_yaml_overrides`` (added by
``cfgyaml01_config_yaml_overrides``) records the parsed ``.qontinui/config.yml``
but not WHICH commit it was read from, so neither coord nor an operator can
tell a fresh snapshot from one stranded at an old ``main``. This column holds
the commit sha the persisted snapshot was read at; coord's config.yml
reconciler writes it alongside ``config_yaml_overrides``.

Shape: ``TEXT NULL``, no default, no backfill. NULL means "read sha unknown" —
every pre-existing row, and any row whose snapshot predates the writer. A
default or a backfill would assert a provenance nobody observed.

Cross-repo deploy order: ``coord.*`` schema is owned by this (web) alembic
(served policy ``production-and-cost`` ``alembic-sole-authorship``). This
revision MUST be applied in production before the coord change that reads or
writes ``config_yaml_read_sha`` deploys, or coord's required-columns drift
gate wedges. The column is harmless until coord touches it.

Chaining: ``down_revision`` is the local single head
(``scripts/ci/count_alembic_heads.py --baseline-ref origin/main`` →
``HEAD_COUNT=1``, ``coord_subprojects_05_note_events``, measured 2026-11-23).
A re-point is two coupled edits: ``down_revision`` and the ``Revises:`` line.

Hand-authored; ``alembic revision --autogenerate`` was not run.

Revision ID: cfgyaml02_config_yaml_read_sha
Revises: coord_subprojects_05_note_events
Create Date: 2026-11-23

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cfgyaml02_config_yaml_read_sha"
down_revision: str | None = "coord_subprojects_05_note_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable, undefaulted read-sha column."""
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "ADD COLUMN IF NOT EXISTS config_yaml_read_sha TEXT"
    )


def downgrade() -> None:
    """Exact inverse of upgrade()."""
    op.execute(
        "ALTER TABLE coord.tenant_repo_profiles "
        "DROP COLUMN IF EXISTS config_yaml_read_sha"
    )
