"""Behaviour test for the ``pr_fix_ctx_head_sha_01`` idempotency-probe index.

The revision creates one partial expression index::

    ix_policy_rule_resolutions_ctx_head_sha
        ON coord.policy_rule_resolutions
        (tenant_id, ((resolved_entity -> 'context') ->> 'head_sha'))
        WHERE ((resolved_entity -> 'context') ->> 'head_sha') IS NOT NULL

What is asserted
================

1. At the parent revision the index does not exist; after the revision it exists,
   is ``indisvalid``, has exactly the intended definition, and is the only index
   added.
2. The index definition never references ``agent_decision``: a predicate column
   blocks HOT updates of that column, and coord updates it on almost every
   consult.
3. Coord's exact ``pr_already_dispatched`` SQL, PREPAREd under
   ``plan_cache_mode = force_generic_plan`` (the hardest case for predicate
   implication), is served by the new index with ``tenant_id`` and ``head_sha``
   as Index Conds rather than Filters. The custom plan is asserted as well.
4. The probe returns the right answer: true for an earlier autodispatched
   resolution of the same PR/kind/head, false for the current resolution itself,
   another head, another kind, another tenant, or a non-autodispatched row.
5. Sensitivity: a query that does not imply the predicate (``head_sha IS NULL``)
   does not get the index.
6. Downgrade removes exactly the new index and every row survives.

``enable_seqscan = off`` for the plan assertions: the fixtures are small, so a
sequential scan wins on cost whatever the index. Turning it off leaves the one
question being asked: CAN the planner use this index for this query?
"""

from __future__ import annotations

import json

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

_REVISION_ID = "pr_fix_ctx_head_sha_01"
_PARENT_REVISION_ID = "cpu_temp_01"
_INDEX = "ix_policy_rule_resolutions_ctx_head_sha"

# ``pg_get_indexdef`` as PostgreSQL 16 renders it. Key order, the expression and
# the predicate are all load-bearing.
_EXPECTED_INDEXDEF = (
    f"CREATE INDEX {_INDEX} ON coord.policy_rule_resolutions "
    "USING btree (tenant_id, (((resolved_entity -> 'context'::text) ->> "
    "'head_sha'::text))) WHERE (((resolved_entity -> 'context'::text) ->> "
    "'head_sha'::text) IS NOT NULL)"
)

# qontinui-coord ``next_step::pr_already_dispatched``, apart from whitespace.
# The predicate proof is syntactic, so a simplified stand-in would prove nothing
# about the statement coord sends.
_PROBE_SQL = (
    "SELECT EXISTS ( "
    "SELECT 1 FROM coord.policy_rule_resolutions "
    "WHERE tenant_id = $1 "
    "AND resolution_id <> $2 "
    "AND resolved_entity->'context'->>'repo' = $3 "
    "AND resolved_entity->'context'->>'pr_number' = $4 "
    "AND resolved_entity->'context'->>'diagnosis_kind' = $5 "
    "AND resolved_entity->'context'->>'head_sha' = $6 "
    "AND (agent_decision->>'autodispatch') = 'true' "
    ")"
)
_PROBE_TYPES = "uuid, uuid, text, text, text, text"

_TENANT = "1a0d7fd8-0000-4000-8000-000000000001"
_OTHER_TENANT = "1a0d7fd8-0000-4000-8000-000000000002"
_REPO = "qontinui-web"
_PR = "1234"
_KIND = "ci_failed"
_HEAD = "a" * 40
_ABSENT_RESOLUTION = "00000000-0000-4000-8000-000000000000"


def _index_def(engine: Engine) -> str:
    with engine.connect() as conn:
        return str(
            conn.execute(
                text("SELECT pg_get_indexdef(to_regclass('coord.' || :n))"),
                {"n": _INDEX},
            ).scalar()
            or ""
        )


def _index_is_valid(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    "SELECT indisvalid FROM pg_index "
                    "WHERE indexrelid = to_regclass('coord.' || :n)"
                ),
                {"n": _INDEX},
            ).scalar()
        )


def _index_set(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'coord' AND tablename = 'policy_rule_resolutions'"
            )
        ).all()
    return {r[0] for r in rows}


def _row_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.policy_rule_resolutions")
            ).scalar_one()
        )


def _insert(
    conn: Connection,
    *,
    tenant: str = _TENANT,
    repo: str = _REPO,
    pr: str = _PR,
    kind: str = _KIND,
    head: str | None = _HEAD,
    autodispatch: bool = True,
) -> str:
    """Insert one resolution and return its ``resolution_id``."""
    context: dict[str, str] = {"repo": repo, "pr_number": pr, "diagnosis_kind": kind}
    if head is not None:
        context["head_sha"] = head
    return str(
        conn.execute(
            text(
                """
                INSERT INTO coord.policy_rule_resolutions
                    (policy_id, tenant_id, resolved_entity, action_taken,
                     resolved_at, agent_decision)
                VALUES (gen_random_uuid(), CAST(:tenant AS uuid),
                        jsonb_build_object('decision_domain', 'pr_fix',
                                           'context', CAST(:context AS jsonb)),
                        '{}'::jsonb, now(),
                        jsonb_build_object('autodispatch', CAST(:ad AS boolean)))
                RETURNING resolution_id
                """
            ),
            {"tenant": tenant, "context": json.dumps(context), "ad": autodispatch},
        ).scalar_one()
    )


def _probe_args(
    *,
    tenant: str = _TENANT,
    current: str = _ABSENT_RESOLUTION,
    repo: str = _REPO,
    pr: str = _PR,
    kind: str = _KIND,
    head: str = _HEAD,
) -> str:
    return ", ".join(f"'{v}'" for v in (tenant, current, repo, pr, kind, head))


def _explain(conn: Connection, sql: str) -> str:
    return "\n".join(str(r[0]) for r in conn.execute(text(f"EXPLAIN {sql}")).all())


def _probe(conn: Connection, **kwargs: str) -> bool:
    return bool(
        conn.execute(text(f"EXECUTE pr_probe({_probe_args(**kwargs)})")).scalar_one()
    )


_SKIP_NO_PG = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)


@_SKIP_NO_PG
def test_pr_fix_ctx_head_sha_01_index_serves_the_idempotency_probe() -> None:
    """Build the index, prove the probe's plan and answers, prove the near-misses."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "pr_fix_head_sha_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: the index does not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)
        parent_indexes = _index_set(engine)

        # 1/2. Apply: exists, VALID, intended definition, nothing else added.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX)
        assert _index_is_valid(engine), (
            f"{_INDEX} is INVALID - a killed CONCURRENTLY build leaves an index "
            "of the right name that IF NOT EXISTS skips on re-run"
        )
        definition = _index_def(engine)
        assert definition == _EXPECTED_INDEXDEF, (
            "index definition drifted - key order, expression and predicate are "
            f"all load-bearing.\nexpected: {_EXPECTED_INDEXDEF}\ngot:      {definition}"
        )
        assert "agent_decision" not in definition, (
            "agent_decision in an index key or predicate blocks HOT updates of "
            "the most-written coord table"
        )
        assert _index_set(engine) == parent_indexes | {_INDEX}

        # Seed AFTER the build, so the index maintains itself (no REINDEX).
        with engine.begin() as conn:
            earlier = _insert(conn)  # the earlier autodispatch the probe must find
            _insert(conn, autodispatch=False, head="b" * 40)
            _insert(conn, tenant=_OTHER_TENANT, head="d" * 40)
            _insert(conn, head=None)  # outside the partial predicate
            for i in range(60):  # bulk, so the index is selective
                _insert(conn, pr=str(2000 + i), head=f"{i:040x}")
            conn.execute(text("ANALYZE coord.policy_rule_resolutions"))
        rows = _row_count(engine)

        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))

            # 3. Generic plan (the hardest case for predicate implication).
            conn.execute(text("SET plan_cache_mode = force_generic_plan"))
            conn.execute(text(f"PREPARE pr_probe ({_PROBE_TYPES}) AS {_PROBE_SQL}"))
            generic = _explain(conn, f"EXECUTE pr_probe({_probe_args()})")
            assert _INDEX in generic, (
                f"the probe must use the new index; got:\n{generic}"
            )
            index_conds = [ln for ln in generic.splitlines() if "Index Cond" in ln]
            assert any("tenant_id" in ln and "head_sha" in ln for ln in index_conds), (
                "tenant_id AND head_sha must both be Index Conds, not Filters; "
                f"got:\n{generic}"
            )
            assert "Seq Scan" not in generic, generic

            # 4. Answers.
            assert _probe(conn), "an earlier autodispatch of the same head is found"
            assert not _probe(conn, current=earlier), (
                "the current resolution itself must not count as a duplicate"
            )
            assert not _probe(conn, head="e" * 40), "a new head is new work"
            assert not _probe(conn, kind="another_kind")
            assert not _probe(conn, tenant=_OTHER_TENANT)
            assert not _probe(conn, head="b" * 40), (
                "a resolution that was not autodispatched is not a dispatch"
            )

            # 3 (custom plan). Bound literals, as coord's un-cached query_one plans it.
            conn.execute(text("RESET plan_cache_mode"))
            custom = _explain(
                conn,
                "SELECT EXISTS ( SELECT 1 FROM coord.policy_rule_resolutions "
                f"WHERE tenant_id = '{_TENANT}' "
                f"AND resolution_id <> '{_ABSENT_RESOLUTION}' "
                f"AND resolved_entity->'context'->>'repo' = '{_REPO}' "
                f"AND resolved_entity->'context'->>'pr_number' = '{_PR}' "
                f"AND resolved_entity->'context'->>'diagnosis_kind' = '{_KIND}' "
                f"AND resolved_entity->'context'->>'head_sha' = '{_HEAD}' "
                "AND (agent_decision->>'autodispatch') = 'true')",
            )
            assert _INDEX in custom, f"custom plan must use the index; got:\n{custom}"

            # 5. Sensitivity: a query that does not imply the predicate cannot use it.
            near_miss = _explain(
                conn,
                "SELECT 1 FROM coord.policy_rule_resolutions "
                f"WHERE tenant_id = '{_TENANT}' "
                "AND resolved_entity->'context'->>'head_sha' IS NULL",
            )
            assert _INDEX not in near_miss, (
                "an IS NULL query is outside the partial predicate and must not "
                f"use the index; got:\n{near_miss}"
            )

        # 6. Downgrade removes exactly the new index; rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX)
        assert _index_set(engine) == parent_indexes
        assert _row_count(engine) == rows
