"""Behaviour test for the ``coord_sessev_interact_idx_01`` partial index.

The revision creates one index::

    CREATE INDEX CONCURRENTLY coord_session_events_interactivity_idx
    ON coord.session_events (session_id, occurred_at DESC)
    WHERE event_kind = 'remote-interactivity'

for coord's per-session interactivity LATERAL (plan
``2026-09-20-remote-session-interactivity-is-a-query-and-both-halves-hold``,
Phase A2, vet defect 8). The contract is that **the planner can serve the
per-session newest-row LATERAL from this index**, so that is what is pinned.

What is asserted
================

1. The parent revision does not have it; after upgrade it exists and is
   **``indisvalid``** — a killed ``CONCURRENTLY`` build leaves an INVALID index
   that ``IF NOT EXISTS`` would skip.
2. Its key list and predicate are the intended ones.
3. **The planner uses it for the LATERAL** coord issues — newest
   ``remote-interactivity`` row per ``(session, half)`` over a page of
   sessions.
4. The LATERAL answers the NEWEST row per half, over a fixture carrying older
   rows of the same half and many rows of other kinds.
5. **Sensitivity: another event kind does NOT get the index.** Without this,
   assertion 3 would still pass against a whole-table index.
6. Re-executing the revision (``stamp`` back to the parent, then
   ``upgrade``) over a valid index keeps it unchanged.
7. An INVALID leftover (``indisvalid = false``) is dropped and rebuilt valid.
8. A valid same-named index with the wrong definition makes the upgrade
   RAISE rather than stamp.
9. Downgrade removes the index while the rows survive.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, skipped when none is reachable.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

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

_REVISION_ID = "coord_sessev_interact_idx_01"
_PARENT_REVISION_ID = "overview_03_documents_and_wiki"

_INDEX_NAME = "coord_session_events_interactivity_idx"

_TENANT = str(uuid4())
_DEVICE = str(uuid4())
_SESSIONS = [str(uuid4()) for _ in range(3)]
_NOW = datetime(2026, 9, 27, 12, 0, tzinfo=UTC)

# The shape coord's fleet read issues: for every session on the page, the
# newest `remote-interactivity` row of one half.
_LATERAL_SQL = """
    SELECT s.id, ev.payload ->> 'state' AS state, ev.occurred_at
      FROM coord.sessions s
      JOIN LATERAL (
            SELECT e.payload, e.occurred_at
              FROM coord.session_events e
             WHERE e.session_id = s.id
               AND e.event_kind = 'remote-interactivity'
               AND e.payload ->> 'half' = :half
             ORDER BY e.occurred_at DESC
             LIMIT 1
      ) ev ON true
     WHERE s.tenant_id = CAST(:tenant AS uuid)
     ORDER BY s.id
"""

# Same shape, another kind: the partial index cannot serve it.
_OTHER_KIND_SQL = """
    SELECT e.occurred_at
      FROM coord.session_events e
     WHERE e.session_id = CAST(:sid AS uuid)
       AND e.event_kind = 'coord-transport-rung'
     ORDER BY e.occurred_at DESC
     LIMIT 1
"""


def _index_state(engine: Engine) -> tuple[bool, str, str]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid,
                       pg_get_indexdef(i.indexrelid),
                       pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return bool(row[0]), str(row[1]), str(row[2] or "")


def _plan_for(engine: Engine, sql: str, params: dict[str, str]) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    The fixture is small, so a seq scan would win on cost regardless. With it
    off the question left is whether the planner CAN use this index for this
    predicate — a partial predicate that does not cover the query stays
    unusable under any penalty, which is how assertion 5 discriminates.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed(engine: Engine) -> int:
    """Seed a tenant, a device, three sessions and their events; return the count.

    ``CAST(:x AS jsonb)`` rather than ``:x::jsonb``: SQLAlchemy's ``text()``
    mis-parses a ``::`` cast that immediately follows a bind parameter.
    """
    events = 0
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) VALUES "
                "(CAST(:t AS uuid), 'sessev-interact-test', 'sessev interact test')"
            ),
            {"t": _TENANT},
        )
        conn.execute(
            text(
                "INSERT INTO coord.devices (device_id, tenant_id, name, hostname) "
                "VALUES (CAST(:d AS uuid), CAST(:t AS uuid), 'dev', 'dev-host')"
            ),
            {"d": _DEVICE, "t": _TENANT},
        )
        insert_event = text(
            """
            INSERT INTO coord.session_events
                (session_id, seq, event_kind, payload, occurred_at)
            VALUES (CAST(:sid AS uuid), :seq, :kind, CAST(:payload AS jsonb), :at)
            """
        )
        for n, sid in enumerate(_SESSIONS):
            conn.execute(
                text(
                    "INSERT INTO coord.sessions "
                    "(id, tenant_id, device_id, session_kind, intent) VALUES "
                    "(CAST(:s AS uuid), CAST(:t AS uuid), CAST(:d AS uuid), "
                    "'terminal_claude', '{}'::jsonb)"
                ),
                {"s": sid, "t": _TENANT, "d": _DEVICE},
            )
            seq = 0
            # Noise: many rows of another kind, all NEWER than any
            # interactivity row, so a kind-blind newest-row read is wrong.
            for i in range(40):
                seq += 1
                conn.execute(
                    insert_event,
                    {
                        "sid": sid,
                        "seq": seq,
                        "kind": "coord-transport-rung",
                        "payload": "{}",
                        "at": _NOW - timedelta(seconds=i),
                    },
                )
            # Interactivity: an OLD `failed` write and a newer `ok` write; an
            # `ok` read. Session n's newest write is `n` minutes old.
            for half, state, age_min in (
                ("write", "failed", 60 + n),
                ("write", "ok", n + 1),
                ("read", "ok", 30),
            ):
                seq += 1
                conn.execute(
                    insert_event,
                    {
                        "sid": sid,
                        "seq": seq,
                        "kind": "remote-interactivity",
                        "payload": f'{{"half": "{half}", "state": "{state}"}}',
                        "at": _NOW - timedelta(minutes=age_min),
                    },
                )
            events += seq
        conn.execute(text("ANALYZE coord.session_events"))
    return events


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_sessev_interact_idx_01_serves_the_interactivity_lateral() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_sessev_interact_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the index must not exist yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME), (
            "the index must be created by this revision, not an earlier one"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, definition, predicate = _index_state(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run — existence is not enough"
        )

        # 2. Key list and predicate.
        assert "(session_id, occurred_at DESC)" in definition, definition
        assert "remote-interactivity" in predicate and "event_kind" in predicate, (
            f"unexpected index predicate: {predicate!r}"
        )

        total = _seed(engine)

        # 3. The LATERAL rides the index.
        params = {"half": "write", "tenant": _TENANT}
        plan = _plan_for(engine, _LATERAL_SQL, params)
        assert _INDEX_NAME in plan, (
            f"the per-session interactivity LATERAL must use the index; got:\n{plan}"
        )

        # 4. Newest row per (session, half), never an older one of that half
        #    and never a row of another kind.
        with engine.connect() as conn:
            writes = conn.execute(text(_LATERAL_SQL), params).all()
            reads = conn.execute(
                text(_LATERAL_SQL), {"half": "read", "tenant": _TENANT}
            ).all()
        assert sorted(str(r[0]) for r in writes) == sorted(_SESSIONS)
        by_session = {str(r[0]): (r[1], r[2]) for r in writes}
        for n, sid in enumerate(_SESSIONS):
            state, at = by_session[sid]
            assert state == "ok", "the newer `ok` write must win over the old failure"
            assert at == _NOW - timedelta(minutes=n + 1)
        assert all(r[1] == "ok" for r in reads) and len(reads) == len(_SESSIONS)

        # 5. Sensitivity — another kind cannot use a partial index on this one.
        other_plan = _plan_for(engine, _OTHER_KIND_SQL, {"sid": _SESSIONS[0]})
        assert _INDEX_NAME not in other_plan, (
            "a non-interactivity read must NOT match this partial index:\n" + other_plan
        )

        # 6. Re-running the revision body over an EXISTING valid index keeps
        #    it. `stamp` rewinds the version table without touching the
        #    catalog, so the next `upgrade` really executes the revision again.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        valid, definition_again, _ = _index_state(engine)
        assert valid and definition_again == definition

        # 7. Heal: an INVALID leftover (a killed CONCURRENTLY build) is
        #    dropped and rebuilt, where IF NOT EXISTS alone would keep it.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE pg_index SET indisvalid = false WHERE indexrelid = "
                    "'coord.coord_session_events_interactivity_idx'::regclass"
                )
            )
        assert not _index_state(engine)[0]
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_state(engine)[0], "the INVALID index must be rebuilt valid"

        # 8. Refusal: a VALID same-named index built differently is not
        #    silently accepted — the revision raises rather than stamping.
        with engine.begin() as conn:
            conn.execute(
                text("DROP INDEX coord.coord_session_events_interactivity_idx")
            )
            conn.execute(
                text(
                    "CREATE INDEX coord_session_events_interactivity_idx "
                    "ON coord.session_events (session_id)"
                )
            )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        refused = run_alembic(root, url, "upgrade", _REVISION_ID, expect_success=False)
        assert "lacks" in refused.stdout + refused.stderr, (
            refused.stdout + refused.stderr
        )
        with engine.begin() as conn:
            conn.execute(
                text("DROP INDEX coord.coord_session_events_interactivity_idx")
            )
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_state(engine)[0]

        # 9. Downgrade removes the index only; the rows survive.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        with engine.connect() as conn:
            assert (
                conn.execute(text("SELECT count(*) FROM coord.session_events")).scalar()
                == total
            ), "downgrade drops the index only — rows are untouched"
