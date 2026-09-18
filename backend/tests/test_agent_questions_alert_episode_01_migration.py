"""Behaviour test for the ``agent_questions_alert_episode_01`` revision.

The revision adds ``coord.agent_questions.alert_id BIGINT NULL`` (the dedupe
key: one ``coord.alerts`` row = one alert episode), ``alert_key TEXT NULL``
(informational), and a partial UNIQUE index::

    CREATE UNIQUE INDEX CONCURRENTLY uq_agent_questions_open_alert_episode
    ON coord.agent_questions (tenant_id, alert_id)
    WHERE alert_id IS NOT NULL AND responded_at IS NULL

The index IS the dedupe coord's ``fleet_health::on_alert_opened`` relies on,
so the test asserts the dedupe semantics, not just shape:

1. Nothing exists at the parent revision.
2. After upgrade both columns are nullable and default-less, and the index is
   UNIQUE, **``indisvalid``**, and carries the intended predicate.
3. The documented write — ``INSERT ... ON CONFLICT (tenant_id, alert_id)
   WHERE ... DO NOTHING RETURNING question_id`` — returns a row for the first
   question of an episode and NO row for a duplicate. A plain duplicate
   INSERT is refused with SQLSTATE 23505.
4. **Two episodes of the same ``alert_key``** (two ``alert_id`` values) each
   get their own open question — an unanswered episode-1 question must not
   block episode 2.
5. The same episode under a DIFFERENT tenant is accepted (one fleet-wide
   alert may raise one question per tenant).
6. Once the open question is answered (``responded_at`` set — the table's only
   "open" discriminator) the episode may be asked again.
7. Questions with no ``alert_id`` are never constrained.
8. **Idempotency:** ``alembic stamp`` back to the parent and ``upgrade`` again
   succeeds over the applied schema and leaves a valid index.
9. **A failed CONCURRENTLY build is repaired, not kept:** duplicates make a
   genuine ``CREATE UNIQUE INDEX CONCURRENTLY`` fail and leave an INVALID
   index of this name; once the duplicate is resolved, a re-run drops it and
   rebuilds a valid one instead of letting ``IF NOT EXISTS`` skip it.
10. Downgrade removes the index and both columns; questions survive. A second
    upgrade re-applies cleanly after the downgrade.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
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
    column_info,
    ephemeral_database,
    index_exists,
    run_alembic,
)

_REVISION_ID = "agent_questions_alert_episode_01"
_PARENT_REVISION_ID = "coord_alerts_claim_01"

_INDEX_NAME = "uq_agent_questions_open_alert_episode"

_KEY = "config_missing_secret_grant:svc"

# The write the revision's docstring prescribes to coord. Quoted here so the
# arbiter inference against the partial index is exercised, not assumed.
_ASK_SQL = """
    INSERT INTO coord.agent_questions
        (agent_id, tenant_id, question, options, alert_id, alert_key)
    VALUES
        (:agent, :tenant, 'grant the secret?', CAST('[]' AS jsonb),
         :alert_id, :alert_key)
    ON CONFLICT (tenant_id, alert_id)
        WHERE alert_id IS NOT NULL AND responded_at IS NULL
    DO NOTHING
    RETURNING question_id
"""

_PLAIN_INSERT_SQL = """
    INSERT INTO coord.agent_questions
        (agent_id, tenant_id, question, options, alert_id, alert_key)
    VALUES
        (:agent, :tenant, 'grant the secret?', CAST('[]' AS jsonb),
         :alert_id, :alert_key)
    RETURNING question_id
"""


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


def _tenant(engine: Engine) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'Alert Episode Test Tenant')
                """
            ),
            {"t": tenant_id, "slug": f"alert-episode-test-{uuid.uuid4().hex[:8]}"},
        )
    return tenant_id


def _params(tenant_id: uuid.UUID, alert_id: int | None) -> dict[str, object]:
    return {
        "agent": uuid.uuid4(),
        "tenant": tenant_id,
        "alert_id": alert_id,
        "alert_key": _KEY if alert_id is not None else None,
    }


def _ask(
    engine: Engine, tenant_id: uuid.UUID, alert_id: int | None
) -> uuid.UUID | None:
    """The prescribed write. Returns the new id, or None when already asked."""
    with engine.begin() as conn:
        qid = conn.execute(text(_ASK_SQL), _params(tenant_id, alert_id)).scalar()
    return None if qid is None else uuid.UUID(str(qid))


def _plain_insert(engine: Engine, tenant_id: uuid.UUID, alert_id: int | None) -> None:
    with engine.begin() as conn:
        conn.execute(text(_PLAIN_INSERT_SQL), _params(tenant_id, alert_id))


def _answer(engine: Engine, question_id: uuid.UUID) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE coord.agent_questions
                   SET responded_at = now(), response = 'granted'
                 WHERE question_id = :q
                """
            ),
            {"q": question_id},
        )


def _question_count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.agent_questions")
            ).scalar_one()
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_agent_questions_alert_episode_01_one_open_question_per_episode() -> None:
    """One OPEN question per (tenant, alert episode); answering frees it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "agent_q_alert_episode_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — nothing yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "agent_questions", "alert_id") is None
        assert column_info(engine, "agent_questions", "alert_key") is None
        assert not index_exists(engine, _INDEX_NAME)

        # 2. Apply — column shapes and a VALID UNIQUE partial index.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, "agent_questions", "alert_id") == (
            "bigint",
            "YES",
            None,
        )
        assert column_info(engine, "agent_questions", "alert_key") == (
            "text",
            "YES",
            None,
        )
        assert index_exists(engine, _INDEX_NAME)
        valid, unique, predicate = _index_row(engine)
        assert valid, "a killed CONCURRENTLY build leaves an INVALID index"
        assert unique, "the dedupe needs a UNIQUE index"
        assert "alert_id IS NOT NULL" in predicate, predicate
        assert "responded_at IS NULL" in predicate, predicate

        tenant_a = _tenant(engine)
        tenant_b = _tenant(engine)
        episode_1, episode_2 = 101, 202  # two coord.alerts rows, one alert_key

        # 3. The prescribed write: first ask lands, duplicate returns no row.
        first = _ask(engine, tenant_a, episode_1)
        assert first is not None
        assert _ask(engine, tenant_a, episode_1) is None, (
            "a second question for an episode with an open one must be a no-op"
        )
        with pytest.raises(IntegrityError) as excinfo:
            _plain_insert(engine, tenant_a, episode_1)
        assert getattr(excinfo.value.orig, "pgcode", None) == "23505"

        # 4. A second EPISODE of the same alert_key gets its own question
        #    while episode 1's is still unanswered.
        assert _ask(engine, tenant_a, episode_2) is not None, (
            "an unanswered question from episode 1 must not block episode 2"
        )

        # 5. Same episode, different tenant — accepted.
        assert _ask(engine, tenant_b, episode_1) is not None

        # 6. Answer the open question; the episode may be asked again.
        _answer(engine, first)
        assert _ask(engine, tenant_a, episode_1) is not None

        # 7. Questions with no alert_id are unconstrained.
        assert _ask(engine, tenant_a, None) is not None
        assert _ask(engine, tenant_a, None) is not None

        # 8. Idempotency — re-running the revision over its own schema.
        with engine.connect() as conn:
            oid_before = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "a re-run must leave a VALID index"
        with engine.connect() as conn:
            oid_after = conn.execute(
                text(f"SELECT 'coord.{_INDEX_NAME}'::regclass::oid")
            ).scalar_one()
        assert oid_after == oid_before, (
            "a re-run must leave a VALID index untouched, not drop and rebuild it"
        )

        # 9. A failed CONCURRENTLY build is repaired. Drop the index, create
        #    a duplicate open question, and let a real CONCURRENTLY build fail
        #    on it — which leaves an INVALID index under our name.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(
                text(
                    "DROP INDEX CONCURRENTLY coord.uq_agent_questions_open_alert_episode"
                )
            )
        _plain_insert(engine, tenant_a, episode_2)  # duplicate of step 4's
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            with pytest.raises(IntegrityError):
                conn.execute(
                    text(
                        """
                        CREATE UNIQUE INDEX CONCURRENTLY
                            uq_agent_questions_open_alert_episode
                        ON coord.agent_questions (tenant_id, alert_id)
                        WHERE alert_id IS NOT NULL AND responded_at IS NULL
                        """
                    )
                )
        assert index_exists(engine, _INDEX_NAME)
        assert not _index_row(engine)[0], "fixture must leave an INVALID index"

        # Resolve the duplicate (answer one of the two), then re-run.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.agent_questions
                       SET responded_at = now(), response = 'dup'
                     WHERE question_id = (
                        SELECT question_id FROM coord.agent_questions
                         WHERE tenant_id = :t AND alert_id = :a
                           AND responded_at IS NULL
                         LIMIT 1)
                    """
                ),
                {"t": tenant_a, "a": episode_2},
            )
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        valid, unique, _ = _index_row(engine)
        assert valid and unique, (
            "the re-run must drop the INVALID index and rebuild a valid one"
        )

        # 10. Downgrade removes index + columns; questions survive. Re-upgrade.
        rows_before = _question_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert column_info(engine, "agent_questions", "alert_id") is None
        assert column_info(engine, "agent_questions", "alert_key") is None
        assert _question_count(engine) == rows_before, (
            "downgrade must not delete questions"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_row(engine)[0], "re-applied index must be VALID"
