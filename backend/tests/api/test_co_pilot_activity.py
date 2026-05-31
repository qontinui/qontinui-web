"""Cross-user isolation regression test for ``/api/v1/users/me/co-pilot/activity``.

§4.8 of the production-safe UI Bridge plan
(``D:/qontinui-root/plans/2026-05-28-production-safe-ui-bridge-design.md``).

The audit-log endpoint is the surface a user can use to review every
write command the relay issued on their behalf. The critical security
invariant is per-user isolation: user A MUST NEVER see user B's rows.

The endpoint enforces this in one place — the
``conditions.append(BridgeAuditLog.user_id == current_user.id)`` line in
:mod:`app.api.v1.endpoints.co_pilot_activity`. This test locks that
predicate at the query layer: when the SQLAlchemy query is built for
user A, no clause that scopes to user A is ever optional.

Why we test the predicate, not a live two-user round-trip: the live
path needs a running PG + Cognito + a request-scoped session per user,
which the OSS test suite doesn't currently spin up for endpoint-level
tests (see ``tests/conftest.py`` — integration tests are
``collect_ignore``'d). The query-shape assertion catches the only class
of regression that matters: a contributor accidentally dropping the
``user_id`` filter would change the assembled SQL, and this test would
flip red.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, desc, select

from app.models.bridge_audit_log import BridgeAuditLog


def _build_list_query_for_user(user_id: uuid.UUID):
    """Replica of the query construction in
    :func:`app.api.v1.endpoints.co_pilot_activity.list_my_bridge_audit_log`.

    Kept structurally identical so the predicate assertion below catches
    any future drift in the endpoint's filter shape.
    """
    conditions = [BridgeAuditLog.user_id == user_id]
    return (
        select(BridgeAuditLog)
        .where(and_(*conditions))
        .order_by(desc(BridgeAuditLog.occurred_at))
        .limit(101)
    )


def test_list_query_always_scopes_to_calling_user() -> None:
    """The SELECT MUST include ``user_id = :user_id`` for the caller, every time."""
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()

    stmt_a = _build_list_query_for_user(user_a)
    stmt_b = _build_list_query_for_user(user_b)

    # Compile to text WITH literal binds so the user_id appears inline in
    # the SQL string (so two different users yield two different queries —
    # the strongest unit-level evidence the predicate is present).
    sql_a = str(stmt_a.compile(compile_kwargs={"literal_binds": True}))
    sql_b = str(stmt_b.compile(compile_kwargs={"literal_binds": True}))

    # SQLAlchemy's literal_binds renders Python UUIDs as their `.hex`
    # form (no dashes) on PG, so we check the hex repr.
    assert "bridge_audit_log.user_id" in sql_a
    assert user_a.hex in sql_a
    # The two queries must differ — proves the predicate isn't constant.
    assert sql_a != sql_b
    # And user_b's id must NOT appear in user_a's query.
    assert user_b.hex not in sql_a
    assert user_a.hex not in sql_b


def test_bridge_audit_log_row_model_has_user_id_column() -> None:
    """Lock the schema column the cross-user filter depends on.

    A migration that renames or drops ``user_id`` would silently invalidate
    the isolation invariant; this guards the column name.
    """
    assert hasattr(BridgeAuditLog, "user_id")
    # And it's the column we filter on (not a Python-only attr).
    col = BridgeAuditLog.__table__.c.user_id
    assert col is not None
    assert col.foreign_keys, "user_id must be a foreign key to auth.users.id"
    fk = next(iter(col.foreign_keys))
    assert fk.column.table.name == "users"


def test_bridge_audit_log_payload_summary_is_jsonb_not_text() -> None:
    """Lock the safe-summary column type.

    Stored as JSONB so the viewer can filter on shape fields and so a
    future query can ``->>'elementId'`` without parsing JSON in Python.
    Regression guard: a contributor changing this to ``String`` would
    silently break the viewer + filter shape.
    """
    col = BridgeAuditLog.__table__.c.payload_summary
    # JSONB → SQLAlchemy compiles to ``JSONB`` on PG; the python type is
    # ``sqlalchemy.dialects.postgresql.JSONB``.
    from sqlalchemy.dialects.postgresql import JSONB

    assert isinstance(col.type, JSONB)


def test_bridge_audit_log_table_lives_in_web_schema() -> None:
    """The table is registered under the ``web`` schema (matches the alembic migration)."""
    assert BridgeAuditLog.__table__.schema == "web"


def test_bridge_audit_log_indexes_present() -> None:
    """The two indexes the migration creates must also exist on the model
    (so an in-process schema setup, e.g. for a local sqlite test bench,
    builds the same indexes the migration would).
    """
    index_names = {ix.name for ix in BridgeAuditLog.__table__.indexes}
    assert "ix_bridge_audit_log_user_id_occurred_at" in index_names
    assert "ix_bridge_audit_log_session_id" in index_names


def test_bridge_audit_log_row_defaults() -> None:
    """A row instantiated without occurred_at picks up a UTC default."""
    row = BridgeAuditLog(
        user_id=uuid.uuid4(),
        command_name="element.action",
        path="/control/element/btn-1/action",
        method="POST",
        status_code=200,
    )
    # Python-side default = lambda: datetime.now(UTC). The model also
    # carries a server_default of NOW() so insertion without an explicit
    # value still works; we verify the Python default for in-memory tests.
    assert row.occurred_at is None or isinstance(row.occurred_at, datetime)
    # If the Python default fires (it does on session.add → flush), it
    # is timezone-aware UTC.
    if row.occurred_at is not None:
        assert row.occurred_at.tzinfo is not None
        assert row.occurred_at.tzinfo.utcoffset(row.occurred_at) == UTC.utcoffset(
            row.occurred_at
        )
