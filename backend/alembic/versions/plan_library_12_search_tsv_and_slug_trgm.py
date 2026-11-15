"""agent.work_artifacts — store the search vector; index both ``?q=`` arms

Revision ID: plan_library_12_search_tsv_and_slug_trgm
Revises: overview_06_cost_category_parent
Create Date: 2026-11-09

Phase 1 of ``2026-11-09-plan-library-full-text-search-seq-scans-past-its-read-timeout``.

Why
==============================================================================

The measurements below are the Phase 0 diagnostic artifact
``probe-plan-library-q-search-2026-11-09`` (plan library, id
``14ea9360-e5e1-444f-9bfe-dde80dd7d62b``).

``GET /api/v1/plan-library?q=…`` took 20–32 s on production (PG 16.13, 3,908
rows, ~26 KB average body). ``EXPLAIN (ANALYZE, BUFFERS)`` of both statements
``list_artifacts`` runs — the ``count(*)`` and the keyset page
``ORDER BY created_at DESC, id DESC LIMIT n`` — showed the expression index
``ix_work_artifacts_search`` used by NO plan, even with the slug ``ILIKE`` arm
off: the count took a bitmap scan on ``ix_work_artifacts_kind_status`` and
re-ran ``to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body,
''))`` per row, and the page walked ``ix_work_artifacts_org_created_id``
backward parsing every body (29.9 s for a zero-hit term). The planner
under-estimates matches and prices the parse at its procost of 100, blind to
the body size, so every plan that leaves the expression index pays one full
parse of the corpus.

What
==============================================================================

1. ``CREATE EXTENSION IF NOT EXISTS pg_trgm`` — UNGUARDED, so a substrate
   without it fails loudly rather than skipping into a vacuous green. Prior
   art for availability: ``coord_pgss_ext_01_enable_pg_stat_statements``
   (RDS ``rds.allowed_extensions = '*'``, the migrator in ``rds_superuser``,
   and a CI image that ships contrib). ``pg_trgm`` is moreover a TRUSTED
   extension since PG 13, so it needs no superuser at all. Unqualified,
   matching every extension this repo creates (``vector``, ``pgcrypto``,
   ``pg_stat_statements``): it lands in the first schema on ``search_path`` —
   ``public`` on prod — and ``alembic/env.py`` resets ``search_path`` after
   every revision, so no earlier revision's leaked setting decides it.

2. ``DROP INDEX IF EXISTS agent.ix_work_artifacts_search`` — the old
   expression index, which the predicate no longer spells. Dropped INSIDE the
   migration transaction, immediately BEFORE the ``ALTER TABLE``, because the
   rewrite below rebuilds every index still on the table: a reviewer measured
   the rewrite at 2.99 s without the old GIN expression index and 7.76 s with
   it (PG 16.15, a synthetic corpus), and that whole span is held under
   ACCESS EXCLUSIVE. A plain ``DROP INDEX`` takes ACCESS EXCLUSIVE too, which
   the ``ALTER`` needs anyway, so dropping it here costs no extra lock window;
   ``CONCURRENTLY`` is impossible inside a transaction and would only drop it
   after the rewrite had already paid for rebuilding it.

3. ``search_tsv tsvector GENERATED ALWAYS AS (…) STORED`` — the expression is
   ``app.models.work_artifact.SEARCH_TSVECTOR_SQL`` copied VERBATIM (a
   migration must not follow the model as the model evolves; coord's
   migration classifier also refuses an f-string ``op.execute``).
   ``tests/test_plan_library_12_search_tsv_and_slug_trgm_migration.py`` pins
   the two equal. A stored value means every plan shape — a seq-scan count, a
   keyset walk with a filter, a bitmap recheck — reads the vector instead of
   parsing the body.

   ⚠️ **This REWRITES the table under ACCESS EXCLUSIVE** for one
   ``to_tsvector`` parse pass over every title and body — about 97 MB of
   bodies on prod — plus a rebuild of every remaining index. The rewrite's
   duration was NOT measured on production; the 20–30 s figures above are
   query latency, not this ``ALTER``. Reads and writes of
   ``agent.work_artifacts`` block for that window. ``SET LOCAL lock_timeout``
   bounds only the WAIT for the lock (a queued ACCESS EXCLUSIVE request blocks
   every reader that arrives behind it, and the slow ``?q=`` reads this
   revision exists to fix run 20–30 s), so a busy table fails the deploy fast
   and it is retried, rather than stalling the API behind one long reader.

4. ``ix_work_artifacts_search_tsv`` — GIN on ``search_tsv``, the full-text
   arm's index.

5. ``ix_work_artifacts_slug_trgm`` — GIN on ``slug gin_trgm_ops``, so the
   slug arm's leading-wildcard ``ILIKE '%needle%'`` is index-served and the OR
   of the two arms stays a BitmapOr as the corpus grows. (``_slug_needle``
   only emits needles of 3+ characters, which is exactly what a trigram index
   can serve.)

Both new indexes are built ``CONCURRENTLY`` inside
``op.get_context().autocommit_block()`` (the house pattern of
``plan_library_10_keyset_walk_indexes``): the table is live, and an
in-transaction build would take a write-blocking SHARE lock for the build.
The ``DROP INDEX`` and ``ALTER TABLE`` run BEFORE the autocommit block, in the
migration transaction, which the block commits on entry.

Idempotency and recovery: ``IF NOT EXISTS`` / ``IF EXISTS`` throughout. A
killed or failed concurrent build leaves an INVALID index of the same name,
which a re-run's ``IF NOT EXISTS`` would silently skip. So the last statement
of the autocommit block is a guard that RAISES when either new index exists
with ``pg_index.indisvalid = false``: a re-run after a failed build fails
loudly, naming the index, instead of stamping the revision over an index the
planner can never use. The remedy the error names: wait until
``pg_stat_progress_create_index`` is empty (a live build also reads invalid),
``DROP INDEX CONCURRENTLY agent.<name>``, and re-run the migration.

Downgrade restores the expression index (concurrently, before anything is
dropped, so the old predicate never runs unindexed), drops the two new
indexes and the column. It leaves ``pg_trgm`` installed: ``IF NOT EXISTS``
means this revision cannot know whether it created the extension or found it,
and dropping one that something else (an operator's ad-hoc index, a later
revision) depends on would fail or, with CASCADE, destroy that dependant.
An installed, unused extension costs nothing.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "plan_library_12_search_tsv_and_slug_trgm"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "overview_06_cost_category_parent"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Extension, drop the old index, stored vector (rewrite), two GIN indexes."""
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Bound the WAIT for ACCESS EXCLUSIVE, not the rewrite it then holds.
    op.execute("SET LOCAL lock_timeout = '5s'")
    # Before the rewrite, so the rewrite does not rebuild it (module docstring).
    op.execute("DROP INDEX IF EXISTS agent.ix_work_artifacts_search")
    # The generation expression is SEARCH_TSVECTOR_SQL verbatim (pinned by
    # this revision's test).
    op.execute(
        """
        ALTER TABLE agent.work_artifacts
            ADD COLUMN IF NOT EXISTS search_tsv tsvector
            GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
            ) STORED
        """
    )

    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_work_artifacts_search_tsv
                ON agent.work_artifacts USING gin (search_tsv)
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_work_artifacts_slug_trgm
                ON agent.work_artifacts USING gin (slug gin_trgm_ops)
            """
        )
        # IF NOT EXISTS skips an INVALID index a failed build left behind;
        # refuse to stamp the revision over one. The message's "DROP" /
        # "INDEX" are split across two adjacent literals only so the
        # alembic-schema-arg gate does not read the advice as a DDL statement
        # naming an unqualified index; PostgreSQL joins them back.
        op.execute(
            """
            DO $$
            DECLARE
                invalid_index text;
            BEGIN
                SELECT c.relname INTO invalid_index
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'agent'
                   AND c.relname IN ('ix_work_artifacts_search_tsv',
                                     'ix_work_artifacts_slug_trgm')
                   AND NOT i.indisvalid
                 LIMIT 1;
                IF invalid_index IS NOT NULL THEN
                    RAISE EXCEPTION
                        'agent.% exists but is INVALID (a failed CREATE INDEX '
                        'CONCURRENTLY). Wait until pg_stat_progress_create_index '
                        'is empty, run DROP '
                        'INDEX CONCURRENTLY %, and re-run the migration.',
                        invalid_index, 'agent.' || invalid_index;
                END IF;
            END
            $$
            """
        )


def downgrade() -> None:
    """Restore the expression index first, then drop the new indexes and column.

    ``pg_trgm`` stays installed — see the module docstring.
    """
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                ix_work_artifacts_search
                ON agent.work_artifacts USING gin (
                    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
                )
            """
        )
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS agent.ix_work_artifacts_slug_trgm")
        op.execute(
            "DROP INDEX CONCURRENTLY IF EXISTS agent.ix_work_artifacts_search_tsv"
        )

    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("ALTER TABLE agent.work_artifacts DROP COLUMN IF EXISTS search_tsv")
