"""overview.* — published-page sources, and who (which device, which session) wrote

Revision ID: overview_05_page_sources
Revises: devcred_01_credential_deny_and_bound_pair_codes
Create Date: 2026-10-07

Phase 2 of ``2026-10-07-agents-publish-documents-to-the-project-overview``:
agents publish repository files to the Project Overview's Documents, and a
re-publish must update the same document rather than make another.

``overview.pages`` — ``source_repo``, ``source_path``, ``source_sha``
    Which repository file a page mirrors and the commit it was published from.
    ``uq_overview_pages_source`` makes ``(tenant_id, kind, source_repo,
    source_path)`` unique among pages that HAVE a source (partial: a
    hand-written page has none and is untouched), which is what lets a
    re-publish find the existing page, and a lost-answer retry converge on it.
    Three CHECKs hold the shape the API validates, for any writer:
    ``ck_overview_pages_source_repo_lowercase`` (a ``source_repo`` is stored in
    its one lowercase spelling, which the unique index depends on),
    ``ck_overview_pages_source_pair`` (``source_repo`` and ``source_path`` are
    both set or both null) and ``ck_overview_pages_source_sha_needs_source``
    (a ``source_sha`` only beside a source).

``overview.page_versions`` — ``source_sha``, ``via_device``, ``via_session``
    Each version records the commit it mirrored, and who wrote it beyond
    ``created_by``: the coord device the write came through (from the verified
    device JWT) and the session the client reported (``X-Overview-Session``,
    a volunteered label — never proof).

``overview.change_log`` — ``via_device``, ``via_session``
    The same two values on the audit trail, so an agent's write says it was
    an agent's.

Locking. Every column is ``ADD COLUMN IF NOT EXISTS``, NULLABLE, with no
default: catalog-only. The CHECKs are added ``NOT VALID`` (a brief ``ACCESS
EXCLUSIVE``, enforced on every write from that moment), each after a
``DROP CONSTRAINT IF EXISTS`` so a re-run after a partial upgrade converges,
and then ``VALIDATE``d inside ``autocommit_block`` — each in its own
transaction under ``SHARE UPDATE EXCLUSIVE``, which blocks no reader or
writer. The index is built ``CONCURRENTLY IF NOT EXISTS`` in the same block.
Every row that exists before this revision has a null source, which all three
CHECKs accept, so the validation can find nothing.

coord's migration classifier does NOT prove this revision additive, and this
docstring used to claim it did: the dollar-quoted invalid-index check below,
``DROP CONSTRAINT`` and ``VALIDATE CONSTRAINT`` are all outside the forms it
admits (it fails closed on each), so a PR carrying this revision is held on
coord's migrations escalate path until reviewed.

Post-deploy verification (the index is built CONCURRENTLY, so a killed build
leaves it INVALID)::

    SELECT c.relname, i.indisvalid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'uq_overview_pages_source';

It must read ``indisvalid = true``. An INVALID unique index may still
enforce uniqueness (PostgreSQL starts enforcing it only once the concurrent
build reaches its second scan, so a build killed earlier enforces nothing)
but serves no lookup, and ``IF NOT EXISTS`` would skip it on every later run,
so ``upgrade`` checks and FAILS LOUDLY on an invalid one rather than reporting
success. The recovery is ``DROP INDEX CONCURRENTLY IF
EXISTS overview.uq_overview_pages_source`` and then this revision's CREATE
again, once ``pg_stat_progress_create_index`` shows no build on the table.
Never a plain ``DROP INDEX``.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "overview_05_page_sources"
down_revision: str | Sequence[str] | None = "devcred_01_credential_deny_and_bound_pair_codes"
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
    # NOT VALID: no scan, enforced on every write from here. Drop-then-add,
    # because PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS and a partial
    # upgrade may already have committed one of these.
    op.execute(
        "ALTER TABLE overview.pages "
        "DROP CONSTRAINT IF EXISTS ck_overview_pages_source_repo_lowercase"
    )
    op.execute(
        "ALTER TABLE overview.pages "
        "ADD CONSTRAINT ck_overview_pages_source_repo_lowercase "
        "CHECK (source_repo IS NULL OR source_repo = lower(source_repo)) NOT VALID"
    )
    op.execute(
        "ALTER TABLE overview.pages "
        "DROP CONSTRAINT IF EXISTS ck_overview_pages_source_pair"
    )
    op.execute(
        "ALTER TABLE overview.pages "
        "ADD CONSTRAINT ck_overview_pages_source_pair "
        "CHECK ((source_repo IS NULL) = (source_path IS NULL)) NOT VALID"
    )
    op.execute(
        "ALTER TABLE overview.pages "
        "DROP CONSTRAINT IF EXISTS ck_overview_pages_source_sha_needs_source"
    )
    op.execute(
        "ALTER TABLE overview.pages "
        "ADD CONSTRAINT ck_overview_pages_source_sha_needs_source "
        "CHECK (source_sha IS NULL OR source_repo IS NOT NULL) NOT VALID"
    )
    # autocommit_block() commits the statements above first, so each VALIDATE
    # runs in its own transaction under SHARE UPDATE EXCLUSIVE, and the index
    # build after them takes no lock a writer waits on.
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TABLE overview.pages "
            "VALIDATE CONSTRAINT ck_overview_pages_source_repo_lowercase"
        )
        op.execute(
            "ALTER TABLE overview.pages "
            "VALIDATE CONSTRAINT ck_overview_pages_source_pair"
        )
        op.execute(
            "ALTER TABLE overview.pages "
            "VALIDATE CONSTRAINT ck_overview_pages_source_sha_needs_source"
        )
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
    op.execute(
        "ALTER TABLE overview.pages "
        "DROP CONSTRAINT IF EXISTS ck_overview_pages_source_sha_needs_source"
    )
    op.execute(
        "ALTER TABLE overview.pages "
        "DROP CONSTRAINT IF EXISTS ck_overview_pages_source_pair"
    )
    op.execute(
        "ALTER TABLE overview.pages "
        "DROP CONSTRAINT IF EXISTS ck_overview_pages_source_repo_lowercase"
    )
    op.execute("ALTER TABLE overview.change_log DROP COLUMN IF EXISTS via_session")
    op.execute("ALTER TABLE overview.change_log DROP COLUMN IF EXISTS via_device")
    op.execute("ALTER TABLE overview.page_versions DROP COLUMN IF EXISTS via_session")
    op.execute("ALTER TABLE overview.page_versions DROP COLUMN IF EXISTS via_device")
    op.execute("ALTER TABLE overview.page_versions DROP COLUMN IF EXISTS source_sha")
    op.execute("ALTER TABLE overview.pages DROP COLUMN IF EXISTS source_sha")
    op.execute("ALTER TABLE overview.pages DROP COLUMN IF EXISTS source_path")
    op.execute("ALTER TABLE overview.pages DROP COLUMN IF EXISTS source_repo")
