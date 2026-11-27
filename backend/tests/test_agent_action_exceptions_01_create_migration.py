"""Behaviour test for the ``agent_action_exceptions_01_create`` revision.

Phase 1 of plan
``2026-11-27-every-action-is-agent-performable-unless-on-the-operator-exception-list``.
The revision creates ``coord.agent_action_exceptions``,
``coord.agent_action_exception_suggestions`` and ``coord.agent_refusal_events``.
Their shape is the contract coord's Phase 2 consult and operator routes, Phase
3 refusal helper and Phase 4 reconciler are built against, so this module pins
it.

What is asserted
================

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` match the pins below, the
   parent (read through the head gate's own parser) names exactly one real
   revision, and the docstring's ``Revision ID:`` / ``Revises:`` header agrees.
2. **Every statement is ONE static SQL literal, the only DROPs are in
   ``downgrade()``**, ``check_coord_column_drops``' scanner sees no drop on the
   upgrade path, and there is no ``op.get_bind()`` read.

Against a real Postgres (skipped when none is reachable — a skip proves
nothing; set ``QONTINUI_TEST_PG_DSN`` (or ``DATABASE_URL``) to an admin URL of a
test Postgres):

3. **The declared shape** of all three tables: columns in order with types,
   nullability and defaults; ``is_class`` generated from the key; the CHECKs.
4. **One LIVE entry per key**: a second live row for the same
   ``(tenant_id, action_key)`` conflicts on the partial unique index, while a
   soft-deleted row does not block a new live one, and another tenant's row
   never conflicts.
5. **The CHECKs refuse what the plan forbids**: an unknown ``origin``, a blank
   reason, a half-set removal pair, an unknown suggestion status, a decided
   suggestion with no decider, a duplicate suggestion key.
6. **Refusal events** insert with ``at`` from ``now()``, a NULL
   ``listed_entry_id`` (the unlisted-barrier defect) and a NULL session, and
   the ``(tenant_id, at DESC)`` index exists. The tenant roles hold DML on all
   three tables and USAGE on the bigserial sequence.
7. **Downgrade removes exactly the three tables, and a re-upgrade restores
   them**; a re-applied upgrade (stamp at the parent, upgrade again) over the
   existing shape is harmless and keeps rows.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, ProgrammingError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    declared_parent_revision_id,
    ephemeral_database,
    index_definition,
    load_revision_module,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "agent_action_exceptions_01_create"
_PARENT_REVISION_ID = "overview_07_schedule_last_known"
_REVISION_FILENAME = "agent_action_exceptions_01_create.py"

_SCHEMA = "coord"
_EXCEPTIONS = "agent_action_exceptions"
_SUGGESTIONS = "agent_action_exception_suggestions"
_EVENTS = "agent_refusal_events"
_TABLES = (_EXCEPTIONS, _SUGGESTIONS, _EVENTS)
_TIMESTAMPTZ = "timestamp with time zone"

# (name, information_schema data_type, nullable, default substring or None),
# in declaration order.
_EXCEPTION_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("tenant_id", "uuid", False, None),
    ("id", "uuid", False, "gen_random_uuid()"),
    ("action_key", "text", False, None),
    ("is_class", "boolean", True, None),
    ("reason", "text", False, None),
    ("added_by", "text", False, None),
    ("added_at", _TIMESTAMPTZ, False, "now()"),
    ("origin", "text", False, None),
    ("source_ref", "text", True, None),
    ("handoff", "text", True, None),
    ("enforced_by", "text", True, None),
    ("disposition", "text", True, None),
    ("removed_at", _TIMESTAMPTZ, True, None),
    ("removed_by", "text", True, None),
)

_SUGGESTION_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("action_key", "text", False, None),
    ("rationale", "text", False, None),
    ("source_ref", "text", False, None),
    ("status", "text", False, "'pending'"),
    ("decided_by", "text", True, None),
    ("decided_at", _TIMESTAMPTZ, True, None),
)

_EVENT_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "bigint", False, "nextval("),
    ("tenant_id", "uuid", False, None),
    ("at", _TIMESTAMPTZ, False, "now()"),
    ("door", "text", False, None),
    ("action_key", "text", False, None),
    ("code", "text", False, None),
    ("listed_entry_id", "uuid", True, None),
    ("principal_kind", "text", False, None),
    ("session_id", "text", True, None),
)

_ORIGINS = (
    "operator",
    "migrated_operator_deny",
    "reserved_by_clause",
    "accepted_suggestion",
)

_DOWNGRADE_STATEMENTS: tuple[str, ...] = (
    "DROP TABLE IF EXISTS coord.agent_refusal_events",
    "DROP TABLE IF EXISTS coord.agent_action_exception_suggestions",
    "DROP TABLE IF EXISTS coord.agent_action_exceptions",
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "Postgres not reachable at the conftest URL. CI provisions a postgres "
        "service; locally, set QONTINUI_TEST_PG_DSN (or DATABASE_URL)."
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _collapsed(sql: str | None) -> str:
    """``sql`` with every whitespace run collapsed to one space."""
    assert sql is not None, "every op.execute takes ONE static string literal"
    return " ".join(sql.split())


# ---------------------------------------------------------------------------
# 1-2. no database
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_revision() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        "a re-point moves down_revision, the docstring's `Revises:` line AND "
        "_PARENT_REVISION_ID in this test together"
    )
    assert (
        declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)
        == _PARENT_REVISION_ID
    ), "the head gate's own parser must read the same parent"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    parents = [
        f.name
        for f in (backend_root() / "alembic" / "versions").glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parents) == 1, (
        f"down_revision {_PARENT_REVISION_ID!r} must name exactly one existing "
        f"revision (found {parents})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


def test_upgrade_creates_the_three_tables_and_both_indexes() -> None:
    upgrade_sql = [_collapsed(c.sql) for c in upgrade_execute_calls(_revision_path())]
    for table in _TABLES:
        assert any(
            s.startswith(f"CREATE TABLE IF NOT EXISTS coord.{table} (")
            for s in upgrade_sql
        ), table
    assert (
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_action_exceptions_live_key "
        "ON coord.agent_action_exceptions (tenant_id, action_key) "
        "WHERE removed_at IS NULL"
    ) in upgrade_sql
    assert (
        "CREATE INDEX IF NOT EXISTS ix_agent_refusal_events_tenant_at "
        "ON coord.agent_refusal_events (tenant_id, at DESC)"
    ) in upgrade_sql
    for call in upgrade_execute_calls(_revision_path()):
        assert call.in_autocommit_block is False


def test_no_foreign_key_to_tenants_or_anything_else() -> None:
    creates = [
        _collapsed(c.sql).upper()
        for c in upgrade_execute_calls(_revision_path())
        if _collapsed(c.sql).startswith("CREATE TABLE")
    ]
    assert len(creates) == len(_TABLES)
    for sql in creates:
        assert "REFERENCES" not in sql and "FOREIGN KEY" not in sql, sql


def test_every_statement_is_static_sql_and_drops_live_in_downgrade() -> None:
    for call in upgrade_execute_calls(_revision_path()):
        sql = _collapsed(call.sql)
        assert "DROP" not in sql.upper(), sql
        assert "%" not in sql, sql
        assert not re.search(r"(?<!:):[A-Za-z_]\w*", sql), (
            "no bind-looking :word sequence in a static literal",
            sql,
        )
    downgrade_calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert tuple(_collapsed(c.sql) for c in downgrade_calls) == _DOWNGRADE_STATEMENTS

    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations

    attrs = {
        n.attr
        for n in ast.walk(ast.parse(_revision_source()))
        if isinstance(n, ast.Attribute)
    }
    assert "get_bind" not in attrs, (
        "no bind: coord's migration classifier cannot inspect SQL run through one"
    )


# ---------------------------------------------------------------------------
# 3-7. real Postgres
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> list[Any]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    """
                    SELECT column_name, data_type, is_nullable, column_default,
                           is_generated, generation_expression
                      FROM information_schema.columns
                     WHERE table_schema = 'coord' AND table_name = :t
                     ORDER BY ordinal_position
                    """
                ),
                {"t": table},
            ).all()
        )


def _constraints(engine: Engine, table: str, contype: str) -> dict[str, str]:
    with engine.connect() as conn:
        return {
            r.conname: r.def_
            for r in conn.execute(
                text(
                    "SELECT conname, pg_get_constraintdef(oid) AS def_ "
                    "FROM pg_constraint "
                    "WHERE conrelid = to_regclass(:t) AND contype = :c"
                ),
                {"t": f"coord.{table}", "c": contype},
            )
        }


def _assert_shape(
    engine: Engine,
    table: str,
    expected: tuple[tuple[str, str, bool, str | None], ...],
) -> None:
    rows = _columns(engine, table)
    assert [r.column_name for r in rows] == [c[0] for c in expected], table
    for row, (name, data_type, nullable, default) in zip(rows, expected, strict=True):
        assert row.data_type == data_type, (table, name, row)
        assert (row.is_nullable == "YES") is nullable, (table, name, row)
        if default is None:
            assert row.column_default is None, (table, name, row)
        else:
            assert default in (row.column_default or ""), (table, name, row)


@pytest.fixture(scope="module")
def exceptions_db() -> Iterator[Engine]:
    """One ephemeral DB upgraded through this revision."""
    if not can_connect(admin_database_url()):
        pytest.skip("Postgres not reachable at the conftest URL")
    with ephemeral_database(admin_database_url(), "coord_aax01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def _insert_entry(
    engine: Engine,
    tenant: str,
    key: str,
    *,
    origin: str = "operator",
    reason: str = "operator closed it",
    removed: bool = False,
) -> Any:
    with engine.begin() as conn:
        return conn.execute(
            text(
                """
                INSERT INTO coord.agent_action_exceptions
                    (tenant_id, action_key, reason, added_by, origin,
                     removed_at, removed_by)
                VALUES (:t, :k, :r, 'operator@example.test', :o,
                        CASE WHEN :rm THEN now() END,
                        CASE WHEN :rm THEN 'operator@example.test' END)
                RETURNING id, is_class, added_at = now() AS added_now
                """
            ),
            {"t": tenant, "k": key, "r": reason, "o": origin, "rm": removed},
        ).one()


@_needs_pg
def test_the_three_tables_have_the_declared_shape(exceptions_db: Engine) -> None:
    engine = exceptions_db
    _assert_shape(engine, _EXCEPTIONS, _EXCEPTION_COLUMNS)
    _assert_shape(engine, _SUGGESTIONS, _SUGGESTION_COLUMNS)
    _assert_shape(engine, _EVENTS, _EVENT_COLUMNS)

    is_class = next(
        r for r in _columns(engine, _EXCEPTIONS) if r.column_name == "is_class"
    )
    assert is_class.is_generated == "ALWAYS", is_class
    expression = is_class.generation_expression or ""
    assert "right" in expression and "(action_key, 1)" in expression, is_class
    assert "'*'" in expression, is_class

    assert _constraints(engine, _EXCEPTIONS, "p") == {
        "agent_action_exceptions_pkey": "PRIMARY KEY (id)"
    }
    assert _constraints(engine, _SUGGESTIONS, "u") == {
        "agent_action_exception_suggestions_tenant_key_unique": (
            "UNIQUE (tenant_id, action_key)"
        )
    }
    assert _constraints(engine, _EVENTS, "p") == {
        "agent_refusal_events_pkey": "PRIMARY KEY (id)"
    }
    for table in _TABLES:
        assert _constraints(engine, table, "f") == {}, table

    origin_check = _constraints(engine, _EXCEPTIONS, "c")[
        "agent_action_exceptions_origin_check"
    ]
    for origin in _ORIGINS:
        assert f"'{origin}'" in origin_check, (origin, origin_check)
    assert set(_constraints(engine, _SUGGESTIONS, "c")) == {
        "agent_action_exception_suggestions_status_check",
        "agent_action_exception_suggestions_decided_iff_not_pending",
        "agent_action_exception_suggestions_decided_pair",
    }

    assert index_definition(engine, "uq_agent_action_exceptions_live_key") == (
        "CREATE UNIQUE INDEX uq_agent_action_exceptions_live_key ON "
        "coord.agent_action_exceptions USING btree (tenant_id, action_key) "
        "WHERE (removed_at IS NULL)"
    )
    assert index_definition(engine, "ix_agent_refusal_events_tenant_at") == (
        "CREATE INDEX ix_agent_refusal_events_tenant_at ON "
        "coord.agent_refusal_events USING btree (tenant_id, at DESC)"
    )


@_needs_pg
def test_is_class_is_derived_from_the_key(exceptions_db: Engine) -> None:
    tenant = str(uuid.uuid4())
    exact = _insert_entry(exceptions_db, tenant, "tool.call:coord_fleet_drain")
    klass = _insert_entry(
        exceptions_db, tenant, "prompt_document.write:claude_settings/*"
    )
    assert exact.is_class is False
    assert klass.is_class is True
    assert exact.added_now is True
    with pytest.raises(ProgrammingError):
        with exceptions_db.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.agent_action_exceptions SET is_class = false "
                    "WHERE id = :i"
                ),
                {"i": klass.id},
            )


@_needs_pg
def test_one_live_entry_per_key_and_tombstones_do_not_block(
    exceptions_db: Engine,
) -> None:
    engine = exceptions_db
    tenant = str(uuid.uuid4())
    key = "route:POST /coord/gates/:id/approve"
    _insert_entry(engine, tenant, key, removed=True)
    _insert_entry(engine, tenant, key)  # a tombstone does not block a live row
    with pytest.raises(IntegrityError) as excinfo:
        _insert_entry(engine, tenant, key)
    assert excinfo.value.orig.diag.constraint_name == (  # type: ignore[union-attr]
        "uq_agent_action_exceptions_live_key"
    )
    _insert_entry(engine, str(uuid.uuid4()), key)  # another tenant never conflicts
    with engine.connect() as conn:
        counts = conn.execute(
            text(
                "SELECT count(*) FILTER (WHERE removed_at IS NULL) AS live, "
                "count(*) AS total FROM coord.agent_action_exceptions "
                "WHERE tenant_id = :t AND action_key = :k"
            ),
            {"t": tenant, "k": key},
        ).one()
    assert (counts.live, counts.total) == (1, 2)


@_needs_pg
@pytest.mark.parametrize("origin", _ORIGINS)
def test_every_declared_origin_is_accepted(exceptions_db: Engine, origin: str) -> None:
    _insert_entry(exceptions_db, str(uuid.uuid4()), "shell:gh pr merge", origin=origin)


@_needs_pg
def test_the_exception_checks_refuse_what_the_plan_forbids(
    exceptions_db: Engine,
) -> None:
    engine = exceptions_db
    tenant = str(uuid.uuid4())
    cases: tuple[tuple[str, dict[str, Any], str], ...] = (
        (
            "INSERT INTO coord.agent_action_exceptions "
            "(tenant_id, action_key, reason, added_by, origin) "
            "VALUES (:t, 'a.b', 'r', 'op', 'compiled_default')",
            {"t": tenant},
            "agent_action_exceptions_origin_check",
        ),
        (
            "INSERT INTO coord.agent_action_exceptions "
            "(tenant_id, action_key, reason, added_by, origin) "
            "VALUES (:t, 'a.b', '   ', 'op', 'operator')",
            {"t": tenant},
            "agent_action_exceptions_reason_nonblank",
        ),
        (
            "INSERT INTO coord.agent_action_exceptions "
            "(tenant_id, action_key, reason, added_by, origin) "
            "VALUES (:t, '', 'r', 'op', 'operator')",
            {"t": tenant},
            "agent_action_exceptions_action_key_nonblank",
        ),
        (
            "INSERT INTO coord.agent_action_exceptions "
            "(tenant_id, action_key, reason, added_by, origin, removed_at) "
            "VALUES (:t, 'a.c', 'r', 'op', 'operator', now())",
            {"t": tenant},
            "agent_action_exceptions_removed_pair",
        ),
    )
    for sql, params, constraint in cases:
        with pytest.raises(IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(text(sql), params)
        assert excinfo.value.orig.diag.constraint_name == constraint, sql  # type: ignore[union-attr]
    with pytest.raises(IntegrityError):
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO coord.agent_action_exceptions "
                    "(tenant_id, action_key, added_by, origin) "
                    "VALUES (:t, 'a.d', 'op', 'operator')"
                ),
                {"t": tenant},
            )


@_needs_pg
def test_suggestions_default_pending_and_the_checks_hold(exceptions_db: Engine) -> None:
    engine = exceptions_db
    tenant = str(uuid.uuid4())
    insert = text(
        """
        INSERT INTO coord.agent_action_exception_suggestions
            (tenant_id, action_key, rationale, source_ref)
        VALUES (:t, 'prompt_document.write:policy/session-protocol',
                'was a compiled default deny; open unless you add it',
                'policy_proposals.rs AGENT_UNWRITABLE_DOCUMENTS')
        RETURNING id, status, decided_by, decided_at
        """
    )
    with engine.begin() as conn:
        row = conn.execute(insert, {"t": tenant}).one()
    assert (row.status, row.decided_by, row.decided_at) == ("pending", None, None)

    with pytest.raises(IntegrityError) as excinfo:
        with engine.begin() as conn:
            conn.execute(insert, {"t": tenant})
    assert excinfo.value.orig.diag.constraint_name == (  # type: ignore[union-attr]
        "agent_action_exception_suggestions_tenant_key_unique"
    )

    refused: tuple[tuple[str, str], ...] = (
        (
            "UPDATE coord.agent_action_exception_suggestions "
            "SET status = 'maybe', decided_at = now(), decided_by = 'op' "
            "WHERE id = :i",
            "agent_action_exception_suggestions_status_check",
        ),
        (
            "UPDATE coord.agent_action_exception_suggestions SET status = 'added' "
            "WHERE id = :i",
            "agent_action_exception_suggestions_decided_iff_not_pending",
        ),
        (
            "UPDATE coord.agent_action_exception_suggestions "
            "SET status = 'dismissed', decided_at = now() WHERE id = :i",
            "agent_action_exception_suggestions_decided_pair",
        ),
    )
    for sql, constraint in refused:
        with pytest.raises(IntegrityError) as excinfo:
            with engine.begin() as conn:
                conn.execute(text(sql), {"i": row.id})
        assert excinfo.value.orig.diag.constraint_name == constraint, sql  # type: ignore[union-attr]

    with engine.begin() as conn:
        decided = conn.execute(
            text(
                "UPDATE coord.agent_action_exception_suggestions "
                "SET status = 'added', decided_at = now(), decided_by = 'op' "
                "WHERE id = :i RETURNING status"
            ),
            {"i": row.id},
        ).scalar_one()
    assert decided == "added"


@_needs_pg
def test_a_minimal_refusal_event_records_an_unlisted_barrier(
    exceptions_db: Engine,
) -> None:
    tenant = str(uuid.uuid4())
    with exceptions_db.begin() as conn:
        row = conn.execute(
            text(
                """
                INSERT INTO coord.agent_refusal_events
                    (tenant_id, door, action_key, code, principal_kind)
                VALUES (:t, 'PUT /coord/fleet-policy/agent',
                        'fleet_policy.write:plan_capture',
                        'domain_not_agent_writable', 'device_agent')
                RETURNING id, at = now() AS at_now, listed_entry_id, session_id
                """
            ),
            {"t": tenant},
        ).one()
    assert row.id >= 1
    assert row.at_now is True
    assert (row.listed_entry_id, row.session_id) == (None, None)


_TENANT_ROLES = ("coord_tenant", "coord_tenant_preflight")


@_needs_pg
def test_the_tenant_roles_can_use_the_new_tables(exceptions_db: Engine) -> None:
    """``coordrls_01``'s default privileges must reach the new tables and the
    bigserial's sequence, or the first tenant-scoped coord write is a ``42501``."""
    with exceptions_db.connect() as conn:
        for role in _TENANT_ROLES:
            for table in _TABLES:
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                    granted = conn.execute(
                        text("SELECT has_table_privilege(:r, :rel, :p)"),
                        {"r": role, "rel": f"coord.{table}", "p": privilege},
                    ).scalar_one()
                    assert granted is True, (role, table, privilege)
            sequence = conn.execute(
                text(
                    "SELECT pg_get_serial_sequence('coord.agent_refusal_events', 'id')"
                )
            ).scalar_one()
            assert sequence is not None
            usage = conn.execute(
                text("SELECT has_sequence_privilege(:r, :s, 'USAGE')"),
                {"r": role, "s": sequence},
            ).scalar_one()
            assert usage is True, (role, sequence)


# (table, column or None for the table comment, a substring the comment carries)
_COMMENTS: tuple[tuple[str, str | None, str], ...] = (
    (
        _EXCEPTIONS,
        None,
        "every-action-is-agent-performable-unless-the-operator-closed-it",
    ),
    (_EXCEPTIONS, "action_key", "CLASS"),
    (_EXCEPTIONS, "is_class", "Generated"),
    (_EXCEPTIONS, "source_ref", "reconciler key"),
    (_EXCEPTIONS, "disposition", "warn_proceed"),
    (_EXCEPTIONS, "removed_at", "tombstone"),
    (_SUGGESTIONS, None, "takes effect only when the operator adds it"),
    (_EVENTS, None, "30 days"),
    (_EVENTS, "listed_entry_id", "defect"),
)


@_needs_pg
def test_every_comment_the_upgrade_writes_is_present(exceptions_db: Engine) -> None:
    for table, column, needle in _COMMENTS:
        if column is None:
            with exceptions_db.connect() as conn:
                comment = conn.execute(
                    text("SELECT obj_description(to_regclass(:t), 'pg_class')"),
                    {"t": f"coord.{table}"},
                ).scalar_one()
        else:
            comment = column_comment(exceptions_db, table, column)
        assert comment and needle in comment, (table, column, comment)


@_needs_pg
def test_downgrade_removes_exactly_the_three_tables_and_re_upgrade_restores_them() -> (
    None
):
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_aax01d") as (engine, url):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table), table

        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table), table

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        for table in _TABLES:
            assert not table_exists(engine, _SCHEMA, table), table
        assert table_exists(engine, _SCHEMA, "agent_registry"), "siblings stay"

        run_alembic(root, url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, _SCHEMA, table), table


@_needs_pg
def test_a_re_applied_upgrade_over_the_existing_shape_is_harmless() -> None:
    """The ``IF NOT EXISTS`` posture: re-stamping at the parent and upgrading
    again over the already-present tables succeeds and keeps rows."""
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_aax01i") as (engine, url):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        tenant = str(uuid.uuid4())
        _insert_entry(
            engine, tenant, "runner.lifecycle:restart", origin="reserved_by_clause"
        )
        shape = {
            table: [tuple(r) for r in _columns(engine, table)] for table in _TABLES
        }
        run_alembic(root, url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert {
            table: [tuple(r) for r in _columns(engine, table)] for table in _TABLES
        } == shape
        with engine.connect() as conn:
            kept = conn.execute(
                text(
                    "SELECT count(*) FROM coord.agent_action_exceptions "
                    "WHERE tenant_id = :t"
                ),
                {"t": tenant},
            ).scalar_one()
        assert kept == 1
