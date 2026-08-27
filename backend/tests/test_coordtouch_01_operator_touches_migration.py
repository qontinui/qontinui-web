"""Behaviour test for the ``coordtouch_01`` operator-touch store + backfill.

``migration-reversal.yml`` would only confirm the statements execute against an
empty database. The contracts worth pinning here are the ones a reviewer cannot
read off the DDL, and every one of them is a way the resulting metric could be
quietly wrong:

1. **Shape** — both tables and all six indexes exist after upgrade, and are
   gone after downgrade. The cheap half, and the only half a schema diff covers.
2. **The unique idempotency key actually dedupes.** The plan names
   double-counting as its primary risk: the runner and the agent can both
   observe one touch. A UNIQUE index that was created but not enforced (a
   non-unique index with a hopeful name, say) would let the stop-short rate
   inflate silently.
3. **The backfill is idempotent.** Same risk from the other direction — a live
   coord emitting for the same events this migration reconstructs. Running the
   backfill twice must not move a single row count.
4. **A pending question backfills as OPEN, not abandoned.** Some of the
   questions in ``coord.agent_questions`` are waiting on an operator right now.
   Stamping a terminal ``resolution`` on them would invent a fact, and it would
   invent it in the direction that flatters the metric (a resolved touch looks
   handled). NULL is the only honest value.
5. **An operator-audience gate cleared by an AGENT is NOT backfilled.** This is
   the touch/no-touch split and it is the assertion most worth having: the
   audience column says who the gate was *addressed to*, and
   ``cleared_by_device_id`` is the only evidence a *human* actually did
   anything. Backfilling agent attestations would inflate the exact rate this
   store exists to measure — and would do it invisibly, because those rows look
   identical in every other column.

The backfill statements are imported from the revision module rather than
re-typed, deliberately: the sibling ``coord_workunits_05`` test documents at
length how a paraphrased SQL mirror stays green while measuring a statement no
process executes. Here that trap is avoidable, so it is avoided.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import UTC, datetime, timedelta
from types import ModuleType

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
    table_exists,
)

_REVISION_ID = "coordtouch_01"
_PARENT_REVISION_ID = "ffland_headsync_01"

_TOUCHES = "operator_touches"
_CLASSIFICATIONS = "operator_touch_classifications"

_TOUCH_INDEXES = (
    "uq_operator_touches_idempotency_key",
    "ix_operator_touches_tenant_emitted_at",
    "ix_operator_touches_tenant_reason_emitted_at",
    "ix_operator_touches_tenant_session",
    "ix_operator_touches_tenant_open",
)
_CLASSIFICATION_INDEXES = ("ix_operator_touch_classifications_touch",)

_TENANT = uuid.UUID("2f2b1f6a-6d4e-4a2f-9a05-6c9a7c3d1e88")
_DEVICE = uuid.UUID("7a1c0e52-3b44-4f8a-b6b1-2b0a5d9f4c31")
_SESSION = uuid.UUID("9d6f2a11-8c7e-4c3b-9f52-1a4e8b7c0d63")
_EPOCH = datetime(2026, 8, 1, tzinfo=UTC)

#: Question ids, fixed so assertions can address a specific backfilled row by
#: its derived idempotency key rather than by guessing at ordering.
_Q_ANSWERED = uuid.UUID("11111111-1111-4111-8111-111111111111")
_Q_PENDING = uuid.UUID("22222222-2222-4222-8222-222222222222")

#: Gate ids. The names say what each one is FOR — the split under test.
_G_OPERATOR_CLEARED = uuid.UUID("33333333-3333-4333-8333-333333333333")
_G_OPERATOR_OPEN = uuid.UUID("44444444-4444-4444-8444-444444444444")
_G_AGENT_CLEARED = uuid.UUID("55555555-5555-4555-8555-555555555555")
_G_AGENT_AUDIENCE = uuid.UUID("66666666-6666-4666-8666-666666666666")

#: Exactly the rows the backfill must produce from the fixture below, keyed by
#: idempotency key. Written out in full rather than derived, so a change to the
#: backfill's filter has to be acknowledged here too.
_EXPECTED_KEYS = {
    f"question:{_Q_ANSWERED}",
    f"question:{_Q_PENDING}",
    f"gate:{_G_OPERATOR_CLEARED}",
    f"gate:{_G_OPERATOR_OPEN}",
}


def _load_revision_module() -> ModuleType:
    """Import the revision file by path to reach its backfill SQL constants.

    ``backend/alembic/versions/`` has no ``__init__.py`` and is not on the
    import path, so a plain ``import`` would either fail or (worse, per the
    harness's own note about namespace packages) resolve to something else.
    """
    path = backend_root() / "alembic" / "versions" / "coordtouch_01_operator_touches.py"
    spec = importlib.util.spec_from_file_location("coordtouch_01_revision", path)
    assert spec is not None and spec.loader is not None, f"cannot load {path}"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _seed_sources(engine: Engine) -> None:
    """Seed the two partial ledgers the backfill reads.

    The fixture is built around the touch/no-touch split rather than around
    coverage: two questions (one answered, one still pending) and four gates
    spanning both axes of the filter — audience, and whether a device (i.e. a
    human at a device) or an agent did the clearing.
    """
    with engine.begin() as conn:
        # `coord.agent_questions.tenant_id` carries an FK to `coord.tenants`
        # (added by `coord_tenant_scope_columns`, repaired by
        # `coord_tenant_fk_01`), so the tenant must exist first.
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:tid, 'touchtest', 'Touch Test Tenant')
                ON CONFLICT (tenant_id) DO NOTHING
                """
            ),
            {"tid": _TENANT},
        )

        for question_id, responded_at, response in (
            (_Q_ANSWERED, _EPOCH + timedelta(minutes=17), "yes"),
            (_Q_PENDING, None, None),
        ):
            conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_questions (
                        question_id, agent_id, agent_session_id, device_id,
                        question, options, created_at, responded_at, response,
                        tenant_id
                    ) VALUES (
                        :qid, :agent, :session, :device,
                        'proceed?', '[]'::jsonb, :created, :responded, :response,
                        :tid
                    )
                    """
                ),
                {
                    "qid": question_id,
                    "agent": uuid.uuid4(),
                    "session": _SESSION,
                    "device": _DEVICE,
                    "created": _EPOCH,
                    "responded": responded_at,
                    "response": response,
                    "tid": _TENANT,
                },
            )

        gates = (
            # (gate_id, audience, verdict, cleared_at, cleared_by_device_id,
            #  cleared_by_agent_id)
            #
            # A human cleared an operator gate — the canonical touch.
            (
                _G_OPERATOR_CLEARED,
                "operator",
                "cleared",
                _EPOCH + timedelta(hours=3),
                _DEVICE,
                None,
            ),
            # An operator gate a human has started but not finished. Included
            # because "cleared by a device" and "resolved" are separate facts,
            # and the backfill must not conflate them.
            (_G_OPERATOR_OPEN, "operator", "open", None, _DEVICE, None),
            # THE assertion: addressed to an operator, cleared by an AGENT.
            # No human was touched.
            (
                _G_AGENT_CLEARED,
                "operator",
                "cleared",
                _EPOCH + timedelta(hours=1),
                None,
                uuid.uuid4(),
            ),
            # Never involved a human at all.
            (
                _G_AGENT_AUDIENCE,
                "agent",
                "cleared",
                _EPOCH + timedelta(hours=2),
                _DEVICE,
                None,
            ),
        )
        for gate_id, audience, verdict, cleared_at, by_device, by_agent in gates:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.gates (
                        gate_id, claim_kind, resource_key, predicate, verdict,
                        tenant_id, agent_session_id, clearance_audience,
                        cleared_by_device_id, cleared_by_agent_id,
                        created_at, cleared_at
                    ) VALUES (
                        :gid, 'file_glob', 'backend/**', '{}'::jsonb, :verdict,
                        :tid, :session, :audience,
                        :by_device, :by_agent,
                        :created, :cleared
                    )
                    """
                ),
                {
                    "gid": gate_id,
                    "verdict": verdict,
                    "tid": _TENANT,
                    "session": _SESSION,
                    "audience": audience,
                    "by_device": by_device,
                    "by_agent": by_agent,
                    "created": _EPOCH,
                    "cleared": cleared_at,
                },
            )


def _touch_rows(engine: Engine) -> dict[str, dict]:
    """Every touch row, keyed by ``idempotency_key``."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT idempotency_key, kind, source, reason_code,
                       policy_authorized, tenant_id, session_id, device_id,
                       gate_id, emitted_at, resolved_at, resolution
                  FROM coord.operator_touches
                """
            )
        ).mappings()
        return {r["idempotency_key"]: dict(r) for r in rows}


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_coordtouch_01_creates_the_store_and_backfills_only_real_touches() -> None:
    """Shape, dedup, backfill idempotency, open-means-open, and the touch split."""
    root = backend_root()
    revision = _load_revision_module()

    with ephemeral_database(admin_database_url(), "coordtouch01_test") as (
        engine,
        url,
    ):
        # ----------------------------------------------------------------
        # 1. Parent revision — the sources exist, the store does not.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TOUCHES), (
            "the store must be created by this revision, not an earlier one"
        )
        assert not table_exists(engine, "coord", _CLASSIFICATIONS)
        assert table_exists(engine, "coord", "agent_questions")
        assert table_exists(engine, "coord", "gates")

        # Seeded BEFORE the upgrade on purpose: the backfill runs inside
        # `upgrade()`, so this is the only way to exercise it as it will
        # actually run against a populated production database.
        _seed_sources(engine)

        # ----------------------------------------------------------------
        # 2. Apply — both tables and every index exist.
        # ----------------------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", _TOUCHES)
        assert table_exists(engine, "coord", _CLASSIFICATIONS)
        for name in (*_TOUCH_INDEXES, *_CLASSIFICATION_INDEXES):
            assert index_exists(engine, name), f"missing index {name}"

        # ----------------------------------------------------------------
        # 3. The backfill produced EXACTLY the real touches — no more.
        # ----------------------------------------------------------------
        rows = _touch_rows(engine)
        assert set(rows) == _EXPECTED_KEYS, (
            "backfill produced the wrong row set; extra keys inflate the "
            "stop-short rate and missing ones deflate it"
        )

        # 3a. An operator-audience gate cleared by an AGENT is NOT a touch.
        assert f"gate:{_G_AGENT_CLEARED}" not in rows, (
            "a gate cleared by an agent attestation touched no human and must "
            "not be backfilled, however it was addressed"
        )
        # 3b. An agent-audience gate never involved a human either.
        assert f"gate:{_G_AGENT_AUDIENCE}" not in rows

        # ----------------------------------------------------------------
        # 4. A PENDING question is OPEN, not abandoned.
        # ----------------------------------------------------------------
        pending = rows[f"question:{_Q_PENDING}"]
        assert pending["resolved_at"] is None
        assert pending["resolution"] is None, (
            "a question nobody has answered yet has no resolution; inventing "
            "one ('abandoned') would fabricate a terminal state"
        )
        assert pending["kind"] == "question"
        assert pending["source"] == "agent_questions", (
            "provenance must say the row was reconstructed, not observed"
        )
        assert pending["reason_code"] == "unclassified"
        assert pending["policy_authorized"] == "unknown", (
            "the backfill cannot know whether asking was authorized; unknown "
            "is the honest tri-state value, and it is why this is not a bool"
        )
        assert pending["session_id"] == _SESSION
        assert pending["device_id"] == _DEVICE
        assert pending["emitted_at"] == _EPOCH

        # The answered one, for contrast — resolution is derived from the
        # source's own timestamp, never guessed.
        answered = rows[f"question:{_Q_ANSWERED}"]
        assert answered["resolution"] == "answered"
        assert answered["resolved_at"] == _EPOCH + timedelta(minutes=17)

        # Gate rows: authorized by construction, and open stays open.
        cleared_gate = rows[f"gate:{_G_OPERATOR_CLEARED}"]
        assert cleared_gate["kind"] == "gate"
        assert cleared_gate["source"] == "gates"
        assert cleared_gate["gate_id"] == _G_OPERATOR_CLEARED
        assert cleared_gate["resolution"] == "answered"
        assert cleared_gate["policy_authorized"] == "yes", (
            "a registered gate IS the sanctioned escalation path; counting it "
            "as avoidable is the miscount the plan explicitly forbids"
        )
        assert rows[f"gate:{_G_OPERATOR_OPEN}"]["resolution"] is None

        # ----------------------------------------------------------------
        # 5. Re-running the backfill changes nothing (the double-count risk).
        # ----------------------------------------------------------------
        with engine.begin() as conn:
            conn.execute(text(revision.BACKFILL_AGENT_QUESTIONS_SQL))
            conn.execute(text(revision.BACKFILL_GATES_SQL))
        assert _touch_rows(engine) == rows, (
            "the backfill must be idempotent: a live coord emitting for the "
            "same events, or a re-run migration, must not duplicate a touch"
        )

        # ----------------------------------------------------------------
        # 6. The unique key is ENFORCED, not merely declared.
        # ----------------------------------------------------------------
        insert_touch = text(
            """
            INSERT INTO coord.operator_touches
                (tenant_id, kind, source, idempotency_key)
            VALUES (:tid, 'permission_prompt', 'runner_hook', :key)
            """
        )
        duplicate_key = f"{_SESSION}:permission_prompt:1754006400"
        with engine.begin() as conn:
            conn.execute(insert_touch, {"tid": _TENANT, "key": duplicate_key})
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(insert_touch, {"tid": _TENANT, "key": duplicate_key})

        # The defaults are what make a bare emit honest: unclassified, unknown.
        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    """
                    SELECT reason_code, policy_authorized, resolved_at, resolution
                      FROM coord.operator_touches
                     WHERE idempotency_key = :key
                    """
                ),
                {"key": duplicate_key},
            ).one()
        assert defaults == ("unclassified", "unknown", None, None)

        # ----------------------------------------------------------------
        # 7. The classification sidecar records a move, and cascades.
        # ----------------------------------------------------------------
        with engine.connect() as conn:
            target = conn.execute(
                text(
                    """
                    SELECT touch_id FROM coord.operator_touches
                     WHERE idempotency_key = :key
                    """
                ),
                {"key": duplicate_key},
            ).scalar_one()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.operator_touch_classifications
                        (touch_id, from_reason_code, to_reason_code,
                         from_policy_authorized, to_policy_authorized, by_actor)
                    VALUES (:tid, 'unclassified', 'missing_permission_grant',
                            'unknown', 'no', 'phase3')
                    """
                ),
                {"tid": target},
            )
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        """
                        SELECT COUNT(*) FROM coord.operator_touch_classifications
                         WHERE touch_id = :tid
                        """
                    ),
                    {"tid": target},
                ).scalar_one()
                == 1
            )
        # Deleting the parent takes the audit row with it — the sidecar is an
        # audit OF a touch, so it must not outlive one.
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.operator_touches WHERE touch_id = :tid"),
                {"tid": target},
            )
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT COUNT(*) FROM coord.operator_touch_classifications")
                ).scalar_one()
                == 0
            )

        # ----------------------------------------------------------------
        # 8. Downgrade — both tables and every index gone.
        # ----------------------------------------------------------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", _TOUCHES)
        assert not table_exists(engine, "coord", _CLASSIFICATIONS)
        for name in (*_TOUCH_INDEXES, *_CLASSIFICATION_INDEXES):
            assert not index_exists(engine, name), f"index {name} survived downgrade"
        # The sources are untouched by either direction — this revision reads
        # them and never writes them.
        assert table_exists(engine, "coord", "agent_questions")
        assert table_exists(engine, "coord", "gates")
