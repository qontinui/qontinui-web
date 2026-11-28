"""coord Regression Tests store — group kinds, ingest sources, check references, run builds and branches

Revision ID: coord_conditions_04_kinds_and_builds
Revises: overview_07_schedule_last_known
Create Date: 2026-11-26

Phase 9 of plan
``2026-11-26-acceptance-results-are-not-kept-and-the-regression-tests-page-has-no-role-beside-ci``
(its D1, D3 and D11).

The Regression Tests store (``coord.condition_groups``, ``coord.conditions``,
``coord.condition_runs``) becomes the one store for every check of what must
always be true of a tenant's product, over time. A ``kind`` per group says how
its checks are judged and where its results come from, an ingested group names
the source its results are read from, a check carries the reference its source
knows it by, and every run records the build it judged and the branch it ran
on. No build reads or writes any of this yet: coord's spec-ci ingester (plan
Phase 10) and its read core (plan Phase 12) do, and each waits on a
``schema_object_exists`` gate for this revision. Alembic is the sole author of
``coord.*`` DDL until the coord-schema cut-over lands (served policy
``production-and-cost`` ``alembic-sole-authorship`` and
``coord-schema-moves-to-the-coord-repo``; that plan's Phases 6.1-6.3 are open,
so this revision is authored here).

What it adds
============

``coord.condition_groups``

* ``kind`` TEXT NOT NULL DEFAULT ``'judged'`` -- one of ``judged``,
  ``deployed-watch``, ``ingested-spec`` (CHECK ``ck_condition_groups_kind``).
  Every existing group is a model-judged, dispatched group, so ``judged`` is
  true of every existing row; the default is a constant, so PostgreSQL stores
  it once in the catalogue and rewrites no row.
* ``ingest_source`` JSONB NULL -- where an ingested group's results are read
  from. ``ck_condition_groups_ingested_spec_requires_source``: an
  ``ingested-spec`` group must name one. ``ck_condition_groups_judged_forbids_source``:
  a ``judged`` group must not.
* ``ingest_state`` JSONB NULL -- the ingester's listing state (``listed_at``,
  ``unread_since``, ``last_error``). NULL means never listed, which a reader
  shows as UNKNOWN (served policy ``verification-and-evidence``
  ``unknown-must-not-render-as-a-default``).

``coord.conditions``

* ``external_ref`` TEXT NULL -- the check's id at its source (an AC id for a
  spec), unique per group where set (``uq_conditions_group_external_ref``,
  partial).
* ``parent_ref`` TEXT NULL -- the requirement the check belongs to (a REQ id),
  indexed per tenant (``idx_conditions_tenant_parent_ref``) for the trace view.

``coord.condition_runs``

* ``build_sha`` TEXT NULL -- the build the run judged. NULL is "unknown",
  never "latest" (plan D11).
* ``build_sha_basis`` TEXT NULL -- how that sha was learned: ``ci_head_sha``,
  ``dispatch_input``, ``session_report`` or ``agent_reported``
  (CHECK ``ck_condition_runs_build_sha_basis``; NULL allowed).
* ``source_ref`` TEXT NULL -- the source run attempt an ingested run was read
  from (``gh:<run>/<attempt>/<job>``), unique per group where set
  (``uq_condition_runs_group_source_ref``, partial), so ingesting the same
  attempt twice is a no-op.
* ``source_git_ref`` TEXT NULL -- the branch the run ran on, indexed with its
  group (``idx_condition_runs_group_source_git_ref``) so "the latest result on
  ``main``" is a read of this column, never of the sha alone (plan D3).

The text each run checked goes in the existing ``coverage`` column (plan D1),
so no column is added for it.

Ordering
========

1. Every ``ADD COLUMN IF NOT EXISTS`` commits first, under a bounded lock
   wait. Each is catalogue-only: nullable with no default, or ``kind``'s
   ``NOT NULL`` with a constant default.
2. The four indexes are built ``CONCURRENTLY IF NOT EXISTS`` inside
   ``autocommit_block()``, so the ALTERs' ACCESS EXCLUSIVE lock is released
   before any scan and no writer is blocked by a build.
3. The four CHECKs are added ``NOT VALID`` in the fresh transaction that also
   stamps the alembic version, so a partial run never leaves one committed
   without the stamp. ``NOT VALID`` skips a scan that could find nothing:
   every existing group holds ``kind = 'judged'`` and a NULL source, and every
   existing run a NULL basis. Every row written from now on is checked either
   way. PostgreSQL cannot guard ``ADD CONSTRAINT`` with ``IF NOT EXISTS``, so
   re-running a COMPLETED upgrade is not supported; alembic never does that.

The downgrade drops all of it again in reverse order, in one transaction.

INVALID-index limit: a ``CONCURRENTLY`` build runs outside the migration
transaction, where no ``lock_timeout`` applies, and a build that fails partway
can leave an INVALID index that a re-run's ``IF NOT EXISTS`` then skips. For
the two plain indexes that is slow, not wrong. For the two partial UNIQUE
indexes it is NOT safe: a build cancelled before PostgreSQL marks the index
ready leaves ``indisready = false``, an index that is never written to and so
enforces nothing, and the re-run skips it silently (measured on postgres 16
during review). Only an index with ``indisready = true`` enforces uniqueness.
After any interrupted upgrade, check
``SELECT indexrelid::regclass, indisvalid, indisready FROM pg_index WHERE
indexrelid IN ('coord.uq_condition_runs_group_source_ref'::regclass,
'coord.uq_conditions_group_external_ref'::regclass)`` and, when either flag is
false, ``DROP INDEX CONCURRENTLY coord.<name>`` and re-run. The migration makes
no such check itself because coord's migration classifier rejects SQL executed
through ``op.get_bind()``.

Merge-train classifier disposition
==================================

coord's migration classifier (``pr_merge/migration_classifier.rs``) admits:
``SET LOCAL lock_timeout``; each ``ALTER TABLE ... ADD COLUMN IF NOT EXISTS``
(nullable with no default, or ``NOT NULL`` with exactly one constant non-NULL
literal default); each ``CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS``
inside ``autocommit_block()``; and each ``ADD CONSTRAINT ... NOT VALID``.
``downgrade()`` is outside the path it classifies, and outside
``scripts/ci/check_coord_column_drops.py``'s scan. Every statement is a plain
literal naming the ``coord`` schema (the ``alembic-schema-arg-gate`` hook).

Head choice
===========

``down_revision`` is the single head of web ``main`` at authoring
(``poetry run alembic heads``). The PR re-chains it onto the single head
``main`` has when it opens and after every rebase (the honest-runs plan's
``coord_conditions_03_run_status_vocabulary`` may land first), moving the
``Revises:`` line above with it. The companion test reads the parent from this
file, so it follows a re-chain.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "coord_conditions_04_kinds_and_builds"
# One line, unannotated — see plan_library_06_scan_root_slug_census for why a
# wrapped down_revision blocks coord deploys.
down_revision = "overview_07_schedule_last_known"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the columns, then build the indexes, then add the NOT VALID CHECKs."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # 1. Columns. Each is catalogue-only; IF NOT EXISTS makes a re-run of this
    #    committed step a no-op.
    op.execute(
        """
        ALTER TABLE coord.condition_groups
            ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'judged'
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_groups
            ADD COLUMN IF NOT EXISTS ingest_source JSONB
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_groups
            ADD COLUMN IF NOT EXISTS ingest_state JSONB
        """
    )
    op.execute(
        """
        ALTER TABLE coord.conditions
            ADD COLUMN IF NOT EXISTS external_ref TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.conditions
            ADD COLUMN IF NOT EXISTS parent_ref TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_runs
            ADD COLUMN IF NOT EXISTS build_sha TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_runs
            ADD COLUMN IF NOT EXISTS build_sha_basis TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_runs
            ADD COLUMN IF NOT EXISTS source_ref TEXT
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_runs
            ADD COLUMN IF NOT EXISTS source_git_ref TEXT
        """
    )

    # 2. Indexes, CONCURRENTLY: autocommit_block() commits the ALTERs above
    #    first, so their ACCESS EXCLUSIVE lock is gone before any scan.
    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_conditions_group_external_ref
                ON coord.conditions (group_id, external_ref)
                WHERE external_ref IS NOT NULL
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_conditions_tenant_parent_ref
                ON coord.conditions (tenant_id, parent_ref)
            """
        )
        op.execute(
            """
            CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
                uq_condition_runs_group_source_ref
                ON coord.condition_runs (group_id, source_ref)
                WHERE source_ref IS NOT NULL
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS
                idx_condition_runs_group_source_git_ref
                ON coord.condition_runs (group_id, source_git_ref)
            """
        )

    # 3. CHECKs, NOT VALID, in the transaction that stamps the version. Every
    #    existing row satisfies each one by construction (module docstring).
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute(
        """
        ALTER TABLE coord.condition_groups
            ADD CONSTRAINT ck_condition_groups_kind
            CHECK (kind IN ('judged', 'deployed-watch', 'ingested-spec')) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_groups
            ADD CONSTRAINT ck_condition_groups_ingested_spec_requires_source
            CHECK (kind <> 'ingested-spec' OR ingest_source IS NOT NULL) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_groups
            ADD CONSTRAINT ck_condition_groups_judged_forbids_source
            CHECK (kind <> 'judged' OR ingest_source IS NULL) NOT VALID
        """
    )
    op.execute(
        """
        ALTER TABLE coord.condition_runs
            ADD CONSTRAINT ck_condition_runs_build_sha_basis
            CHECK (
                build_sha_basis IS NULL
                OR build_sha_basis IN
                    ('ci_head_sha', 'dispatch_input', 'session_report', 'agent_reported')
            ) NOT VALID
        """
    )


def downgrade() -> None:
    """Drop the CHECKs, the indexes and the columns, in reverse order, in ONE transaction.

    One transaction, so a failed downgrade (say, the 3s lock timeout) rolls
    back completely and leaves every object of this revision in place. A
    ``DROP INDEX CONCURRENTLY`` would have to commit on its own and buys
    nothing, because ``DROP COLUMN`` takes ACCESS EXCLUSIVE regardless.

    Data lost: every group's kind, source and listing state, every check's
    references, and every run's build, basis, source and branch.
    """
    op.execute("SET LOCAL lock_timeout = '3s'")

    op.execute(
        "ALTER TABLE coord.condition_runs "
        "DROP CONSTRAINT IF EXISTS ck_condition_runs_build_sha_basis"
    )
    op.execute(
        "ALTER TABLE coord.condition_groups "
        "DROP CONSTRAINT IF EXISTS ck_condition_groups_judged_forbids_source"
    )
    op.execute(
        "ALTER TABLE coord.condition_groups "
        "DROP CONSTRAINT IF EXISTS ck_condition_groups_ingested_spec_requires_source"
    )
    op.execute(
        "ALTER TABLE coord.condition_groups "
        "DROP CONSTRAINT IF EXISTS ck_condition_groups_kind"
    )

    op.execute("DROP INDEX IF EXISTS coord.idx_condition_runs_group_source_git_ref")
    op.execute("DROP INDEX IF EXISTS coord.uq_condition_runs_group_source_ref")
    op.execute("DROP INDEX IF EXISTS coord.idx_conditions_tenant_parent_ref")
    op.execute("DROP INDEX IF EXISTS coord.uq_conditions_group_external_ref")

    op.execute("ALTER TABLE coord.condition_runs DROP COLUMN IF EXISTS source_git_ref")
    op.execute("ALTER TABLE coord.condition_runs DROP COLUMN IF EXISTS source_ref")
    op.execute("ALTER TABLE coord.condition_runs DROP COLUMN IF EXISTS build_sha_basis")
    op.execute("ALTER TABLE coord.condition_runs DROP COLUMN IF EXISTS build_sha")
    op.execute("ALTER TABLE coord.conditions DROP COLUMN IF EXISTS parent_ref")
    op.execute("ALTER TABLE coord.conditions DROP COLUMN IF EXISTS external_ref")
    op.execute("ALTER TABLE coord.condition_groups DROP COLUMN IF EXISTS ingest_state")
    op.execute("ALTER TABLE coord.condition_groups DROP COLUMN IF EXISTS ingest_source")
    op.execute("ALTER TABLE coord.condition_groups DROP COLUMN IF EXISTS kind")
