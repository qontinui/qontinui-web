"""Behaviour test for the ``sessruns_02_run_key_per_device`` revision.

Pins the run key coord's session-run ingest upserts on (plan
``2026-10-23-session-duration-by-work-type-and-per-device-session-load``
Phase 3):

1. **The key is swapped, not added** — after upgrade ``coord.session_runs``
   carries exactly ``uq_session_runs_device_session_run`` on ``(tenant_id,
   device_id, claude_code_session_id, run_seq)`` and no longer
   ``uq_session_runs_session_run``; every other constraint and index of
   ``sessruns_01`` is untouched.
2. **A run is per device** — the same ``(claude_code_session_id, run_seq)`` on
   another device (a cross-device handoff or respawn starting its own run 1)
   is accepted; on the same device it is refused by the new key.
3. **The comments say so** — the table and ``run_seq`` comments carry the
   per-device wording after upgrade and the ``sessruns_01`` text, verbatim,
   after downgrade.
4. **Re-running is harmless** — with rows present, ``stamp <parent>`` then
   ``upgrade`` again converges on the same single key.
5. **Downgrade reverses it** — refused while two devices hold the same
   ``(claude_code_session_id, run_seq)`` (the old key cannot represent them),
   and once they do not, it restores the old key; re-applying works.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import TextClause, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    run_alembic,
)

_REVISION_ID = "sessruns_02_run_key_per_device"
_REVISION_FILENAME = "sessruns_02_run_key_per_device.py"


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime (it gets re-pointed)."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    return declared_parent_revision_id(source, _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()

_OLD_KEY = "uq_session_runs_session_run"
_NEW_KEY = "uq_session_runs_device_session_run"

_OLD_KEY_DEF = "UNIQUE (tenant_id, claude_code_session_id, run_seq)"
_NEW_KEY_DEF = "UNIQUE (tenant_id, device_id, claude_code_session_id, run_seq)"

_OLD_KEY_INDEX = (
    "CREATE UNIQUE INDEX uq_session_runs_session_run ON coord.session_runs "
    "USING btree (tenant_id, claude_code_session_id, run_seq)"
)
_NEW_KEY_INDEX = (
    "CREATE UNIQUE INDEX uq_session_runs_device_session_run ON coord.session_runs "
    "USING btree (tenant_id, device_id, claude_code_session_id, run_seq)"
)

_TENANT = uuid.UUID("3b8e2f61-7c04-4d9a-a1e5-9f62c7d0b418")
_DEVICE = uuid.UUID("71f0c4a8-2d5e-4a3b-9c67-e8b1f2a09d53")
_OTHER_DEVICE = uuid.UUID("0d6a92c1-5f3e-4b87-a2c9-6e14b8f07a35")

_INSERT_RUN = text(
    """
    INSERT INTO coord.session_runs
        (tenant_id, device_id, claude_code_session_id, run_seq, started_at)
    VALUES (:tid, :device, :sid, :run_seq, '2026-10-26T10:00:00+00:00')
    """
)


def _run(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tid": _TENANT,
        "device": _DEVICE,
        "sid": uuid.uuid4(),
        "run_seq": 1,
    }
    params.update(overrides)
    return params


def _constraints(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.session_runs')
                   AND contype <> 'n'
                """
            )
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = 'session_runs'
                """
            )
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _comments(engine: Engine) -> tuple[str | None, str | None]:
    """The table comment and the ``run_seq`` column comment."""
    with engine.connect() as conn:
        table_comment, run_seq_comment = conn.execute(
            text(
                """
                SELECT obj_description(to_regclass('coord.session_runs'), 'pg_class'),
                       col_description(
                           to_regclass('coord.session_runs'),
                           (SELECT attnum FROM pg_attribute
                             WHERE attrelid = to_regclass('coord.session_runs')
                               AND attname = 'run_seq')
                       )
                """
            )
        ).one()
    return (
        None if table_comment is None else str(table_comment),
        None if run_seq_comment is None else str(run_seq_comment),
    )


def _without[V](mapping: dict[str, V], key: str) -> dict[str, V]:
    return {name: value for name, value in mapping.items() if name != key}


def _insert(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(statement, params)


def _refused(engine: Engine, params: dict[str, object], constraint: str) -> None:
    """The insert is refused, and by the named constraint, not by another one."""
    with pytest.raises(IntegrityError) as refusal:
        _insert(engine, _INSERT_RUN, params)
    refused_by = getattr(
        getattr(refusal.value.orig, "diag", None), "constraint_name", None
    )
    assert refused_by == constraint, (
        f"refused by {refused_by!r}, expected {constraint!r}"
    )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a "
        "postgres service; locally, point DATABASE_URL at a dev Postgres "
        "before running this test."
    ),
)
def test_sessruns_02_makes_the_run_key_per_device() -> None:
    """Key swap, cross-device acceptance, comments, re-run, guarded reversal."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "sessruns02_test") as (
        engine,
        url,
    ):
        # 1. Parent revision — the sessruns_01 key and comments.
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        parent_constraints = _constraints(engine)
        parent_indexes = _indexes(engine)
        parent_comments = _comments(engine)
        assert parent_constraints[_OLD_KEY] == ("u", _OLD_KEY_DEF)
        assert _NEW_KEY not in parent_constraints
        assert parent_indexes[_OLD_KEY] == _OLD_KEY_INDEX

        # 2. Apply — the key is SWAPPED: the new one replaces the old one and
        #    every other constraint and index is exactly as before.
        run_alembic(root, url, "upgrade", _REVISION_ID)

        def assert_upgraded() -> None:
            constraints = _constraints(engine)
            assert constraints[_NEW_KEY] == ("u", _NEW_KEY_DEF)
            assert _without(constraints, _NEW_KEY) == _without(
                parent_constraints, _OLD_KEY
            )
            indexes = _indexes(engine)
            assert indexes[_NEW_KEY] == _NEW_KEY_INDEX
            assert _without(indexes, _NEW_KEY) == _without(parent_indexes, _OLD_KEY)
            table_comment, run_seq_comment = _comments(engine)
            assert table_comment is not None
            assert "(tenant_id, device_id, claude_code_session_id, run_seq)" in (
                table_comment
            )
            assert "on each device it ran on" in table_comment
            assert run_seq_comment is not None
            assert "ON ONE DEVICE" in run_seq_comment

        assert_upgraded()

        # 3. A run is per device: the same session and run_seq on another
        #    device is a distinct run; on the same device it is refused.
        session = uuid.uuid4()
        _insert(engine, _INSERT_RUN, _run(sid=session))
        _insert(engine, _INSERT_RUN, _run(sid=session, device=_OTHER_DEVICE))
        _refused(engine, _run(sid=session), _NEW_KEY)
        _refused(engine, _run(sid=session, device=_OTHER_DEVICE), _NEW_KEY)
        _insert(engine, _INSERT_RUN, _run(sid=session, run_seq=2))

        # 4. Re-running is harmless: rewind the stamp and apply again.
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert_upgraded()

        # 5. Downgrade is refused while two devices share a
        #    (session, run_seq), which the old key cannot represent ...
        with pytest.raises(AssertionError, match=_OLD_KEY):
            run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert_upgraded()

        # ... and once they do not, it restores the old key and comments.
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.session_runs WHERE device_id = :device"),
                {"device": _OTHER_DEVICE},
            )
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _constraints(engine) == parent_constraints
        assert _indexes(engine) == parent_indexes
        assert _comments(engine) == parent_comments

        # 6. Re-apply — the downgrade left no residue that blocks a second run.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert_upgraded()
