"""Behaviour test for the ``agent_questions_alert_id_idx_01`` revision.

The revision adds a plain partial index::

    CREATE INDEX CONCURRENTLY idx_agent_questions_tenant_alert
    ON coord.agent_questions (tenant_id, alert_id)
    WHERE alert_id IS NOT NULL

What is asserted
================

1. Nothing exists at the parent revision.
2. After upgrade the index exists, is **``indisvalid``**, is NOT unique (it is
   an access path, not a constraint), and its predicate is
   ``alert_id IS NOT NULL`` only. It must not inherit the open-only
   ``responded_at IS NULL`` term of the unique index.
3. **coord's answered-row probes ride it.** Seeded with thousands of answered
   and open alert questions plus unlinked agent questions, then ANALYZEd:
   * the gap-count arm ``q.tenant_id = $1 AND q.alert_id = a.id AND
     q.responded_at IS NOT NULL`` (``alert_queue.rs``), as a point probe;
   * the any-question probe ``q.tenant_id = a.tenant_id AND q.alert_id = a.id``
     (``alert_operator_questions.rs``) as the correlated ``EXISTS`` over
     ``coord.alerts`` it actually is.
4. **Sensitivity:** a read of UNLINKED questions (``alert_id IS NULL``) does
   not plan on it, so assertion 3 is measuring the partial predicate.
5. **Idempotency:** ``alembic stamp`` back to the parent and ``upgrade`` again
   leaves the same VALID index (same oid), rather than dropping and rebuilding
   it.
6. **A failed CONCURRENTLY build is repaired, not kept:** a genuinely failing
   ``CREATE UNIQUE INDEX CONCURRENTLY`` of the same name (duplicate answered
   questions for one episode) leaves an INVALID index; a re-run drops it and
   rebuilds the revision's own, non-unique, valid index.
7. Downgrade removes the index and leaves every question; a second upgrade
   re-applies cleanly.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` points it
at a non-default host:port).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "agent_questions_alert_id_idx_01"
_PARENT_REVISION_ID = "coordnotif_03_rename_irreversible_kind"

_INDEX_NAME = "idx_agent_questions_tenant_alert"

_TENANTS = 40
_ALERTS_PER_TENANT = 150


def _index_row(engine: Engine) -> tuple[bool, bool, str]:
    """``(indisvalid, indisunique, predicate)`` for the index."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, i.indisunique,
                       pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = :idx
                """
            ),
            {"idx": _INDEX_NAME},
        ).one()
    return bool(row[0]), bool(row[1]), str(row[2] or "")


def _index_oid(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        )


def _plan_for(engine: Engine, sql: str) -> str:
    """EXPLAIN ``sql`` with sequential scans penalised.

    ``enable_seqscan = off`` leaves the question being asked: which index does
    the planner choose for this predicate, given every other index on the
    table? A predicate the partial index does not cover never plans on it.
    """
    with engine.connect() as conn:
        conn.execute(text("SET enable_seqscan = off"))
        rows = conn.execute(text(f"EXPLAIN {sql}")).all()
    return "\n".join(str(r[0]) for r in rows)


def _question_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.agent_questions")
            ).scalar_one()
        )


def _seed(engine: Engine) -> tuple[uuid.UUID, int]:
    """Seed the production shape. Returns a (tenant, alert_id) that has an answer.

    Per tenant: ``_ALERTS_PER_TENANT`` alert episodes, each with one ANSWERED
    question, and every third with a newer OPEN one too. Plus 2,000 questions
    linked to no alert, which the partial index must leave out. And one open
    ``coord.alerts`` row per episode for the correlated probe.
    """
    tenants = [uuid.uuid4() for _ in range(_TENANTS)]
    with engine.begin() as conn:
        for t_index, tenant in enumerate(tenants):
            base = t_index * 10_000
            # agent_questions.tenant_id is a foreign key to coord.tenants.
            conn.execute(
                text(
                    """
                    INSERT INTO coord.tenants (tenant_id, slug, display_name)
                    VALUES (:t, :slug, 'Index Test Tenant')
                    """
                ),
                {"t": tenant, "slug": f"aq-idx-test-{uuid.uuid4().hex[:12]}"},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_questions
                        (agent_id, tenant_id, question, options, alert_id,
                         alert_key, responded_at, response)
                    SELECT gen_random_uuid(), :t, 'q', CAST('[]' AS jsonb),
                           :base + g, 'k:' || g, now(), 'answered'
                      FROM generate_series(1, :n) AS g
                    """
                ),
                {"t": tenant, "base": base, "n": _ALERTS_PER_TENANT},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_questions
                        (agent_id, tenant_id, question, options, alert_id, alert_key)
                    SELECT gen_random_uuid(), :t, 'q', CAST('[]' AS jsonb),
                           :base + g, 'k:' || g
                      FROM generate_series(1, :n) AS g
                     WHERE g % 3 = 0
                    """
                ),
                {"t": tenant, "base": base, "n": _ALERTS_PER_TENANT},
            )
            conn.execute(
                text(
                    """
                    INSERT INTO coord.alerts
                        (alert_key, severity, kind, summary, tenant_id)
                    SELECT 'idx-test-' || (:base + g), 'warning',
                           'pr_merge_stuck', 'open', :t
                      FROM generate_series(1, :n) AS g
                    """
                ),
                {"t": tenant, "base": base, "n": _ALERTS_PER_TENANT},
            )
        conn.execute(
            text(
                """
                INSERT INTO coord.agent_questions
                    (agent_id, tenant_id, question, options)
                SELECT gen_random_uuid(), :t, 'unlinked', CAST('[]' AS jsonb)
                  FROM generate_series(1, 2000)
                """
            ),
            {"t": tenants[0]},
        )
        conn.execute(text("ANALYZE coord.agent_questions"))
        conn.execute(text("ANALYZE coord.alerts"))
    return tenants[7], 7 * 10_000 + 42


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG to a reachable host:port."
    ),
)
def test_agent_questions_alert_id_idx_01_indexes_answered_episode_probes() -> None:
    root = backend_root()

    with ephemeral_database(admin_database_url(), "aq_alert_id_idx_test") as (
        engine,
        url,
    ):
        # 1. Parent revision: no index yet. Seed so the build runs over rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        tenant, alert_id = _seed(engine)
        questions = _question_count(engine)

        # 2. Apply: valid, non-unique, the intended predicate only.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        valid, unique, predicate = _index_row(engine)
        assert valid, (
            "a killed CONCURRENTLY build leaves an INVALID index that "
            "IF NOT EXISTS would skip on re-run; existence is not enough"
        )
        assert not unique, "this index is an access path, not a constraint"
        assert "alert_id IS NOT NULL" in predicate, predicate
        assert "responded_at" not in predicate, (
            f"the index must cover ANSWERED rows too, got predicate {predicate!r}"
        )
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.agent_questions"))

        # 3. The answered-row probes ride the index.
        answered_probe = f"""
            SELECT 1 FROM coord.agent_questions q
             WHERE q.tenant_id = '{tenant}'
               AND q.alert_id = {alert_id}
               AND q.responded_at IS NOT NULL
        """
        plan = _plan_for(engine, answered_probe)
        assert _INDEX_NAME in plan, f"the answered probe must ride the index:\n{plan}"

        correlated = """
            SELECT a.id FROM coord.alerts a
             WHERE a.resolved_at IS NULL
               AND a.alert_key LIKE 'idx-test-%'
               AND NOT EXISTS (
                   SELECT 1 FROM coord.agent_questions q
                    WHERE q.tenant_id = a.tenant_id AND q.alert_id = a.id)
        """
        plan = _plan_for(engine, correlated)
        assert _INDEX_NAME in plan, (
            f"the correlated any-question probe must ride the index:\n{plan}"
        )
        with engine.connect() as conn:
            found = conn.execute(text(answered_probe)).all()
        assert len(found) == 1, "the seeded answered question must be found"

        # 4. Sensitivity: unlinked questions are outside the partial predicate.
        unlinked = f"""
            SELECT 1 FROM coord.agent_questions q
             WHERE q.tenant_id = '{tenant}' AND q.alert_id IS NULL
        """
        assert _INDEX_NAME not in _plan_for(engine, unlinked), (
            "an `alert_id IS NULL` read must NOT match this partial index"
        )

        # 5. Idempotency: a re-run leaves the VALID index untouched.
        oid_before = _index_oid(engine)
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "a re-run must leave a VALID index"
        assert _index_oid(engine) == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # 6. A failed CONCURRENTLY build is repaired. Two ANSWERED questions for
        #    one episode make a same-named UNIQUE build fail, leaving an
        #    INVALID index under our name.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_questions
                        (agent_id, tenant_id, question, options, alert_id,
                         responded_at, response)
                    VALUES (gen_random_uuid(), :t, 'dup', CAST('[]' AS jsonb),
                            :a, now(), 'answered again')
                    """
                ),
                {"t": tenant, "a": alert_id},
            )
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(
                text("DROP INDEX CONCURRENTLY coord.idx_agent_questions_tenant_alert")
            )
            with pytest.raises(IntegrityError):
                conn.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX CONCURRENTLY idx_agent_questions_tenant_alert
                        ON coord.agent_questions (tenant_id, alert_id)
                        WHERE alert_id IS NOT NULL
                        """
                    )
                )
        assert index_exists(engine, _INDEX_NAME)
        assert not _index_row(engine)[0], "fixture must leave an INVALID index"

        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        valid, unique, _ = _index_row(engine)
        assert valid, "the re-run must drop the INVALID index and rebuild it"
        assert not unique, "the rebuilt index must be the revision's own"

        # 7. Downgrade removes the index; questions survive. Re-upgrade works.
        questions_before = _question_count(engine)
        assert questions_before == questions + 1
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert _question_count(engine) == questions_before, (
            "downgrade must not delete questions"
        )
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "re-applied index must be VALID"
