"""Behaviour test for the ``coord_agent_questions_effect`` revision.

The revision adds ``coord.agent_questions.effect_kind TEXT NOT NULL DEFAULT
'none'`` (CHECK ``IN ('none','clause','proposal','gate')``), ``effect_ref JSONB
NULL``, and three partial indices: ``idx_agent_questions_open_effect``, the
partial UNIQUE index::

    CREATE UNIQUE INDEX CONCURRENTLY uq_agent_questions_open_effect
    ON coord.agent_questions (tenant_id, effect_kind, (effect_ref->>'id'))
    WHERE effect_kind <> 'none' AND responded_at IS NULL AND withdrawn_at IS NULL

and ``idx_agent_questions_effect_ref`` — the same key over EVERY mirror row,
answered or not (``WHERE effect_kind <> 'none'``), for coord's "has this effect
been mirrored?" anti-joins.

The unique index IS the idempotency coord's gate/proposal mirror writers rely
on, so the test asserts the dedupe semantics, not just shape:

1. Nothing exists at the parent revision.
2. After upgrade the column shapes are right, existing rows read ``'none'`` /
   NULL, all three indices are VALID with exactly the intended keys and
   predicates (as Postgres renders them), and only the dedupe one is UNIQUE.
3. The CHECK refuses an unknown ``effect_kind`` (SQLSTATE 23514).
4. The documented write — ``INSERT ... ON CONFLICT (tenant_id, effect_kind,
   (effect_ref->>'id')) WHERE ... DO NOTHING RETURNING question_id`` — returns
   a row for the first mirror of an effect and NO row for a duplicate; a plain
   duplicate INSERT is refused with 23505.
5. The same id under a DIFFERENT effect kind, and the same effect under a
   different tenant, are both accepted.
6. Answering the open mirror (``responded_at`` set) frees the key.
7. ``effect_kind = 'none'`` questions are never constrained.
8. Idempotency: ``stamp`` back to the parent and ``upgrade`` again succeeds and
   leaves all three VALID indices untouched. Then the INVALID-index cleanup
   branch, once per index: ``indisvalid`` is forced false on that index, and a
   re-run rebuilds it VALID under a NEW oid while the other two keep theirs.
9. Downgrade removes indices, CHECK and columns; questions survive. A second
   upgrade re-applies cleanly and leaves every index VALID.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import json
import uuid
import warnings

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

_REVISION_ID = "coord_agent_questions_effect"
_PARENT_REVISION_ID = "coord_iops_idx_01"

_UNIQUE_INDEX = "uq_agent_questions_open_effect"
_OPEN_INDEX = "idx_agent_questions_open_effect"
_REF_INDEX = "idx_agent_questions_effect_ref"
_CHECK_NAME = "coord_agent_questions_effect_kind_check"

# The write the revision's docstring prescribes to coord. Quoted here so the
# arbiter inference against the partial expression index is exercised, not
# assumed.
_MIRROR_SQL = """
    INSERT INTO coord.agent_questions
        (agent_id, tenant_id, question, options, effect_kind, effect_ref)
    VALUES
        (:agent, :tenant, 'approve?', CAST('["met","not_met"]' AS jsonb),
         :kind, CAST(:ref AS jsonb))
    ON CONFLICT (tenant_id, effect_kind, (effect_ref->>'id'))
        WHERE effect_kind <> 'none' AND responded_at IS NULL
            AND withdrawn_at IS NULL
    DO NOTHING
    RETURNING question_id
"""

_PLAIN_INSERT_SQL = """
    INSERT INTO coord.agent_questions
        (agent_id, tenant_id, question, options, effect_kind, effect_ref)
    VALUES
        (:agent, :tenant, 'approve?', CAST('[]' AS jsonb),
         :kind, CAST(:ref AS jsonb))
    RETURNING question_id
"""


def _index_row(engine: Engine, index_name: str) -> tuple[bool, bool, str]:
    """``(indisvalid, indisunique, predicate)`` for the index."""
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, i.indisunique,
                       pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        ).one()
    return bool(row[0]), bool(row[1]), str(row[2] or "")


def _index_def(engine: Engine, index_name: str) -> str:
    """``pg_get_indexdef`` for ``coord.<index_name>`` — the key as Postgres
    renders it."""
    with engine.connect() as conn:
        return str(
            conn.execute(
                text("SELECT pg_get_indexdef(CAST(:q AS regclass))"),
                {"q": f"coord.{index_name}"},
            ).scalar_one()
        )


def _invalidate_index(engine: Engine, index_name: str) -> None:
    """Mark ``coord.<index_name>`` INVALID — the state a killed CONCURRENTLY
    build leaves behind — so the revision's cleanup branch is exercised."""
    with engine.begin() as conn:
        updated = conn.execute(
            text(
                """
                UPDATE pg_index i
                   SET indisvalid = false
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.oid = i.indexrelid
                   AND n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": index_name},
        ).rowcount
    assert updated == 1, f"expected to invalidate exactly coord.{index_name}"


def _is_superuser(engine: Engine) -> bool:
    """Whether the connected role may write the ``pg_index`` catalog, which
    :func:`_invalidate_index` needs."""
    with engine.connect() as conn:
        return (
            conn.execute(text("SELECT current_setting('is_superuser')")).scalar()
            == "on"
        )


def _index_oid(engine: Engine, index_name: str) -> int:
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT CAST(:q AS regclass)::oid"),
                {"q": f"coord.{index_name}"},
            ).scalar_one()
        )


def _check_exists(engine: Engine) -> bool:
    with engine.connect() as conn:
        return bool(
            conn.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM pg_constraint
                         WHERE conname = :c
                           AND conrelid = CAST('coord.agent_questions' AS regclass))
                    """
                ),
                {"c": _CHECK_NAME},
            ).scalar_one()
        )


def _tenant(engine: Engine) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'Effect Mirror Test Tenant')
                """
            ),
            {"t": tenant_id, "slug": f"effect-test-{uuid.uuid4().hex[:8]}"},
        )
    return tenant_id


def _params(
    tenant_id: uuid.UUID, kind: str, ref: dict[str, object] | None
) -> dict[str, object]:
    return {
        "agent": uuid.uuid4(),
        "tenant": tenant_id,
        "kind": kind,
        "ref": None if ref is None else json.dumps(ref),
    }


def _gate_ref(gate_id: str) -> dict[str, object]:
    return {
        "id": gate_id,
        "gate_id": gate_id,
        "work_unit_id": "wu-1",
        "phase_name": "Phase 2",
    }


def _mirror(
    engine: Engine,
    tenant_id: uuid.UUID,
    kind: str,
    ref: dict[str, object] | None,
) -> uuid.UUID | None:
    """The prescribed write. Returns the new id, or None when already mirrored."""
    with engine.begin() as conn:
        qid = conn.execute(text(_MIRROR_SQL), _params(tenant_id, kind, ref)).scalar()
    return None if qid is None else uuid.UUID(str(qid))


def _plain_insert(
    engine: Engine,
    tenant_id: uuid.UUID,
    kind: str,
    ref: dict[str, object] | None,
) -> uuid.UUID:
    with engine.begin() as conn:
        qid = conn.execute(
            text(_PLAIN_INSERT_SQL), _params(tenant_id, kind, ref)
        ).scalar_one()
    return uuid.UUID(str(qid))


def _answer(engine: Engine, question_id: uuid.UUID) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE coord.agent_questions
                   SET responded_at = now(), response = 'met'
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
def test_coord_agent_questions_effect_one_open_mirror_per_effect() -> None:
    """One OPEN mirror per (tenant, effect kind, effect id); answering frees it."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "agent_q_effect_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — nothing yet. A pre-existing question is written
        #    here so step 2 can prove the DDL default reaches old rows.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert column_info(engine, "agent_questions", "effect_kind") is None
        assert column_info(engine, "agent_questions", "effect_ref") is None
        assert not index_exists(engine, _UNIQUE_INDEX)
        assert not index_exists(engine, _OPEN_INDEX)
        assert not index_exists(engine, _REF_INDEX)
        tenant_a = _tenant(engine)
        with engine.begin() as conn:
            legacy = conn.execute(
                text(
                    """
                    INSERT INTO coord.agent_questions
                        (agent_id, tenant_id, question, options)
                    VALUES (:a, :t, 'legacy?', CAST('[]' AS jsonb))
                    RETURNING question_id
                    """
                ),
                {"a": uuid.uuid4(), "t": tenant_a},
            ).scalar_one()

        # 2. Apply — shapes, defaults on the old row, VALID partial indices.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        kind_info = column_info(engine, "agent_questions", "effect_kind")
        assert kind_info is not None
        assert kind_info[0] == "text" and kind_info[1] == "NO"
        assert kind_info[2] is not None and "'none'" in kind_info[2]
        assert column_info(engine, "agent_questions", "effect_ref") == (
            "jsonb",
            "YES",
            None,
        )
        assert _check_exists(engine)
        with engine.connect() as conn:
            old_kind, old_ref = conn.execute(
                text(
                    "SELECT effect_kind, effect_ref FROM coord.agent_questions "
                    "WHERE question_id = :q"
                ),
                {"q": legacy},
            ).one()
        assert (old_kind, old_ref) == ("none", None)

        # Predicates and keys are compared EXACTLY, as Postgres renders them
        # (pg_get_expr / pg_get_indexdef), so a dropped or added conjunct fails.
        effect_key = "(tenant_id, effect_kind, ((effect_ref ->> 'id'::text)))"
        valid, unique, predicate = _index_row(engine, _UNIQUE_INDEX)
        assert valid, "a killed CONCURRENTLY build leaves an INVALID index"
        assert unique, "the mirror dedupe needs a UNIQUE index"
        assert predicate == (
            "((effect_kind <> 'none'::text) AND (responded_at IS NULL) "
            "AND (withdrawn_at IS NULL))"
        ), predicate
        assert f"USING btree {effect_key} WHERE" in _index_def(engine, _UNIQUE_INDEX)
        valid, unique, predicate = _index_row(engine, _OPEN_INDEX)
        assert valid and not unique
        assert predicate == (
            "((responded_at IS NULL) AND (effect_kind <> 'none'::text))"
        ), predicate
        assert "USING btree (tenant_id) WHERE" in _index_def(engine, _OPEN_INDEX)
        # Every mirror row, answered or not: coord's anti-joins need it.
        valid, unique, predicate = _index_row(engine, _REF_INDEX)
        assert valid and not unique
        assert predicate == "(effect_kind <> 'none'::text)", predicate
        ref_def = _index_def(engine, _REF_INDEX)
        assert f"USING btree {effect_key} WHERE" in ref_def, ref_def

        # 3. The CHECK refuses a kind coord cannot route.
        with pytest.raises(IntegrityError) as excinfo:
            _plain_insert(engine, tenant_a, "merge", {"id": "x"})
        assert getattr(excinfo.value.orig, "pgcode", None) == "23514"

        # 4. The prescribed write: first mirror lands, duplicate is a no-op.
        tenant_b = _tenant(engine)
        first = _mirror(engine, tenant_a, "gate", _gate_ref("g-1"))
        assert first is not None
        assert _mirror(engine, tenant_a, "gate", _gate_ref("g-1")) is None, (
            "a gate refresh must not mint a second open mirror"
        )
        with pytest.raises(IntegrityError) as excinfo:
            _plain_insert(engine, tenant_a, "gate", _gate_ref("g-1"))
        assert getattr(excinfo.value.orig, "pgcode", None) == "23505"

        # 5. Same id, different kind — a different effect. Same effect,
        #    different tenant — accepted.
        assert (
            _mirror(engine, tenant_a, "proposal", {"id": "g-1", "proposal_id": "g-1"})
            is not None
        )
        assert _mirror(engine, tenant_b, "gate", _gate_ref("g-1")) is not None

        # 6. Answering the open mirror frees the effect for a later decision.
        _answer(engine, first)
        second = _mirror(engine, tenant_a, "gate", _gate_ref("g-1"))
        assert second is not None

        # 6b. Withdrawing the open mirror ALSO frees the effect: a withdrawn
        #     row keeps responded_at NULL, and without `withdrawn_at IS NULL`
        #     in the predicate it would block the effect forever.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.agent_questions SET withdrawn_at = now() "
                    "WHERE question_id = :q"
                ),
                {"q": second},
            )
        assert _mirror(engine, tenant_a, "gate", _gate_ref("g-1")) is not None, (
            "a withdrawn mirror must not block re-mirroring its effect"
        )

        # 7. Ordinary questions (`'none'`) are never constrained.
        assert _mirror(engine, tenant_a, "none", None) is not None
        assert _mirror(engine, tenant_a, "none", None) is not None

        # 8. Idempotency — re-running the revision over its own schema leaves
        #    all three VALID indices untouched.
        all_indices = (_UNIQUE_INDEX, _OPEN_INDEX, _REF_INDEX)
        oids_before = {name: _index_oid(engine, name) for name in all_indices}
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        for name in all_indices:
            assert _index_row(engine, name)[0], name
        assert {name: _index_oid(engine, name) for name in all_indices} == (
            oids_before
        ), "a re-run must not drop and rebuild a VALID index"

        # 8b. The INVALID-index cleanup branch, once per index: a killed
        #     CONCURRENTLY build leaves an INVALID index that `IF NOT EXISTS`
        #     alone would keep. The revision must drop and rebuild it — VALID,
        #     with a NEW oid — and leave the two still-VALID siblings untouched.
        #     Writing ``pg_index`` needs a superuser; on a role that is not one
        #     THIS SUB-STEP ONLY is skipped (loudly), and the rest runs.
        if not _is_superuser(engine):
            warnings.warn(
                "SKIPPED sub-step 8b (INVALID-index cleanup branch): the test "
                "role is not a superuser (current_setting('is_superuser') <> "
                "'on'), so it cannot mark an index INVALID in pg_index. Run "
                "against a superuser role to exercise it.",
                stacklevel=1,
            )
        else:
            for target in all_indices:
                siblings = [name for name in all_indices if name != target]
                oids = {name: _index_oid(engine, name) for name in all_indices}
                _invalidate_index(engine, target)
                assert not _index_row(engine, target)[0], target
                run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
                run_alembic(root, url, "upgrade", _REVISION_ID)
                assert _index_row(engine, target)[0], (
                    f"INVALID {target} must be rebuilt VALID, not kept by IF NOT EXISTS"
                )
                assert _index_oid(engine, target) != oids[target], (
                    f"INVALID {target} must be dropped and rebuilt, not revalidated"
                )
                for name in siblings:
                    assert _index_row(engine, name)[0], (target, name)
                    assert _index_oid(engine, name) == oids[name], (
                        f"invalidating {target} must not rebuild VALID {name}"
                    )

        # 9. Downgrade removes everything added; questions survive. Re-upgrade.
        rows_before = _question_count(engine)
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _UNIQUE_INDEX)
        assert not index_exists(engine, _OPEN_INDEX)
        assert not index_exists(engine, _REF_INDEX)
        assert not _check_exists(engine)
        assert column_info(engine, "agent_questions", "effect_kind") is None
        assert column_info(engine, "agent_questions", "effect_ref") is None
        assert _question_count(engine) == rows_before, (
            "downgrade must not delete questions"
        )

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _index_row(engine, _UNIQUE_INDEX)[0], "re-applied index must be VALID"
        assert _index_row(engine, _OPEN_INDEX)[0], "re-applied index must be VALID"
        assert _index_row(engine, _REF_INDEX)[0], "re-applied index must be VALID"
        assert _check_exists(engine)
