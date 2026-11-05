"""Behaviour test for ``coord_forecast_scored_idx_01``.

The revision builds, ``CONCURRENTLY``::

    + coord.process_forecasts (tenant_id, object_type, issued_at DESC)
                              WHERE resolved_at IS NOT NULL
                                  ix_process_forecasts_resolved_family_issued

so coord's forecast score read (``SCORED_ROWS_SQL``) can walk one family's resolved
rows in ``issued_at DESC`` order and stop at its cap, instead of fetching every
resolved row of the tenant and sorting. Phase 1 of plan
``2026-11-05-forecast-ledger-phase-3-review-follow-ups``.

What is asserted
================

1. The upgrade path is what coord's merge classifier auto-lands: one static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literal in an autocommit block.
2. At the parent revision the index is absent, and the two indexes the docstring's
   argument rests on (``uq_process_forecasts_issue``, ``ix_process_forecasts_unresolved``)
   are present.
3. After upgrade the index exists, is ``indisvalid``, and is exactly the intended
   definition.
4. **Capability, forced:** with sequential and bitmap scans priced out, the read plans as
   an ordered Index Scan of the new index with no Sort, for both ``since`` arms. At the
   parent revision the same forced plan has a Sort, so this assertion can fail.
5. **The read as Phase 3 sends it** (one transaction, ``SET LOCAL statement_timeout =
   '5s'`` and ``SET LOCAL enable_sort = off``, nothing else forced) plans on the new
   index with no Sort, for both ``since`` arms, on a seeded and ANALYZEd table with
   other families, another tenant and unresolved rows beside the scored family.
6. **A measurement, not an assertion:** the plans and timings of the read WITHOUT
   ``enable_sort = off``, and of a 1 %-selective question prefix with and without it,
   go to the CI log through ``warnings.warn``. D2 of the plan applies the setting
   unconditionally, so nothing here decides anything.
7. Downgrade removes the index and keeps every row; a second upgrade re-applies it.

The read is a literal copy of ``SCORED_ROWS_SQL`` in qontinui-coord
``crates/coord/src/forecast_ledger/mod.rs`` (lines 162-180 at ``89909b161``), plus the
``AND f.object_type = 'dev_action'`` that Phase 3 step 3.1 adds (``OBJECT_TYPE``,
``mod.rs:45-46``). A copy on purpose: the index serves coord only while the read keeps
this shape. ``$4`` is ``MAX_SCORED_ROWS + 1`` = 50,001 and ``$5`` is
``inference::shrinkage::ESTIMATOR``. Parameters are inlined as literals, which is what
a custom plan sees.

The database tests share one ephemeral database (seeding it is the expensive part).
Each one first moves it to the revision it needs, so none depends on another's order.
Substrate comes from ``_alembic_harness``: skipped when no Postgres is reachable
(``QONTINUI_TEST_PG`` / ``QONTINUI_TEST_PG_DSN`` point it at another instance).
"""

from __future__ import annotations

import re
import warnings
from collections.abc import Iterator

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
    upgrade_execute_calls,
)

_PARENT_REVISION_ID = "pr_events_mergeability_head_idx_01"
_REVISION_ID = "coord_forecast_scored_idx_01"
_REVISION_FILENAME = "coord_forecast_scored_idx_01_process_forecasts_resolved_family.py"
_INDEX_NAME = "ix_process_forecasts_resolved_family_issued"
_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_INDEX_NAME} ON coord.process_forecasts USING btree "
    "(tenant_id, object_type, issued_at DESC) WHERE (resolved_at IS NOT NULL)"
)

_TENANT = "00000000-0000-0000-0000-00000000f001"
_OTHER_TENANT = "00000000-0000-0000-0000-00000000f002"
_ESTIMATOR = "hierarchical-eb-v1"
_CAP_PLUS_ONE = 50_001
_DEFAULT_PREFIX = "dev_action."
# About 1 % of the scored family: every 100th row's question is a `restart`.
_SELECTIVE_PREFIX = "dev_action.restart."
_SINCE = "2026-06-01T00:00:00+00:00"

# qontinui-coord 89909b161 `SCORED_ROWS_SQL`, verbatim but for the one line Phase 3
# step 3.1 adds (`AND f.object_type = 'dev_action'`).
_SCORED_ROWS_SQL = """
    SELECT f.p,
           (SELECT (e->>'p')::float8
              FROM jsonb_array_elements(f.predicted->'forecasts') AS e
             WHERE e->>'model' = 'prior_only' LIMIT 1) AS p_prior,
           CASE WHEN jsonb_typeof(f.observed->'y') = 'number'
                THEN (f.observed->>'y')::int END AS y,
           f.issued_at,
           f.predicted->>'tenant_source' AS tenant_source
      FROM coord.process_forecasts f
     WHERE f.tenant_id = $1
       AND f.object_type = 'dev_action'
       AND f.resolved_at IS NOT NULL
       AND left(f.question, length($2)) = $2
       AND ($3::timestamptz IS NULL OR f.issued_at >= $3)
       AND jsonb_typeof(f.predicted->'forecasts') = 'array'
       AND f.predicted->'forecasts' @> jsonb_build_array(jsonb_build_object('model', $5::text))
       AND f.predicted->'forecasts' @> '[{"model": "prior_only"}]'::jsonb
     ORDER BY f.issued_at DESC
     LIMIT $4
"""

# One row's `predicted`: both models the read requires, and a tenant source.
_PREDICTED = (
    "jsonb_build_object("
    "'forecasts', jsonb_build_array("
    "jsonb_build_object('model', 'hierarchical-eb-v1', 'p', 0.3), "
    "jsonb_build_object('model', 'prior_only', 'p', 0.2)), "
    "'tenant_source', 'snapshot')"
)

# Rows are inserted oldest first, one a minute ending now, so heap order follows
# `issued_at`. Each statement takes `:tenant`, `:object_type`, `:batch` (which keeps
# object ids distinct across batches), `:n` and `:resolved`.
_SEED_SQL = f"""
    INSERT INTO coord.process_forecasts
        (tenant_id, question, object_type, object_id, issued_at, horizon_secs, p,
         predicted, resolved_at, observed)
    SELECT CAST(:tenant AS uuid),
           CASE WHEN i % 100 = 0 THEN 'dev_action.restart.SIG-' || (i % 7)
                ELSE 'dev_action.build.SIG-' || (i % 13) END,
           :object_type,
           'obj-' || :batch || '-' || i,
           now() - make_interval(mins => :n - i),
           3600,
           0.3,
           {_PREDICTED},
           CASE WHEN :resolved THEN now() - make_interval(mins => :n - i) END,
           CASE WHEN :resolved THEN jsonb_build_object('y', i % 2) END
      FROM generate_series(1, :n) AS i
     ORDER BY i
"""

# (tenant, object_type, rows, resolved): the scored family, another family of the same
# tenant, another tenant's family, and unresolved rows the partial predicate leaves out.
_SEED_BATCHES = (
    (_TENANT, "dev_action", 120_000, True),
    (_TENANT, "ci_skip", 20_000, True),
    (_OTHER_TENANT, "dev_action", 5_000, True),
    (_TENANT, "dev_action", 2_000, False),
)


def _literal(value: str | None) -> str:
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


def _scored_rows_sql(prefix: str, since: str | None) -> str:
    """The read with its parameters inlined, highest placeholder first."""
    sql = _SCORED_ROWS_SQL
    for placeholder, value in (
        ("$5", _literal(_ESTIMATOR)),
        ("$4", str(_CAP_PLUS_ONE)),
        ("$3", _literal(since)),
        ("$2", _literal(prefix)),
        ("$1", _literal(_TENANT) + "::uuid"),
    ):
        sql = sql.replace(placeholder, value)
    assert "$" not in sql, sql
    return sql


def _plan(
    engine: Engine,
    sql: str,
    *,
    settings: tuple[str, ...] = (),
    analyze: bool = False,
) -> str:
    """EXPLAIN ``sql`` in one transaction, under ``SET LOCAL`` settings, rolled back."""
    explain = "EXPLAIN (ANALYZE, BUFFERS) " if analyze else "EXPLAIN "
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            for setting in settings:
                conn.execute(text(f"SET LOCAL {setting}"))
            rows = conn.execute(text(explain + sql)).all()
            return "\n".join(str(r[0]) for r in rows)
        finally:
            tx.rollback()


def _rides_the_index_unsorted(plan: str) -> bool:
    return f"Index Scan using {_INDEX_NAME}" in plan and "Sort" not in plan


def _index_is_valid(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT i.indisvalid FROM pg_index i "
                    "JOIN pg_class c ON c.oid = i.indexrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'coord' AND c.relname = :n"
                ),
                {"n": _INDEX_NAME},
            ).scalar_one()
        )


def _index_definition(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(f"SELECT pg_get_indexdef('coord.{_INDEX_NAME}'::regclass)")
            ).scalar_one()
        )


def _row_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.process_forecasts")
            ).scalar_one()
        )


def _seed(engine: Engine) -> None:
    with engine.begin() as conn:
        for batch, (tenant, object_type, rows, resolved) in enumerate(_SEED_BATCHES):
            conn.execute(
                text(_SEED_SQL),
                {
                    "tenant": tenant,
                    "object_type": object_type,
                    "batch": batch,
                    "n": rows,
                    "resolved": resolved,
                },
            )
        conn.execute(text("ANALYZE coord.process_forecasts"))


_DB_REQUIRED = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)


@pytest.fixture(scope="module")
def seeded() -> Iterator[tuple[Engine, str]]:
    """One ephemeral database at the parent revision, seeded and ANALYZEd."""
    with ephemeral_database(admin_database_url(), "forecast_scored_idx_test") as (
        engine,
        url,
    ):
        run_alembic(backend_root(), url, "upgrade", _PARENT_REVISION_ID)
        _seed(engine)
        yield engine, url


def _at(url: str, revision: str) -> None:
    """Move the shared database to ``revision`` (a no-op when it is already there)."""
    command = "downgrade" if revision == _PARENT_REVISION_ID else "upgrade"
    run_alembic(backend_root(), url, command, revision)


def test_the_upgrade_path_is_classifier_safe() -> None:
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    calls = upgrade_execute_calls(path)
    assert len(calls) == 1, "one CREATE INDEX, and nothing else on the upgrade path"
    call = calls[0]
    assert call.sql is not None, "the execute argument is one static literal"
    assert call.in_autocommit_block, "CONCURRENTLY cannot run in a transaction"
    create = re.sub(r"\s+", " ", call.sql).strip().upper()
    assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), (
        "coord writes forecasts continuously, and its classifier rejects a "
        f"non-concurrent or unguarded build: {create}"
    )


@_DB_REQUIRED
def test_the_parent_has_the_premise_indexes_and_not_this_one(
    seeded: tuple[Engine, str],
) -> None:
    engine, url = seeded
    _at(url, _PARENT_REVISION_ID)
    assert not index_exists(engine, _INDEX_NAME)
    for premise in ("uq_process_forecasts_issue", "ix_process_forecasts_unresolved"):
        assert index_exists(engine, premise), (
            f"the docstring's argument is that {premise} cannot serve the ordered "
            "read; its absence means the premise moved"
        )


@_DB_REQUIRED
def test_the_index_is_valid_and_exactly_as_defined(
    seeded: tuple[Engine, str],
) -> None:
    engine, url = seeded
    _at(url, _REVISION_ID)
    assert index_exists(engine, _INDEX_NAME)
    assert _index_is_valid(engine), (
        "a killed CONCURRENTLY build leaves an INVALID index that IF NOT EXISTS "
        "would skip on re-run; existence is not enough"
    )
    assert _index_definition(engine) == _EXPECTED_DEFINITION


@_DB_REQUIRED
def test_the_read_can_be_an_unsorted_walk_of_the_index_and_cannot_without_it(
    seeded: tuple[Engine, str],
) -> None:
    engine, url = seeded
    forced = ("enable_seqscan = off", "enable_bitmapscan = off")

    _at(url, _PARENT_REVISION_ID)
    for since in (None, _SINCE):
        plan = _plan(engine, _scored_rows_sql(_DEFAULT_PREFIX, since), settings=forced)
        assert "Sort" in plan, (
            f"at the parent nothing delivers issued_at DESC order, so the forced plan "
            f"must sort (since={since}); without that this test cannot fail:\n{plan}"
        )

    _at(url, _REVISION_ID)
    for since in (None, _SINCE):
        plan = _plan(engine, _scored_rows_sql(_DEFAULT_PREFIX, since), settings=forced)
        assert _rides_the_index_unsorted(plan), (
            f"the read must be an ordered Index Scan of {_INDEX_NAME} with no Sort "
            f"(since={since}):\n{plan}"
        )


@_DB_REQUIRED
def test_the_score_read_plans_on_the_family_index(
    seeded: tuple[Engine, str],
) -> None:
    engine, url = seeded
    _at(url, _REVISION_ID)
    phase_3 = ("statement_timeout = '5s'", "enable_sort = off")
    for since in (None, _SINCE):
        plan = _plan(
            engine,
            _scored_rows_sql(_DEFAULT_PREFIX, since),
            settings=phase_3,
            analyze=True,
        )
        assert _rides_the_index_unsorted(plan), (
            f"under Phase 3's enable_sort = off the read must walk {_INDEX_NAME} "
            f"with no Sort (since={since}):\n{plan}"
        )


@_DB_REQUIRED
def test_the_planners_unforced_choice_is_recorded(
    seeded: tuple[Engine, str],
) -> None:
    """Test 6 of the plan: warns plans and timings into the CI log, asserts nothing."""
    engine, url = seeded
    _at(url, _REVISION_ID)
    timeout = ("statement_timeout = '5s'",)
    cases = (
        ("default prefix, since NULL, no enable_sort", _DEFAULT_PREFIX, None, timeout),
        ("default prefix, since set, no enable_sort", _DEFAULT_PREFIX, _SINCE, timeout),
        ("1% prefix, since NULL, no enable_sort", _SELECTIVE_PREFIX, None, timeout),
        (
            "1% prefix, since NULL, enable_sort = off",
            _SELECTIVE_PREFIX,
            None,
            (*timeout, "enable_sort = off"),
        ),
    )
    for label, prefix, since, settings in cases:
        plan = _plan(
            engine, _scored_rows_sql(prefix, since), settings=settings, analyze=True
        )
        warnings.warn(
            f"coord_forecast_scored_idx_01 measurement [{label}]:\n{plan}",
            stacklevel=1,
        )


@_DB_REQUIRED
def test_downgrade_removes_the_index_and_keeps_every_row(
    seeded: tuple[Engine, str],
) -> None:
    engine, url = seeded
    _at(url, _REVISION_ID)
    rows = _row_count(engine)
    _at(url, _PARENT_REVISION_ID)
    assert not index_exists(engine, _INDEX_NAME)
    assert _row_count(engine) == rows, "downgrade must not touch a row"
    _at(url, _REVISION_ID)
    assert _index_is_valid(engine), "the re-applied index must be VALID"
    assert _index_definition(engine) == _EXPECTED_DEFINITION
