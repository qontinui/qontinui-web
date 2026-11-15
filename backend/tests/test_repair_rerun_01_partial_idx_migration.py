"""Behaviour test for the ``repair_rerun_01_partial_idx`` revision.

The revision adds the partial expression index ``idx_pr_events_repair_rerun`` on
``coord.pr_events`` so coord's ``repair_cause`` re-run ledger read
(``RERUNS_SPENT_SQL`` in ``crates/coord/src/pr_merge/repair_cause.rs``) reads the
few ``rerun`` rows instead of walking every ``repair_decision`` row of each open PR.
Plan ``2026-11-02-repair-cause-rerun-ledger-read-walks-every-repair-decision-row``,
Phase 1. Phase 2 (qontinui-coord#3953) pins the STATEMENT's side of the contract
with ``reruns_spent_sql_spells_the_literal_its_partial_index_is_built_on``; this
file pins the INDEX's side, so a change to either side's literals reddens a test.
Neither test sees the other side's file: coord's is a substring check, so a clause
coord appended after its predicate (an ``OR``, say) could still defeat the match
with both tests green.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent names exactly one real sibling, and the docstring's ``Revises:`` header
   agrees with the assignment.
2. **The upgrade path is what coord's merge classifier auto-lands**: one static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literal in an autocommit block, no
   other ``op.*`` call (so no non-concurrent ``op.create_index``), no ``get_bind``,
   no module-level helper. The downgrade is one ``DROP INDEX CONCURRENTLY IF
   EXISTS`` in an autocommit block, and ``check_coord_column_drops`` finds nothing.
3. **The partial predicate spells the literals coord's statement spells.** The
   planner proves a partial index usable only when the statement's ``WHERE``
   implies the index's predicate, so the two literals must match coord's.

Against a real Postgres (skipped when none is reachable):

4. Nothing exists at the parent revision.
5. After upgrade the index exists, is **``indisvalid``**, and is exactly the
   intended definition, the partial predicate included.
6. **coord's statement rides it under BOTH a custom and a generic plan.** Today coord
   sends it through ``tokio_postgres::Client::query`` with a ``&str``, which prepares
   a fresh statement per call and executes it once, so under ``plan_cache_mode =
   auto`` production plans it custom. A generic plan is what a cached prepared
   statement (``prepare_cached``, which coord uses elsewhere) can switch to after
   five executions, when its cost compares well with the custom plans'. The
   literal is what makes the index match in both modes; ``plan_cache_mode`` forces
   each, and the statement is run the way coord runs it, as a prepared statement.
7. **The index is what makes the read cheap,** in both modes. One PR carrying
   thousands of ``repair_decision`` rows costs a handful of buffers after the
   upgrade, and many times more at the parent revision, where nothing narrows the
   read to the re-run rows: it filters every decision it reaches, whichever path the
   planner takes. The read's cost no longer grows with the decision history, which
   is the defect the plan exists for.
8. **The ``'rerun'`` literal is load-bearing.** The statement as it stood before
   coord#3953, with the action as a bound ``$3``, cannot use the index under a
   generic plan and can under a custom one. That is the instrument showing it can
   tell "cannot" from "did not". (The one-shot custom plan coord runs today could
   already use it with ``$3``; the literal makes the match independent of plan mode.)

"Cannot use" is asserted with every other index gone and sequential scans priced out,
so it says the partial predicate cannot be proved from the read's clauses. Plain
``EXPLAIN`` on a table this small could stay off the index on cost alone.

9. **A re-run leaves the VALID index alone (same oid), and keeps an INVALID one.**
   The revision carries no in-migration repair, so this pins what its docstring tells
   a reader to check after the deploy.
10. Downgrade removes the index and leaves every row; a second upgrade re-applies.

That the statement returns the same rows with and without the index is a property of
Postgres, not of this revision; the seeded answer is checked only so the plans above
are measured over rows the statement actually returns. Phase 3 of the plan compares
the two in production.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it at a
non-default host:port).
"""

from __future__ import annotations

import ast
import re
import sys
import warnings
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType
from typing import cast

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

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

_REVISION_ID = "repair_rerun_01_partial_idx"
_PARENT_REVISION_ID = "fpl_02b"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_INDEX_NAME = "idx_pr_events_repair_rerun"

_REPO = "o/rerun-idx-test"
_OTHER_REPO = "o/rerun-idx-other"
_LONG_PR = 3001

_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_INDEX_NAME} ON coord.pr_events USING btree "
    "(repo, pr_number, ((payload ->> 'head_sha'::text))) "
    "WHERE ((event_kind = 'repair_decision'::text) AND "
    "((payload ->> 'action'::text) = 'rerun'::text))"
)

# `RERUNS_SPENT_SQL` in coord's `pr_merge/repair_cause.rs`, as coord spells it
# (qontinui-coord#3953, commit `57ef9eadd76a`). A literal copy on purpose: the index
# serves coord only while the two match, and this is what reddens if the revision's
# side moves. coord binds `$1` (repos) and `$2` (PR numbers) and nothing else.
_RERUNS_SPENT_SQL = (
    "SELECT DISTINCT e.repo, e.pr_number, e.payload->>'head_sha' "
    "FROM coord.pr_events e "
    "JOIN unnest($1::text[], $2::int[]) AS k(repo, pr_number) "
    "ON e.repo = k.repo AND e.pr_number = k.pr_number "
    "WHERE e.event_kind = 'repair_decision' AND e.payload->>'action' = 'rerun'"
)
_RERUNS_SPENT_PARAMS = "text[], int[]"

# The same statement before coord#3953: the action bound as `$3`. A generic plan
# cannot prove a bound parameter implies a partial predicate.
_RERUNS_SPENT_BOUND_SQL = _RERUNS_SPENT_SQL.replace("= 'rerun'", "= $3")
_RERUNS_SPENT_BOUND_PARAMS = "text[], int[], text"
assert "$3" in _RERUNS_SPENT_BOUND_SQL, "the bound variant lost its `$3`"

# The statement's WHERE, as coord spells it, for the no-database check.
_COORD_PREDICATE = _RERUNS_SPENT_SQL.split(" WHERE ", 1)[1]

# The actions coord's repair scheduler stamps on a repair_decision row. All but
# `rerun` must stay out of the index.
_OTHER_ACTIONS = ("skip", "classified", "cleared", "pick")

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


def test_the_partial_predicate_spells_coords_literals() -> None:
    """The index's WHERE, with coord's ``e.`` alias added, is coord's WHERE.

    Postgres matches a partial index by proving implication from the query's clauses,
    so a predicate that differs from the statement's (another literal, an added
    conjunct, a parameter) makes the index invisible to the read with no error
    anywhere. coord#3953 pins its side; this pins the revision's against this file's
    copy of coord's statement.
    """
    sql = upgrade_execute_calls(_revision_path())[0].sql
    assert sql is not None
    match = re.search(r"\bWHERE\b(.*)$", _squash(sql), re.S)
    assert match is not None, sql
    predicate = match.group(1).strip()
    aliased = re.sub(r"\b(event_kind|payload)\b", r"e.\1", predicate)
    assert aliased == _COORD_PREDICATE, (
        f"the index predicate {predicate!r} no longer matches coord's "
        f"RERUNS_SPENT_SQL WHERE {_COORD_PREDICATE!r}"
    )


# ---------------------------------------------------------------------------
# 4-10. real Postgres
# ---------------------------------------------------------------------------


def _seed(engine: Engine) -> set[tuple[str, int, str]]:
    """A decision history shaped like production's, and the answer coord expects.

    40 PRs each carry 250 repair_decision rows of the other actions (about 245 per PR
    in production), interleaved in time order so a PR's rows are spread across the
    heap. Every even PR also spent a re-run on one or two heads. One PR carries 6,000
    decisions and two re-runs. Re-run-shaped payloads of another event kind and of a
    repo outside the keys must stay out of the answer.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                SELECT :repo, pr, 'repair_decision',
                       jsonb_build_object(
                           'head_sha', 'head-' || pr || '-' || (k / 100),
                           'action', (CAST(:actions AS text[]))[1 + k % 4],
                           'cause', 'positional',
                           'evidence', jsonb_build_array(
                               'filler-so-rows-are-realistically-wide')),
                       now() - make_interval(mins => k * 5)
                  FROM generate_series(1, 40) AS pr,
                       generate_series(1, 250) AS k
                 ORDER BY k DESC, pr
                """
            ),
            {"repo": _REPO, "actions": list(_OTHER_ACTIONS)},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                SELECT :repo, pr, 'repair_decision',
                       jsonb_build_object('head_sha', 'head-' || pr || '-' || h,
                                          'action', 'rerun'),
                       now() - make_interval(mins => h * 7)
                  FROM generate_series(2, 40, 2) AS pr,
                       generate_series(0, CASE WHEN pr % 4 = 0 THEN 1 ELSE 0 END) AS h
                """
            ),
            {"repo": _REPO},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                SELECT :repo, :pr, 'repair_decision',
                       jsonb_build_object(
                           'head_sha', 'long-' || (k / 1000),
                           'action', CASE WHEN k IN (1500, 4500) THEN 'rerun'
                                          ELSE (CAST(:actions AS text[]))[1 + k % 4] END,
                           'evidence', jsonb_build_array(
                               'filler-so-rows-are-realistically-wide')),
                       now() - make_interval(secs => k * 30)
                  FROM generate_series(1, 6000) AS k
                 ORDER BY k DESC
                """
            ),
            {"repo": _REPO, "pr": _LONG_PR, "actions": list(_OTHER_ACTIONS)},
        )
        # A re-run-shaped payload under another kind, and a re-run of a repo the read
        # does not ask about: neither is in the answer.
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                VALUES (:repo, 1, 'predicate_eval',
                        jsonb_build_object('head_sha', 'head-1-0', 'action', 'rerun'),
                        now()),
                       (:other, 2, 'repair_decision',
                        jsonb_build_object('head_sha', 'other-head', 'action', 'rerun'),
                        now())
                """
            ),
            {"repo": _REPO, "other": _OTHER_REPO},
        )
        conn.execute(text("ANALYZE coord.pr_events"))

    expected = {(_REPO, pr, f"head-{pr}-0") for pr in range(2, 41, 2)}
    expected |= {(_REPO, pr, f"head-{pr}-1") for pr in range(4, 41, 4)}
    expected |= {(_REPO, _LONG_PR, "long-1"), (_REPO, _LONG_PR, "long-4")}
    return expected


def _keys(prs: Sequence[int]) -> tuple[list[str], list[int]]:
    return [_REPO] * len(prs), list(prs)


def _array_literals(repos: list[str], prs: list[int]) -> str:
    """``EXECUTE`` arguments as SQL literals: a prepared statement takes no bind here."""
    repo_items = ",".join("'" + r.replace("'", "''") + "'" for r in repos)
    pr_items = ",".join(str(int(p)) for p in prs)
    return f"ARRAY[{repo_items}]::text[], ARRAY[{pr_items}]::int[]"


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
    """Run ``sql`` as coord does, a prepared statement, under ``plan_cache_mode``.

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
            conn.exec_driver_sql(f"PREPARE reruns_spent({params}) AS {sql}")
            prefix = f"EXPLAIN ({explain}) " if explain is not None else ""
            rows = [
                tuple(r)
                for r in conn.exec_driver_sql(
                    f"{prefix}EXECUTE reruns_spent({args})"
                ).all()
            ]
            conn.exec_driver_sql("DEALLOCATE reruns_spent")
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


def _long_pr_buffers(engine: Engine, mode: str) -> tuple[int, str]:
    """Buffers, and the plan, of coord's read for the one long PR under ``mode``."""
    plan = _plan(
        _prepared(
            engine,
            sql=_RERUNS_SPENT_SQL,
            params=_RERUNS_SPENT_PARAMS,
            args=_array_literals(*_keys([_LONG_PR])),
            plan_cache_mode=mode,
            explain="ANALYZE, BUFFERS",
        )
    )
    return _top_buffers(plan), plan


_MODES = ("force_custom_plan", "force_generic_plan")


@_needs_pg
def test_repair_rerun_01_partial_idx_serves_the_rerun_ledger_read() -> None:
    root = backend_root()
    all_prs = [*range(1, 41), _LONG_PR]
    all_args = _array_literals(*_keys(all_prs))

    with ephemeral_database(admin_database_url(), "repair_rerun_idx_test") as (
        engine,
        url,
    ):
        # 4. Parent revision: no index yet. Seed so the build runs over rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        expected = _seed(engine)
        rows = _row_count(engine)

        # The cost of one long PR's read before the index, for assertion 7.
        before = {mode: _long_pr_buffers(engine, mode)[0] for mode in _MODES}

        # 5. Apply: valid, and exactly the definition the statement relies on.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run; existence is not enough"
        )
        assert _index_definition(engine) == _EXPECTED_DEFINITION
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.pr_events"))

        # The statement's answer over this seed, in the mode coord runs it today, so
        # the plans below are measured over rows it actually returns.
        answer = {
            (cast(str, r[0]), cast(int, r[1]), cast(str, r[2]))
            for r in _prepared(
                engine,
                sql=_RERUNS_SPENT_SQL,
                params=_RERUNS_SPENT_PARAMS,
                args=all_args,
                plan_cache_mode="force_custom_plan",
                explain=None,
            )
        }
        assert answer == expected

        for mode in _MODES:
            # 6. coord's statement rides the index, planned on its own.
            plan = _plan(
                _prepared(
                    engine,
                    sql=_RERUNS_SPENT_SQL,
                    params=_RERUNS_SPENT_PARAMS,
                    args=all_args,
                    plan_cache_mode=mode,
                    explain="ANALYZE, BUFFERS",
                )
            )
            assert _INDEX_NAME in plan, (
                f"{mode}: the read does not use the index:\n{plan}"
            )

            # 7. The index is what makes it cheap: one PR of 6,000 decisions costs a
            #    handful of buffers, where the parent revision filtered every decision
            #    it reached.
            after, plan = _long_pr_buffers(engine, mode)
            assert after < 20, (
                f"{mode}: {after} buffers for one PR of 6,000 decisions: the read "
                f"still grows with the PR's decision history:\n{plan}"
            )
            assert before[mode] > 10 * after, (
                f"{mode}: {before[mode]} buffers at the parent against {after} with "
                "the index: the seed no longer shows the walk the index removes"
            )

        # 8. Sensitivity: the action as a bound `$3`, the shape before coord#3953,
        #    cannot use the index under a generic plan and can under a custom one.
        bound_args = f"{all_args}, 'rerun'"
        plan = _plan(
            _prepared(
                engine,
                sql=_RERUNS_SPENT_BOUND_SQL,
                params=_RERUNS_SPENT_BOUND_PARAMS,
                args=bound_args,
                plan_cache_mode="force_generic_plan",
                explain="COSTS OFF",
                no_alternative=True,
            )
        )
        assert _INDEX_NAME not in plan, (
            f"a bound action must NOT be provable against the partial predicate:\n{plan}"
        )
        plan = _plan(
            _prepared(
                engine,
                sql=_RERUNS_SPENT_BOUND_SQL,
                params=_RERUNS_SPENT_BOUND_PARAMS,
                args=bound_args,
                plan_cache_mode="force_custom_plan",
                explain="COSTS OFF",
                no_alternative=True,
            )
        )
        assert _INDEX_NAME in plan, (
            f"the instrument must see the index when the action is known at plan "
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
