"""Behaviour test for the ``coord_iops_idx_01`` read-IOPS indexes.

The revision creates three indexes, all ``CONCURRENTLY``::

    idx_client_telemetry_obs_best_evidence
        ON coord.client_telemetry_observations
        (surface, origin, invariant, coverage DESC, observed_at DESC)
    idx_alerts_kind_first_seen_at
        ON coord.alerts (kind, first_seen_at)
    idx_policy_rule_resolutions_repo_pull_repo
        ON coord.policy_rule_resolutions
        (((resolved_entity -> 'context') ->> 'repo'), tenant_id)
        WHERE (resolved_entity ->> 'decision_domain') = 'repo_pull'

``migration-reversal.yml`` confirms that those statements *execute* on an empty
database, and nothing more. The contract is that **the planner chooses each
index for the exact SQL coord sends**. For index #3 that depends on PostgreSQL
proving that the query's ``WHERE`` implies the partial predicate. That proof is
syntactic, and an innocent-looking edit to either side breaks it silently.

What is asserted
================

1. **The revision adds.** At the parent revision none of the three exists.
2. **Each exists, is ``indisvalid``, and has the intended definition**, read
   back exactly with ``pg_get_indexdef`` and, for #3, ``pg_get_expr(indpred)``.
   A killed ``CONCURRENTLY`` build leaves an INVALID index that
   ``IF NOT EXISTS`` skips, so existence alone is not the contract.
3. **Self-maintenance.** Every row is seeded AFTER the build, with no
   ``REINDEX``.
4. **Index #1 serves both halves of coord's loose-index-scan rewrite.** The
   per-invariant best-evidence probe (``ORDER BY coverage DESC, observed_at
   DESC, id DESC LIMIT 1``) rides the index with no full ``Sort``. Only an
   ``Incremental Sort`` for the ``id`` tie-break is allowed. The next-invariant
   step is an index-only probe. The probe returns the coverage-1.0 row over a
   newer coverage-0 beacon row, and breaks an exact tie by ``id``.
5. **Index #1 can serve today's ``DISTINCT ON`` statement with no ``Sort``.**
   This is a weaker claim than #4, and deliberately so. With only sequential
   scans disabled, PostgreSQL 16.14 keeps a bitmap scan plus ``Sort`` for that
   statement (measured at 120 and at 12,030 interleaved rows per
   ``(surface, origin)``), so the planner does NOT pick the index for today's
   statement on cost. This assertion also disables bitmap scans, and so asserts
   capability: the index supplies the statement's exact order. The reader's win
   is the rewrite in #4.
6. **Index #2 serves the phase-8 stats read as a range probe on both
   columns.** It does so first with ZERO rows of the kind, which is the
   production state, and then with rows present, when the counts are checked.
   It also serves the ``slo_routes`` ``kill_switch_fired`` read, which is why
   the index is not partial on one kind.
7. **Index #3 serves the evidence read**, and the three counts are right on
   the fixture. The custom plan (bound literals) is what coord runs today:
   ``pull_timing_outcome_by_repo`` calls ``query_one`` with a literal statement
   and no ``prepare_cached``, so each call is planned afresh. The generic plan
   (``$1``/``$2``) is asserted as well, as future-proofing for a cached
   statement. ``agent_decision IS NOT NULL`` must appear as a heap ``Filter``:
   that conjunct is kept OUT of the predicate so that coord's later UPDATEs of
   ``agent_decision`` stay HOT (see the revision's docstring).
8. **Sensitivity for #3.** The same read with a different domain literal does
   NOT get the partial index. Without this, #7 would still pass against an
   index whose predicate had been widened or dropped, and it would not be
   measuring implication at all.
9. **Downgrade removes exactly the three.** The index set on the three tables
   returns to the parent's set, and every row survives.

The revision deliberately carries no build guards (in-progress refusal,
INVALID-leftover rebuild): coord's fail-closed migration classifier admits only
provable DDL, so ``indisvalid`` is verified after the production deploy instead
(see the revision's docstring).

``enable_seqscan = off`` for the plan assertions
================================================

The fixtures are small, so a sequential scan wins on cost whatever the index.
Turning it off removes the cost question and leaves the one being asked: CAN
the planner use this index for this query? If the predicate implication or the
ordering match does not hold, no penalty makes the index usable, which is how
the negative cases discriminate.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres. The tests are skipped when no Postgres is reachable.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "coord_iops_idx_01"
_PARENT_REVISION_ID = "overview_02_authoring_core"

_IDX_TELEMETRY = "idx_client_telemetry_obs_best_evidence"
_IDX_ALERTS = "idx_alerts_kind_first_seen_at"
_IDX_RESOLUTIONS = "idx_policy_rule_resolutions_repo_pull_repo"
_NEW_INDEXES = (_IDX_TELEMETRY, _IDX_ALERTS, _IDX_RESOLUTIONS)

_TABLES = ("client_telemetry_observations", "alerts", "policy_rule_resolutions")

# The definitions exactly as ``pg_get_indexdef`` renders them on PostgreSQL 16.
# Column ORDER, direction, key expression and predicate are all load-bearing:
# each one is part of what makes a reader below able to use the index.
_EXPECTED_INDEXDEF = {
    _IDX_TELEMETRY: (
        f"CREATE INDEX {_IDX_TELEMETRY} ON coord.client_telemetry_observations "
        "USING btree (surface, origin, invariant, coverage DESC, observed_at DESC)"
    ),
    _IDX_ALERTS: (
        f"CREATE INDEX {_IDX_ALERTS} ON coord.alerts USING btree (kind, first_seen_at)"
    ),
    _IDX_RESOLUTIONS: (
        f"CREATE INDEX {_IDX_RESOLUTIONS} ON coord.policy_rule_resolutions "
        "USING btree ((((resolved_entity -> 'context'::text) ->> 'repo'::text)), "
        "tenant_id) WHERE ((resolved_entity ->> 'decision_domain'::text) = "
        "'repo_pull'::text)"
    ),
}
# ``agent_decision IS NOT NULL`` is deliberately absent: a predicate column
# blocks HOT updates of that column, and coord updates it after insert.
_EXPECTED_RESOLUTIONS_PREDICATE = (
    "((resolved_entity ->> 'decision_domain'::text) = 'repo_pull'::text)"
)

# ---------------------------------------------------------------------------
# Reader SQL. #2 and #3 are transcribed from qontinui-coord ``origin/main``,
# close to character for character. The predicate proof is syntactic, so a
# simplified stand-in would prove nothing about the statement coord sends.
# ---------------------------------------------------------------------------

# ``client_telemetry_observer::latest_observations``' SELECT list.
_TELEMETRY_COLUMNS = (
    "observed_at, surface, origin, release, invariant, drift_class, "
    "drift_subclass, coverage, provenance, credibility, components"
)

# ``client_telemetry_observer::latest_observations`` as coord sends it TODAY,
# with ``:s`` / ``:o`` for coord's ``$1`` / ``$2``.
_TELEMETRY_CURRENT_SQL = (
    f"SELECT DISTINCT ON (invariant) {_TELEMETRY_COLUMNS} "
    "FROM coord.client_telemetry_observations "
    "WHERE surface = :s AND origin = :o "
    "ORDER BY invariant, coverage DESC, observed_at DESC"
)

# The per-invariant half of the recursive-CTE rewrite: the best-evidence row
# for one invariant. ``id DESC`` is the deterministic tie-break.
_TELEMETRY_BEST_PROBE_SQL = (
    f"SELECT id, {_TELEMETRY_COLUMNS} FROM coord.client_telemetry_observations "
    "WHERE surface = :s AND origin = :o AND invariant = :i "
    "ORDER BY coverage DESC, observed_at DESC, id DESC LIMIT 1"
)

# The stepping half of the rewrite: the next distinct invariant after ``:prev``.
_TELEMETRY_NEXT_INVARIANT_SQL = (
    "SELECT invariant FROM coord.client_telemetry_observations "
    "WHERE surface = :s AND origin = :o AND invariant > :prev "
    "ORDER BY invariant LIMIT 1"
)

# ``pr_merge/mod.rs`` ``refresh_phase8_db_stats``: leader-only, every 60 s.
_ALERTS_STATS_SQL = (
    "SELECT "
    "COUNT(*) FILTER (WHERE resolution_action = 'accepted')::BIGINT AS accepted, "
    "COUNT(*) FILTER (WHERE resolution_action IS NOT NULL)::BIGINT AS resolved, "
    "COUNT(*)::BIGINT AS total "
    "FROM coord.alerts "
    "WHERE kind = 'profile_drift_suggestion' "
    "AND first_seen_at > now() - INTERVAL '90 days'"
)

# ``pr_merge/slo_routes.rs`` ``load_kill_switch_history_30d``: the same shape
# for a different kind. This read is why index #2 is not partial.
_ALERTS_KILL_SWITCH_SQL = (
    "SELECT first_seen_at, detail FROM coord.alerts "
    "WHERE kind = 'kill_switch_fired' "
    "AND tenant_id = :tenant "
    "AND first_seen_at > now() - INTERVAL '30 days' "
    "ORDER BY first_seen_at DESC "
    "LIMIT 100"
)

# ``policies/evidence.rs`` ``pull_timing_outcome_by_repo``, with coord's own
# ``$1`` (repo) / ``$2`` (tenant) placeholders. With ``:repo`` / ``:tenant``
# binds it gets the custom plan coord runs today (``query_one`` on a literal, no
# ``prepare_cached``). As a PREPAREd statement it gets the generic plan, which is
# asserted only as future-proofing for a cached statement.
_EVIDENCE_SQL = (
    "WITH pulls AS ( "
    "SELECT r.resolved_at AS decided_at, "
    "r.agent_decision->>'chosen_option' AS opt, "
    "EXISTS ( "
    "SELECT 1 FROM coord.conflicts c "
    "WHERE c.repo = $1 "
    "AND c.created_at >  r.resolved_at "
    "AND c.created_at <= r.resolved_at + interval '24 hours' "
    ") AS conflict_after "
    "FROM coord.policy_rule_resolutions r "
    "WHERE (r.tenant_id = $2 OR r.tenant_id IS NULL) "
    "AND r.resolved_entity->>'decision_domain' = 'repo_pull' "
    "AND r.resolved_entity->'context'->>'repo' = $1 "
    "AND r.agent_decision IS NOT NULL "
    ") "
    "SELECT "
    "COUNT(*)::bigint AS total_recorded, "
    "COUNT(*) FILTER (WHERE opt = 'pulled')::bigint AS pulled_cnt, "
    "COUNT(*) FILTER (WHERE opt = 'pulled' AND conflict_after)::bigint "
    "AS pulled_then_conflict "
    "FROM pulls"
)
_EVIDENCE_SQL_BOUND = _EVIDENCE_SQL.replace("$1", ":repo").replace("$2", ":tenant")

# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

_TENANT = "1a0d7fd8-0000-4000-8000-000000000001"
_OTHER_TENANT = "1a0d7fd8-0000-4000-8000-000000000002"
_REPO = "qontinui-runner"

_SURFACES = ("web", "mobile_webview")
_ORIGINS = ("https://qontinui.io", "https://api.qontinui.io")
_INVARIANTS = ("auth_callback_health", "cors_health", "error_budget", "host_integrity")
_BEACON_TICKS = 30

# Fixed so every expected value below is exact.
_BASE = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
# The probed key: a newer coverage-0 beacon must NOT shadow the older
# coverage-1.0 synthetic rows, and of two synthetic rows tied on
# (coverage, observed_at) the later-inserted (higher id) one wins.
_PROBE_KEY = {"s": "web", "o": "https://qontinui.io", "i": "host_integrity"}
_SYNTHETIC_AT = _BASE - timedelta(minutes=20)

# Evidence fixture for ``_REPO`` / ``_TENANT``: ten decided repo_pull rows, one
# per hour back from ``_BASE``. Even hours pulled, odd hours deferred. One
# conflict opens at BASE - 3h30m, so the decisions at hours 4..9 (within the
# 24 h before it) have ``conflict_after``, and of those 4, 6 and 8 are pulls.
_EVIDENCE_DECISIONS = 10
_CONFLICT_AT = _BASE - timedelta(hours=3, minutes=30)
_EXPECTED_EVIDENCE = (10, 5, 3)


def _plan(
    conn: Connection,
    sql: str,
    params: Mapping[str, object] | None = None,
    also_disable: Sequence[str] = (),
) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised; see the module docstring.

    ``also_disable`` names further planner methods to penalise (``"bitmapscan"``)
    for a capability assertion. They are RESET afterwards. That is belt and
    braces: the caller's ``engine.connect()`` checkout runs inside a
    transaction that is rolled back on close, which also undoes a plain
    ``SET``.
    """
    conn.execute(text("SET enable_seqscan = off"))
    for method in also_disable:
        conn.execute(text(f"SET enable_{method} = off"))
    rows = conn.execute(text(f"EXPLAIN {sql}"), params or {}).all()
    for method in also_disable:
        conn.execute(text(f"RESET enable_{method}"))
    return "\n".join(str(r[0]) for r in rows)


def _plan_for(
    engine: Engine,
    sql: str,
    params: Mapping[str, object] | None = None,
    also_disable: Sequence[str] = (),
) -> str:
    with engine.connect() as conn:
        return _plan(conn, sql, params, also_disable)


_FULL_SORT_NODE = re.compile(r"(?:^|->)\s*Sort\s+\(")


def _has_full_sort(plan: str) -> bool:
    """True when the plan has a plain ``Sort`` node (not an ``Incremental Sort``)."""
    return any(_FULL_SORT_NODE.search(line) for line in plan.splitlines())


def _index_def(engine: Engine, index_name: str) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text("SELECT pg_get_indexdef(to_regclass('coord.' || :n))"),
                {"n": index_name},
            ).scalar()
            or ""
        )


def _index_predicate(engine: Engine, index_name: str) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(
                    """
                    SELECT pg_get_expr(i.indpred, i.indrelid)
                      FROM pg_index i
                     WHERE i.indexrelid = to_regclass('coord.' || :n)
                    """
                ),
                {"n": index_name},
            ).scalar()
            or ""
        )


def _index_is_valid(engine: Engine, index_name: str) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT indisvalid FROM pg_index "
                    "WHERE indexrelid = to_regclass('coord.' || :n)"
                ),
                {"n": index_name},
            ).scalar()
        )


def _index_set(engine: Engine) -> set[str]:
    """Every index on the three tables this revision touches."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'coord' AND tablename = ANY(:t)"
            ),
            {"t": list(_TABLES)},
        ).all()
    return {r[0] for r in rows}


def _seed_telemetry(conn: Connection) -> None:
    """Coverage-0 beacon ticks on every key, plus two synthetic rows on one key."""
    insert = text(
        """
        INSERT INTO coord.client_telemetry_observations
            (observed_at, surface, origin, invariant, drift_class, d3_outcome,
             posterior, coverage, provenance)
        VALUES (:at, :s, :o, :i, 'none', 'Confirmed', 0.1, :cov, :prov)
        """
    )
    for surface in _SURFACES:
        for origin in _ORIGINS:
            for invariant in _INVARIANTS:
                for tick in range(_BEACON_TICKS):
                    conn.execute(
                        insert,
                        {
                            # Tick 0 is NEWER than the synthetic rows.
                            "at": _BASE - timedelta(minutes=5 * tick),
                            "s": surface,
                            "o": origin,
                            "i": invariant,
                            "cov": 0.0,
                            "prov": "client_telemetry_beacon",
                        },
                    )
    for provenance in ("served_bundle_grep_first", "served_bundle_grep_second"):
        conn.execute(
            insert,
            {
                "at": _SYNTHETIC_AT,
                "s": _PROBE_KEY["s"],
                "o": _PROBE_KEY["o"],
                "i": _PROBE_KEY["i"],
                "cov": 1.0,
                "prov": provenance,
            },
        )
    conn.execute(text("ANALYZE coord.client_telemetry_observations"))


def _insert_alert(
    conn: Connection,
    key: str,
    kind: str,
    first_seen_at: datetime,
    resolution_action: str | None = None,
    tenant_id: str | None = None,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO coord.alerts
                (alert_key, severity, kind, summary, first_seen_at,
                 last_seen_at, resolution_action, tenant_id)
            VALUES (:key, 'info', :kind, :key, :at, :at, :ra,
                    CAST(:tenant AS uuid))
            """
        ),
        {
            "key": key,
            "kind": kind,
            "at": first_seen_at,
            "ra": resolution_action,
            "tenant": tenant_id,
        },
    )


def _seed_alerts_background(conn: Connection, now: datetime) -> None:
    """Other kinds only: production's state, with zero profile_drift_suggestion rows."""
    conn.execute(
        text(
            "INSERT INTO coord.tenants (tenant_id, slug, display_name) VALUES "
            "(CAST(:t AS uuid), 'iops-idx-test', 'iops idx test')"
        ),
        {"t": _TENANT},
    )
    for kind in ("red_main", "merge_escalation", "stale_wip", "ci_red"):
        for day in range(60):
            _insert_alert(conn, f"{kind}:{day}", kind, now - timedelta(days=day * 2))
    # kill_switch_fired: four for _TENANT inside 30 days, two outside, and two
    # inside with no tenant (excluded by the tenant filter).
    for day in (1, 5, 10, 20, 35, 60):
        _insert_alert(
            conn,
            f"ks:{day}",
            "kill_switch_fired",
            now - timedelta(days=day),
            tenant_id=_TENANT,
        )
    for day in (2, 3):
        _insert_alert(
            conn,
            f"ks-untenanted:{day}",
            "kill_switch_fired",
            now - timedelta(days=day),
        )
    conn.execute(text("ANALYZE coord.alerts"))


# (days ago, resolution_action) for profile_drift_suggestion. Inside the 90-day
# window: 2 accepted, 4 resolved, 6 total. The last two are outside it.
_DRIFT_SUGGESTIONS = (
    (1, "accepted"),
    (2, "accepted"),
    (3, "rejected"),
    (10, None),
    (45, "muted"),
    (89, None),
    (91, "accepted"),
    (200, "rejected"),
)
_EXPECTED_DRIFT_STATS = (2, 4, 6)


def _seed_drift_suggestions(conn: Connection, now: datetime) -> None:
    for days, action in _DRIFT_SUGGESTIONS:
        _insert_alert(
            conn,
            f"profile_drift_suggestion:{days}",
            "profile_drift_suggestion",
            now - timedelta(days=days),
            resolution_action=action,
        )
    conn.execute(text("ANALYZE coord.alerts"))


def _seed_resolutions(conn: Connection) -> None:
    """Decided repo_pull rows for ``_REPO`` plus every near-miss the read must exclude."""
    insert = text(
        """
        INSERT INTO coord.policy_rule_resolutions
            (policy_id, tenant_id, resolved_entity, action_taken, resolved_at,
             agent_decision)
        VALUES (gen_random_uuid(), CAST(:tenant AS uuid),
                jsonb_build_object('decision_domain', CAST(:domain AS text),
                                   'context',
                                   jsonb_build_object('repo', CAST(:repo AS text))),
                '{}'::jsonb, :at, CAST(:decision AS jsonb))
        """
    )

    def row(
        repo: str,
        hour: int,
        opt: str | None,
        domain: str = "repo_pull",
        tenant: str = _TENANT,
    ) -> dict[str, object]:
        return {
            "tenant": tenant,
            "domain": domain,
            "repo": repo,
            "at": _BASE - timedelta(hours=hour),
            "decision": None if opt is None else f'{{"chosen_option": "{opt}"}}',
        }

    rows: list[dict[str, object]] = []
    # Counted: ten decided repo_pull rows for _REPO / _TENANT.
    for hour in range(_EVIDENCE_DECISIONS):
        rows.append(row(_REPO, hour, "pulled" if hour % 2 == 0 else "deferred"))
    # Excluded, each by exactly one conjunct.
    for hour in range(5):
        rows.append(row(_REPO, hour, None))  # agent_decision IS NULL
        rows.append(row(_REPO, hour, "pulled", domain="pr_fix"))  # other domain
        rows.append(row(_REPO, hour, "pulled", tenant=_OTHER_TENANT))  # other tenant
    # Bulk: other repos' decided pulls, so the index is selective.
    for repo in ("qontinui-web", "qontinui-coord", "qontinui-schemas"):
        for hour in range(40):
            rows.append(row(repo, hour, "pulled"))
    for params in rows:
        conn.execute(insert, params)

    conflict = text(
        "INSERT INTO coord.conflicts (id, repo, conflict_ref, created_at) "
        "VALUES (gen_random_uuid(), :repo, :ref, :at)"
    )
    conn.execute(conflict, {"repo": _REPO, "ref": "c1", "at": _CONFLICT_AT})
    # A conflict on another repo at the same moment must not count for _REPO.
    conn.execute(conflict, {"repo": "qontinui-web", "ref": "c2", "at": _CONFLICT_AT})
    conn.execute(text("ANALYZE coord.policy_rule_resolutions"))
    conn.execute(text("ANALYZE coord.conflicts"))


_SKIP_NO_PG = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)


@_SKIP_NO_PG
def test_coord_iops_idx_01_indexes_serve_the_three_readers() -> None:
    """Build all three, prove each reader's plan and values, prove the near-misses don't match."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_iops_idx_test") as (
        engine,
        url,
    ):
        # ------------------------------------------------------------------
        # Step 1 (claim 1). Parent revision: none of the three exists yet.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for name in _NEW_INDEXES:
            assert not index_exists(engine, name), (
                f"{name} must be created by this revision, not an earlier one"
            )
        parent_indexes = _index_set(engine)

        # ------------------------------------------------------------------
        # Step 2 (claim 2). Apply: each exists, is VALID, and has the intended
        # definition.
        # ------------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)

        for name in _NEW_INDEXES:
            assert index_exists(engine, name)
            assert _index_is_valid(engine, name), (
                f"{name} is INVALID - a killed CONCURRENTLY build leaves an index "
                "of the right name that IF NOT EXISTS skips on re-run"
            )
            definition = _index_def(engine, name)
            assert definition == _EXPECTED_INDEXDEF[name], (
                f"{name} definition drifted - column order, direction, key "
                "expression and predicate are all load-bearing.\n"
                f"expected: {_EXPECTED_INDEXDEF[name]}\n"
                f"got:      {definition}"
            )
        assert _index_predicate(engine, _IDX_RESOLUTIONS) == (
            _EXPECTED_RESOLUTIONS_PREDICATE
        )
        assert _index_set(engine) == parent_indexes | set(_NEW_INDEXES), (
            "the revision must add exactly the three indexes and touch no other"
        )

        # ------------------------------------------------------------------
        # Step 3 (claims 3, 4, 5). Index #1: seed after the build, then both halves
        # of the loose index scan.
        # ------------------------------------------------------------------
        with engine.begin() as conn:
            _seed_telemetry(conn)

        probe_plan = _plan_for(engine, _TELEMETRY_BEST_PROBE_SQL, _PROBE_KEY)
        assert f"Index Scan using {_IDX_TELEMETRY}" in probe_plan, (
            "the per-invariant best-evidence probe must ride the new index; "
            f"got:\n{probe_plan}"
        )
        assert any(
            "Index Cond" in line
            and "surface = " in line
            and "origin = " in line
            and "invariant = " in line
            for line in probe_plan.splitlines()
        ), (
            "surface, origin AND invariant must all be index conditions on ONE "
            f"Index Cond line, not a Filter; got:\n{probe_plan}"
        )
        assert not _has_full_sort(probe_plan), (
            "the index supplies coverage DESC, observed_at DESC in order, so at "
            "most an Incremental Sort (for the id tie-break) may appear - never "
            f"a full Sort of the key's rows; got:\n{probe_plan}"
        )
        assert "Seq Scan" not in probe_plan, probe_plan

        step_plan = _plan_for(
            engine,
            _TELEMETRY_NEXT_INVARIANT_SQL,
            {"s": _PROBE_KEY["s"], "o": _PROBE_KEY["o"], "prev": "cors_health"},
        )
        assert f"Index Only Scan using {_IDX_TELEMETRY}" in step_plan, (
            "stepping to the next distinct invariant must be an index-only probe "
            f"on (surface, origin, invariant); got:\n{step_plan}"
        )
        assert not _has_full_sort(step_plan), step_plan

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            best = conn.execute(text(_TELEMETRY_BEST_PROBE_SQL), _PROBE_KEY).one()
            next_invariant = conn.execute(
                text(_TELEMETRY_NEXT_INVARIANT_SQL),
                {"s": _PROBE_KEY["s"], "o": _PROBE_KEY["o"], "prev": "cors_health"},
            ).scalar_one()
        assert best.coverage == 1.0 and best.observed_at == _SYNTHETIC_AT, (
            "coverage dominates recency: the coverage-1.0 row must beat the NEWER "
            f"coverage-0 beacon tick; got {best!r}"
        )
        assert best.provenance == "served_bundle_grep_second", (
            "of two rows tied on (coverage, observed_at), id DESC picks the later "
            f"insert; got {best.provenance!r}"
        )
        assert next_invariant == "error_budget"

        # Claim 5: today's DISTINCT ON statement. Capability only - see the
        # module docstring for why bitmap scans are disabled here as well.
        current_key = {"s": _PROBE_KEY["s"], "o": _PROBE_KEY["o"]}
        current_plan = _plan_for(
            engine, _TELEMETRY_CURRENT_SQL, current_key, also_disable=("bitmapscan",)
        )
        assert f"Index Scan using {_IDX_TELEMETRY}" in current_plan, (
            "today's DISTINCT ON statement must be able to ride the new index; "
            f"got:\n{current_plan}"
        )
        assert not _has_full_sort(current_plan), (
            "the index supplies ORDER BY invariant, coverage DESC, observed_at "
            "DESC exactly once surface and origin are fixed, so no Sort may "
            f"appear; got:\n{current_plan}"
        )
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            conn.execute(text("SET enable_bitmapscan = off"))
            current = conn.execute(text(_TELEMETRY_CURRENT_SQL), current_key).all()
            conn.execute(text("RESET enable_bitmapscan"))
        assert [r.invariant for r in current] == sorted(_INVARIANTS), current
        for r in current:
            if r.invariant == _PROBE_KEY["i"]:
                assert (r.coverage, r.observed_at) == (1.0, _SYNTHETIC_AT), r
            else:
                assert (r.coverage, r.observed_at) == (0.0, _BASE), r

        # ------------------------------------------------------------------
        # Step 4 (claim 6). Index #2: zero rows of the kind first (the
        # production state), then rows present.
        # ------------------------------------------------------------------
        now = datetime.now(UTC)
        with engine.begin() as conn:
            _seed_alerts_background(conn, now)

        stats_plan = _plan_for(engine, _ALERTS_STATS_SQL)
        assert _IDX_ALERTS in stats_plan, (
            "the phase-8 stats read must ride the new index even with zero rows "
            f"of its kind; got:\n{stats_plan}"
        )
        assert any(
            "Index Cond" in line
            and "kind = 'profile_drift_suggestion'" in line
            and "first_seen_at >" in line
            for line in stats_plan.splitlines()
        ), (
            "kind AND the first_seen_at window must both be index conditions - a "
            f"range probe, not a kind scan with a filter; got:\n{stats_plan}"
        )
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            assert tuple(conn.execute(text(_ALERTS_STATS_SQL)).one()) == (0, 0, 0)

        with engine.begin() as conn:
            _seed_drift_suggestions(conn, now)

        with engine.connect() as conn:
            assert _IDX_ALERTS in _plan(conn, _ALERTS_STATS_SQL)
            stats = tuple(conn.execute(text(_ALERTS_STATS_SQL)).one())
        assert stats == _EXPECTED_DRIFT_STATS, (
            "accepted / resolved / total inside the 90-day window; rows older "
            f"than the window must not count. Got {stats!r}"
        )

        kill_plan = _plan_for(engine, _ALERTS_KILL_SWITCH_SQL, {"tenant": _TENANT})
        assert _IDX_ALERTS in kill_plan and "Seq Scan" not in kill_plan, (
            "the slo_routes kill_switch_fired read has the same shape for another "
            "kind - the reason index #2 is not partial - and must ride it too; "
            f"got:\n{kill_plan}"
        )
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            kills = conn.execute(
                text(_ALERTS_KILL_SWITCH_SQL), {"tenant": _TENANT}
            ).all()
        assert len(kills) == 4, f"four tenant kill switches in 30 days; got {kills!r}"
        assert [k.first_seen_at for k in kills] == sorted(
            (k.first_seen_at for k in kills), reverse=True
        )

        # ------------------------------------------------------------------
        # Step 5 (claim 7). Index #3: custom plan, generic plan, and values.
        # ------------------------------------------------------------------
        with engine.begin() as conn:
            _seed_resolutions(conn)

        bound = {"repo": _REPO, "tenant": _TENANT}
        custom_plan = _plan_for(engine, _EVIDENCE_SQL_BOUND, bound)
        assert _IDX_RESOLUTIONS in custom_plan, (
            "the evidence read must ride the partial index - the query's literal "
            "conjuncts must imply its predicate; got:\n" + custom_plan
        )
        assert "Seq Scan on policy_rule_resolutions" not in custom_plan, custom_plan
        assert any(
            "Index Cond" in line and "'repo'" in line
            for line in custom_plan.splitlines()
        ), (
            "the repo expression must be an Index Cond: a partial index whose "
            "predicate is implied can still be walked whole with no key "
            "condition, reading every repo_pull entry instead of one repo's "
            f"slice; got:\n{custom_plan}"
        )
        assert any(
            "Filter:" in line and "agent_decision IS NOT NULL" in line
            for line in custom_plan.splitlines()
        ), (
            "agent_decision IS NOT NULL must be a heap Filter, not part of the "
            "index predicate: a predicate column blocks HOT updates of it, and "
            f"coord updates agent_decision after insert; got:\n{custom_plan}"
        )

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            conn.execute(text(f"PREPARE iops_evidence(text, uuid) AS {_EVIDENCE_SQL}"))
            conn.execute(text("SET plan_cache_mode = force_generic_plan"))
            generic_plan = "\n".join(
                str(r[0])
                for r in conn.execute(
                    text("EXPLAIN EXECUTE iops_evidence(:repo, :tenant)"), bound
                ).all()
            )
            generic_values = tuple(
                conn.execute(text("EXECUTE iops_evidence(:repo, :tenant)"), bound).one()
            )
            conn.execute(text("DEALLOCATE iops_evidence"))
            # Belt and braces: closing this checkout rolls its transaction
            # back, which also undoes the SETs, so the generic-plan mode cannot
            # reach the custom-plan checks below either way.
            conn.execute(text("RESET plan_cache_mode"))
        assert any(
            "Index Cond" in line and "'repo'" in line and "$1" in line
            for line in generic_plan.splitlines()
        ), (
            "the generic plan must probe the repo expression with $1 as an "
            f"Index Cond, not walk the whole partial index; got:\n{generic_plan}"
        )
        assert "$1" in generic_plan, (
            "force_generic_plan must yield a plan over the placeholders, or this "
            f"is not testing the generic plan at all:\n{generic_plan}"
        )
        assert _IDX_RESOLUTIONS in generic_plan, (
            "future-proofing: coord plans this read afresh on every call today "
            "(query_one on a literal, no prepare_cached), but if it is ever "
            "cached, the GENERIC plan must ride the partial index too - the "
            f"predicate proof may use only the literal conjuncts there; "
            f"got:\n{generic_plan}"
        )

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            custom_values = tuple(conn.execute(text(_EVIDENCE_SQL_BOUND), bound).one())
        assert custom_values == _EXPECTED_EVIDENCE, (
            "total_recorded / pulled_cnt / pulled_then_conflict for the fixture; "
            f"got {custom_values!r}"
        )
        assert generic_values == _EXPECTED_EVIDENCE, generic_values

        # ------------------------------------------------------------------
        # Step 6 (claim 8). Sensitivity: a near-miss must NOT get the partial
        # index. If it does, the predicate has been widened or dropped, and
        # the positive assertions above have stopped measuring implication.
        # ------------------------------------------------------------------
        other_domain_sql = _EVIDENCE_SQL_BOUND.replace(
            "'decision_domain' = 'repo_pull'", "'decision_domain' = 'pr_fix'"
        )
        assert other_domain_sql != _EVIDENCE_SQL_BOUND
        near_plan = _plan_for(engine, other_domain_sql, bound)
        assert _IDX_RESOLUTIONS not in near_plan, (
            "the evidence read with decision_domain = 'pr_fix' does not imply "
            "the partial predicate, so it must NOT get the index - if it does, "
            "the predicate is wider than intended:\n" + near_plan
        )

        # ------------------------------------------------------------------
        # Step 7 (claim 9). Downgrade removes exactly the three.
        # ------------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)

        assert _index_set(engine) == parent_indexes, (
            "downgrade must drop the three new indexes and nothing else"
        )
        with engine.connect() as conn:
            counts = {
                table: conn.execute(
                    text(f"SELECT count(*) FROM coord.{table}")
                ).scalar()
                for table in _TABLES
            }
        assert counts == {
            "client_telemetry_observations": (
                len(_SURFACES) * len(_ORIGINS) * len(_INVARIANTS) * _BEACON_TICKS + 2
            ),
            "alerts": 4 * 60 + 6 + 2 + len(_DRIFT_SUGGESTIONS),
            "policy_rule_resolutions": _EVIDENCE_DECISIONS + 5 * 3 + 3 * 40,
        }, f"downgrade drops indexes only - rows are untouched; got {counts!r}"
