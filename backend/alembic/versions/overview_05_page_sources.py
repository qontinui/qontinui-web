"""overview.* — published-page sources, and who (which device, which session) wrote

Revision ID: overview_05_page_sources
Revises: coord_policy_outcome_counts_01
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
EXCLUSIVE``, enforced on every write from that moment), each only when the
table has no CHECK of that name yet, so a re-run after a partial upgrade
converges, and then ``VALIDATE``d inside ``autocommit_block`` — each in its own
transaction under ``SHARE UPDATE EXCLUSIVE``, which blocks no reader or writer.
The index is built ``CONCURRENTLY IF NOT EXISTS`` in the same block.
Every row that exists before this revision has a null source, which all three
CHECKs accept, so the validation can find nothing. Each transactional group of
``ALTER``s (the upgrade's first, the downgrade's last) runs under
``SET LOCAL lock_timeout = '3s'``, so a long reader makes the migration fail
fast instead of queueing every writer behind an ``ACCESS EXCLUSIVE`` request.
``env.py`` resets the bound after each revision. Nothing inside
``autocommit_block`` is bounded: the ``SET LOCAL`` ended with the transaction
the block committed.

The existence test reads the name and the kind, not the body: a CHECK of that
name with another body is kept as it is, and a constraint of that name that is
not a CHECK makes the ADD fail loudly. Only a hand-made constraint can be
either, since no version of this revision has added a different body.

``upgrade`` removes nothing: every drop is in ``downgrade``. That is what lets
coord's alembic re-point move this revision onto a newer main head when main
gains a revision first (its E6 clause refuses to re-order a revision that drops
anything outside ``downgrade``, and this one once did, by dropping each CHECK
before re-adding it).

coord's migration classifier does NOT prove this revision additive, and this
docstring used to claim it did: the dollar-quoted blocks below (the
existence-checked CHECKs and the invalid-index check) and ``VALIDATE
CONSTRAINT`` are outside the forms it admits (it fails closed on each), so a
PR carrying this revision is held on coord's migrations escalate path until
reviewed.

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
down_revision: str | Sequence[str] | None = "coord_policy_outcome_counts_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _add_check_not_valid(name: str, check: str) -> None:
    """Add CHECK ``name`` to ``overview.pages`` NOT VALID, unless the table
    already has a CHECK of that name.

    PostgreSQL has no ``ADD CONSTRAINT IF NOT EXISTS``, and a partial upgrade
    may already have committed this one, so ``pg_constraint`` is read first.
    """
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                  FROM pg_constraint
                 WHERE conrelid = 'overview.pages'::regclass
                   AND conname = '{name}'
                   AND contype = 'c'
            ) THEN
                ALTER TABLE overview.pages
                    ADD CONSTRAINT {name} CHECK ({check}) NOT VALID;
            END IF;
        END
        $$
        """
    )


def upgrade() -> None:
    # Fail fast rather than queue an ACCESS EXCLUSIVE request in front of every
    # reader and writer of these tables; env.py resets it after this revision.
    op.execute("SET LOCAL lock_timeout = '3s'")
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
    # NOT VALID: no scan, enforced on every write from here.
    _add_check_not_valid(
        "ck_overview_pages_source_repo_lowercase",
        "source_repo IS NULL OR source_repo = lower(source_repo)",
    )
    _add_check_not_valid(
        "ck_overview_pages_source_pair",
        "(source_repo IS NULL) = (source_path IS NULL)",
    )
    _add_check_not_valid(
        "ck_overview_pages_source_sha_needs_source",
        "source_sha IS NULL OR source_repo IS NOT NULL",
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
    # The transaction autocommit_block reopened: bound its ALTERs' lock wait.
    op.execute("SET LOCAL lock_timeout = '3s'")
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
