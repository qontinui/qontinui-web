"""coord.worktree_census_latest + coord.worktree_census_history — census presence/history split

Revision ID: wtcensus_split_01_latest_and_history
Revises: coord_wu_authored_at_02
Create Date: 2026-09-25

Phase B of plan
``2026-09-25-worktree-census-presence-history-split-and-device-relative-freshness``
(design decisions D1-D3, D8).

## Why

``coord.worktree_census`` is an append-only oplog: the runner walks every
worktree each cycle and coord appends one row per worktree per walk. Measured
on 2026-09-25 (coord finding ``ce0fdb8e``), 92-99.9 % of those rows repeat the
same path's previous row in every column except ``head_age_secs``. Every
current-state reader then asks for "the latest row per ``(repo, path)``" with
``SELECT DISTINCT ON``, which Postgres answers by reading and sorting every
retained generation. That read is the one behind ``/coord/fleet/volumes`` that
hung coord on 2026-09-22.

This revision creates the two tables that replace it. It creates them EMPTY and
nothing writes them yet: the coord dual-write is Phase C, the reader flip Phase D,
the end of the legacy write Phase E, and the ``DROP TABLE coord.worktree_census``
Phase F (``wtcensus_split_02_drop_legacy_oplog``).

## ``coord.worktree_census_latest`` (D2): one row per ``(device_id, repo, path)``

Every census column of the legacy table (the ``CENSUS_COLS_FULL`` list in
qontinui-coord ``worktree_census.rs``, the same types, nullability and defaults as
``twin_07`` + ``twin_p6_01`` + ``twin_p6_02`` + ``twin_p7_03`` + ``runprov_01``
gave them), plus three clocks and **no** ``observed_at`` / ``id``:

* ``first_observed_at`` — the start of the current presence run. Reset when the
  path reappears after a gap longer than coord's presence window (D4).
* ``state_since`` — the start of the current state; equal to the open history
  interval's ``started_at``.
* ``last_observed_at`` — the latest walk: the clock of the ingest transaction
  that last wrote the row. Readers map the legacy ``observed_at`` to it.

None of the three has a default. The writer binds its one chunk clock into every
statement (D5), so a default ``now()`` could only ever fill a column the writer
forgot, and would do so with a plausible-looking wrong value.

``PRIMARY KEY (device_id, repo, path)`` is the table's ONLY index, and that is
the design, not an omission. Every per-walk update rewrites only unindexed
columns (``last_observed_at``, ``head_age_secs``, and on a change the tracked
columns), so Postgres can do a HOT update whenever the page has room, and
``WITH (fillfactor = 70)`` reserves that room. An index on ``last_observed_at``
in particular would turn every walk into an index write and undo the point of
the table. Every current-state read is a primary-key range scan
(``device_id = $1`` or ``= ANY($1)``) with no sort, because the key is unique.

## ``coord.worktree_census_history`` (D3): state intervals, written on change

``id BIGSERIAL`` primary key, the same census columns (the values at the START of
the state), ``started_at TIMESTAMPTZ NOT NULL`` and ``ended_at TIMESTAMPTZ``
(NULL = the interval is open; its end is then the latest row's
``last_observed_at``). A row is written only when a tracked column changes or a
path reappears after a gap. Three secondary indexes:

* ``uq_worktree_census_history_open_key`` — UNIQUE ``(device_id, repo, path)``
  ``WHERE ended_at IS NULL``: at most one open interval per key, enforced by the
  database. Two concurrent first sightings of one key collide here (23505) and
  the writer retries once.
* ``idx_worktree_census_history_key_started_at`` —
  ``(device_id, repo, path, started_at DESC)``, the as-of read ("latest interval
  per key starting at or before anchor A").
* ``idx_worktree_census_history_ended_at`` — ``(ended_at) WHERE ended_at IS NOT
  NULL``, the retention prune. Retention is keyed on interval END, never on
  start (an unchanged long-lived worktree has one old, open row), and an open
  interval is never pruned by age.

## Why two NEW tables rather than repurposing the oplog (D1)

The existing 200k rows are point observations, not intervals; the
one-open-interval invariant cannot be created on the old table, where every row
would read as open; and its four indexes were sized for 15k inserts per hour.
coord dual-writes for 24 h, so no backfill is needed, and the old table is then
dropped (Phase F).

## Two-repo ordering: this schema half lands and is APPLIED first

alembic in qontinui-web is the SOLE author of ``coord.*`` schema; the
qontinui-coord binary authors zero ``coord.*`` DDL. No coord code may name
either table, including coord DB tests (whose migrator pin must contain this
revision), until this revision has been applied in production and read back.

## Runner companion

qontinui-runner keeps an atlas exclude list (``atlas/exclude.txt``) and a
generated schema dump (``src-tauri/schema.pg.sql.generated``). The two tables and
``coord.worktree_census_history_id_seq`` must enter the exclude list, or the next
``atlas schema apply`` would try to DROP them. Neither heals itself: the nightly
jobs (``atlas-exclude-fresh.yml``, ``schema-pg-sql-freshness-nightly.yml``) only
open or update a refresh PR, and that PR has to LAND before ``exclude.txt``
covers ``coord.worktree_census_latest``, ``coord.worktree_census_history`` and
``coord.worktree_census_history_id_seq``. A refresh PR can stay open for days
(runner#1641 had been open since at least 2026-09-21 when this was written), so
until one lands an ``atlas schema apply`` would still try to DROP the new
tables. Running ``atlas/scripts/regen_exclude.ps1`` and
``regenerate_schema_pg_sql.sh`` by hand after this deploy, and landing the
result, closes that window sooner. No runner behaviour changes.

## Head choice

``down_revision`` is ``coord_wu_authored_at_02``, the single head of
``origin/main`` when this revision was written (``scripts/ci/count_alembic_heads.py``
reported ``HEAD_COUNT=1``). If main moves before this lands, re-point
``down_revision``, the ``Revises:`` header and ``_PARENT_REVISION_ID`` in
``tests/test_wtcensus_split_01_migration.py`` at the new single head. Do not add
an ``alembic merge``.

## Safety

Both tables are new and empty, so the plain ``CREATE INDEX`` statements in the
same transaction take no lock anyone else waits on, and no ``CONCURRENTLY`` or
autocommit block is needed. Every statement is ``IF NOT EXISTS`` (or a
re-runnable ``COMMENT ON``), so a partial apply re-runs cleanly. No existing
table is touched. Both directions bound lock waits with
``SET LOCAL lock_timeout = '3s'`` and reset it to ``DEFAULT`` as their last
statement, because env.py runs a whole batch in one transaction and a
``SET LOCAL`` that is not reset would bound every later revision in the batch
too.

``downgrade()`` drops both tables (their indexes, sequence and comments go with
them). It is safe only while no deployed coord reads or writes them, which is
true until Phase C deploys. Both directions are static SQL literals with no bind
or inspection, so they work under ``alembic ... --sql`` offline mode.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "wtcensus_split_01_latest_and_history"
down_revision: str | Sequence[str] | None = "coord_wu_authored_at_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every SQL string below is a STATIC literal. The coord merge-train migration
# classifier extracts string literals from each execute call and rejects a call
# with none as dynamic. These comments also avoid apostrophes and the
# op-dot-call spelling, following the sibling coord revisions.


def upgrade() -> None:
    """Create the census latest and history tables, their indexes and comments."""
    op.execute("SET LOCAL lock_timeout = '3s'")

    # One row per (device_id, repo, path), updated in place on every walk.
    # The primary key is the ONLY index: every per-walk update then rewrites
    # unindexed columns alone and can be a HOT update, for which fillfactor 70
    # keeps room on the page.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.worktree_census_latest (
            device_id                  UUID NOT NULL,
            tenant_id                  UUID,
            repo                       TEXT NOT NULL,
            path                       TEXT NOT NULL,
            branch                     TEXT,
            head_sha                   TEXT,
            head_age_secs              BIGINT,
            is_dirty                   BOOLEAN NOT NULL DEFAULT false,
            nm_present                 BOOLEAN NOT NULL DEFAULT false,
            nm_is_junction             BOOLEAN NOT NULL DEFAULT false,
            nm_bytes                   BIGINT NOT NULL DEFAULT 0,
            target_present             BOOLEAN NOT NULL DEFAULT false,
            target_is_junction         BOOLEAN NOT NULL DEFAULT false,
            target_bytes               BIGINT NOT NULL DEFAULT 0,
            last_access_mtime          TIMESTAMPTZ,
            attributable_bytes         BIGINT NOT NULL DEFAULT 0,
            landed_in_main             BOOLEAN,
            building                   BOOLEAN,
            canonical_current_branch   TEXT,
            canonical_is_dirty         BOOLEAN,
            canonical_base_divergence  TEXT,
            build_target_dir           TEXT,
            build_slot                 TEXT,
            first_observed_at          TIMESTAMPTZ NOT NULL,
            state_since                TIMESTAMPTZ NOT NULL,
            last_observed_at           TIMESTAMPTZ NOT NULL,
            CONSTRAINT worktree_census_latest_pkey
                PRIMARY KEY (device_id, repo, path)
        ) WITH (fillfactor = 70)
        """
    )

    # State intervals, written only when a tracked column changes or a path
    # reappears after a gap. ended_at NULL means the interval is open.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.worktree_census_history (
            id                         BIGSERIAL,
            device_id                  UUID NOT NULL,
            tenant_id                  UUID,
            repo                       TEXT NOT NULL,
            path                       TEXT NOT NULL,
            branch                     TEXT,
            head_sha                   TEXT,
            head_age_secs              BIGINT,
            is_dirty                   BOOLEAN NOT NULL DEFAULT false,
            nm_present                 BOOLEAN NOT NULL DEFAULT false,
            nm_is_junction             BOOLEAN NOT NULL DEFAULT false,
            nm_bytes                   BIGINT NOT NULL DEFAULT 0,
            target_present             BOOLEAN NOT NULL DEFAULT false,
            target_is_junction         BOOLEAN NOT NULL DEFAULT false,
            target_bytes               BIGINT NOT NULL DEFAULT 0,
            last_access_mtime          TIMESTAMPTZ,
            attributable_bytes         BIGINT NOT NULL DEFAULT 0,
            landed_in_main             BOOLEAN,
            building                   BOOLEAN,
            canonical_current_branch   TEXT,
            canonical_is_dirty         BOOLEAN,
            canonical_base_divergence  TEXT,
            build_target_dir           TEXT,
            build_slot                 TEXT,
            started_at                 TIMESTAMPTZ NOT NULL,
            ended_at                   TIMESTAMPTZ,
            CONSTRAINT worktree_census_history_pkey PRIMARY KEY (id)
        )
        """
    )

    # At most one open interval per key, enforced by the database.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_worktree_census_history_open_key
            ON coord.worktree_census_history (device_id, repo, path)
            WHERE ended_at IS NULL
        """
    )
    # The as-of read: the latest interval per key starting at or before an anchor.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_worktree_census_history_key_started_at
            ON coord.worktree_census_history (device_id, repo, path, started_at DESC)
        """
    )
    # The retention prune, keyed on interval END. Open intervals are never pruned.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_worktree_census_history_ended_at
            ON coord.worktree_census_history (ended_at)
            WHERE ended_at IS NOT NULL
        """
    )

    op.execute(
        """
        COMMENT ON TABLE coord.worktree_census_latest IS
            'Current census state: one row per (device_id, repo, path), updated in place on every runner walk. The primary key is deliberately the only index, so a per-walk update rewrites unindexed columns alone and can be HOT (fillfactor 70). Do not index last_observed_at. Replaces the latest-per-key reads of the append-only coord.worktree_census oplog.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_census_latest.last_observed_at IS
            'When this path was last walked: the clock of the ingest transaction that last wrote the row, bumped by every observation whether or not anything changed. Readers map the legacy observed_at to this column. Unindexed on purpose.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_census_latest.first_observed_at IS
            'Start of the current presence run. Reset when the path reappears after a gap longer than the coord census presence window.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_census_latest.state_since IS
            'Start of the current state: equal to started_at of the open coord.worktree_census_history interval for this key.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.worktree_census_history IS
            'Census state intervals [started_at, ended_at], written only when a tracked column changes or a path reappears after a gap, carrying the values at the start of the state. At most one open interval (ended_at IS NULL) per (device_id, repo, path). Retention is keyed on ended_at; an open interval is never pruned by age.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_census_history.started_at IS
            'When this state was first observed: the ingest clock of the walk that opened the interval.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.worktree_census_history.ended_at IS
            'NULL while the interval is open, and its end is then last_observed_at of the matching coord.worktree_census_latest row. Set to the last walk of the old state when the state changes, when the path reappears after a gap, or when the latest row is pruned.'
        """
    )

    op.execute("SET LOCAL lock_timeout = DEFAULT")


def downgrade() -> None:
    """Drop both tables. Indexes, the id sequence and the comments go with them."""
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.execute("DROP TABLE IF EXISTS coord.worktree_census_history")
    op.execute("DROP TABLE IF EXISTS coord.worktree_census_latest")
    op.execute("SET LOCAL lock_timeout = DEFAULT")
