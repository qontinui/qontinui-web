"""Behaviour test for the ``pr_events_mergeability_head_idx_01`` revision.

The revision adds a partial expression index on ``coord.pr_events`` so coord's
conflict clock can read the start of a PR head's trailing conflicting run with two
index probes per PR instead of a scan of the PR's whole observation history.

What is asserted
================

1. The upgrade path is what coord's merge classifier auto-lands: one static
   ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` literal in an autocommit block.
2. Nothing exists at the parent revision.
3. After upgrade the index exists, is **``indisvalid``**, and is exactly the intended
   definition, the partial predicate included. Column order is what makes the probes
   index-ordered, and the predicate is what keeps other kinds and the recompute
   sentinel out of it.
4. **Both probes ride it,** in the shape Phase 3 of the plan must send: a ``LATERAL``
   over ``unnest`` of the targets. **Their cost does not grow with a strand's length,**
   which is what the column order is for: a head of 6,000 observations costs what a short
   one does. **coord's delta read cannot use it,** because a running build sends that
   read and it would walk every entry of a head.
5. **A read carrying the conflicting expression but another kind cannot use it,** so
   assertion 4 is measuring the partial predicate.

"Cannot use" is asserted with every other index gone and sequential scans priced out, so
it says the partial predicate cannot be proved from the read's clauses. Plain ``EXPLAIN``
on a table this small would stay off the index on cost alone, whatever its definition.

6. **A re-run leaves the VALID index alone (same oid), and keeps an INVALID one.** The
   revision carries no in-migration repair, because coord's classifier rejects one, so
   this pins what its docstring tells a reader to check after the deploy.
7. Downgrade removes the index and leaves every row; a second upgrade re-applies.

That the probes answer what the fold they replace answers is not asserted here: an index
cannot change an answer, so it is a property of Phase 3's SQL. Phase 3 pins it against its
real statement, in coord's
``conflicting_now::tests::the_strand_clock_dates_the_trailing_conflicting_run_at_the_current_head``:
expected onsets for an open strand, a clear, a re-conflict, a late commit, the recompute
sentinel, a force-push, a clear with no ``mergeable`` key, a same-instant tie, two clears,
an ``ingest`` row, another event kind, and the no-evidence fallback.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it at a
non-default host:port).
"""

from __future__ import annotations

import ast
import re
import warnings
from typing import Any

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

_REVISION_ID = "pr_events_mergeability_head_idx_01"
_PARENT_REVISION_ID = "ci_job_res_02"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_INDEX_NAME = "idx_pr_events_mergeability_head_created"
_REPO = "o/idx-test"
_LONG_PR = 2001
_LONG_HEAD = "long-head"

_CONFLICTING_DEF = (
    "COALESCE((((payload ->> 'mergeable'::text) = 'false'::text) OR "
    "(lower((payload ->> 'merge_state_status'::text)) = 'dirty'::text)), false)"
)
_EVIDENCE_DEF = (
    "COALESCE((((payload ->> 'mergeable'::text) = 'true'::text) OR "
    "(((payload ->> 'merge_state_status'::text) IS NOT NULL) AND "
    "(lower((payload ->> 'merge_state_status'::text)) <> 'unknown'::text))), false)"
)
_EXPECTED_DEFINITION = (
    f"CREATE INDEX {_INDEX_NAME} ON coord.pr_events USING btree "
    "(repo, pr_number, ((payload ->> 'head_sha'::text)), "
    f"{_CONFLICTING_DEF}, created_at) "
    "WHERE ((event_kind = ANY (ARRAY['ingest'::text, 'hydration'::text])) AND "
    "(payload ? 'head_sha'::text) AND "
    f"({_CONFLICTING_DEF} OR {_EVIDENCE_DEF}))"
)

# The expressions of `CONFLICTING_PAYLOAD_SQL` and
# `NOT_CONFLICTING_EVIDENCE_PAYLOAD_SQL` in coord's `pr_merge/conflicting_now.rs`,
# spelled as coord spells them. A literal copy on purpose: the index serves coord only
# while the two match, and this is what reddens if the revision's side moves.
_CONFLICTING = (
    "COALESCE((e.payload->>'mergeable') = 'false' "
    "OR lower(e.payload->>'merge_state_status') = 'dirty', false)"
)
_EVIDENCE = (
    "COALESCE((e.payload->>'mergeable') = 'true' "
    "OR (e.payload->>'merge_state_status' IS NOT NULL "
    "AND lower(e.payload->>'merge_state_status') <> 'unknown'), false)"
)
_KINDS = "e.event_kind IN ('ingest', 'hydration') AND e.payload ? 'head_sha'"
_WINDOW = "NOW() - interval '90 days'"

# The two probes, as Phase 3's stateless clock must send them.
_PROBES = f"""
    SELECT p.pr_number, onset.created_at AS conflict_since
      FROM unnest(CAST(:repos AS text[]), CAST(:prs AS int[]), CAST(:heads AS text[]))
           AS p(repo, pr_number, head_sha)
      LEFT JOIN LATERAL (
          SELECT e.created_at FROM coord.pr_events e
           WHERE e.repo = p.repo AND e.pr_number = p.pr_number
             AND e.payload->>'head_sha' = p.head_sha
             AND {_KINDS} AND NOT {_CONFLICTING} AND {_EVIDENCE}
             AND e.created_at > {_WINDOW}
           ORDER BY e.created_at DESC LIMIT 1
      ) cleared ON true
     CROSS JOIN LATERAL (
          SELECT e.created_at FROM coord.pr_events e
           WHERE e.repo = p.repo AND e.pr_number = p.pr_number
             AND e.payload->>'head_sha' = p.head_sha
             AND {_KINDS} AND {_CONFLICTING}
             AND e.created_at > GREATEST(cleared.created_at, {_WINDOW})
           ORDER BY e.created_at ASC LIMIT 1
      ) onset
"""

# The shape of today's delta read in coord's conflicting_now.rs: every observation after
# a checkpoint, ending in `WHERE conflicting OR not_conflicting_evidence`. coord binds a
# per-target checkpoint and the kinds as `ANY($5)`; this uses one window and literal
# kinds. That changes which plan wins on cost, not whether the index is usable, which is
# all the forced-plan check below asks. It must stay unusable (see the revision's
# docstring), which is what the `payload ? 'head_sha'` conjunct buys.
_DELTA = f"""
    SELECT pr_number, created_at, conflicting FROM (
        SELECT p.pr_number, e.created_at,
               {_CONFLICTING} AS conflicting, {_EVIDENCE} AS not_conflicting_evidence
          FROM unnest(CAST(:repos AS text[]), CAST(:prs AS int[]), CAST(:heads AS text[]))
               AS p(repo, pr_number, head_sha)
          JOIN coord.pr_events e ON e.repo = p.repo AND e.pr_number = p.pr_number
         WHERE e.event_kind = ANY(ARRAY['ingest', 'hydration'])
           AND e.created_at > now() - interval '30 minutes'
           AND e.payload->>'head_sha' = p.head_sha
    ) obs WHERE conflicting OR not_conflicting_evidence
"""


def _seed(engine: Engine) -> dict[str, list[Any]]:
    """Long conflicting histories interleaved row by row, and one very long strand.

    Returns the targets for the probes.
    """
    with engine.begin() as conn:
        # 60 PRs of 600 observations each, inserted in time order so each PR's rows are
        # spread across the heap the way an append-only table spreads them. A PR's
        # oldest third is clear, and the rest conflict.
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                SELECT :repo, pr, 'hydration',
                       jsonb_build_object(
                           'head_sha', 'head-' || pr,
                           'mergeable', NOT (k < 400),
                           'merge_state_status',
                           CASE WHEN k < 400 THEN 'DIRTY' ELSE 'CLEAN' END,
                           'labels', jsonb_build_array('filler-so-rows-are-realistically-wide')),
                       now() - make_interval(mins => k * 15)
                  FROM generate_series(1, 60) AS pr,
                       generate_series(1, 600) AS k
                 ORDER BY k DESC, pr
                """
            ),
            {"repo": _REPO},
        )
        # Other kinds, which the index must leave out.
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                SELECT :repo, pr, 'predicate_eval',
                       jsonb_build_object('head_sha', 'head-' || pr,
                                          'mergeable', false,
                                          'merge_state_status', 'DIRTY'),
                       now() - make_interval(mins => k * 15)
                  FROM generate_series(1, 60) AS pr,
                       generate_series(1, 200) AS k
                """
            ),
            {"repo": _REPO},
        )
        # One long strand: a clear at its very start, then every later row conflicting,
        # so a probe walking this head's rows in time order has all of them to read.
        conn.execute(
            text(
                """
                INSERT INTO coord.pr_events (repo, pr_number, event_kind, payload, created_at)
                SELECT :repo, :pr, 'hydration',
                       jsonb_build_object(
                           'head_sha', :head,
                           'mergeable', k = 6000,
                           'merge_state_status',
                           CASE WHEN k = 6000 THEN 'CLEAN' ELSE 'DIRTY' END),
                       now() - make_interval(mins => k)
                  FROM generate_series(1, 6000) AS k
                 ORDER BY k DESC
                """
            ),
            {"repo": _REPO, "pr": _LONG_PR, "head": _LONG_HEAD},
        )
        conn.execute(text("ANALYZE coord.pr_events"))
    prs = list(range(1, 61))
    return {
        "repos": [_REPO] * len(prs),
        "prs": prs,
        "heads": [f"head-{pr}" for pr in prs],
    }


def _explain(engine: Engine, sql: str, params: dict[str, Any]) -> str:
    with engine.connect() as conn:
        rows = conn.execute(text(f"EXPLAIN (ANALYZE, BUFFERS) {sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _plan_with_no_alternative(engine: Engine, sql: str, params: dict[str, Any]) -> str:
    """The plan of a read when this index is the only useful path the planner has.

    Cost decides between usable indexes, and on a small table a read can stay off this
    one while still being able to use it. So every other droppable index goes, inside a
    transaction that is rolled back, and a sequential scan is priced out. If the partial
    predicate can be proved from the read's clauses the plan names this index, and if it
    cannot, no cost can make it.
    """
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            others = conn.execute(
                text(
                    """
                    SELECT i.indexrelid::regclass::text
                      FROM pg_index i
                     WHERE i.indrelid = 'coord.pr_events'::regclass
                       AND i.indexrelid <> CAST(:idx AS regclass)
                       AND NOT EXISTS (
                           SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
                    """
                ),
                {"idx": f"coord.{_INDEX_NAME}"},
            ).scalars()
            for name in list(others):
                conn.execute(text(f"DROP INDEX {name}"))
            conn.execute(text("SET LOCAL enable_seqscan = off"))
            rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
            return "\n".join(str(r[0]) for r in rows)
        finally:
            tx.rollback()


def _top_buffers(plan: str) -> int:
    """The buffers the whole statement touched: the plan's first Buffers line."""
    first = re.search(r"Buffers: shared(?: hit=(\d+))?(?: read=(\d+))?", plan)
    assert first is not None, plan
    return int(first.group(1) or 0) + int(first.group(2) or 0)


def _index_is_valid(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT i.indisvalid FROM pg_index i
                      JOIN pg_class c ON c.oid = i.indexrelid
                     WHERE c.relname = :idx
                    """
                ),
                {"idx": _INDEX_NAME},
            ).scalar_one()
        )


def _index_definition(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text(f"SELECT pg_get_indexdef('coord.{_INDEX_NAME}'::regclass)")
            ).scalar_one()
        )


def _index_oid(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        )


def _is_superuser(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
            ).scalar_one()
        )


def _row_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(text("SELECT count(*) FROM coord.pr_events")).scalar_one()
        )


def test_the_upgrade_path_is_classifier_safe() -> None:
    """Coord's classifier rejects a read through ``op.get_bind().execute`` and a DROP on
    the upgrade path, and a Reject parks the PR on its author. An in-migration repair of
    an INVALID index is both, so this reddens if one comes back.
    """
    path = backend_root() / "alembic" / "versions" / _REVISION_FILENAME
    calls = upgrade_execute_calls(path)
    assert len(calls) == 1, "one CREATE INDEX, and nothing else on the upgrade path"
    # The classifier reads module-level helpers too, so an `op.execute` anywhere but
    # `downgrade()` counts, called from `upgrade()` or not.
    module = ast.parse(path.read_text(encoding="utf-8"))
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
    downgrade = [
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade"
    ]
    in_downgrade = {id(n) for d in downgrade for n in ast.walk(d)}
    executes = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and id(node) not in in_downgrade
    ]
    assert len(executes) == 1, f"op.execute outside downgrade(), at lines {executes}"
    call = calls[0]
    assert call.sql is not None, "the execute argument is one static literal"
    assert call.in_autocommit_block, "CONCURRENTLY cannot run in a transaction"
    create = re.sub(r"\s+", " ", call.sql).strip().upper()
    assert create.startswith("CREATE INDEX CONCURRENTLY IF NOT EXISTS "), create
    module = ast.parse(path.read_text(encoding="utf-8"))
    binds = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.Attribute) and node.attr == "get_bind"
    ]
    assert not binds, f"get_bind anywhere in the revision, at lines {binds}"


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)
def test_pr_events_mergeability_head_idx_01_serves_the_conflict_clock() -> None:
    root = backend_root()

    with ephemeral_database(
        admin_database_url(), "pr_events_mergeability_idx_test"
    ) as (
        engine,
        url,
    ):
        # 2. Parent revision: no index yet. Seed so the build runs over rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        targets = _seed(engine)
        rows = _row_count(engine)

        # 3. Apply: valid, and exactly the definition the probes rely on.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_is_valid(engine), (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run; existence is not enough"
        )
        assert _index_definition(engine) == _EXPECTED_DEFINITION
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.pr_events"))

        # 4. Both probes ride it, and it is what makes them cheap.
        plan = _explain(engine, _PROBES, targets)
        assert plan.count(_INDEX_NAME) == 2, (
            f"both probes of the clock must ride the index:\n{plan}"
        )
        buffers = _top_buffers(plan)
        assert buffers < 40 * len(targets["prs"]), (
            f"{buffers} buffers for {len(targets['prs'])} PRs: the probes are not "
            f"index-bounded:\n{plan}"
        )

        # A strand's length must not show. The newest clear on this head is its oldest
        # row, so a key with `created_at` ahead of the evidence walks all 6,000 entries.
        plan = _explain(
            engine,
            _PROBES,
            {"repos": [_REPO], "prs": [_LONG_PR], "heads": [_LONG_HEAD]},
        )
        long_buffers = _top_buffers(plan)
        assert long_buffers < 40, (
            f"{long_buffers} buffers for one PR of 6,000 observations: the cost grows "
            f"with the strand:\n{plan}"
        )

        # The instrument below can see this index when a read can use it...
        assert _INDEX_NAME in _plan_with_no_alternative(engine, _PROBES, targets)

        # ...and the reader a running coord build already has cannot move onto it.
        plan = _plan_with_no_alternative(engine, _DELTA, targets)
        assert _INDEX_NAME not in plan, (
            f"coord's delta read must not be able to use this index, or it reads every "
            f"entry of each head:\n{plan}"
        )

        # 5. Sensitivity: the conflicting rows of another kind are outside the partial
        #    predicate, even with the conflicting expression in the query.
        other_kind = f"""
            SELECT e.created_at FROM coord.pr_events e
             WHERE e.repo = :repo AND e.pr_number = 1
               AND e.payload->>'head_sha' = 'head-1'
               AND e.event_kind = 'predicate_eval' AND e.payload ? 'head_sha'
               AND {_CONFLICTING}
             ORDER BY e.created_at LIMIT 1
        """
        plan = _plan_with_no_alternative(engine, other_kind, {"repo": _REPO})
        assert _INDEX_NAME not in plan, (
            f"another event kind must NOT match this partial index:\n{plan}"
        )

        # 6. A re-run leaves the VALID index untouched...
        oid_before = _index_oid(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_is_valid(engine), "a re-run must leave a VALID index"
        assert _index_oid(engine) == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # ...and keeps an INVALID one, reporting success, which is why the docstring
        # tells a reader to check `indisvalid` after the deploy. Marking the index
        # INVALID takes a superuser, which CI's database role is; elsewhere this step is
        # skipped and the rest still runs.
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
                "not a superuser: the INVALID-index half of assertion 6 did not run",
                stacklevel=1,
            )

        # 7. Downgrade removes the index; every row survives. Re-upgrade works.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _row_count(engine) == rows, "downgrade must not touch a row"
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_is_valid(engine), "re-applied index must be VALID"
