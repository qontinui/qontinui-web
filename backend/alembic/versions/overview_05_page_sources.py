"""overview.* — published-page sources, and who (which device, which session) wrote

Revision ID: overview_05_page_sources
Revises: coord_smckpt_01_success_metric_checkpoint_results
Create Date: 2026-10-07

Phase 2 of ``2026-10-07-agents-publish-documents-to-the-project-overview``:
agents publish repository files to the Project Overview's Documents, and a
re-publish must update the same document rather than make another.

``overview.pages`` — ``source_repo``, ``source_path``, ``source_sha``
    Which repository file a page mirrors and the commit it was published from.
    ``uq_overview_pages_source`` makes ``(tenant_id, kind, source_repo,
    source_path)`` unique among pages that HAVE a source (partial: a
    hand-written page has none and is untouched), which is what lets a create
    that collides on it converge on the existing page.

``overview.page_versions`` — ``source_sha``, ``via_device``, ``via_session``
    Each version records the commit it mirrored, and who wrote it beyond
    ``created_by``: the coord device the write came through (from the verified
    device JWT) and the session the client reported (``X-Overview-Session``,
    a volunteered label — never proof).

``overview.change_log`` — ``via_device``, ``via_session``
    The same two values on the audit trail, so an agent's write says it was
    an agent's.

Written to be provably additive for coord's migration classifier, as
``overview_04_timeline`` is: ``ADD COLUMN IF NOT EXISTS`` with every column
NULLABLE and no default, and the index ``CONCURRENTLY IF NOT EXISTS`` inside
``autocommit_block``.

Post-deploy verification (the index is built CONCURRENTLY, so a killed build
leaves it INVALID)::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'uq_overview_pages_source';

It must read ``indisvalid = true``. An INVALID unique index still rejects
duplicate writes but serves no lookup, and ``IF NOT EXISTS`` would skip it on
every later run, so ``upgrade`` checks and FAILS LOUDLY on an invalid one
rather than reporting success. The recovery is ``DROP INDEX CONCURRENTLY IF
EXISTS overview.uq_overview_pages_source`` and then this revision's CREATE
again, once ``pg_stat_progress_create_index`` shows no build on the table.
Never a plain ``DROP INDEX``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_05_page_sources"
down_revision: str | Sequence[str] | None = (
    "coord_smckpt_01_success_metric_checkpoint_results"
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE overview.pages ADD COLUMN IF NOT EXISTS source_repo text")
    op.execute("ALTER TABLE overview.pages ADD COLUMN IF NOT EXISTS source_path text")
    op.execute("ALTER TABLE overview.pages ADD COLUMN IF NOT EXISTS source_sha text")
    op.execute(
        "ALTER TABLE overview.page_versions ADD COLUMN IF NOT EXISTS source_sha text"
    )
    op.execute(
        "ALTER TABLE overview.page_versions ADD COLUMN IF NOT EXISTS via_device uuid"
    )
    op.execute(
        "ALTER TABLE overview.page_versions ADD COLUMN IF NOT EXISTS via_session text"
    )
    op.execute(
        "ALTER TABLE overview.change_log ADD COLUMN IF NOT EXISTS via_device uuid"
    )
    op.execute(
        "ALTER TABLE overview.change_log ADD COLUMN IF NOT EXISTS via_session text"
    )
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_overview_pages_source "
            "ON overview.pages (tenant_id, kind, source_repo, source_path) "
            "WHERE source_repo IS NOT NULL"
        )
        # `IF NOT EXISTS` matches an INVALID leftover from a killed build by
        # name, so the CREATE above can "succeed" without an index that works.
        op.execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'overview'
                       AND c.relname = 'uq_overview_pages_source'
                       AND NOT i.indisvalid
                ) THEN
                    RAISE EXCEPTION
                        'overview.uq_overview_pages_source exists but is INVALID '
                        '(a killed concurrent build); remove it concurrently '
                        'and re-run this revision (see the revision docstring)';
                END IF;
            END
            $$
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS overview.uq_overview_pages_source"
        )
    op.execute("ALTER TABLE overview.change_log DROP COLUMN IF EXISTS via_session")
    op.execute("ALTER TABLE overview.change_log DROP COLUMN IF EXISTS via_device")
    op.execute("ALTER TABLE overview.page_versions DROP COLUMN IF EXISTS via_session")
    op.execute("ALTER TABLE overview.page_versions DROP COLUMN IF EXISTS via_device")
    op.execute("ALTER TABLE overview.page_versions DROP COLUMN IF EXISTS source_sha")
    op.execute("ALTER TABLE overview.pages DROP COLUMN IF EXISTS source_sha")
    op.execute("ALTER TABLE overview.pages DROP COLUMN IF EXISTS source_path")
    op.execute("ALTER TABLE overview.pages DROP COLUMN IF EXISTS source_repo")
