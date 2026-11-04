"""coord.dependency_census + coord.dependency_advisories — the dependency-advisory store

Revision ID: depcensus_01
Revises: ci_job_res_02
Create Date: 2026-11-04

Phase 3 of plan ``2026-11-02-rust-advisories-have-no-fleet-consumer``.

Two new, empty tables. Today no fleet consumer holds the result of a
``cargo audit`` run anywhere durable. Findings cannot hold it: they expire after
about 14 days, ``supersedes`` means correction, and dedup ignores it, so an
advisory with no fix would vanish after two weeks. This is the store the census
(plan Phase 2) and the steward (plan Phase 4) write, and that coord's
``POST``/``GET /coord/dependency-advisories`` (plan Phase 3, coord half) serves.

## coord.dependency_census — one row per (tenant, repo, ecosystem)

The latest census of one repo's lockfile. A repo with no row has never been
censused, and a reader shows that as UNKNOWN, never as clean.

* ``state`` is closed to ``clean`` / ``vulnerable`` / ``not_applicable`` /
  ``unknown`` by ``ck_dependency_census_state``. ``unknown`` is a real row: a
  census that ran but could not read the repo (no ``cargo-audit`` on the box,
  an unproven owner) writes ``unknown`` with a ``reason``, so a stale or failed
  census stays visible instead of reading as an absence.
* ``sha`` is the ``origin/main`` commit audited and ``db_commit`` the
  advisory-db commit it was read against. Both are NULL when the census could
  not establish them (an ``unknown`` row).
* ``advisory_count`` defaults to 0. Read it with ``state``: 0 on an ``unknown``
  row means "not counted", not "none found".
* ``ecosystem`` is ``rust`` today and carries no CHECK, so npm and pip can join
  without a migration; coord validates it at ingest.
* ``tenant_id`` carries no foreign key, as most recent ``coord.*`` tables
  (``launch_ledger``, ``ops_tasks``, ``session_runs``): coord scopes every read
  and write by the credential's tenant.

## coord.dependency_advisories — one row per advisory per package per repo

Keyed ``(tenant_id, repo, ecosystem, advisory_id, package)``. One advisory can
hit several crates, and re-observing a hit updates its row in place rather than
adding one.

* ``version`` is the version currently in the lock, rewritten on every
  re-observation; ``patched`` is the advisory's patched ranges verbatim (an
  empty array means no fix is published).
* ``first_seen_at`` / ``last_seen_at`` bracket the observations.
  ``resolved_at`` is set when a census that READ the repo no longer sees the
  hit; an ``unknown`` census resolves nothing. A hit that reappears clears it.
* ``ignored`` records that the repo's ``.cargo/audit.toml`` ignores the
  advisory. The row stays, so an accepted advisory is still visible.
* ``ix_dependency_advisories_tenant_open`` is a PARTIAL index on
  ``(tenant_id) WHERE resolved_at IS NULL``: it serves the open-advisory read
  and holds only open rows, so resolved history does not grow it.

``dependency_census.updated_at`` defaults to ``now()`` on insert but has NO
trigger: coord, the only writer, sets it explicitly on every upsert (its column
comment says so), so a stale ``updated_at`` means coord did not write the row.

## Head choice

``down_revision`` is the repo's single alembic head on ``origin/main`` at
authoring time (``scripts/ci/count_alembic_heads.py``: ``HEAD_COUNT=1``,
``HEAD=ci_job_res_02``, ``5b2803fb5``). coord re-points it at land time if a
sibling lands first; the companion test reads it at runtime.

## Two-repo ordering — this schema half lands FIRST

alembic in qontinui-web is the SOLE author of ``coord.*`` schema (served policy
``production-and-cost`` ``alembic-sole-authorship``). The coord route that reads
and writes these tables merges only after this migration is at head on
production (plan Phase 3 gate). Hand-authored; ``--autogenerate`` is never run
against ``coord.*``.

## Safety

Additive: two ``CREATE TABLE IF NOT EXISTS`` on new names, one partial index on
a table this file creates, and ``COMMENT ON``. No existing table is touched, so there
is no lock on a hot table and nothing to backfill. The ``coord_tenant`` roles
receive their privileges through ``coordrls_01``'s default privileges.
``downgrade`` drops only what ``upgrade`` created.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "depcensus_01"
down_revision: str | Sequence[str] | None = "ci_job_res_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create both tables, the open-advisory index, and document them. No rows."""
    op.execute("CREATE SCHEMA IF NOT EXISTS coord")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.dependency_census (
            tenant_id       UUID NOT NULL,
            repo            TEXT NOT NULL,
            ecosystem       TEXT NOT NULL,
            sha             TEXT NULL,
            db_commit       TEXT NULL,
            state           TEXT NOT NULL,
            reason          TEXT NULL,
            advisory_count  INTEGER NOT NULL DEFAULT 0,
            observed_at     TIMESTAMPTZ NOT NULL,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT dependency_census_pkey
                PRIMARY KEY (tenant_id, repo, ecosystem),
            CONSTRAINT ck_dependency_census_state
                CHECK (state IN ('clean', 'vulnerable', 'not_applicable', 'unknown'))
        )
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS coord.dependency_advisories (
            tenant_id       UUID NOT NULL,
            repo            TEXT NOT NULL,
            ecosystem       TEXT NOT NULL,
            advisory_id     TEXT NOT NULL,
            package         TEXT NOT NULL,
            version         TEXT NOT NULL,
            patched         TEXT[] NOT NULL DEFAULT '{}',
            severity        TEXT NULL,
            ignored         BOOLEAN NOT NULL DEFAULT false,
            first_seen_at   TIMESTAMPTZ NOT NULL,
            last_seen_at    TIMESTAMPTZ NOT NULL,
            resolved_at     TIMESTAMPTZ NULL,
            CONSTRAINT dependency_advisories_pkey
                PRIMARY KEY (tenant_id, repo, ecosystem, advisory_id, package)
        )
        """
    )
    # The open-advisory read: WHERE tenant_id = $1 AND resolved_at IS NULL.
    # Partial, so only open rows are indexed and resolved history never grows it.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_dependency_advisories_tenant_open
            ON coord.dependency_advisories (tenant_id)
            WHERE resolved_at IS NULL
        """
    )

    # Document both tables. Each statement is a complete static literal.
    op.execute(
        """
        COMMENT ON TABLE coord.dependency_census IS
            'The latest dependency-advisory census of one repo lockfile, one row per (tenant, repo, ecosystem). A repo with no row was never censused and reads UNKNOWN, never clean. Plan 2026-11-02-rust-advisories-have-no-fleet-consumer.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_census.state IS
            'clean | vulnerable | not_applicable | unknown. unknown = the census ran but could not read the repo (see reason); it is a real row, not an absence.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_census.sha IS
            'The origin/main commit whose lockfile was audited. NULL = not established (an unknown census).'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_census.db_commit IS
            'The advisory-db commit the audit was read against, so two censuses of one sha are comparable. NULL = not established.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_census.advisory_count IS
            'Open advisories this census saw. 0 on an unknown row means not counted, not none found: read it with state.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_census.updated_at IS
            'When coord last wrote this row. No trigger maintains it: the writer (coord) sets it explicitly on every upsert; the now() default covers the first insert only.'
        """
    )
    op.execute(
        """
        COMMENT ON TABLE coord.dependency_advisories IS
            'One row per advisory per package per repo lockfile, updated in place on re-observation. resolved_at IS NULL = still open. Plan 2026-11-02-rust-advisories-have-no-fleet-consumer.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_advisories.version IS
            'The version currently in the lock, rewritten on every re-observation.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_advisories.patched IS
            'The advisory patched version ranges, verbatim. Empty = no fix is published.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_advisories.ignored IS
            'true = the repo audit config ignores this advisory. The row stays, so an accepted advisory is still visible.'
        """
    )
    op.execute(
        """
        COMMENT ON COLUMN coord.dependency_advisories.resolved_at IS
            'Set when a census that READ the repo no longer sees the hit; an unknown census resolves nothing. Cleared if the hit reappears.'
        """
    )


def downgrade() -> None:
    """Drop both tables; the partial open-advisory index and every constraint go
    with them."""
    op.execute("DROP TABLE IF EXISTS coord.dependency_advisories")
    op.execute("DROP TABLE IF EXISTS coord.dependency_census")
