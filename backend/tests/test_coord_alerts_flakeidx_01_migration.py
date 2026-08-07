"""Behaviour test for the ``coord_alerts_flakeidx_01`` partial expression index.

The revision creates one index::

    CREATE INDEX CONCURRENTLY idx_alerts_red_main_flake_healed
    ON coord.alerts (kind)
    WHERE kind = 'red_main' AND detail->>'suspected_flake' = 'true'

``migration-reversal.yml`` would confirm that statement *executes*, on an empty
database, and nothing more. Executing is not the contract. The contract is that
**the planner chooses this index for the exact SQL coord sends**, which depends
on Postgres proving that the query's ``WHERE`` implies the index predicate - a
syntactic proof over parsed expressions that an innocuous rewrite of the Rust
SQL literal silently breaks, with no error and no failing build. That is the
plan's named risk for this migration, and it is what this test pins.

What is asserted
================

1. The index exists after upgrade and is **``indisvalid``**. A killed
   ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS`` would
   skip on re-run, so "exists" alone would report success on an index that can
   never serve a query.
2. Its recorded predicate is the intended one (read back from
   ``pg_get_expr(indpred)``).
3. **With ``K = 0`` - no matching row at all, which is prod's measured state -
   the planner still chooses it.** An empty partial index is eligible by
   predicate implication alone; implication needs no statistics. This is the
   assertion that justifies landing the migration now rather than waiting for
   the stamp path to fire.
4. **It is self-maintaining.** A row inserted AFTER the index was built starts
   matching the predicate and is returned through an index scan - no
   ``REINDEX``. This is what makes "build it empty today" correct.
5. Both JSON spellings index. ``detail->>'suspected_flake'`` extracts text, so a
   JSON boolean ``true`` and a JSON string ``"true"`` both render as ``'true'``
   and both must be captured - the producer's exact serde spelling is not
   pinned anywhere, so the index must not depend on it.
6. **Sensitivity: the DEFEATED rewrite does NOT get the index.** Asking the same
   question as ``detail->'suspected_flake' = 'true'::jsonb`` must fall back to a
   sequential scan. Without this the other assertions would still pass against
   an index that matched everything, and the test would not be measuring
   implication at all.
7. Downgrade removes it.

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

_REVISION_ID = "coord_alerts_flakeidx_01"
_PARENT_REVISION_ID = "coord_alerts_retention_01"

_INDEX_NAME = "idx_alerts_red_main_flake_healed"

# The reader's WHERE clause, character-for-character as ``compute_flake_healed``
# (qontinui-coord/src/red_main_metrics.rs) sends it. If this string and the
# migration's predicate ever diverge, the index stops being chosen - which is
# exactly the silent failure this test exists to catch.
_READER_WHERE = "kind = 'red_main' AND detail->>'suspected_flake' = 'true'"

# The rewrite that LOOKS equivalent and silently defeats the index: `->` yields
# jsonb, not text, so the parsed expression no longer matches the predicate and
# implication cannot be proven.
_DEFEATED_WHERE = "kind = 'red_main' AND detail->'suspected_flake' = 'true'::jsonb"

# The full aggregate, so the test pins the real statement rather than a
# simplified stand-in of it.
_READER_SQL = f"""
SELECT COALESCE(NULLIF(detail->>'repo', ''),
                regexp_replace(alert_key, '^red_main:', '')) AS repo,
       wf.workflow AS workflow,
       COUNT(*)::BIGINT AS healed
FROM coord.alerts,
     LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(detail->'flake_workflows') = 'array'
              THEN detail->'flake_workflows'
              ELSE jsonb_build_array(
                       COALESCE(NULLIF(detail->>'last_rerun_workflow', ''),
                                'unknown'))
         END) AS wf(workflow)
WHERE {_READER_WHERE}
GROUP BY 1, 2
"""

# Rows seeded AFTER the index is built, as (alert_key, detail JSON).
_SEED_ROWS = [
    # Matches: JSON boolean true.
    (
        "red_main:qontinui/qontinui-coord",
        "red_main",
        '{"suspected_flake": true, "repo": "qontinui/qontinui-coord",'
        ' "flake_workflows": ["ci", "build"]}',
    ),
    # Matches: JSON string "true" - the other plausible serde spelling.
    (
        "red_main:qontinui/qontinui-web",
        "red_main",
        '{"suspected_flake": "true", "repo": "qontinui/qontinui-web",'
        ' "flake_workflows": ["lint"]}',
    ),
    # Does NOT match: red_main without the stamp. This is what all 219 of
    # prod's red_main rows actually look like.
    (
        "red_main:qontinui/other",
        "red_main",
        '{"workflows": ["ci"], "repo": "qontinui/other"}',
    ),
    # Does NOT match: the stamp present, but on a different kind.
    ("stale_wip:x", "stale_wip", '{"suspected_flake": true}'),
]


def _index_is_valid(engine: Engine) -> bool:
    """``indisvalid`` for the new index - existence is not enough."""
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :idx
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar()
        )


def _index_predicate(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    """
                    SELECT pg_get_expr(i.indpred, i.indrelid)
                      FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :idx
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar()
            or ""
        )


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is deliberately tiny, so a seq scan would win on cost no matter
    how good the index is. ``enable_seqscan = off`` removes the cost question
    and leaves only the one being asked: CAN the planner use this index for this
    predicate? If implication does not hold, no amount of penalty makes it
    usable and the plan still shows a Seq Scan - which is precisely how the
    negative case below discriminates.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed_matching_rows(engine: Engine) -> None:
    """Rows inserted AFTER the index was built - the self-maintenance case.

    ``CAST(:d AS jsonb)`` rather than ``:d::jsonb``: SQLAlchemy's ``text()``
    parses ``:name`` bind parameters itself and mis-parses a ``::`` cast that
    immediately follows one, emitting a stray ``:`` that Postgres rejects.
    """
    with engine.begin() as conn:
        for key, kind, detail in _SEED_ROWS:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, detail)
                    VALUES (:key, 'critical', :kind, :key, CAST(:d AS jsonb))
                    """
                ),
                {"key": key, "kind": kind, "d": detail},
            )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_alerts_flakeidx_01_index_is_valid_and_planner_chooses_it() -> None:
    """Build the index, prove the planner uses it, prove the defeated form doesn't."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_alerts_flakeidx_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision - the index must not exist yet.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )

        # ----------------------------------------------------------------
        # 2. Apply - exists, and is VALID (not a half-built CONCURRENTLY).
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run - existence is not enough"
        )

        predicate = _index_predicate(engine)
        assert "red_main" in predicate and "suspected_flake" in predicate, (
            f"unexpected index predicate: {predicate!r}"
        )

        # ----------------------------------------------------------------
        # 3. K = 0 - prod's measured state. The index holds zero entries and
        #    the planner must STILL be able to choose it, by implication alone.
        # ----------------------------------------------------------------
        empty_plan = _plan_for(
            engine, f"SELECT count(*) FROM coord.alerts WHERE {_READER_WHERE}"
        )
        assert _INDEX_NAME in empty_plan, (
            "an empty partial index is still eligible by predicate implication; "
            f"planner did not choose it:\n{empty_plan}"
        )

        # ----------------------------------------------------------------
        # 4. Self-maintaining: rows inserted after the build are indexed with
        #    no REINDEX, and the full reader aggregate rides the index.
        # ----------------------------------------------------------------
        _seed_matching_rows(engine)

        reader_plan = _plan_for(engine, _READER_SQL)
        assert _INDEX_NAME in reader_plan, (
            f"the reader's exact SQL must ride the new index; got:\n{reader_plan}"
        )

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            results = {
                (r[0], r[1]): r[2] for r in conn.execute(text(_READER_SQL)).all()
            }

        # Case 5 - both JSON spellings of the stamp are captured, and neither
        # the unstamped red_main row nor the stamped non-red_main row is.
        assert results == {
            ("qontinui/qontinui-coord", "ci"): 1,
            ("qontinui/qontinui-coord", "build"): 1,
            ("qontinui/qontinui-web", "lint"): 1,
        }, f"unexpected aggregate over the indexed rows: {results!r}"

        # ----------------------------------------------------------------
        # 5. Sensitivity. The `->` / ::jsonb rewrite is the innocuous-looking
        #    edit that silently restores the full scan. If this assertion ever
        #    fails, the index predicate has been widened and every assertion
        #    above has stopped measuring implication.
        # ----------------------------------------------------------------
        defeated_plan = _plan_for(
            engine, f"SELECT count(*) FROM coord.alerts WHERE {_DEFEATED_WHERE}"
        )
        assert _INDEX_NAME not in defeated_plan, (
            "the `detail->'suspected_flake' = 'true'::jsonb` rewrite must NOT "
            "match this partial index - if it does, the predicate is wrong and "
            "the positive assertions above prove nothing:\n" + defeated_plan
        )

        # ----------------------------------------------------------------
        # 6. Downgrade removes it; the table and its rows survive.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        with engine.connect() as conn:
            assert conn.execute(
                text("SELECT count(*) FROM coord.alerts")
            ).scalar() == len(_SEED_ROWS), (
                "downgrade drops the index only - rows are untouched"
            )
