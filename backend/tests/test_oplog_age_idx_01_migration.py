"""Behaviour test for ``oplog_age_idx_01`` — six bare age indexes.

Plan: ``2026-09-02-bare-age-indexes-for-the-six-unindexed-observation-oplogs``.

``migration-reversal.yml`` proves the revision's statements *execute*. Executing
is not the contract. The contract is that the planner picks each new index for
the ONE statement it exists for — coord ``table_retention``'s batch subquery —
and that it does so because the age column now LEADS an index, which no
pre-existing index on these six tables provided.

What is asserted
================

1. **The revision adds; it does not replace.** At the parent revision none of
   the six new indexes exist and every pre-existing composite does. If a
   composite had vanished, the premise of the whole plan ("the age column is
   never the leading column") would have moved and this test would be measuring
   nothing.

2. **All six exist, are ``indisvalid``, and are ASCENDING single-column
   indexes on the right column.** Validity is checked explicitly because a
   killed ``CONCURRENTLY`` build leaves an INVALID index of the same name that
   ``CREATE INDEX ... IF NOT EXISTS`` silently skips on re-run — "exists" would
   pass against an index that can never serve a query. The definition is pinned
   because ``error_observations``' age column is ``window_start``, not
   ``observed_at``: that single table is the one place a plausible-looking
   copy-paste produces six indexes of which one is useless.

3. **The prune subquery becomes an ordered index scan with NO Sort node.**
   Transcribed from ``qontinui-coord`` ``crates/coord/src/table_retention.rs``
   ``prune_sql``, which renders every registered table's batch selection.

4. **The negative case: at the parent revision the same subquery needs a Sort.**
   Run against the same seeded rows with only the pre-existing composite
   available. Without this, assertion 3 would pass just as happily against a
   composite that already served the query, and the test would not be measuring
   the leading-column claim at all — which is the plan's entire argument.

5. **Downgrade removes exactly the six.** Every pre-existing composite, every
   table and every row survives.

Why the seeder is introspective, and why it drops value constraints
===================================================================

The six tables were created by six unrelated revisions, three via raw SQL and
three via ``op.create_table``, and they share no column shape beyond the age
column. Hard-coding six INSERT statements would encode six schemas this test
does not own and would break on any unrelated column addition. ``_seed_rows``
instead reads ``information_schema`` for the NOT NULL, defaultless,
non-generated columns and fills them by ``data_type``.

Rows exist here only to give ANALYZE something to measure — **no assertion reads
a value**. So ``_relax_value_constraints`` first drops the CHECK and FOREIGN KEY
constraints on the six tables in the throwaway database, which is what lets the
filler stay generic instead of encoding six enumerations of allowed strings.
Neither constraint kind participates in the plans being asserted: these are
single-table ordered scans with no join and no constraint-exclusion opportunity,
and the negative case in assertion 4 is measured on the SAME relaxed tables, so
any effect would cancel. The constraints themselves are covered by the
revisions that created them; a value-faithful fixture here would be misleading
precision, not extra rigour.

``enable_seqscan = off`` for the plan assertions
================================================

The fixture is small, so a sequential scan wins on cost regardless of index
quality — the same reason ``test_coord_obs_idx_01_migration`` does this.
Turning it off removes the cost question and leaves the one being asked: CAN
the planner satisfy this query's ordering from an index? If it cannot, no
penalty makes it possible — which is exactly how assertion 4 still discriminates
with sequential scans disabled: it shows a Sort anyway.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "oplog_age_idx_01"
_PARENT_REVISION_ID = "coord_agent_questions_audience_backfill"

# ``(new index, table, age column, the composite that already existed)``.
#
# The fourth element is the premise: on every one of these six tables the age
# column is the TRAILING column of a composite, so nothing could serve
# ``ORDER BY {age_col}`` before this revision.
_CASES: tuple[tuple[str, str, str, str], ...] = (
    (
        "idx_client_telemetry_observations_observed_at",
        "client_telemetry_observations",
        "observed_at",
        "idx_client_telemetry_observations_surface_origin_observed_at",
    ),
    (
        "idx_infra_health_observations_observed_at",
        "infra_health_observations",
        "observed_at",
        "idx_infra_health_observations_resource_observed_at",
    ),
    (
        "idx_memory_observations_observed_at",
        "memory_observations",
        "observed_at",
        "idx_memory_observations_tenant_observed",
    ),
    (
        "idx_memory_anchor_observations_observed_at",
        "memory_anchor_observations",
        "observed_at",
        "idx_memory_anchor_observations_tenant_observed",
    ),
    (
        "idx_origin_resolution_observations_observed_at",
        "origin_resolution_observations",
        "observed_at",
        "idx_origin_resolution_observations_domain_path_observed_at",
    ),
    (
        "idx_error_observations_window_start",
        "error_observations",
        "window_start",
        "idx_error_observations_surface_window",
    ),
)

_ROWS_PER_TABLE = 200


def _prune_batch_sql(table: str, age_col: str) -> str:
    """coord's batch subquery, transcribed from ``table_retention::prune_sql``.

    The real statement wraps this in ``DELETE ... WHERE {pk_col} IN (...)``; the
    subquery alone is what the index exists for and is what can be EXPLAINed
    without mutating the fixture. ``$1``/``$2`` become literals so EXPLAIN can
    plan it without bind parameters.

    ``id`` is hard-coded as the selected column because it is the primary key on
    all six of these tables. The projection is irrelevant to the plan being
    asserted — the index is chosen for the ``WHERE``/``ORDER BY`` pair, not for
    what is selected — so a table that renamed its key would fail here loudly
    rather than silently measure the wrong thing.
    """
    return (
        f"SELECT id FROM coord.{table} "
        f"WHERE {age_col} < now() - make_interval(days => 180) "
        f"ORDER BY {age_col} "
        f"LIMIT 5000"
    )


def _index_def(engine: Engine, index_name: str) -> str:
    """``pg_get_indexdef`` — the recorded column list AND their directions."""
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    "SELECT pg_get_indexdef(c.oid) FROM pg_class c WHERE c.relname = :n"
                ),
                {"n": index_name},
            ).scalar()
            or ""
        )


def _index_is_valid(engine: Engine, index_name: str) -> bool:
    """``indisvalid`` — a half-built CONCURRENTLY index exists but cannot serve."""
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :n
                    """
                ),
                {"n": index_name},
            ).scalar()
        )


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised — see the module docstring."""
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        return "\n".join(str(r[0]) for r in conn.execute(text(f"EXPLAIN {sql}")).all())


def _relax_value_constraints(engine: Engine, table: str) -> None:
    """Drop CHECK and FOREIGN KEY constraints on a throwaway table.

    See "Why the seeder is introspective" in the module docstring: the rows are
    statistics fodder, and neither constraint kind is visible to the plans this
    test asserts.
    """
    with engine.connect() as conn:
        names = [
            str(r[0])
            for r in conn.execute(
                text(
                    """
                    SELECT con.conname
                      FROM pg_constraint con
                      JOIN pg_class rel ON rel.oid = con.conrelid
                      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                     WHERE ns.nspname = 'coord'
                       AND rel.relname = :t
                       AND con.contype IN ('c', 'f')
                    """
                ),
                {"t": table},
            ).all()
        ]
    with engine.begin() as conn:
        for name in names:
            conn.execute(text(f'ALTER TABLE coord.{table} DROP CONSTRAINT "{name}"'))


def _enum_label(engine: Engine, udt_name: str) -> str | None:
    """The first label of an enum type, or None when it is not an enum."""
    with engine.connect() as conn:
        return conn.execute(
            text(
                """
                SELECT e.enumlabel
                  FROM pg_enum e
                  JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = :n
                 ORDER BY e.enumsortorder
                 LIMIT 1
                """
            ),
            {"n": udt_name},
        ).scalar()


def _filler(data_type: str, udt_name: str, i: int, enum_label: str | None) -> str:
    """A type-plausible literal for a NOT NULL column — see the module docstring."""
    if udt_name.startswith("_"):  # an array type, e.g. _text
        return f"'{{}}'::{udt_name[1:]}[]"
    if enum_label is not None:
        return f"'{enum_label}'::{udt_name}"
    if data_type in ("timestamp with time zone", "timestamp without time zone"):
        return f"now() - make_interval(days => {i})"
    if data_type == "date":
        return f"(now() - make_interval(days => {i}))::date"
    if data_type == "uuid":
        return "gen_random_uuid()"
    if data_type == "jsonb":
        return "'{}'::jsonb"
    if data_type == "json":
        return "'{}'::json"
    if data_type == "boolean":
        return "false"
    if data_type in (
        "integer",
        "bigint",
        "smallint",
        "numeric",
        "double precision",
        "real",
    ):
        return str(i)
    if data_type == "interval":
        return "'1 day'::interval"
    return f"'f{i}'"  # text / varchar / enum-ish — one distinct value per row


def _seed_rows(engine: Engine, table: str, count: int) -> None:
    """Insert ``count`` rows filling only the columns Postgres will demand."""
    with engine.connect() as conn:
        cols = conn.execute(
            text(
                """
                SELECT column_name, data_type, udt_name
                  FROM information_schema.columns
                 WHERE table_schema = 'coord'
                   AND table_name = :t
                   AND is_nullable = 'NO'
                   AND column_default IS NULL
                   AND is_generated = 'NEVER'
                   AND is_identity = 'NO'
                 ORDER BY ordinal_position
                """
            ),
            {"t": table},
        ).all()

    labels = {
        str(c[2]): _enum_label(engine, str(c[2]))
        for c in cols
        if str(c[1]) == "USER-DEFINED"
    }
    names = ", ".join(str(c[0]) for c in cols)
    with engine.begin() as conn:
        for i in range(count):
            values = ", ".join(
                _filler(str(c[1]), str(c[2]), i, labels.get(str(c[2]))) for c in cols
            )
            conn.execute(text(f"INSERT INTO coord.{table} ({names}) VALUES ({values})"))
        conn.execute(text(f"ANALYZE coord.{table}"))


def _row_count(engine: Engine, table: str) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text(f"SELECT count(*) FROM coord.{table}")).scalar() or 0
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_oplog_age_idx_01_serves_the_retention_batch_subquery() -> None:
    """Six age indexes: additive, valid, ascending, and load-bearing."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "oplog_age_idx_test") as (
        engine,
        url,
    ):
        # ------------------------------------------------------------------
        # Step 1 (assertion 1). Parent revision: none of the six new indexes
        # exist; every composite this plan measured itself against does.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)

        for new_idx, table, _age, composite in _CASES:
            assert not index_exists(engine, new_idx), (
                f"{new_idx} must be created by {_REVISION_ID}, not by an "
                "earlier revision"
            )
            assert index_exists(engine, composite), (
                f"coord.{table} no longer carries {composite}. The plan's "
                "premise is that the age column is only ever a TRAILING "
                "column of this composite — if it has moved, re-measure "
                "before trusting this revision"
            )

        # ------------------------------------------------------------------
        # Step 2 (assertion 4, the negative case). Seed, then show the batch
        # subquery needs a Sort while only the composite exists.
        # ------------------------------------------------------------------
        for _new_idx, table, _age, _composite in _CASES:
            _relax_value_constraints(engine, table)
            _seed_rows(engine, table, _ROWS_PER_TABLE)

        for _new_idx, table, age, _composite in _CASES:
            plan = _plan_for(engine, _prune_batch_sql(table, age))
            assert "Sort" in plan, (
                f"coord.{table}: without a leading-{age} index the batch "
                "subquery must sort — if it does not, some index already "
                "supplies the ordering and this revision is unnecessary for "
                f"this table. Got:\n{plan}"
            )

        # ------------------------------------------------------------------
        # Step 3 (assertion 2). Apply: all six exist, all VALID, all ASC and
        # single-column on the right column.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        for new_idx, table, age, _composite in _CASES:
            assert index_exists(engine, new_idx)
            assert _index_is_valid(engine, new_idx), (
                f"{new_idx} is INVALID — a killed CONCURRENTLY build leaves an "
                "index of the right name that IF NOT EXISTS skips on re-run, "
                "so existence alone is not the contract"
            )
            definition = _index_def(engine, new_idx)
            assert definition.endswith(f"({age})"), (
                f"{new_idx} must be a bare ascending index on ({age}) — one "
                "column, no DESC. coord.error_observations is the trap here: "
                "its age column is window_start, and an index on observed_at "
                f"would not even build. Got: {definition!r}"
            )
            assert f"ON coord.{table} " in definition, (
                f"{new_idx} must sit on coord.{table}. Got: {definition!r}"
            )

        # ------------------------------------------------------------------
        # Step 4 (assertion 3). Every batch subquery now rides its own index
        # with no Sort node.
        # ------------------------------------------------------------------
        for new_idx, table, age, _composite in _CASES:
            plan = _plan_for(engine, _prune_batch_sql(table, age))
            assert f"Index Scan using {new_idx}" in plan, (
                f"coord.{table}'s retention batch must ride {new_idx}. This is "
                "the whole point of the revision. Got:\n" + plan
            )
            assert "Sort" not in plan, (
                f"coord.{table}: {new_idx} supplies the ordering, so no Sort "
                "node should remain. Got:\n" + plan
            )

        # ------------------------------------------------------------------
        # Step 5 (assertion 5). Downgrade removes exactly the six.
        # ------------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        for new_idx, table, _age, composite in _CASES:
            assert not index_exists(engine, new_idx), f"downgrade must drop {new_idx}"
            assert index_exists(engine, composite), (
                f"downgrade must not touch {composite}"
            )
            assert _row_count(engine, table) == _ROWS_PER_TABLE, (
                f"downgrade must not touch coord.{table}'s rows"
            )
