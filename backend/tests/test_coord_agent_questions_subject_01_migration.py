"""Behaviour test for the ``coord_agent_questions_subject_01`` revision.

The revision adds ``coord.agent_questions.subject_key TEXT NULL``,
``ask_count INTEGER NOT NULL DEFAULT 1``, ``last_asked_at TIMESTAMPTZ NULL``
and a plain partial UNIQUE index::

    CREATE UNIQUE INDEX uq_agent_questions_open_subject
    ON coord.agent_questions (tenant_id, subject_key)
    WHERE subject_key IS NOT NULL
      AND responded_at IS NULL AND withdrawn_at IS NULL

The index IS the "asks once per subject" guarantee coord's
``create_escalation_question`` relies on, so the test asserts the dedupe
semantics through the exact upsert the revision documents, not just shape:

1. Nothing exists at the parent revision.
2. After upgrade the three columns have their shapes, the index is UNIQUE,
   valid, and carries all three predicate conjuncts.
3. A pre-existing row (written at the parent) reads ``ask_count = 1`` and
   ``subject_key IS NULL`` — the constant default, no backfill.
4. Two consults on one subject → ONE row, ``ask_count = 2``,
   ``last_asked_at`` set, and the row refreshed to the second consult's
   ``context``/``question``/``options``; ``created_at`` unchanged.
5. A plain duplicate INSERT on an open subject is refused with 23505.
6. The partial predicate: once the open row is WITHDRAWN, or separately
   ANSWERED, the subject may be asked again as a new row.
7. The same subject in another tenant, and rows with ``subject_key IS NULL``,
   are never constrained.
8. Idempotency: ``stamp`` back to the parent and ``upgrade`` again succeeds
   over the applied schema.
9. Downgrade removes the index and the three columns; questions survive. A
   second upgrade re-applies cleanly.

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

_REVISION_ID = "coord_agent_questions_subject_01"
_PARENT_REVISION_ID = "fleet_policy_egress_01_transcript_sync"

_INDEX_NAME = "uq_agent_questions_open_subject"

_SUBJECT = "repo_pull:device-1/qontinui-web"

# The write the revision's docstring prescribes to coord. Quoted here so the
# arbiter inference against the partial index is exercised, not assumed.
_ASK_SQL = """
    INSERT INTO coord.agent_questions
        (agent_id, tenant_id, question, options, context, subject_key)
    VALUES
        (:agent, :tenant, :question, CAST(:options AS jsonb), :context, :subject)
    ON CONFLICT (tenant_id, subject_key)
        WHERE subject_key IS NOT NULL
          AND responded_at IS NULL
          AND withdrawn_at IS NULL
    DO UPDATE SET ask_count     = coord.agent_questions.ask_count + 1,
                  last_asked_at = now(),
                  context       = EXCLUDED.context,
                  question      = EXCLUDED.question,
                  options       = EXCLUDED.options
    RETURNING question_id
"""

_PLAIN_INSERT_SQL = """
    INSERT INTO coord.agent_questions
        (agent_id, tenant_id, question, options, context, subject_key)
    VALUES
        (:agent, :tenant, 'q', CAST('[]' AS jsonb), 'c', :subject)
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
                VALUES (:t, :slug, 'Subject Key Test Tenant')
                """
            ),
            {"t": tenant_id, "slug": f"subject-key-test-{uuid.uuid4().hex[:8]}"},
        )
    return tenant_id


def _ask(
    engine: Engine,
    tenant_id: uuid.UUID,
    subject: str | None,
    *,
    context: str = "ctx-1",
    question: str = "pull?",
    options: str = '["yes"]',
) -> uuid.UUID:
    """The prescribed upsert. Returns the (new or refreshed) row's id."""
    with engine.begin() as conn:
        qid = conn.execute(
            text(_ASK_SQL),
            {
                "agent": uuid.uuid4(),
                "tenant": tenant_id,
                "question": question,
                "options": options,
                "context": context,
                "subject": subject,
            },
        ).scalar_one()
    return uuid.UUID(str(qid))


def _row(engine: Engine, question_id: uuid.UUID) -> dict[str, object]:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT ask_count, last_asked_at, context, question,
                       options::text AS options, created_at, subject_key
                  FROM coord.agent_questions
                 WHERE question_id = :q
                """
            ),
            {"q": question_id},
        ).one()
    return dict(row._mapping)


def _set(engine: Engine, question_id: uuid.UUID, assignment: str) -> None:
    # `assignment` is a test-local literal, never caller input.
    with engine.begin() as conn:
        conn.execute(
            text(
                f"UPDATE coord.agent_questions SET {assignment} WHERE question_id = :q"
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
def test_coord_agent_questions_subject_01_one_open_question_per_subject() -> None:
    """One OPEN row per (tenant, subject_key); answer/withdraw frees it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "agent_q_subject_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — nothing yet. Write one pre-existing question.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for column in ("subject_key", "ask_count", "last_asked_at"):
            assert column_info(engine, "agent_questions", column) is None, column
        assert not index_exists(engine, _INDEX_NAME)
        tenant_a = _tenant(engine)
        with engine.begin() as conn:
            legacy = conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_questions
                        (agent_id, tenant_id, question, options)
                    VALUES (:a, :t, 'legacy', CAST('[]' AS jsonb))
                    RETURNING question_id
                    """
                ),
                {"a": uuid.uuid4(), "t": tenant_a},
            ).scalar_one()

        # 2. Apply — column shapes and a VALID UNIQUE partial index.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, "agent_questions", "subject_key") == (
            "text",
            "YES",
            None,
        )
        assert column_info(engine, "agent_questions", "ask_count") == (
            "integer",
            "NO",
            "1",
        )
        assert column_info(engine, "agent_questions", "last_asked_at") == (
            "timestamp with time zone",
            "YES",
            None,
        )
        valid, unique, predicate = _index_row(engine)
        assert valid and unique, "the dedupe needs a VALID UNIQUE index"
        assert "subject_key IS NOT NULL" in predicate, predicate
        assert "responded_at IS NULL" in predicate, predicate
        assert "withdrawn_at IS NULL" in predicate, predicate

        # 3. The pre-existing row: constant default, no backfill.
        legacy_row = _row(engine, uuid.UUID(str(legacy)))
        assert legacy_row["ask_count"] == 1
        assert legacy_row["subject_key"] is None
        assert legacy_row["last_asked_at"] is None

        # 4. Two consults on one subject → one row, refreshed to the latest.
        first = _ask(engine, tenant_a, _SUBJECT)
        before = _row(engine, first)
        assert before["ask_count"] == 1 and before["last_asked_at"] is None
        second = _ask(
            engine,
            tenant_a,
            _SUBJECT,
            context="ctx-2",
            question="pull again?",
            options='["yes", "no"]',
        )
        assert second == first, "a repeat consult must return the open row's id"
        after = _row(engine, first)
        assert after["ask_count"] == 2
        assert after["last_asked_at"] is not None
        assert after["context"] == "ctx-2"
        assert after["question"] == "pull again?"
        assert after["options"] == '["yes", "no"]'
        assert after["created_at"] == before["created_at"], (
            "created_at must keep the FIRST ask"
        )

        # 5. A plain duplicate on an open subject is refused.
        with pytest.raises(IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(_PLAIN_INSERT_SQL),
                    {"agent": uuid.uuid4(), "tenant": tenant_a, "subject": _SUBJECT},
                )
        assert getattr(excinfo.value.orig, "pgcode", None) == "23505"

        # 6a. Withdrawn → outside the predicate → a new row.
        _set(engine, first, "withdrawn_at = now()")
        third = _ask(engine, tenant_a, _SUBJECT)
        assert third != first, "a withdrawn row must not absorb a new consult"
        assert _row(engine, third)["ask_count"] == 1

        # 6b. Answered → outside the predicate → a new row.
        _set(engine, third, "responded_at = now(), response = 'yes'")
        fourth = _ask(engine, tenant_a, _SUBJECT)
        assert fourth not in (first, third), "an answered row must not absorb it"

        # 7. Another tenant, and NULL subjects, are unconstrained.
        tenant_b = _tenant(engine)
        assert _ask(engine, tenant_b, _SUBJECT) != fourth
        assert _ask(engine, tenant_a, None) != _ask(engine, tenant_a, None)

        # 8. Idempotency — re-running the revision over its own schema.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine)[0], "a re-run must leave a VALID index"

        # 9. Downgrade removes index + columns; questions survive. Re-upgrade.
        rows_before = _question_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        for column in ("subject_key", "ask_count", "last_asked_at"):
            assert column_info(engine, "agent_questions", column) is None, column
        assert _question_count(engine) == rows_before, (
            "downgrade must not delete questions"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_row(engine)[0], "re-applied index must be VALID"
