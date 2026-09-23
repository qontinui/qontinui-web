"""Shape test for the ``devconn_inst_01_device_connections_instance`` revision.

Phase 6 (web half) of plan
``2026-09-20-runner-selector-drives-a-transport-not-a-target`` adds the
runner-instance identity to ``coord.device_connections``: ``instance_key``,
``instance_role``, ``port`` and ``last_seen_at`` (all nullable), a CHECK on the
role, a CHECK on the port range, and a partial UNIQUE index on the LIVE
``(device_id, instance_key)`` pairs.

What this pins, against the catalog rather than the DDL text:

1. **Absent at the parent** — so the walk cannot pass vacuously.
2. **Four nullable columns, no defaults, the declared types**, with both
   CHECKs VALIDATED (they are added ``NOT VALID`` then validated) and the
   ``CONCURRENTLY``-built index VALID. Nullable because
   every pre-existing row predates the fields and a runner that predates them
   keeps connecting.
3. **The role CHECK is enforced** — ``'tertiary'`` is refused, NULL and the two
   real roles are accepted.
4. **The live-key index is UNIQUE and PARTIAL** — a second OPEN row with the
   same ``(device_id, instance_key)`` is refused, but a CLOSED holder and NULL
   keys (legacy runners) are outside it. This is the database half of the
   duplicate-instance conflict rule in ``devices_ws.py``.
5. **Idempotent re-run** — ``stamp`` back and re-upgrade must not fail.
6. **Downgrade removes exactly what it added**; re-upgrade restores it.

Substrate: ``_alembic_harness`` — an ephemeral DB inside the test Postgres,
skipped (NOT passed) when none is reachable.
"""

from __future__ import annotations

import re
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

_REVISION_ID = "devconn_inst_01_device_connections_instance"
_PARENT_REVISION_ID = "coord_agent_questions_withdrawn"
_REVISION_FILENAME = "devconn_inst_01_device_connections_instance.py"

_TABLE = "device_connections"
_NEW_COLUMNS = {
    "instance_key": "text",
    "instance_role": "text",
    "port": "integer",
    "last_seen_at": "timestamp with time zone",
}
_INDEX = "uq_device_connections_live_instance_key"


def _source() -> str:
    return (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed."""
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        _source(),
        re.MULTILINE,
    )
    assert match is not None
    assert match.group("parent") == _PARENT_REVISION_ID


def test_the_down_revision_is_on_one_line() -> None:
    """Coord's line-scoped alembic-graph parser must see the parent."""
    one_line = re.search(
        r'^down_revision[^=\n]*=\s*"' + re.escape(_PARENT_REVISION_ID) + r'"\s*$',
        _source(),
        re.MULTILINE,
    )
    assert one_line is not None


def _columns(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": _TABLE},
        ).all()
    return {r[0] for r in rows}


def _constraints(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname FROM pg_constraint
                 WHERE conrelid = 'coord.device_connections'::regclass
                """
            )
        ).all()
    return {r[0] for r in rows}


def _seed_device(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """A user + device row so connection rows satisfy their FKs."""
    user_id = uuid.uuid4()
    device_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO auth.users
                    (id, email, username, is_active, is_superuser, is_verified,
                     is_beta, subscription_tier, login_count,
                     remember_me_usage_count, automation_streaming_enabled,
                     automation_sessions_used, created_at, updated_at)
                VALUES
                    (:id, :email, :username, true, false, true, false, 'free',
                     0, 0, false, 0, now(), now())
                """
            ),
            {
                "id": user_id,
                "email": f"devconn_{user_id.hex[:8]}@example.com",
                "username": f"devconn_{user_id.hex[:8]}",
            },
        )
        tenant_id = uuid.uuid4()
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:t, :slug, 'devconn_inst_01 test tenant')"
            ),
            {"t": tenant_id, "slug": f"devconn-{tenant_id.hex[:12]}"},
        )
        conn.execute(
            text(
                "INSERT INTO coord.devices "
                "(device_id, tenant_id, user_id, name, hostname) "
                "VALUES (:d, :t, :u, 'devconn-test', 'devconn-host')"
            ),
            {"d": device_id, "t": tenant_id, "u": user_id},
        )
    return device_id, user_id


def _insert_connection(
    engine: Engine,
    device_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    key: str | None,
    role: str | None = "primary",
    closed: bool = False,
) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.device_connections "
                "(device_id, user_id, connected_at, disconnected_at, "
                " instance_key, instance_role) VALUES "
                "(:d, :u, now(), CASE WHEN :closed THEN now() END, :k, :r)"
            ),
            {"d": device_id, "u": user_id, "closed": closed, "k": key, "r": role},
        )


@pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL, so the device_connections "
        "instance columns, CHECKs and live-key index were NOT verified — only "
        "that the revision file parses and names its parent. This skip is not a "
        "pass."
    ),
)
def test_devconn_inst_01_adds_instance_identity() -> None:
    """Walk parent → revision → stamp+re-run → downgrade → re-upgrade."""
    root = backend_root()

    with ephemeral_database(admin_database_url(), "devconn_inst_01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        columns_at_parent = _columns(engine)
        assert columns_at_parent, "coord.device_connections must exist at the parent"
        assert not (set(_NEW_COLUMNS) & columns_at_parent), (
            "the instance columns must not exist before the revision runs"
        )
        assert not index_exists(engine, _INDEX)

        run_alembic(root, url, "upgrade", _REVISION_ID)

        for column, data_type in _NEW_COLUMNS.items():
            info = column_info(engine, _TABLE, column)
            assert info is not None, f"upgrade must add {column}"
            assert info == (data_type, "YES", None), (
                f"{column} must be a nullable {data_type} with no default; got {info}"
            )
        assert _columns(engine) == columns_at_parent | set(_NEW_COLUMNS)
        assert {
            "ck_device_connections_instance_role",
            "ck_device_connections_port_range",
        } <= _constraints(engine)
        assert index_exists(engine, _INDEX)
        # NOT VALID → VALIDATE must have completed, and the CONCURRENTLY build
        # must have produced a VALID index (an interrupted one is INVALID).
        with engine.connect() as conn:
            unvalidated = conn.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'coord.device_connections'::regclass "
                    "AND conname LIKE 'ck_device_connections_%' "
                    "AND NOT convalidated"
                )
            ).all()
            index_valid = conn.execute(
                text(
                    "SELECT indisvalid FROM pg_index "
                    "WHERE indexrelid = 'coord.uq_device_connections_live_instance_key'"
                    "::regclass"
                )
            ).scalar_one()
        assert unvalidated == [], f"CHECKs left NOT VALID: {unvalidated}"
        assert index_valid is True

        # -- the constraints behave, not just exist ---------------------------
        device_id, user_id = _seed_device(engine)
        _insert_connection(engine, device_id, user_id, key=None, role=None)
        _insert_connection(engine, device_id, user_id, key=None, role="primary")
        _insert_connection(engine, device_id, user_id, key=None, role="primary")
        with pytest.raises(IntegrityError):
            _insert_connection(engine, device_id, user_id, key="x", role="tertiary")

        _insert_connection(engine, device_id, user_id, key="primary")
        with pytest.raises(IntegrityError):
            # A second OPEN row holding the same key on the same device.
            _insert_connection(engine, device_id, user_id, key="primary")
        # A CLOSED holder is outside the partial index...
        _insert_connection(engine, device_id, user_id, key="runner:a", closed=True)
        _insert_connection(engine, device_id, user_id, key="runner:a", role="secondary")
        # ...and so is the same key on a DIFFERENT device.
        other_device, _ = _seed_device(engine)
        _insert_connection(engine, other_device, user_id, key="primary")
        with pytest.raises(IntegrityError):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE coord.device_connections SET port = 70000 "
                        "WHERE device_id = :d"
                    ),
                    {"d": device_id},
                )

        # -- re-run over its own output --------------------------------------
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _columns(engine) == columns_at_parent | set(_NEW_COLUMNS)

        # -- downgrade removes exactly this revision's objects ---------------
        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert _columns(engine) == columns_at_parent
        assert not index_exists(engine, _INDEX)
        assert not (
            {
                "ck_device_connections_instance_role",
                "ck_device_connections_port_range",
            }
            & _constraints(engine)
        )

        # -- and comes back ----------------------------------------------------
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert index_exists(engine, _INDEX)
        assert _columns(engine) == columns_at_parent | set(_NEW_COLUMNS)
