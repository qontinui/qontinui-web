"""Behaviour test for the ``findings_keyset_01`` keyset-index revision.

The revision adds two indexes to ``coord.findings`` for the findings page
read::

    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_created_keyset
        ON coord.findings (created_at DESC, finding_id DESC)
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_supersedes
        ON coord.findings (supersedes) WHERE supersedes IS NOT NULL

Phase 0 of plan
``2026-09-05-findings-recent-is-a-window-that-reads-as-a-corpus``.
``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contract is that **coord's ``recent()`` page read walks
the keyset index in order instead of sorting, and its supersede anti-join
probes the supersedes index instead of scanning the table per row**, so that is
what is pinned here.

What is asserted
================

1. Neither index exists at the parent revision, and there the page read
   SORTS and its anti-join's inner side is a ``Seq Scan on findings s`` —
   both read from the actual parent plan, so assertion 5's no-Sort check has
   a real opposite to be measured against.
2. After upgrade both indexes exist and are **``indisvalid``** — a killed
   ``CONCURRENTLY`` build leaves an INVALID index that ``IF NOT EXISTS`` would
   skip on re-run, so existence alone would green a dead index.
3. The keyset index's key is ``(created_at DESC, finding_id DESC)``,
   non-partial, non-unique. The supersedes index is on ``(supersedes)``,
   non-unique, and PARTIAL on ``supersedes IS NOT NULL``.
4. It is NOT tenant-leading — the revision docstring's design choice, pinned so
   a "helpful" edit to ``(tenant_id, …)`` fails here rather than in production.
5. **The planner rides it with no Sort node** for coord's PRODUCTION
   ``recent()`` statement — every clause, the supersede ``NOT EXISTS``
   anti-join included, with the unfiltered first page's parameters as literals
   (``ORDER BY created_at DESC, finding_id DESC LIMIT 21``) — AND for a
   follow-on page carrying the row comparison cursor
   ``(created_at, finding_id) < (ts, id)``. On both, the ``NOT EXISTS``
   anti-join's inner side probes ``idx_findings_supersedes`` — no Seq Scan
   anywhere in the plan. The probe check is proven able to fail IN the test:
   ``idx_findings_supersedes`` is dropped, the same statement is EXPLAINed and
   must fall back to a ``Seq Scan on findings s`` that the probe check
   rejects, and the index is recreated with a byte-identical definition.
6. The ordered read returns rows in keyset order across a ``created_at`` tie,
   and the cursor page resumes exactly after the boundary row.
7. Downgrade removes both indexes; rows survive.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

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

_REVISION_ID = "findings_keyset_01"
_PARENT_REVISION_ID = "coord_iops_idx_01"

_INDEX_NAME = "idx_findings_created_keyset"
_SUPERSEDES_INDEX_NAME = "idx_findings_supersedes"

_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000f1e1")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000f1e2")
_SEED_TOPIC = "findings-keyset-test"

# coord's production `recent()` statement, VERBATIM in shape, with its bound
# parameters written as literals for the unfiltered first page (limit 20, so
# `$4` = `limit + 1` = 21). Source: qontinui-coord
# `crates/coord/src/findings.rs` `recent()` on the branch that adds the keyset
# cursor (plan `2026-09-05-findings-recent-is-a-window-that-reads-as-a-corpus`).
# Every clause the planner sees in production is here — the tenant/fleet-infra
# OR that rules out a tenant-leading index, the by-id and expiry arms, the
# supersede `NOT EXISTS` anti-join, the resource_keys/topic OR group, the kind
# and triage arms, and the keyset guard — because an index that serves a
# simplified query proves nothing about the one coord runs.
#
# Why literals are the faithful spelling: tokio-postgres prepares each
# `query(&str, …)` as a fresh statement and executes it once, and PostgreSQL
# plans the first executions of a prepared statement with a CUSTOM plan built
# from the actual parameter values — so `$7::uuid IS NULL`, `$8 IS NULL` and
# friends are constant-folded exactly as they are here.
#
#   $1 tenant   $2 '{}'::text[]   $3 NULL::text (topic)   $4 21
#   $5 NULL::text (kind)   $6 0::int2 (triaged=any)   $7 NULL::uuid (by-id)
#   $8/$9 NULL (first page) or the boundary row's (created_at, finding_id)
#
# The tenant, timestamp and id are fixed test values or read back from seeded
# rows — never user input.
_RECENT_SQL = """
    SELECT f.finding_id FROM coord.findings f
     WHERE (f.tenant_id = '{tenant}'::uuid OR f.scope = 'fleet-infra')
       AND (NULL::uuid IS NULL OR f.finding_id = NULL::uuid)
       AND (f.expires_at > now()
            OR (NULL::uuid IS NOT NULL AND f.finding_id = NULL::uuid))
       AND NOT EXISTS (
             SELECT 1 FROM coord.findings s WHERE s.supersedes = f.finding_id
           )
       AND (
             f.resource_keys && '{{}}'::text[]
          OR (NULL::text IS NOT NULL AND f.topic = NULL::text)
          OR ('{{}}'::text[] = '{{}}'::text[] AND NULL::text IS NULL)
           )
       AND (NULL::text IS NULL OR f.kind = NULL::text)
       AND (
             0::int2 = 0
          OR (0::int2 = 1 AND f.tenant_id = '{tenant}'::uuid
                          AND f.triaged_at IS NULL AND f.kind <> 'dossier')
          OR (0::int2 = 2 AND f.triaged_at IS NOT NULL)
           )
       AND ({ts} IS NULL
            OR (f.created_at, f.finding_id) < ({ts}, {fid}))
     ORDER BY f.created_at DESC, f.finding_id DESC
     LIMIT 21
"""

# The first page: `$8` / `$9` NULL.
_PAGE_SQL = _RECENT_SQL.format(tenant=_TENANT, ts="NULL::timestamptz", fid="NULL::uuid")


def _cursor_page_sql(ts: str, fid: object) -> str:
    """A follow-on page: `$8` / `$9` are the boundary row's key (Design
    decision 2's row comparison)."""
    return _RECENT_SQL.format(
        tenant=_TENANT, ts=f"'{ts}'::timestamptz", fid=f"'{fid}'::uuid"
    )


def _index_is_valid(engine: Engine, index: str = _INDEX_NAME) -> bool:
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
                {"idx": index},
            ).scalar()
        )


def _index_shape(engine: Engine, index: str = _INDEX_NAME) -> tuple[str, bool, bool]:
    """Return ``(definition, is_partial, is_unique)`` for ``index``."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT pg_get_indexdef(i.indexrelid),
                       i.indpred IS NOT NULL,
                       i.indisunique
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": index},
        ).one()
    return str(row[0]), bool(row[1]), bool(row[2])


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is tiny, so a seq scan plus an in-memory sort would win on cost
    regardless of index quality. ``enable_seqscan = off`` (session-local to this
    one connection, used only for these EXPLAIN assertions) removes the cost
    question and leaves the one being asked: CAN the planner serve this
    ORDER BY from an index walk? At the parent revision no index can, so the
    plan still carries a Sort node — assertion 1 — and the penalty cannot
    manufacture a pass.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _has_sort_node(plan: str) -> bool:
    # A Sort / Incremental Sort node, not the "Sort Key" detail line.
    return any(
        line.strip().lstrip("-> ").startswith(("Sort", "Incremental Sort"))
        and not line.strip().startswith("Sort Key")
        for line in plan.splitlines()
    )


def _anti_join_probes_supersedes_index(plan: str) -> bool:
    """True when the ``NOT EXISTS`` anti-join's inner side is an index probe on
    ``idx_findings_supersedes`` and nothing in the plan is a Seq Scan.

    The inner relation is the subquery's alias ``s``; the check reads the scan
    node on ``findings s`` rather than merely finding the index name anywhere,
    so the index serving some other node would not pass.
    """
    lines = [line.strip().lstrip("-> ") for line in plan.splitlines()]
    has_anti_join = any("Anti Join" in line for line in lines)
    inner_probe = any(
        f"using {_SUPERSEDES_INDEX_NAME} on findings s" in line for line in lines
    )
    any_seq_scan = any(line.startswith("Seq Scan") for line in lines)
    return has_anti_join and inner_probe and not any_seq_scan


def _inner_side_seq_scans(plan: str) -> bool:
    """True when the anti-join's inner relation (alias ``s``) is a Seq Scan."""
    return any(
        line.strip().lstrip("-> ").startswith("Seq Scan on findings s")
        for line in plan.splitlines()
    )


def _seed(engine: Engine) -> None:
    """Six findings: own tenant, a peer tenant's fleet-infra row, a peer
    tenant's private row, an expired row, and a ``created_at`` tie pair."""
    rows = [
        (_TENANT, "tenant", "0 minutes", "14 days"),
        (_OTHER_TENANT, "fleet-infra", "1 minutes", "14 days"),
        (_OTHER_TENANT, "tenant", "2 minutes", "14 days"),
        (_TENANT, "tenant", "3 minutes", "-1 minutes"),  # expired
        (_TENANT, "tenant", "4 minutes", "14 days"),  # tie pair ...
        (_TENANT, "tenant", "4 minutes", "14 days"),  # ... same created_at
    ]
    with engine.begin() as conn:
        for i, (tenant, scope, age, ttl) in enumerate(rows):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.findings
                        (finding_id, tenant_id, scope, kind, topic, title, body,
                         created_at, expires_at)
                    VALUES
                        (:fid, :tenant, :scope, 'investigation', :topic,
                         :title, 'seed',
                         date_trunc('second', now()) - CAST(:age AS interval),
                         now() + CAST(:ttl AS interval))
                    """
                ),
                {
                    "fid": str(uuid.uuid4()),
                    "topic": _SEED_TOPIC,
                    "tenant": str(tenant),
                    "scope": scope,
                    "title": f"seed {i}",
                    "age": age,
                    "ttl": ttl,
                },
            )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_findings_keyset_01_index_serves_the_recent_page_read() -> None:
    """Build the keyset index, prove the page read walks it without sorting."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "findings_keyset_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — no index, and the page read must sort.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )
        _seed(engine)
        parent_plan = _plan_for(engine, _PAGE_SQL)
        assert _has_sort_node(parent_plan), (
            "without the keyset index the page read must sort — otherwise the "
            f"no-Sort assertion below proves nothing:\n{parent_plan}"
        )
        assert not index_exists(engine, _SUPERSEDES_INDEX_NAME)
        assert _inner_side_seq_scans(parent_plan), (
            "without the supersedes index the anti-join's inner side must be a "
            f"Seq Scan on findings s:\n{parent_plan}"
        )

        # 2. Apply — the index exists and is VALID.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for index in (_INDEX_NAME, _SUPERSEDES_INDEX_NAME):
            assert index_exists(engine, index), index
            assert _index_is_valid(engine, index), (
                f"{index}: a killed CONCURRENTLY build leaves an INVALID index "
                "that IF NOT EXISTS would skip on re-run — existence is not enough"
            )

        # 3 + 4. Key order and direction; not partial, not unique, not
        #        tenant-leading.
        definition, is_partial, is_unique = _index_shape(engine)
        assert definition.endswith("(created_at DESC, finding_id DESC)"), definition
        assert "ON coord.findings" in definition, definition
        assert not is_partial, definition
        assert not is_unique, definition
        assert "tenant_id" not in definition, (
            "a tenant-leading btree cannot serve `(tenant_id = $1 OR scope = "
            f"'fleet-infra')` in created_at order: {definition}"
        )

        # 3b. The supersedes index: on `supersedes`, partial on NOT NULL.
        sup_definition, sup_partial, sup_unique = _index_shape(
            engine, _SUPERSEDES_INDEX_NAME
        )
        assert "ON coord.findings" in sup_definition, sup_definition
        assert "(supersedes)" in sup_definition, sup_definition
        assert sup_definition.endswith("WHERE (supersedes IS NOT NULL)"), sup_definition
        assert sup_partial, sup_definition
        assert not sup_unique, sup_definition

        # 5. The first page and a cursor page ride the keyset index with no
        #    Sort, and probe the supersedes index on the anti-join's inner side.
        plan = _plan_for(engine, _PAGE_SQL)
        assert _INDEX_NAME in plan, f"the page read must ride the index:\n{plan}"
        assert not _has_sort_node(plan), f"the page read must not sort:\n{plan}"
        assert _anti_join_probes_supersedes_index(plan), (
            "the NOT EXISTS anti-join must probe idx_findings_supersedes, not "
            f"scan the table per row:\n{plan}"
        )

        # 5b. The probe check can fail: drop ONLY the supersedes index, EXPLAIN
        #     the same statement, require the inner side to fall back to a Seq
        #     Scan that the probe check rejects, then recreate the index with
        #     the definition the migration built and prove it came back
        #     byte-identical and valid.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text(f"DROP INDEX coord.{_SUPERSEDES_INDEX_NAME}"))
        mutated_plan = _plan_for(engine, _PAGE_SQL)
        assert _inner_side_seq_scans(mutated_plan), mutated_plan
        assert not _anti_join_probes_supersedes_index(mutated_plan), (
            "with idx_findings_supersedes dropped the probe check must go red — "
            f"otherwise it proves nothing:\n{mutated_plan}"
        )
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text(sup_definition))
        assert _index_shape(engine, _SUPERSEDES_INDEX_NAME)[0] == sup_definition
        assert _index_is_valid(engine, _SUPERSEDES_INDEX_NAME)
        assert _anti_join_probes_supersedes_index(_plan_for(engine, _PAGE_SQL))

        with engine.connect() as conn:
            first_page = [
                (r[0], r[1])
                for r in conn.execute(
                    text(
                        "SELECT f.finding_id, f.created_at FROM coord.findings f "
                        f"WHERE (f.tenant_id = '{_TENANT}' OR f.scope = 'fleet-infra') "
                        "AND f.expires_at > now() "
                        "ORDER BY f.created_at DESC, f.finding_id DESC"
                    )
                ).all()
            ]
        # Own tenant's 3 live rows + the peer's fleet-infra row; the peer's
        # private row and the expired row are filtered out.
        assert len(first_page) == 4, first_page

        # The boundary is the FIRST row of the created_at tie pair, so the resume
        # must return its tie partner — the row a created_at-only cursor loses.
        boundary_id, boundary_ts = first_page[2]
        cursor_sql = _cursor_page_sql(boundary_ts.isoformat(), boundary_id)
        cursor_plan = _plan_for(engine, cursor_sql)
        assert _INDEX_NAME in cursor_plan, (
            f"the cursor page must ride the index:\n{cursor_plan}"
        )
        assert not _has_sort_node(cursor_plan), (
            f"the cursor page must not sort:\n{cursor_plan}"
        )
        assert _anti_join_probes_supersedes_index(cursor_plan), (
            "the cursor page's anti-join must probe idx_findings_supersedes:\n"
            f"{cursor_plan}"
        )

        # 6. Keyset order is total across the created_at tie, and the cursor
        #    page resumes exactly after the boundary row.
        ordered = [fid for fid, _ in first_page]
        created = [ts for _, ts in first_page]
        assert created == sorted(created, reverse=True), created
        with engine.connect() as conn:
            resumed = [r[0] for r in conn.execute(text(cursor_sql)).all()]
            assert [r[0] for r in conn.execute(text(_PAGE_SQL)).all()] == ordered
        assert created[2] == created[3], "fixture must carry a created_at tie"
        assert resumed == ordered[3:], (resumed, ordered)

        # 7. Downgrade removes both indexes; the rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert not index_exists(engine, _SUPERSEDES_INDEX_NAME)
        with engine.connect() as conn:
            survivors = conn.execute(
                text("SELECT count(*) FROM coord.findings WHERE topic = :topic"),
                {"topic": _SEED_TOPIC},
            ).scalar()
        assert survivors == 6, "downgrade drops the index only — rows are untouched"
