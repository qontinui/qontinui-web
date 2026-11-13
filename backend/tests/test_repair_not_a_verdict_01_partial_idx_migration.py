"""Behaviour test for the ``repair_not_a_verdict_01_partial_idx`` revision.

The revision adds the partial index ``idx_pr_events_repair_not_a_verdict`` on
``coord.pr_events``. It lets the decided-set scan of the plan's candidate count
query ``repair_not_a_verdict_heads_without_rerun`` read the few ``not_a_verdict``
decisions instead of every ``repair_decision`` row in its 7-day window. Plan
``2026-11-13-not-a-verdict-rerun-behaviour-probe``, Phase 2. The plan's Phase 3
lands that query in qontinui-coord ``count_query/merge_train.rs``; it is not on
coord's main as of 2026-11-13. Until Phase 3 (qontinui-coord branch
``agent/eb2155ed4152-d2980fe1/not-a-verdict-count-query-phase-3``) lands, this
file pins the INDEX against a copy of the plan's candidate statement, and Phase 3
adds coord's own literal-pinning test for the STATEMENT's side. Once both are on
main, a change to either side's literals reddens a test. Neither test sees the
other side's file.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent names exactly one real sibling, and the docstring's ``Revises:`` header
   agrees with the assignment. The docstring's post-deploy identity check quotes
   ``_EXPECTED_DEFINITION`` verbatim. Its repair runbook takes the lock once and
   releases it at both exits, each call spelling ``MIGRATION_LOCK_KEY``.
2. **The upgrade path is what coord's merge classifier auto-lands**: one static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literal in an autocommit block, no
   other ``op.*`` call (so no non-concurrent ``op.create_index``), no ``get_bind``,
   no module-level helper. The downgrade is one ``DROP INDEX CONCURRENTLY IF
   EXISTS`` in an autocommit block, and ``check_coord_column_drops`` finds nothing.
3. **The scan's literals imply the partial predicate.** Postgres uses a partial
   index only when it can prove that the statement's ``WHERE`` implies the index's
   predicate. So every conjunct of the predicate, with the scan's ``e.`` alias, must
   be a top-level conjunct of the scan's ``WHERE``, spelled the same way. The index
   key must also be the column the scan's 7-day window bounds. The conjunct
   splitter this relies on refuses a top-level ``OR``, matched as a keyword
   rather than by its spaces: ``OR(x)`` and ``)OR`` raise, while ``ORDER``, a
   quoted or parenthesised ``OR`` and identifiers such as ``color`` do not. Two
   parametrised tests pin both sides.

Against a real Postgres (skipped when none is reachable):

4. Nothing exists at the parent revision.
5. After upgrade the index exists, is **``indisvalid``**, and is exactly the
   intended definition, the partial predicate included.
6. **The scan rides it under BOTH a custom and a generic plan.** Phase 1 measured
   the statement under a forced generic plan, the mode in which only a literal can
   prove the predicate. A custom plan is what a one-shot execution gets. The
   literals make the match independent of the plan mode. ``plan_cache_mode``
   forces each, and the scan runs as a prepared statement.
7. **The index is what makes the scan cheap,** in both modes. A window holding
   30,000 decisions of other reasons costs a handful of buffers after the upgrade,
   and many times more at the parent revision, where every decision in the window
   is visited and its JSON filtered. After the upgrade the scan's cost follows the
   not-a-verdict population, not the ledger's growth.
8. **Both literals are load-bearing.** With either one bound as ``$3``, the scan
   cannot use the index under a generic plan, and can under a custom one. That is
   the instrument showing it can tell "cannot" from "did not".

"Cannot use" is asserted with every other index gone and sequential scans priced
out, so it says the partial predicate cannot be proved from the scan's clauses.
Plain ``EXPLAIN`` on a table this small could stay off the index on cost alone.

9. **A re-run leaves the VALID index alone (same oid), and keeps an INVALID one.**
   The revision carries no in-migration repair, so this pins what its docstring
   tells a reader to check after the deploy.
10. Downgrade removes the index and leaves every row; a second upgrade re-applies.

That the scan returns the same rows with and without the index is a property of
Postgres, not of this revision. The seeded answer is checked only so the plans
above are measured over rows the scan actually returns. The plan's Phase 2 gate
re-measures the scan in production after the deploy.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it at a
non-default host:port).
"""

from __future__ import annotations

import ast
import re
import sys
import warnings
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.db.migration_lock import MIGRATION_LOCK_KEY
from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "repair_not_a_verdict_01_partial_idx"
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_INDEX_NAME = "idx_pr_events_repair_not_a_verdict"

_REPO = "o/nav-idx-test"
_PEER_REPO = "o/nav-idx-peer"
_FOREIGN_REPO = "o/nav-idx-foreign"

_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_INDEX_NAME} ON coord.pr_events USING btree (created_at) "
    "WHERE ((event_kind = 'repair_decision'::text) AND "
    "((payload ->> 'reason'::text) = 'not_a_verdict'::text))"
)

# The decided-set scan's WHERE, as the plan's candidate (plan Phase 1) and the
# Phase 3 branch spell it. At that branch's 0fdf4e076a0a (read 2026-11-13) its
# six conjuncts before the tenant authority clause read exactly as below. This
# is NOT Phase 3's whole `decided_rows` CTE: the branch adds a `LEFT JOIN
# LATERAL` reset probe and a `reset_at` column, which this copy leaves out. The
# SELECT list is the plan candidate's, and the tenant authority clause is
# spelled as a literal `IN` list of this test's repos, the form Phase 1
# measured. The statement binds `$1` (the tenant, which only the authority
# clause reads) and `$2` (the optional repo). Phase 3 will land the statement
# in coord as `REPAIR_NOT_A_VERDICT_HEADS_WITHOUT_RERUN_SQL`; it is not on
# coord's main as of 2026-11-13. A literal copy on purpose: the index will
# serve coord only while the two WHEREs match, and this is what reddens if the
# revision's side moves.
#
# RE-ANCHOR when Phase 3 lands: replace this WHERE with the one coord's commit
# spells and cite that commit here, the way
# test_repair_rerun_01_partial_idx_migration.py anchors its `_RERUNS_SPENT_SQL`
# copy to coord `57ef9eadd76a`. Plan 2026-11-13-not-a-verdict-rerun-behaviour-probe
# Phase 4 owns that step. Until then this WHERE is anchored to the plan and to
# Phase 3's qontinui-coord branch
# agent/eb2155ed4152-d2980fe1/not-a-verdict-count-query-phase-3, not to coord's
# main.
_DECIDED_SCAN_SQL = (
    "SELECT e.repo, e.pr_number, e.payload->>'head_sha' AS head, e.created_at, "
    "COALESCE("
    "CASE WHEN jsonb_typeof(e.payload->'first_seen_at') = 'string' "
    "AND pg_input_is_valid(e.payload->>'first_seen_at', 'timestamptz') "
    "THEN CASE WHEN isfinite((e.payload->>'first_seen_at')::timestamptz) "
    "THEN (e.payload->>'first_seen_at')::timestamptz END "
    "END, "
    "e.created_at) AS fs "
    "FROM coord.pr_events e "
    "WHERE e.event_kind = 'repair_decision' "
    "AND e.payload->>'reason' = 'not_a_verdict' "
    "AND e.payload->>'cause' = 'flake_infra' "
    "AND e.created_at >= now() - interval '7 days' "
    "AND COALESCE(e.payload->>'head_sha', '') <> '' "
    "AND ($2::text IS NULL OR e.repo = $2::text) "
    f"AND e.repo IN ('{_REPO}', '{_PEER_REPO}')"
)
_DECIDED_SCAN_PARAMS = "uuid, text"
_DECIDED_SCAN_ARGS = "'00000000-0000-4000-8000-000000000001'::uuid, NULL"

# The scan's WHERE, as the candidate statement spells it, for the no-database check.
_SCAN_WHERE = _DECIDED_SCAN_SQL.split(" WHERE ", 1)[1]
assert _DECIDED_SCAN_SQL.count(" WHERE ") == 1, "the copy grew a second WHERE"

# Each literal of the partial predicate, as the scan spells it. Assertion 8 binds
# each one in turn: a generic plan cannot prove a bound parameter implies it.
_PREDICATE_LITERALS = ("'repair_decision'", "'not_a_verdict'")
for _literal in _PREDICATE_LITERALS:
    assert _DECIDED_SCAN_SQL.count(f"= {_literal}") == 1, _literal

# Matching rows are every `_MATCH_EVERY`-th of the bulk seed, spread across the heap.
_BULK_ROWS = 30_000
_MATCH_EVERY = 5_000

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _squash(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


# The OR keyword: any case, not preceded by a word character, `$` or `.`, and not
# followed by a word character or `$`. So `OR(x)` and `)OR` match, while
# `ORDER`, `color`, `or_flag` and `e.ORDER` do not.
_TOP_LEVEL_OR = re.compile(r"(?<![\w$.])OR(?![\w$])", re.IGNORECASE)


def _top_level_conjuncts(where: str) -> list[str]:
    """Split ``where`` on its top-level ``AND`` s, refusing a top-level ``OR``.

    ``where`` is first squashed (each whitespace run becomes one space, and the
    ends are stripped). One walk then tracks parenthesis depth and quoting; a
    ``'`` toggles quoting, so a doubled ``''`` inside a literal toggles twice and
    leaves it unchanged. At depth 0 outside quotes, the walk:

    - raises ``ValueError`` (its message names a top-level OR) where
      ``_TOP_LEVEL_OR`` matches;
    - splits where `` AND `` stands, one space on each side, in any case.

    A clause with a top-level ``OR`` is not a conjunction. Its pieces are not
    conjuncts, and a partial-index predicate cannot be proved from them.
    Without the raise, an ``OR`` appended to the scan's ``WHERE`` would leave
    every predicate conjunct "found" and the always-run predicate test green.
    """
    parts: list[str] = []
    depth = 0
    in_quote = False
    start = 0
    i = 0
    squashed = _squash(where)
    while i < len(squashed):
        ch = squashed[i]
        if ch == "'":
            in_quote = not in_quote
        elif not in_quote and ch == "(":
            depth += 1
        elif not in_quote and ch == ")":
            depth -= 1
        elif not in_quote and depth == 0 and _TOP_LEVEL_OR.match(squashed, i):
            raise ValueError(
                f"a top-level OR at offset {i} of {squashed!r}: the clause is not "
                "a conjunction, so a partial-index predicate cannot be proved "
                "from its parts"
            )
        elif not in_quote and depth == 0 and squashed[i : i + 5].upper() == " AND ":
            parts.append(squashed[start:i].strip())
            start = i + len(" AND ")
            i = start
            continue
        i += 1
    parts.append(squashed[start:].strip())
    return parts


# ---------------------------------------------------------------------------
# 1-3. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    siblings = [
        f
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None

    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)
    # The docstring's post-deploy identity check compares production's
    # `pg_get_indexdef` against a definition it quotes; that quote must be this
    # test's pinned one, or the check compares against a stale string.
    assert _EXPECTED_DEFINITION in source, (
        "the docstring's post-deploy check must quote _EXPECTED_DEFINITION verbatim"
    )
    # The repair runbook takes the migration lock once (step 1) and releases it
    # at each of its two exits (the STOP in step 3, and step 6), every call
    # spelling the key. A key that drifts from the one every migrator takes would
    # not serialize the repair with them, and a missing release leaves a hold
    # that times every migrator out.
    calls = re.findall(
        r"\b(pg_try_advisory_lock|pg_advisory_lock|pg_advisory_unlock)\((\d+)\)",
        source,
    )
    assert sorted(name for name, _ in calls) == [
        "pg_advisory_unlock",
        "pg_advisory_unlock",
        "pg_try_advisory_lock",
    ], f"the runbook's lock calls changed shape: {calls}"
    for name, key in calls:
        assert int(key) == MIGRATION_LOCK_KEY, (
            f"the docstring's runbook calls {name}({key}), but MIGRATION_LOCK_KEY is "
            f"{MIGRATION_LOCK_KEY}"
        )


def test_the_upgrade_and_downgrade_paths_are_classifier_safe() -> None:
    """coord's classifier rejects a non-concurrent ``CREATE INDEX``, a read through
    ``op.get_bind``, and a DROP on the upgrade path; a Reject parks the PR on its
    author. A killed build leaves an INVALID index the revision deliberately does not
    repair, because that repair is a read plus a DROP.
    """
    path = _revision_path()
    module = ast.parse(_revision_source())
    functions = {
        n.name
        for n in module.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    assert functions == {"upgrade", "downgrade"}, (
        f"a module-level helper is read by the classifier as well: {sorted(functions)}"
    )
    assert not any(isinstance(n, ast.Lambda) for n in ast.walk(module)), (
        "a lambda is a helper the classifier reads as well"
    )
    binds = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Attribute) and node.attr == "get_bind"
    ]
    assert not binds, f"get_bind anywhere in the revision, at lines {binds}"
    # Only `op.get_context()` and `op.execute(...)`: an added `op.create_index` (a
    # non-concurrent build) or `op.drop_index` is not an `op.execute` and would
    # otherwise slip past the count below.
    op_calls = sorted(
        {
            node.attr
            for node in ast.walk(module)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "op"
        }
    )
    assert op_calls == ["execute", "get_context"], f"op.* calls: {op_calls}"

    up = upgrade_execute_calls(path)
    assert len(up) == 1, "one CREATE INDEX, and nothing else on the upgrade path"
    assert up[0].sql is not None, "the execute argument is one static literal"
    assert up[0].in_autocommit_block, "CONCURRENTLY cannot run in a transaction"
    create = _squash(up[0].sql).upper()
    assert create.startswith(
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_INDEX_NAME.upper()} "
        "ON COORD.PR_EVENTS "
    ), create
    assert "DROP" not in create, create

    down = upgrade_execute_calls(path, function="downgrade")
    assert len(down) == 1
    assert down[0].sql is not None
    assert down[0].in_autocommit_block, (
        "DROP ... CONCURRENTLY cannot run in a transaction"
    )
    assert _squash(down[0].sql) == (
        f"DROP INDEX CONCURRENTLY IF EXISTS coord.{_INDEX_NAME}"
    ), "a plain DROP INDEX takes ACCESS EXCLUSIVE on a hot table"

    scan = guard.scan_source(_revision_source(), path)
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


def test_the_scans_literals_imply_the_partial_predicate() -> None:
    """Every predicate conjunct, with the scan's ``e.`` alias, is one of its own.

    Postgres matches a partial index by proving implication from the query's clauses,
    so a predicate conjunct the scan does not spell the same way (another literal, an
    added conjunct, a parameter) makes the index invisible to the scan with no error
    anywhere. The scan's other conjuncts (``cause``, the window, the head and repo
    filters) may stay heap filters: implication needs only the predicate's own.
    """
    sql = upgrade_execute_calls(_revision_path())[0].sql
    assert sql is not None
    match = re.search(r"\bON coord\.pr_events \((\w+)\) WHERE\b(.*)$", _squash(sql))
    assert match is not None, sql
    key, predicate = match.group(1), match.group(2).strip()

    scan_conjuncts = _top_level_conjuncts(_SCAN_WHERE)
    predicate_conjuncts = _top_level_conjuncts(predicate)
    assert len(predicate_conjuncts) == 2, predicate_conjuncts
    for conjunct in predicate_conjuncts:
        aliased = re.sub(r"\b(event_kind|payload)\b", r"e.\1", conjunct)
        assert aliased in scan_conjuncts, (
            f"the index predicate's {conjunct!r} is not spelled by the decided-set "
            f"scan, whose top-level conjuncts are {scan_conjuncts!r}"
        )

    assert key == "created_at", key
    assert f"e.{key} >= now() - interval '7 days'" in scan_conjuncts, (
        f"the index key {key!r} must be the column the scan's window bounds"
    )


@pytest.mark.parametrize(
    "where",
    [
        "e.a = 1 OR true",
        "e.a = 1 or true",
        "e.a = 1 OR(true)",
        "(e.a = 1)OR e.b = 2",
    ],
)
def test_the_conjunct_splitter_refuses_a_top_level_or(where: str) -> None:
    """A top-level ``OR`` raises, with or without spaces around the keyword."""
    with pytest.raises(ValueError, match="top-level OR"):
        _top_level_conjuncts(where)


@pytest.mark.parametrize(
    ("where", "expected"),
    [
        ("e.a = 1 AND e.b = 2 ORDER BY e.c", ["e.a = 1", "e.b = 2 ORDER BY e.c"]),
        ("e.reason = ' OR ' AND e.b = 2", ["e.reason = ' OR '", "e.b = 2"]),
        ("(e.a = 1 OR e.b = 2) AND e.c = 3", ["(e.a = 1 OR e.b = 2)", "e.c = 3"]),
        (
            "color = 1 AND or_flag AND e.ORDER = 2",
            ["color = 1", "or_flag", "e.ORDER = 2"],
        ),
    ],
)
def test_the_conjunct_splitter_lets_every_other_or_through(
    where: str, expected: list[str]
) -> None:
    """``ORDER``, a quoted or parenthesised ``OR``, and identifiers do not raise."""
    assert _top_level_conjuncts(where) == expected


# ---------------------------------------------------------------------------
# 4-10. real Postgres
# ---------------------------------------------------------------------------


def _bulk_repo(k: int) -> str:
    """The repo the bulk seed gives row ``k`` (the SQL's ``(k / 7) % 2``)."""
    return _REPO if (k // 7) % 2 == 0 else _PEER_REPO


def _seed(engine: Engine) -> set[tuple[str, int, str]]:
    """A decision ledger shaped like production's, and the rows the scan expects.

    30,000 ``repair_decision`` rows of other reasons span the last ~5.2 days across
    40 PRs of two in-scope repos, in time order, so the window holds all of them and
    the parent revision's scan must visit each. Every 5,000th row is instead a
    ``not_a_verdict`` / ``flake_infra`` decision on its own head: those six rows are
    the answer, spread across the heap. Near-misses on each side of the predicate
    must stay out of the answer: four the index holds and the scan's other clauses
    reject (outside the window, another cause, an empty head, a repo outside the
    authority list), and two the predicate itself rejects (another event kind, and
    the ``not_a_verdict_rerun_spent`` reason).
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                SELECT CASE WHEN (k / 7) % 2 = 0 THEN :repo ELSE :peer END,
                       1 + k % 40,
                       'repair_decision',
                       CASE WHEN k % :every = 0 THEN
                                jsonb_build_object(
                                    'head_sha', 'nav-head-' || k,
                                    'cause', 'flake_infra',
                                    'reason', 'not_a_verdict',
                                    'action', 'classified')
                            ELSE
                                jsonb_build_object(
                                    'head_sha', 'head-' || (k % 40) || '-' || (k / 1000),
                                    'cause', (CAST(:causes AS text[]))[1 + k % 4],
                                    'reason', (CAST(:reasons AS text[]))[1 + k % 4],
                                    'action', (CAST(:actions AS text[]))[1 + k % 4],
                                    'evidence', jsonb_build_array(
                                        'filler-so-rows-are-realistically-wide'))
                       END,
                       now() - make_interval(secs => k * 15)
                  FROM generate_series(1, :rows) AS k
                 ORDER BY k DESC
                """
            ),
            {
                "repo": _REPO,
                "peer": _PEER_REPO,
                "every": _MATCH_EVERY,
                "rows": _BULK_ROWS,
                "causes": ["positional", "intrinsic", "flake_infra", "unknown"],
                "reasons": [
                    "conflict_only",
                    "check_failed",
                    "not_a_verdict_rerun_spent",
                    "main_flake_beside_uncompared",
                ],
                "actions": ["skip", "classified", "cleared", "rerun"],
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                VALUES
                    -- In the index; the scan's other clauses reject each one.
                    (:repo, 901, 'repair_decision',
                     jsonb_build_object('head_sha', 'nav-old', 'cause', 'flake_infra',
                                        'reason', 'not_a_verdict'),
                     now() - interval '8 days'),
                    (:repo, 902, 'repair_decision',
                     jsonb_build_object('head_sha', 'nav-unknown', 'cause', 'unknown',
                                        'reason', 'not_a_verdict'),
                     now()),
                    (:repo, 903, 'repair_decision',
                     jsonb_build_object('head_sha', '', 'cause', 'flake_infra',
                                        'reason', 'not_a_verdict'),
                     now()),
                    (:foreign, 904, 'repair_decision',
                     jsonb_build_object('head_sha', 'nav-foreign', 'cause', 'flake_infra',
                                        'reason', 'not_a_verdict'),
                     now()),
                    -- Outside the predicate itself.
                    (:repo, 905, 'predicate_eval',
                     jsonb_build_object('head_sha', 'nav-kind', 'cause', 'flake_infra',
                                        'reason', 'not_a_verdict'),
                     now()),
                    (:repo, 906, 'repair_decision',
                     jsonb_build_object('head_sha', 'nav-spent', 'cause', 'unknown',
                                        'reason', 'not_a_verdict_rerun_spent'),
                     now())
                """
            ),
            {"repo": _REPO, "foreign": _FOREIGN_REPO},
        )
        conn.execute(text("ANALYZE coord.pr_events"))

    return {
        (_bulk_repo(k), 1 + k % 40, f"nav-head-{k}")
        for k in range(_MATCH_EVERY, _BULK_ROWS + 1, _MATCH_EVERY)
    }


def _prepared(
    engine: Engine,
    *,
    sql: str,
    params: str,
    args: str,
    plan_cache_mode: str,
    explain: str | None,
    no_alternative: bool = False,
) -> list[tuple[object, ...]]:
    """Run ``sql`` as a prepared statement under ``plan_cache_mode``.

    ``explain`` is ``None`` to execute it, or the EXPLAIN options to plan it. With
    ``no_alternative`` every other droppable index on the table goes and sequential
    scans are priced out, inside a transaction that is rolled back: if the partial
    predicate can be proved from the statement's clauses the plan names this index,
    and if it cannot, no cost can make it.
    """
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.exec_driver_sql("DEALLOCATE ALL")
            if no_alternative:
                others = conn.execute(
                    text(
                        """
                        SELECT i.indexrelid::regclass::text
                          FROM pg_index i
                         WHERE i.indrelid = 'coord.pr_events'::regclass
                           AND i.indexrelid <> CAST(:idx AS regclass)
                           AND NOT EXISTS (
                               SELECT 1 FROM pg_constraint c
                                WHERE c.conindid = i.indexrelid)
                        """
                    ),
                    {"idx": f"coord.{_INDEX_NAME}"},
                ).scalars()
                for name in list(others):
                    conn.exec_driver_sql(f"DROP INDEX {name}")
                conn.exec_driver_sql("SET LOCAL enable_seqscan = off")
            conn.exec_driver_sql(f"SET LOCAL plan_cache_mode = {plan_cache_mode}")
            conn.exec_driver_sql(f"PREPARE decided_scan({params}) AS {sql}")
            prefix = f"EXPLAIN ({explain}) " if explain is not None else ""
            rows = [
                tuple(r)
                for r in conn.exec_driver_sql(
                    f"{prefix}EXECUTE decided_scan({args})"
                ).all()
            ]
            conn.exec_driver_sql("DEALLOCATE decided_scan")
            return rows
        finally:
            tx.rollback()


def _plan(rows: list[tuple[object, ...]]) -> str:
    return "\n".join(str(r[0]) for r in rows)


def _top_buffers(plan: str) -> int:
    """The buffers the whole statement touched: the plan's first Buffers line."""
    first = re.search(r"Buffers: shared(?: hit=(\d+))?(?: read=(\d+))?", plan)
    assert first is not None, plan
    return int(first.group(1) or 0) + int(first.group(2) or 0)


def _index_is_valid(engine: Engine) -> bool:
    return bool(
        scalar(
            engine,
            """
            SELECT i.indisvalid FROM pg_index i
              JOIN pg_class c ON c.oid = i.indexrelid
             WHERE c.relname = :idx
            """,
            idx=_INDEX_NAME,
        )
    )


def _index_definition(engine: Engine) -> str:
    return str(
        scalar(engine, f"SELECT pg_get_indexdef('coord.{_INDEX_NAME}'::regclass)")
    )


def _index_oid(engine: Engine) -> int:
    return cast(int, scalar(engine, f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid"))


def _is_superuser(engine: Engine) -> bool:
    return bool(
        scalar(engine, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
    )


def _row_count(engine: Engine) -> int:
    return cast(int, scalar(engine, "SELECT count(*) FROM coord.pr_events"))


def _scan_buffers(engine: Engine, mode: str) -> tuple[int, str]:
    """Buffers, and the plan, of the decided-set scan under ``mode``."""
    plan = _plan(
        _prepared(
            engine,
            sql=_DECIDED_SCAN_SQL,
            params=_DECIDED_SCAN_PARAMS,
            args=_DECIDED_SCAN_ARGS,
            plan_cache_mode=mode,
            explain="ANALYZE, BUFFERS",
        )
    )
    return _top_buffers(plan), plan


_MODES = ("force_custom_plan", "force_generic_plan")


@_needs_pg
def test_repair_not_a_verdict_01_partial_idx_serves_the_decided_set_scan() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "repair_nav_idx_test") as (
        engine,
        url,
    ):
        # 4. Parent revision: no index yet. Seed so the build runs over rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        expected = _seed(engine)
        rows = _row_count(engine)

        # The scan's cost before the index, for assertion 7.
        before = {mode: _scan_buffers(engine, mode)[0] for mode in _MODES}

        # 5. Apply: valid, and exactly the definition the scan relies on.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run; existence is not enough"
        )
        assert _index_definition(engine) == _EXPECTED_DEFINITION
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.pr_events"))

        # The scan's answer over this seed, so the plans below are measured over
        # rows it actually returns.
        answer = {
            (cast(str, r[0]), cast(int, r[1]), cast(str, r[2]))
            for r in _prepared(
                engine,
                sql=_DECIDED_SCAN_SQL,
                params=_DECIDED_SCAN_PARAMS,
                args=_DECIDED_SCAN_ARGS,
                plan_cache_mode="force_custom_plan",
                explain=None,
            )
        }
        assert answer == expected

        for mode in _MODES:
            # 6 and 7. The scan rides the index, and the index is what makes it
            #    cheap: a window of 30,000 other decisions costs a handful of
            #    buffers, where the parent revision visited every one of them.
            after, plan = _scan_buffers(engine, mode)
            assert _INDEX_NAME in plan, (
                f"{mode}: the scan does not use the index:\n{plan}"
            )
            assert after < 30, (
                f"{mode}: {after} buffers for {len(expected)} not-a-verdict rows: "
                f"the scan still grows with the decision ledger:\n{plan}"
            )
            assert before[mode] > 10 * after, (
                f"{mode}: {before[mode]} buffers at the parent against {after} with "
                "the index: the seed no longer shows the walk the index removes"
            )

        # 8. Sensitivity: either literal as a bound `$3` cannot use the index under
        #    a generic plan, and can under a custom one.
        for literal in _PREDICATE_LITERALS:
            bound_sql = _DECIDED_SCAN_SQL.replace(f"= {literal}", "= $3")
            assert "$3" in bound_sql, literal
            bound_params = f"{_DECIDED_SCAN_PARAMS}, text"
            bound_args = f"{_DECIDED_SCAN_ARGS}, {literal}"
            plan = _plan(
                _prepared(
                    engine,
                    sql=bound_sql,
                    params=bound_params,
                    args=bound_args,
                    plan_cache_mode="force_generic_plan",
                    explain="COSTS OFF",
                    no_alternative=True,
                )
            )
            assert _INDEX_NAME not in plan, (
                f"a bound {literal} must NOT be provable against the partial "
                f"predicate:\n{plan}"
            )
            plan = _plan(
                _prepared(
                    engine,
                    sql=bound_sql,
                    params=bound_params,
                    args=bound_args,
                    plan_cache_mode="force_custom_plan",
                    explain="COSTS OFF",
                    no_alternative=True,
                )
            )
            assert _INDEX_NAME in plan, (
                f"the instrument must see the index when {literal} is known at plan "
                f"time:\n{plan}"
            )

        # 9. A re-run leaves the VALID index untouched...
        oid_before = _index_oid(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_is_valid(engine), "a re-run must leave a VALID index"
        assert _index_oid(engine) == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # ...and keeps an INVALID one, reporting success, which is why the docstring
        # tells a reader to check `indisvalid` after the deploy. Marking the index
        # INVALID takes a superuser, which CI's database role is; elsewhere this step
        # is skipped and the rest still runs.
        if _is_superuser(engine):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        """
                        UPDATE pg_index SET indisvalid = false
                         WHERE indexrelid = CAST(:idx AS regclass)
                        """
                    ),
                    {"idx": f"coord.{_INDEX_NAME}"},
                )
            run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
            run_alembic(root, url, "upgrade", _REVISION_ID)
            assert not _index_is_valid(engine), (
                "IF NOT EXISTS keeps an INVALID index and the upgrade reports success: "
                "the post-deploy indisvalid read is the only thing that sees this"
            )
        else:
            warnings.warn(
                "not a superuser: the INVALID-index half of assertion 9 did not run",
                stacklevel=1,
            )

        # 10. Downgrade removes the index; every row survives. Re-upgrade works.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _row_count(engine) == rows, "downgrade must not touch a row"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_is_valid(engine), "re-applied index must be VALID"
