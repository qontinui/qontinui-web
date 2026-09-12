"""Behaviour test for the ``coord_test_results_idx_01`` per-test history indexes.

The revision creates two composite indexes ``CONCURRENTLY`` and retires the
prefix index the first one supersedes::

    + coord.test_results (repo, test_id, observed_at DESC)   idx_test_results_repo_test_observed
    + coord.test_results (repo, observed_at DESC)            idx_test_results_repo_observed
    - coord.test_results (repo, test_id)                     idx_test_results_repo_test

``migration-reversal.yml`` confirms those statements *execute* on an empty
database. Executing is not the contract. The contract is that **the planner
chooses each index for the exact SQL coord sends** — the rewritten
``test_run_effects::load_result_history`` — and that the rewrite returns the
right rows. The migration's docstring makes specific, falsifiable planner
claims; each is re-stated below as an assertion against a real Postgres.

What is asserted
================

1. **The revision supersedes; it does not merely add.** At the parent revision
   the prefix index exists and neither composite does.

2. **Both composites exist, are ``indisvalid``, and have the intended
   definition; the prefix is gone.** Validity is checked explicitly because a
   killed ``CONCURRENTLY`` build leaves an INVALID index of the same name that
   ``IF NOT EXISTS`` then skips on re-run.

3. **The per-test probe (C) is an ordered index scan with NO Sort node.**
   ``WHERE repo = $1 AND test_id = $2 ORDER BY observed_at DESC LIMIT n`` rides
   ``idx_test_results_repo_test_observed`` and stops after ``n`` entries. This
   is the probe that runs once per test — ~11k times per flakiness call on the
   runner — so it is the one whose shape decides whether the read finishes.

4. **The newest-row probe (A) is an index scan with NO Sort node, and
   ``idx_test_results_repo_observed`` CAN serve it.** Which index the planner
   picks on the REAL table is a cost decision it gets to make: on this small
   fixture it prefers the retained single-column ``idx_test_results_observed_at``
   scanned backwards with a ``repo`` filter (the exact "instant for a repo that
   ingested a minute ago" case the migration describes), and that is fine —
   both are probes, not sorts. So the no-Sort claim is asserted on the real
   table, and the capability claim on a control clone carrying the composite
   and nothing else, the same split ``test_coord_obs_idx_01_migration`` makes
   for its own contested probe. This is also why the migration does NOT drop
   ``idx_test_results_observed_at``: the planner is still choosing it.

5. **The full coord statement returns the right rows.** Seeded AFTER the build
   (self-maintaining — no ``REINDEX``): the roster is exactly the tests the
   repo's TWO most recent ``head_sha``s carried (a test absent from both is not
   scored; a test only in the newest is; a test only in the previous — the
   in-flight-chunk / subset-job case the second head exists for — is), each
   test gets its
   newest ``window`` rows and no more, and another repo's rows never leak in.

6. **Downgrade removes exactly the two composites and restores the prefix
   index** with the definition ``runtests_effect_tables_01`` gave it.

``enable_seqscan = off`` for the plan assertions
================================================

The fixture is deliberately small, so a sequential scan wins on cost regardless
of index quality — the same reason ``test_coord_obs_idx_01_migration`` does
this. Turning it off removes the cost question and leaves the one being asked:
CAN the planner serve this query shape from this index without a sort?

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

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

_REVISION_ID = "coord_test_results_idx_01"
_PARENT_REVISION_ID = "claude_acct_01"

_IDX_REPO_TEST_OBSERVED = "idx_test_results_repo_test_observed"
_IDX_REPO_OBSERVED = "idx_test_results_repo_observed"
# The prefix this revision retires, created by ``runtests_effect_tables_01``.
_IDX_PREFIX = "idx_test_results_repo_test"

# A clone of the table carrying the composite and NOTHING else, so the planner
# has no cheaper single-column index to prefer — where "can index #2 serve
# probe (A)?" is actually decidable (claim 4).
_CTL_REPO_OBSERVED = "coord.ctl_test_results_repo_observed"

_REPO = "qontinui/qontinui-runner"
_OTHER_REPO = "qontinui/qontinui-coord"
_SHARDS = ("ubuntu-22.04", "windows-latest")
_WINDOW = 4
# Every ingest writes one row per shard under ONE observed_at, so a window that
# is not a multiple of the shard count would split a same-timestamp tie
# non-deterministically. Both windows the values assertions use (4 and 6) must
# fall on an ingest boundary.
assert _WINDOW % len(_SHARDS) == 0

# The newest ingest's timestamp; every earlier ingest is one minute older.
_NEWEST = datetime(2026, 9, 12, 12, 0, tzinfo=UTC)

# ---------------------------------------------------------------------------
# The reader SQL, transcribed from qontinui-coord ``test_run_effects.rs``
# ``load_result_history``. Kept character-for-character where it matters (the
# WHERE / ORDER BY / LIMIT shapes are what the plans are about); ``$1`` / ``$2``
# are spelled as SQLAlchemy binds.
# ---------------------------------------------------------------------------

# Probe (C): one per roster test. Index #1 exists for this statement.
_PROBE_PER_TEST_SQL = (
    "SELECT test_id, outcome, duration_seconds, head_sha, shard, observed_at "
    "FROM coord.test_results "
    f"WHERE repo = '{_REPO}' AND test_id = 'bin::mod::t1' "
    f"ORDER BY observed_at DESC LIMIT {_WINDOW}"
)

# Probe (A): the repo's newest row. Index #2 exists for this statement.
_PROBE_LATEST_SQL = (
    "SELECT head_sha FROM coord.test_results "
    f"WHERE repo = '{_REPO}' AND head_sha IS NOT NULL "
    "ORDER BY observed_at DESC LIMIT 1"
)

# The whole statement, as coord runs it.
_HISTORY_SQL = text(
    """
    WITH latest AS (
        SELECT head_sha FROM coord.test_results
        WHERE repo = :repo AND head_sha IS NOT NULL
        ORDER BY observed_at DESC LIMIT 1
    ), previous AS (
        SELECT t.head_sha FROM coord.test_results t, latest
        WHERE t.repo = :repo AND t.head_sha IS NOT NULL
          AND t.head_sha <> latest.head_sha
        ORDER BY t.observed_at DESC LIMIT 1
    ), roster AS (
        SELECT DISTINCT t.test_id
        FROM coord.test_results t
        WHERE t.repo = :repo
          AND t.head_sha IN (SELECT head_sha FROM latest
                             UNION SELECT head_sha FROM previous)
    )
    SELECT h.test_id, h.outcome, h.duration_seconds,
           h.head_sha, h.shard, h.observed_at
    FROM roster r
    CROSS JOIN LATERAL (
        SELECT test_id, outcome, duration_seconds, head_sha, shard, observed_at
        FROM coord.test_results
        WHERE repo = :repo AND test_id = r.test_id
        ORDER BY observed_at DESC
        LIMIT :window
    ) h
    """
)


def _index_def(engine: Engine, index_name: str) -> str:
    """``pg_get_indexdef`` — the recorded column list AND their directions."""
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    "SELECT pg_get_indexdef(c.oid) FROM pg_class c "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'coord' AND c.relname = :n"
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
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'coord' AND c.relname = :n
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


def _seed(engine: Engine) -> None:
    """Insert every row AFTER the indexes were built — the self-maintenance case.

    Eight ingests for ``_REPO`` (``sha0`` newest … ``sha7`` oldest), two shards
    each, so every test has 16 rows — four times ``_WINDOW``. The roster edges:

    * ``t_dropped`` exists in every ingest EXCEPT the newest two → not scored.
    * ``t_new`` exists ONLY in the newest ingest → scored, with 2 rows.
    * ``t_prev`` exists ONLY in the second-newest ingest (an in-flight newest
      chunk, or a subset job landing last, looks exactly like this) → scored.
    * ``t1`` fails on ``sha2``/ubuntu only — the one row the window must keep
      and the values assertion checks for.

    ``_OTHER_REPO`` carries the same test ids so a leak across ``repo`` would
    show up as extra rows, not as a silently identical answer.
    """
    with engine.begin() as conn:
        insert = text(
            """
            INSERT INTO coord.test_results
                (repo, head_sha, test_id, outcome, shard, provenance, observed_at)
            VALUES (:repo, :sha, :tid, :outcome, :shard, 'result_ingested', :at)
            """
        )
        for i in range(8):
            sha = f"sha{i}"
            at = _NEWEST - timedelta(minutes=i)
            tests = ["bin::mod::t1", "bin::mod::t2"]
            tests.append(
                {0: "bin::mod::t_new", 1: "bin::mod::t_prev"}.get(
                    i, "bin::mod::t_dropped"
                )
            )
            for tid in tests:
                for shard in _SHARDS:
                    outcome = (
                        "fail"
                        if (
                            tid.endswith("t1") and sha == "sha2" and shard == _SHARDS[0]
                        )
                        else "pass"
                    )
                    conn.execute(
                        insert,
                        {
                            "repo": _REPO,
                            "sha": sha,
                            "tid": tid,
                            "outcome": outcome,
                            "shard": shard,
                            "at": at,
                        },
                    )
            # Same ids, other repo, NEWER than everything in _REPO: a read that
            # forgot to bind `repo` on probe (A) would pick this head.
            for tid in ("bin::mod::t1", "bin::mod::t_other"):
                conn.execute(
                    insert,
                    {
                        "repo": _OTHER_REPO,
                        "sha": f"other{i}",
                        "tid": tid,
                        "outcome": "fail",
                        "shard": None,
                        "at": at + timedelta(hours=1),
                    },
                )
        conn.execute(text("ANALYZE coord.test_results"))


def _build_control(engine: Engine) -> None:
    """Clone the table with exactly ONE index — the composite under test.

    ``INCLUDING ALL EXCLUDING INDEXES`` copies the column types, defaults and
    check constraints but no index, so the clone differs from the original only
    in which index it carries; any plan difference is attributable to that.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_CTL_REPO_OBSERVED} "
                "(LIKE coord.test_results INCLUDING ALL EXCLUDING INDEXES)"
            )
        )
        conn.execute(
            text(f"INSERT INTO {_CTL_REPO_OBSERVED} SELECT * FROM coord.test_results")
        )
        conn.execute(
            text(
                f"CREATE INDEX ctl_test_results_repo_observed_idx "
                f"ON {_CTL_REPO_OBSERVED} (repo, observed_at DESC)"
            )
        )
        conn.execute(text(f"ANALYZE {_CTL_REPO_OBSERVED}"))


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_test_results_idx_01_serves_the_per_test_history_read() -> None:
    """Build both indexes, prove each probe's plan, prove the read's answer."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_test_results_idx_test") as (
        engine,
        url,
    ):
        # ------------------------------------------------------------------
        # Step 1 (claim 1). Parent revision: the prefix exists, the composites
        # do not.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert index_exists(engine, _IDX_PREFIX), (
            "runtests_effect_tables_01 created (repo, test_id); this revision "
            "supersedes it, so its absence means the premise has moved"
        )
        assert not index_exists(engine, _IDX_REPO_TEST_OBSERVED)
        assert not index_exists(engine, _IDX_REPO_OBSERVED)

        # ------------------------------------------------------------------
        # Step 2 (claim 2). Apply: both composites exist, VALID, as defined;
        # the prefix is gone.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for name, expected_cols in (
            (_IDX_REPO_TEST_OBSERVED, "(repo, test_id, observed_at DESC)"),
            (_IDX_REPO_OBSERVED, "(repo, observed_at DESC)"),
        ):
            assert index_exists(engine, name)
            assert _index_is_valid(engine, name), (
                f"{name} is INVALID — a killed CONCURRENTLY build leaves an "
                "index of the right name that IF NOT EXISTS skips on re-run, "
                "so existence alone is not the contract"
            )
            definition = _index_def(engine, name)
            assert expected_cols in definition, (
                f"{name} must be {expected_cols}; the column ORDER is "
                f"load-bearing. Got: {definition!r}"
            )
        assert not index_exists(engine, _IDX_PREFIX), (
            "the (repo, test_id) prefix must be retired once its superseding "
            "composite exists — keeping both is pure write amplification"
        )

        # ------------------------------------------------------------------
        # Step 3 (setup). Seed AFTER the build — self-maintaining.
        # ------------------------------------------------------------------
        _seed(engine)

        # ------------------------------------------------------------------
        # Claim 3. Probe (C): ordered index scan on #1, no Sort.
        # ------------------------------------------------------------------
        plan = _plan_for(engine, _PROBE_PER_TEST_SQL)
        assert _IDX_REPO_TEST_OBSERVED in plan, (
            f"the per-test probe must ride {_IDX_REPO_TEST_OBSERVED}:\n{plan}"
        )
        assert "Index Scan" in plan and "Sort" not in plan, (
            "the per-test probe must be an ORDERED index scan that stops after "
            f"LIMIT rows — a Sort node means the whole history is fetched:\n{plan}"
        )

        # ------------------------------------------------------------------
        # Claim 4. Probe (A): an index probe with no Sort on the real table;
        # index #2 CAN serve it, shown where nothing cheaper competes.
        # ------------------------------------------------------------------
        plan = _plan_for(engine, _PROBE_LATEST_SQL)
        assert "Index Scan" in plan and "Sort" not in plan, (
            f"the newest-row probe must be an index probe, never a sort:\n{plan}"
        )
        _build_control(engine)
        plan = _plan_for(
            engine, _PROBE_LATEST_SQL.replace("coord.test_results", _CTL_REPO_OBSERVED)
        )
        assert "ctl_test_results_repo_observed_idx" in plan and "Sort" not in plan, (
            "(repo, observed_at DESC) must serve `WHERE repo = $1 ORDER BY "
            f"observed_at DESC LIMIT 1` as an ordered probe:\n{plan}"
        )
        assert "Filter: (repo" not in plan, (
            "with `repo` bound in the index's leading column there must be no "
            f"residual repo filter — that is the whole point of index #2:\n{plan}"
        )

        # ------------------------------------------------------------------
        # Claim 5. The full statement's ANSWER.
        # ------------------------------------------------------------------
        with engine.connect() as conn:
            rows = conn.execute(_HISTORY_SQL, {"repo": _REPO, "window": _WINDOW}).all()
        by_test: dict[str, list] = {}
        for r in rows:
            by_test.setdefault(r.test_id, []).append(r)

        assert set(by_test) == {
            "bin::mod::t1",
            "bin::mod::t2",
            "bin::mod::t_new",
            "bin::mod::t_prev",
        }, (
            "the roster is the two newest ingests' tests: t_dropped (absent from "
            "sha0 AND sha1) must not be scored; t_new (only in sha0) and t_prev "
            f"(only in sha1) must. Got {set(by_test)}"
        )
        assert all(
            len(v) == _WINDOW
            for k, v in by_test.items()
            if k not in ("bin::mod::t_new", "bin::mod::t_prev")
        ), (
            f"each test gets exactly its newest {_WINDOW} rows: "
            f"{ {k: len(v) for k, v in by_test.items()} }"
        )
        assert len(by_test["bin::mod::t_new"]) == 2, (
            "t_new has only the newest ingest's two shard rows"
        )
        assert len(by_test["bin::mod::t_prev"]) == 2, (
            "t_prev has only the previous ingest's two shard rows"
        )
        # The window is the NEWEST rows: sha0 and sha1 (two shards each), so
        # the sha2 failure falls just outside a window of 4 — and inside 6.
        assert {r.head_sha for r in by_test["bin::mod::t1"]} == {"sha0", "sha1"}
        assert all(r.outcome == "pass" for r in by_test["bin::mod::t1"])
        with engine.connect() as conn:
            wider = conn.execute(_HISTORY_SQL, {"repo": _REPO, "window": 6}).all()
        t1_wider = [r for r in wider if r.test_id == "bin::mod::t1"]
        assert [r.outcome for r in t1_wider].count("fail") == 1
        assert not any(r.head_sha.startswith("other") for r in wider), (
            "another repo's rows leaked into the history — `repo` is not bound "
            "on every probe"
        )
        assert "bin::mod::t_other" not in {r.test_id for r in wider}

        # ------------------------------------------------------------------
        # Claim 6. Downgrade: composites gone, prefix restored as it was.
        # ------------------------------------------------------------------
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE {_CTL_REPO_OBSERVED}"))
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _IDX_REPO_TEST_OBSERVED)
        assert not index_exists(engine, _IDX_REPO_OBSERVED)
        assert index_exists(engine, _IDX_PREFIX)
        assert _index_is_valid(engine, _IDX_PREFIX)
        assert "(repo, test_id)" in _index_def(engine, _IDX_PREFIX)
        with engine.connect() as conn:
            n = conn.execute(text("SELECT count(*) FROM coord.test_results")).scalar()
        assert n == 8 * (3 * 2) + 8 * 2, "downgrade must touch no rows"
