"""Behaviour test for the ``agent_questions_alert_key_01`` revision.

The revision adds ``coord.agent_questions.alert_key TEXT NULL`` and a partial
UNIQUE index::

    CREATE UNIQUE INDEX CONCURRENTLY uq_agent_questions_open_alert_key
    ON coord.agent_questions (tenant_id, alert_key)
    WHERE alert_key IS NOT NULL AND responded_at IS NULL

The index IS the dedupe coord's ``fleet_health::on_alert_opened`` relies on:
several writers can fire for one alert episode, and the second INSERT must hit
a unique-violation. So the test asserts the dedupe semantics, not just shape:

1. Nothing exists at the parent revision.
2. After upgrade the column is a nullable, default-less TEXT, and the index is
   UNIQUE and **``indisvalid``** (an INVALID unique index is enforced on
   writes yet skipped by ``IF NOT EXISTS`` on re-run).
3. A second OPEN question for the same ``(tenant, alert_key)`` is refused with
   SQLSTATE 23505 — one open question per alert episode.
4. The same key under a DIFFERENT tenant is accepted (alert keys are
   tenant-local).
5. Once the open question is answered (``responded_at`` set — the table's only
   "open" discriminator), a new question for the same key is accepted: a later
   episode of the alert can ask again.
6. Questions with no ``alert_key`` are never constrained.
7. Downgrade removes the index and the column; questions survive. A second
   upgrade re-applies cleanly.

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

_REVISION_ID = "agent_questions_alert_key_01"
_PARENT_REVISION_ID = "coord_alerts_claim_01"

_INDEX_NAME = "uq_agent_questions_open_alert_key"


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
                VALUES (:t, :slug, 'Alert Key Test Tenant')
                """
            ),
            {"t": tenant_id, "slug": f"alert-key-test-{uuid.uuid4().hex[:8]}"},
        )
    return tenant_id


def _ask(engine: Engine, tenant_id: uuid.UUID, alert_key: str | None) -> uuid.UUID:
    """Insert one pending operator question; returns its id."""
    with engine.begin() as conn:
        return uuid.UUID(
            str(
                conn.execute(
                    text(
                        """
                        INSERT INTO coord.agent_questions
                            (agent_id, tenant_id, question, options, alert_key)
                        VALUES
                            (:agent, :tenant, 'grant the secret?',
                             CAST('[]' AS jsonb), :key)
                        RETURNING question_id
                        """
                    ),
                    {"agent": uuid.uuid4(), "tenant": tenant_id, "key": alert_key},
                ).scalar_one()
            )
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
def test_agent_questions_alert_key_01_dedupes_open_questions_per_alert() -> None:
    """One OPEN question per (tenant, alert_key); answered ones free the key."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "agent_questions_alert_key_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — nothing yet.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "agent_questions", "alert_key") is None
        assert not index_exists(engine, _INDEX_NAME)

        # 2. Apply — column shape and a VALID UNIQUE partial index.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert column_info(engine, "agent_questions", "alert_key") == (
            "text",
            "YES",
            None,
        )
        assert index_exists(engine, _INDEX_NAME)
        valid, unique, predicate = _index_row(engine)
        assert valid, "a killed CONCURRENTLY build leaves an INVALID index"
        assert unique, "the dedupe needs a UNIQUE index"
        assert "alert_key IS NOT NULL" in predicate, predicate
        assert "responded_at IS NULL" in predicate, predicate

        tenant_a = _tenant(engine)
        tenant_b = _tenant(engine)

        # 3. A second OPEN question for the same (tenant, key) is refused.
        first = _ask(engine, tenant_a, "config_missing_secret_grant:svc")
        with pytest.raises(IntegrityError) as excinfo:
            _ask(engine, tenant_a, "config_missing_secret_grant:svc")
        assert getattr(excinfo.value.orig, "pgcode", None) == "23505", (
            "the duplicate must surface as a unique-violation, which is what "
            "coord treats as 'already asked'"
        )

        # 4. Same key, different tenant — accepted.
        _ask(engine, tenant_b, "config_missing_secret_grant:svc")

        # 5. Answer the open question; the next episode may ask again.
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    UPDATE coord.agent_questions
                       SET responded_at = now(), response = 'granted'
                     WHERE question_id = :q
                    """
                ),
                {"q": first},
            )
        _ask(engine, tenant_a, "config_missing_secret_grant:svc")

        # 6. Questions with no alert_key are unconstrained.
        _ask(engine, tenant_a, None)
        _ask(engine, tenant_a, None)

        # 7. Downgrade removes index + column; questions survive. Re-upgrade.
        rows_before = _question_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _INDEX_NAME)
        assert column_info(engine, "agent_questions", "alert_key") is None
        assert _question_count(engine) == rows_before, (
            "downgrade must not delete questions"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX_NAME)
        assert _index_row(engine)[0], "re-applied index must be VALID"
