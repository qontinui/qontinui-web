"""Behaviour test for the ``coord_subprojects_04_same_anchor_indexes`` revision.

The revision adds two HASH indexes for qontinui-coord
``subprojects::store::SAME_ANCHOR_SQL``::

    idx_agent_sessions_label            ON coord.agent_sessions  USING hash (label)
    idx_agent_worktrees_session_intent  ON coord.agent_worktrees USING hash (intent)
                                        WHERE agent_session_id IS NOT NULL

An index the planner declines to use is not a fix, so the contract pinned here
is the PLAN of each arm of the coord read, not only the DDL's execution. And
hash was chosen over btree because both columns are unbounded free text a btree
would refuse to index past ~2.7 KB — so the test also writes values well past
that and asserts the writes still succeed with the indexes in place.

What is asserted
================

Source-level (never skip):

1. ``down_revision`` is the pinned parent.

Live (skip without a reachable Postgres; a skip proves nothing — set
``DATABASE_URL`` to an admin URL of a test Postgres):

2. At the parent revision neither index exists.
3. After upgrade both exist, are VALID, are ``hash``, and carry the intended
   predicate (none on the label index; ``agent_session_id IS NOT NULL`` on the
   intent index).
4. Each arm of ``SAME_ANCHOR_SQL``, with its ``= ANY(array)`` predicate, is
   chosen by the planner on its own costs (no ``enable_*`` override) over a
   fixture of 2 000 allocations in ONE tenant — the production shape, where
   ``tenant_id`` is unselective and the pre-existing
   ``idx_agent_worktrees_tenant_id`` cannot narrow the arm.
5. A label and an intent of 16 KB of incompressible text insert successfully
   (a btree would refuse the INSERT), and each is FOUND by its own arm: the
   intent by the worktree arm, the label by the label arm (its session given a
   live ``coord.sessions`` row so the arm's tenancy ``EXISTS`` holds).
6. Downgrade removes both indexes and keeps every row.

The arm SQL is ``SAME_ANCHOR_SQL``'s two ``cand`` arms as written in
qontinui-coord ``crates/coord/src/subprojects/store.rs``, with ``$n`` spelled as
named binds.
"""

from __future__ import annotations

import secrets
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_definition,
    index_exists,
    index_state,
    run_alembic,
)

_REVISION_ID = "coord_subprojects_04_same_anchor_indexes"
_PARENT_REVISION_ID = "coord_subprojects_03_lineage_vocabulary"
_REVISION_FILE = (
    Path(__file__).resolve().parent.parent
    / "alembic"
    / "versions"
    / "coord_subprojects_04_same_anchor_indexes.py"
)

_LABEL_INDEX = "idx_agent_sessions_label"
_INTENT_INDEX = "idx_agent_worktrees_session_intent"

# SAME_ANCHOR_SQL's worktree arm.
_WORKTREE_ARM_SQL = """
    SELECT w.agent_session_id AS sid FROM coord.agent_worktrees w
     WHERE w.tenant_id = :tenant AND w.agent_session_id IS NOT NULL
       AND w.intent = ANY(CAST(:intents AS text[]))
"""

# SAME_ANCHOR_SQL's session-label arm (its tenancy EXISTS clauses included).
_LABEL_ARM_SQL = """
    SELECT a.id FROM coord.agent_sessions a
     WHERE a.label = ANY(CAST(:names AS text[]))
       AND (EXISTS (SELECT 1 FROM coord.sessions s
                     WHERE s.tenant_id = :tenant AND s.claude_code_session_id = a.id
                       AND s.expected_at IS NULL)
         OR EXISTS (SELECT 1 FROM coord.subproject_members m
                     WHERE m.tenant_id = :tenant AND m.agent_session_id = a.id
                       AND m.removed_at IS NULL))
"""

_ANCHOR = "claim:pr:qontinui/qontinui-web#4242"
# Hex of random bytes: does not compress, so inline compression cannot rescue a
# btree entry the way it could for repetitive text.
_LONG_TEXT = secrets.token_hex(8192)  # 16 384 characters
_BULK_ROWS = 2000
_TOTAL_ROWS = 3 + _BULK_ROWS  # pre-existing + long + anchor + bulk


def test_down_revision_is_the_pinned_parent() -> None:
    """Re-pointing the parent without updating this pin is a fork risk."""
    source = _REVISION_FILE.read_text(encoding="utf-8")
    assert declared_parent_revision_id(source, _REVISION_ID) == _PARENT_REVISION_ID


def _plan_for(engine: Engine, sql: str, params: dict[str, object]) -> str:
    """EXPLAIN ``sql`` with the planner's own costs — no ``enable_*`` overrides."""
    with engine.connect() as conn:
        rows = conn.execute(text(f"EXPLAIN {sql}"), params).all()
    return "\n".join(str(r[0]) for r in rows)


def _seed_bulk(
    engine: Engine, tenant: uuid.UUID, device: uuid.UUID, count: int
) -> None:
    """``count`` sessions, each holding one allocation, all in ONE tenant.

    The production shape: one tenant owns nearly every allocation, so
    ``tenant_id`` is unselective and ``idx_agent_worktrees_tenant_id`` cannot
    narrow the arm — only the intent can. On a three-row fixture every index
    costs the same and the planner's pick says nothing.
    """
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.agent_sessions (id, label)
                SELECT gen_random_uuid(), 'bulk-session-' || g
                  FROM generate_series(1, :n) AS g
                """
            ),
            {"n": count},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.agent_worktrees
                    (agent_id, device_id, repo, branch, parent_sha, worktree_path,
                     tenant_id, agent_session_id, intent)
                SELECT gen_random_uuid(), :device, 'qontinui/qontinui-web',
                       'agent/bulk-' || a.label, 'deadbeef', '/tmp/bulk/' || a.label,
                       :tenant, a.id, 'bulk intent for ' || a.label
                  FROM coord.agent_sessions a
                 WHERE a.label LIKE 'bulk-session-%'
                """
            ),
            {"device": device, "tenant": tenant},
        )


def _seed_tenant_and_device(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    with engine.begin() as conn:
        tenant = conn.execute(
            text(
                "INSERT INTO coord.tenants (slug, display_name) "
                "VALUES ('anchor-idx-test', 'anchor idx test') RETURNING tenant_id"
            )
        ).scalar_one()
        device = conn.execute(
            text(
                "INSERT INTO coord.devices (name, hostname, tenant_id) "
                "VALUES ('anchor-idx', 'anchor-idx-host', :t) RETURNING device_id"
            ),
            {"t": tenant},
        ).scalar_one()
    return tenant, device


def _insert_session_and_worktree(
    engine: Engine,
    tenant: uuid.UUID,
    device: uuid.UUID,
    *,
    label: str,
    intent: str,
) -> uuid.UUID:
    """One agent session labelled ``label`` and one allocation it holds with ``intent``."""
    sid = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO coord.agent_sessions (id, label) VALUES (:id, :label)"),
            {"id": sid, "label": label},
        )
        agent_id = uuid.uuid4()
        conn.execute(
            text(
                """
                INSERT INTO coord.agent_worktrees
                    (agent_id, device_id, repo, branch, parent_sha, worktree_path,
                     tenant_id, agent_session_id, intent)
                VALUES (:agent_id, :device, 'qontinui/qontinui-web', :branch,
                        'deadbeef', :path, :tenant, :sid, :intent)
                """
            ),
            {
                "agent_id": agent_id,
                "device": device,
                "branch": f"agent/anchor-idx-{agent_id.hex}",
                "path": f"/tmp/anchor-idx/{agent_id.hex}",
                "tenant": tenant,
                "sid": sid,
                "intent": intent,
            },
        )
    return sid


def _record_live_session(
    engine: Engine, tenant: uuid.UUID, device: uuid.UUID, sid: uuid.UUID
) -> None:
    """A live ``coord.sessions`` row for agent session ``sid`` under ``tenant``."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.sessions
                    (id, tenant_id, device_id, claude_code_session_id, session_kind,
                     intent, state, started_at)
                VALUES (:id, :t, :d, :sid, 'terminal_claude', CAST('{}' AS jsonb),
                        'active', now())
                """
            ),
            {"id": uuid.uuid4(), "t": tenant, "d": device, "sid": sid},
        )


def _assert_indexes_as_intended(engine: Engine) -> None:
    """Both indexes exist, are VALID, non-unique, hash, with the intended predicates."""
    for name, expected_predicate in (
        (_LABEL_INDEX, ""),
        (_INTENT_INDEX, "(agent_session_id IS NOT NULL)"),
    ):
        assert index_exists(engine, name), name
        valid, unique, predicate = index_state(engine, name)
        assert valid, f"{name} must be VALID, not a skipped invalid leftover"
        assert not unique, name
        assert predicate == expected_predicate, (name, predicate)
        assert "USING hash" in index_definition(engine, name), (
            f"{name} must be hash: a btree refuses values past ~2.7 KB"
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, bring up a backend Postgres before "
        "running this test."
    ),
)
def test_coord_subprojects_04_indexes_serve_the_same_anchor_arms() -> None:
    """Build both hash indexes; prove each anchor arm rides one; long values still write."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "coord_subprojects_04_test") as (
        engine,
        url,
    ):
        # 2. Parent revision: neither index exists.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _LABEL_INDEX)
        assert not index_exists(engine, _INTENT_INDEX)

        tenant, device = _seed_tenant_and_device(engine)
        _insert_session_and_worktree(
            engine, tenant, device, label="pre-existing", intent="pre-existing intent"
        )

        # 3. Upgrade: both exist, valid, hash, with the intended predicates.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_indexes_as_intended(engine)

        # 5. Values far past the btree tuple limit write, and the arms find them.
        long_sid = _insert_session_and_worktree(
            engine, tenant, device, label=_LONG_TEXT, intent=_LONG_TEXT
        )
        anchor_sid = _insert_session_and_worktree(
            engine, tenant, device, label=_ANCHOR, intent=_ANCHOR
        )
        _seed_bulk(engine, tenant, device, _BULK_ROWS)
        # The label arm admits a session only with tenancy proven by a live
        # coord.sessions row (or a membership); give the long-label one that.
        _record_live_session(engine, tenant, device, long_sid)
        with engine.begin() as conn:
            conn.execute(text("ANALYZE coord.agent_sessions"))
            conn.execute(text("ANALYZE coord.agent_worktrees"))
            found_long_label = (
                conn.execute(
                    text(_LABEL_ARM_SQL), {"tenant": tenant, "names": [_LONG_TEXT]}
                )
                .scalars()
                .all()
            )
            found_long = (
                conn.execute(
                    text(_WORKTREE_ARM_SQL), {"tenant": tenant, "intents": [_LONG_TEXT]}
                )
                .scalars()
                .all()
            )
            found_anchor = (
                conn.execute(
                    text(_WORKTREE_ARM_SQL),
                    {"tenant": tenant, "intents": [_ANCHOR, "unit:none:1"]},
                )
                .scalars()
                .all()
            )
        assert found_long_label == [long_sid], "the 16 KB label must be found"
        assert found_long == [long_sid], "the 16 KB intent must be found"
        assert found_anchor == [anchor_sid]

        # 4. Each arm is served by its index.
        worktree_plan = _plan_for(
            engine, _WORKTREE_ARM_SQL, {"tenant": tenant, "intents": [_ANCHOR, "x"]}
        )
        assert _INTENT_INDEX in worktree_plan, (
            f"the worktree arm must ride {_INTENT_INDEX}:\n{worktree_plan}"
        )
        label_plan = _plan_for(
            engine, _LABEL_ARM_SQL, {"tenant": tenant, "names": [_ANCHOR, "x"]}
        )
        assert _LABEL_INDEX in label_plan, (
            f"the label arm must ride {_LABEL_INDEX}:\n{label_plan}"
        )

        # 6. Downgrade removes both; every row survives.
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not index_exists(engine, _LABEL_INDEX)
        assert not index_exists(engine, _INTENT_INDEX)
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text("SELECT count(*) FROM coord.agent_worktrees")
                ).scalar()
                == _TOTAL_ROWS
            )
            assert (
                conn.execute(text("SELECT count(*) FROM coord.agent_sessions")).scalar()
                == _TOTAL_ROWS
            )

        # Re-apply: the round trip the migration-reversal workflow walks.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        _assert_indexes_as_intended(engine)
