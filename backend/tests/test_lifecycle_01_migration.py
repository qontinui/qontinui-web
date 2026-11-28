"""Schema + behaviour + round-trip test for ``lifecycle_01_work_items_lifecycle_events``.

Phase 17 of plan ``2026-10-28-one-session-lifecycle-authority``. Pins:

1. **Every new table's exact column set** — ``(data_type, is_nullable)`` per
   column, no more and no fewer. coord's Phase 18/20/26/28/42/50/56 writers are
   built against these shapes, so a change is a reviewed edit of this test.
2. **The widened ``coord.session_census_device`` set** — the census_01 test's
   own ``_EXPECTED_DEVICE_COLUMNS`` plus ``complete``, imported so the two
   cannot drift apart.
3. **The three CONCURRENTLY indexes are VALID and carry their predicates.**
4. **The behaviours the DDL exists for**, each with a partner case that is
   allowed, so a removed or widened rule goes red rather than passing
   vacuously:

   * a second open row for one (tenant, device, pane) is refused — including
     when the holder is ``stale`` — and a ``closed`` holder frees the pane;
   * a withdrawn question frees its ``dedupe_key`` (the third conjunct);
   * the lease scope CHECKs;
   * ``UNIQUE (tenant_id, kind, subject)`` on ``coord.work_items``;
   * ``delivered_evidence``'s CHECK.
5. **Downgrade leaves no residue and keeps pre-existing rows; re-upgrade
   restores every object.**

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing: point it
at a live instance with ``QONTINUI_TEST_PG_DSN`` (conftest overwrites
``DATABASE_URL`` from it, so setting ``DATABASE_URL`` alone still skips).
"""

from __future__ import annotations

import ast
import contextlib
import re
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, OperationalError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)
from tests.test_coord_session_census_01_migration import (
    _EXPECTED_DEVICE_COLUMNS as _CENSUS_01_DEVICE_COLUMNS,
)

_REVISION_ID = "lifecycle_01_work_items_lifecycle_events"
_REVISION_FILENAME = "lifecycle_01_work_items_lifecycle_events.py"
_CENSUS_01_REVISION_ID = "coord_session_census_01"

_TS = "timestamp with time zone"


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Parse this revision's own ``down_revision`` at runtime, never hardcode
    it: coord re-points ``down_revision`` at land when a peer lands first."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


_PARENT_REVISION_ID = _parent_revision_id()


def _revision_module() -> ModuleType:
    return load_revision_module(_revision_path(), f"_rev_{_REVISION_ID}")


# ---------------------------------------------------------------------------
# The contract: column sets
# ---------------------------------------------------------------------------

_EXPECTED_NEW_TABLES: dict[str, dict[str, tuple[str, str]]] = {
    "lifecycle_events": {
        "event_id": ("bigint", "NO"),
        "tenant_id": ("uuid", "NO"),
        "session_id": ("uuid", "NO"),
        "claude_code_session_id": ("uuid", "YES"),
        "writer_device_id": ("uuid", "NO"),
        "decision_seq": ("bigint", "NO"),
        "journal_id": ("text", "NO"),
        "event_kind": ("text", "NO"),
        "phase": ("text", "NO"),
        "action": ("text", "YES"),
        "rule": ("text", "YES"),
        "reasons": ("jsonb", "NO"),
        "guards": ("jsonb", "NO"),
        "unknowns": ("jsonb", "NO"),
        "owed_kinds": ("ARRAY", "NO"),
        "caps": ("ARRAY", "NO"),
        "inputs_digest": ("text", "NO"),
        "fn_version": ("text", "NO"),
        "build_sha": ("text", "YES"),
        "evaluated_at": (_TS, "NO"),
        "received_at": (_TS, "NO"),
    },
    "work_items": {
        "item_id": ("uuid", "NO"),
        "tenant_id": ("uuid", "NO"),
        "kind": ("text", "NO"),
        "subject": ("text", "NO"),
        "repo": ("text", "YES"),
        "pr_number": ("integer", "YES"),
        "head_sha": ("text", "YES"),
        "first_seen_at": (_TS, "NO"),
        "state": ("text", "NO"),
        "state_detail": ("jsonb", "NO"),
        "owner_kind": ("text", "YES"),
        "owner_session_id": ("uuid", "YES"),
        "owner_claude_code_session_id": ("uuid", "YES"),
        "owner_device_id": ("uuid", "YES"),
        "attribution": ("text", "NO"),
        "corroboration": ("jsonb", "YES"),
        "red_class": ("text", "YES"),
        "route": ("text", "YES"),
        "deadline_at": (_TS, "YES"),
        "handoff_gate_id": ("uuid", "YES"),
        "created_at": (_TS, "NO"),
        "updated_at": (_TS, "NO"),
    },
    "work_item_events": {
        "coord_seq": ("bigint", "NO"),
        "tenant_id": ("uuid", "NO"),
        "item_id": ("uuid", "NO"),
        "event_kind": ("text", "NO"),
        "from_state": ("text", "YES"),
        "to_state": ("text", "YES"),
        "owner_kind": ("text", "YES"),
        "route": ("text", "YES"),
        "red_class": ("text", "YES"),
        "actor": ("text", "NO"),
        "detail": ("jsonb", "NO"),
        "occurred_at": (_TS, "NO"),
    },
    "work_ledger_arming": {
        "transition_id": ("bigint", "NO"),
        "tenant_id": ("uuid", "NO"),
        "mode": ("text", "NO"),
        "transitioned_at": (_TS, "NO"),
        "reason": ("text", "NO"),
        "evidence": ("jsonb", "NO"),
    },
    "lifecycle_close_latches": {
        "latch_id": ("uuid", "NO"),
        "tenant_id": ("uuid", "NO"),
        "false_close_id": ("bigint", "NO"),
        "fn_version": ("text", "NO"),
        "fixture_id": ("text", "YES"),
        "tripped_at": (_TS, "NO"),
    },
    "session_message_leases": {
        "lease_id": ("uuid", "NO"),
        "tenant_id": ("uuid", "NO"),
        "session_id": ("uuid", "NO"),
        "message_id": ("uuid", "YES"),
        "holder": ("text", "NO"),
        "scope": ("text", "NO"),
        "acquired_at": (_TS, "NO"),
        "expires_at": (_TS, "NO"),
    },
}

_EXPECTED_DEVICE_COLUMNS: dict[str, tuple[str, str]] = {
    **_CENSUS_01_DEVICE_COLUMNS,
    "complete": ("boolean", "NO"),
}

# Columns this revision adds to tables that already exist.
_ADDED_COLUMNS: dict[str, dict[str, tuple[str, str]]] = {
    "sessions": {"pane_id": ("text", "YES")},
    "session_messages": {"delivered_evidence": ("text", "YES")},
    "session_census_device": {"complete": ("boolean", "NO")},
    "agent_questions": {
        "basis": ("jsonb", "YES"),
        "documents_read": ("jsonb", "YES"),
        "dedupe_key": ("text", "YES"),
        "clear_predicate": ("jsonb", "YES"),
        "why_none_decides": ("text", "YES"),
        "policy_gap_finding_id": ("uuid", "YES"),
    },
}

# The agent-question columns are TRAILING and in this order: append-only, for
# consistency with the existing column order. (coord reads the table through
# its own explicit COLS projection, not by position.)
_QUESTION_TRAILING = (
    "basis",
    "documents_read",
    "dedupe_key",
    "clear_predicate",
    "why_none_decides",
    "policy_gap_finding_id",
)

# The three CONCURRENTLY indexes: (table, unique, pg_get_indexdef on PG 16).
_CONCURRENT_INDEXES: dict[str, tuple[str, bool, str]] = {
    "uq_sessions_active_pane": (
        "sessions",
        True,
        "CREATE UNIQUE INDEX uq_sessions_active_pane ON coord.sessions "
        "USING btree (tenant_id, device_id, pane_id) "
        "WHERE ((pane_id IS NOT NULL) AND (state <> 'closed'::text))",
    ),
    "uq_agent_questions_open_dedupe": (
        "agent_questions",
        True,
        "CREATE UNIQUE INDEX uq_agent_questions_open_dedupe ON coord.agent_questions "
        "USING btree (tenant_id, dedupe_key) "
        "WHERE ((dedupe_key IS NOT NULL) AND (responded_at IS NULL) "
        "AND (withdrawn_at IS NULL))",
    ),
    "idx_agent_questions_open_typed": (
        "agent_questions",
        False,
        "CREATE INDEX idx_agent_questions_open_typed ON coord.agent_questions "
        "USING btree (tenant_id, created_at DESC) "
        "WHERE ((basis IS NOT NULL) AND (responded_at IS NULL) "
        "AND (withdrawn_at IS NULL))",
    ),
}

# Every constraint of the six new tables (PK, FK, UNIQUE, CHECK), by name, as
# pg_get_constraintdef renders it with search_path = pg_catalog (PG 16).
_NEW_TABLE_CONSTRAINTS: dict[str, dict[str, str]] = {
    "lifecycle_events": {
        "lifecycle_events_pkey": "PRIMARY KEY (event_id)",
        "lifecycle_events_tenant_id_fkey": (
            "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE "
            "CASCADE"
        ),
        "uq_lifecycle_events_session_writer_seq": "UNIQUE (session_id, writer_device_id, decision_seq)",
        "uq_lifecycle_events_writer_journal": "UNIQUE (writer_device_id, journal_id)",
    },
    "work_items": {
        "uq_work_items_tenant_kind_subject": "UNIQUE (tenant_id, kind, subject)",
        "work_items_attribution_check": (
            "CHECK ((attribution = ANY (ARRAY['attributed'::text, "
            "'unattributed'::text])))"
        ),
        "work_items_kind_check": (
            "CHECK ((kind = ANY (ARRAY['ci_first_verdict'::text, 'ci_red'::text, "
            "'pr_conflict'::text, 'escalate_hit'::text, 'pr_watch'::text, "
            "'wait_gate'::text, 'question'::text, 'custody'::text, "
            "'work_unit_scope'::text, 'finding'::text, 'resume'::text])))"
        ),
        "work_items_owner_kind_check": (
            "CHECK ((owner_kind = ANY (ARRAY['author_session'::text, "
            "'resumed_author'::text, 'fixer'::text, 'main_fix'::text, 'infra'::text, "
            "'ledger'::text, 'operator'::text])))"
        ),
        "work_items_pkey": "PRIMARY KEY (item_id)",
        "work_items_state_check": (
            "CHECK ((state = ANY (ARRAY['open'::text, 'watched'::text, 'pending'::text, "
            "'impeded'::text, 'done'::text, 'deferred'::text, 'surfaced'::text, "
            "'unknown'::text])))"
        ),
        "work_items_tenant_id_fkey": (
            "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE "
            "CASCADE"
        ),
    },
    "work_item_events": {
        "work_item_events_item_id_fkey": "FOREIGN KEY (item_id) REFERENCES coord.work_items(item_id) ON DELETE CASCADE",
        "work_item_events_pkey": "PRIMARY KEY (coord_seq)",
    },
    "work_ledger_arming": {
        "work_ledger_arming_mode_check": "CHECK ((mode = ANY (ARRAY['shadow'::text, 'live'::text])))",
        "work_ledger_arming_pkey": "PRIMARY KEY (transition_id)",
        "work_ledger_arming_tenant_id_fkey": (
            "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE "
            "CASCADE"
        ),
    },
    "lifecycle_close_latches": {
        "lifecycle_close_latches_pkey": "PRIMARY KEY (latch_id)",
        "lifecycle_close_latches_tenant_id_fkey": (
            "FOREIGN KEY (tenant_id) REFERENCES coord.tenants(tenant_id) ON DELETE "
            "CASCADE"
        ),
        "uq_lifecycle_close_latches_tenant_false_close": "UNIQUE (tenant_id, false_close_id)",
    },
    "session_message_leases": {
        "session_message_leases_message_id_fkey": (
            "FOREIGN KEY (message_id) REFERENCES coord.session_messages(message_id) ON "
            "DELETE CASCADE"
        ),
        "session_message_leases_pkey": "PRIMARY KEY (lease_id)",
        "session_message_leases_scope_check": "CHECK ((scope = ANY (ARRAY['message'::text, 'session'::text])))",
        "session_message_leases_scope_message_check": "CHECK (((scope = 'message'::text) = (message_id IS NOT NULL)))",
    },
}

# Every index of the six new tables (PK and UNIQUE backing indexes included),
# by name, as pg_get_indexdef renders it with search_path = pg_catalog (PG 16).
# Each partial predicate is part of the pinned text.
_NEW_TABLE_INDEX_DEFS: dict[str, dict[str, str]] = {
    "lifecycle_events": {
        "idx_lifecycle_events_received_at": (
            "CREATE INDEX idx_lifecycle_events_received_at ON coord.lifecycle_events "
            "USING btree (received_at)"
        ),
        "idx_lifecycle_events_tenant_cc_session": (
            "CREATE INDEX idx_lifecycle_events_tenant_cc_session ON "
            "coord.lifecycle_events USING btree (tenant_id, claude_code_session_id, "
            "event_id DESC)"
        ),
        "idx_lifecycle_events_tenant_session": (
            "CREATE INDEX idx_lifecycle_events_tenant_session ON coord.lifecycle_events "
            "USING btree (tenant_id, session_id, event_id DESC)"
        ),
        "lifecycle_events_pkey": (
            "CREATE UNIQUE INDEX lifecycle_events_pkey ON coord.lifecycle_events USING "
            "btree (event_id)"
        ),
        "uq_lifecycle_events_session_writer_seq": (
            "CREATE UNIQUE INDEX uq_lifecycle_events_session_writer_seq ON "
            "coord.lifecycle_events USING btree (session_id, writer_device_id, "
            "decision_seq)"
        ),
        "uq_lifecycle_events_writer_journal": (
            "CREATE UNIQUE INDEX uq_lifecycle_events_writer_journal ON "
            "coord.lifecycle_events USING btree (writer_device_id, journal_id)"
        ),
    },
    "work_items": {
        "idx_work_items_open_owner_cc_session": (
            "CREATE INDEX idx_work_items_open_owner_cc_session ON coord.work_items "
            "USING btree (tenant_id, owner_claude_code_session_id) WHERE (state <> ALL "
            "(ARRAY['done'::text, 'deferred'::text, 'surfaced'::text]))"
        ),
        "idx_work_items_owner_device_state": (
            "CREATE INDEX idx_work_items_owner_device_state ON coord.work_items USING "
            "btree (owner_device_id, state)"
        ),
        "idx_work_items_tenant_repo_pr": (
            "CREATE INDEX idx_work_items_tenant_repo_pr ON coord.work_items USING btree "
            "(tenant_id, repo, pr_number)"
        ),
        "uq_work_items_tenant_kind_subject": (
            "CREATE UNIQUE INDEX uq_work_items_tenant_kind_subject ON coord.work_items "
            "USING btree (tenant_id, kind, subject)"
        ),
        "work_items_pkey": (
            "CREATE UNIQUE INDEX work_items_pkey ON coord.work_items USING btree "
            "(item_id)"
        ),
    },
    "work_item_events": {
        "idx_work_item_events_item_seq": (
            "CREATE INDEX idx_work_item_events_item_seq ON coord.work_item_events USING "
            "btree (item_id, coord_seq)"
        ),
        "idx_work_item_events_occurred_at": (
            "CREATE INDEX idx_work_item_events_occurred_at ON coord.work_item_events "
            "USING btree (occurred_at)"
        ),
        "idx_work_item_events_tenant_occurred": (
            "CREATE INDEX idx_work_item_events_tenant_occurred ON "
            "coord.work_item_events USING btree (tenant_id, occurred_at)"
        ),
        "work_item_events_pkey": (
            "CREATE UNIQUE INDEX work_item_events_pkey ON coord.work_item_events USING "
            "btree (coord_seq)"
        ),
    },
    "work_ledger_arming": {
        "idx_work_ledger_arming_tenant_transition": (
            "CREATE INDEX idx_work_ledger_arming_tenant_transition ON "
            "coord.work_ledger_arming USING btree (tenant_id, transition_id DESC)"
        ),
        "work_ledger_arming_pkey": (
            "CREATE UNIQUE INDEX work_ledger_arming_pkey ON coord.work_ledger_arming "
            "USING btree (transition_id)"
        ),
    },
    "lifecycle_close_latches": {
        "lifecycle_close_latches_pkey": (
            "CREATE UNIQUE INDEX lifecycle_close_latches_pkey ON "
            "coord.lifecycle_close_latches USING btree (latch_id)"
        ),
        "uq_lifecycle_close_latches_tenant_false_close": (
            "CREATE UNIQUE INDEX uq_lifecycle_close_latches_tenant_false_close ON "
            "coord.lifecycle_close_latches USING btree (tenant_id, false_close_id)"
        ),
    },
    "session_message_leases": {
        "idx_session_message_leases_message_expires": (
            "CREATE INDEX idx_session_message_leases_message_expires ON "
            "coord.session_message_leases USING btree (message_id, expires_at) WHERE "
            "(scope = 'message'::text)"
        ),
        "idx_session_message_leases_session_expires": (
            "CREATE INDEX idx_session_message_leases_session_expires ON "
            "coord.session_message_leases USING btree (session_id, expires_at) WHERE "
            "(scope = 'session'::text)"
        ),
        "ix_session_message_leases_message_id": (
            "CREATE INDEX ix_session_message_leases_message_id ON "
            "coord.session_message_leases USING btree (message_id)"
        ),
        "session_message_leases_pkey": (
            "CREATE UNIQUE INDEX session_message_leases_pkey ON "
            "coord.session_message_leases USING btree (lease_id)"
        ),
        "uq_session_message_leases_message_holder": (
            "CREATE UNIQUE INDEX uq_session_message_leases_message_holder ON "
            "coord.session_message_leases USING btree (message_id, holder) WHERE (scope "
            "= 'message'::text)"
        ),
        "uq_session_message_leases_session_holder": (
            "CREATE UNIQUE INDEX uq_session_message_leases_session_holder ON "
            "coord.session_message_leases USING btree (tenant_id, session_id, holder) "
            "WHERE (scope = 'session'::text)"
        ),
    },
}

_NEW_TABLE_INDEXES = tuple(
    name for defs in _NEW_TABLE_INDEX_DEFS.values() for name in defs
)


# ---------------------------------------------------------------------------
# Source-level guards — no database needed, so they never skip.
# ---------------------------------------------------------------------------


def test_revision_ids_parse_consistently() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_every_op_execute_takes_a_static_string_literal() -> None:
    """coord's migration classifier rejects a dynamic ``op.execute`` argument,
    and the schema-arg gate can only read a literal."""
    tree = ast.parse(_revision_source())
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls
    for call in calls:
        assert len(call.args) == 1 and not call.keywords
        arg = call.args[0]
        assert isinstance(arg, ast.Constant) and isinstance(arg.value, str), (
            f"op.execute at line {call.lineno} is not a static string literal"
        )


def _recorded_upgrade(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """``upgrade()``'s ``op.execute`` text, in order, with no database.

    ``recorded_sql`` stubs only ``execute``; this revision also opens an
    ``autocommit_block`` and runs two catalog probes through ``op.get_bind()``,
    so all three are stubbed here with the first-apply answers: no INVALID
    index leftover, and no ``delivered_evidence`` CHECK yet (so its
    ``ADD CONSTRAINT`` is recorded).
    """
    executed: list[str] = []

    class _Context:
        @staticmethod
        @contextlib.contextmanager
        def autocommit_block() -> Iterator[None]:
            executed.append("-- autocommit_block")
            yield

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

        @staticmethod
        def get_context() -> _Context:
            return _Context()

    module = _revision_module()
    monkeypatch.setattr(module, "op", _RecordingOp)
    monkeypatch.setattr(module, "_index_is_invalid", lambda _name: False)
    monkeypatch.setattr(module, "_constraint_exists", lambda _table, _name: False)
    module.upgrade()
    return executed


def _ddl_position(ddl: list[str], prefix: str) -> int:
    found = [i for i, sql in enumerate(ddl) if sql.startswith(prefix)]
    assert len(found) >= 1, f"no statement starts with {prefix!r}"
    return found[0]


def test_upgrade_bounds_its_lock_wait_and_takes_the_sessions_lock_last(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The DDL takes ACCESS EXCLUSIVE on the shared coord.sessions: bound the
    wait, never RESET (coord's classifier refuses it; env.py resets after each
    revision), and take the coord.sessions lock LAST so it is held shortest."""
    statements = [" ".join(s.split()) for s in _recorded_upgrade(monkeypatch)]
    assert statements[0] == "SET LOCAL lock_timeout = '3s'", statements[0]
    assert not any(s.upper().startswith("RESET") for s in statements), (
        "coord's migration classifier refuses every RESET"
    )
    assert not any("$$" in s for s in statements), (
        "coord's classifier lexer fails closed on dollar-quoted strings"
    )
    block = statements.index("-- autocommit_block")
    ddl = statements[1:block]
    # Every CONCURRENTLY build runs after the transaction's DDL, never in it.
    assert not any("CONCURRENTLY" in s for s in ddl)

    # The brand-new tables first; then the leases table; then the ALTERs of
    # existing tables, coord.sessions last. The new tables still lock shared
    # rows' tables: each REFERENCES coord.tenants takes SHARE ROW EXCLUSIVE on
    # coord.tenants, and the leases FK the same on coord.session_messages.
    # What the order buys is that no ACCESS EXCLUSIVE lock (an ALTER) is taken
    # until every CREATE is done, and the hottest one is taken last.
    order = [
        "CREATE TABLE IF NOT EXISTS coord.lifecycle_events",
        "CREATE TABLE IF NOT EXISTS coord.work_items",
        "CREATE TABLE IF NOT EXISTS coord.work_item_events",
        "CREATE TABLE IF NOT EXISTS coord.work_ledger_arming",
        "CREATE TABLE IF NOT EXISTS coord.lifecycle_close_latches",
        "CREATE TABLE IF NOT EXISTS coord.session_message_leases",
        "ALTER TABLE coord.session_messages ADD COLUMN",
        "ALTER TABLE coord.session_messages ADD CONSTRAINT",
        "ALTER TABLE coord.session_census_device",
        "ALTER TABLE coord.agent_questions",
        "ALTER TABLE coord.sessions",
    ]
    positions = [_ddl_position(ddl, prefix) for prefix in order]
    assert positions == sorted(positions), list(zip(order, positions, strict=True))
    alters = [i for i, s in enumerate(ddl) if s.startswith("ALTER TABLE")]
    creates = [i for i, s in enumerate(ddl) if s.startswith("CREATE")]
    assert ddl[-1].startswith("ALTER TABLE coord.sessions"), ddl[-1]
    assert max(creates) < min(alters), (
        "every CREATE must precede the first ALTER (the first ACCESS EXCLUSIVE "
        "lock on an existing table)"
    )
    assert "NOT VALID" in ddl[_ddl_position(ddl, order[7])]

    concurrent = [s for s in statements[block + 1 :] if s.startswith("CREATE")]
    assert len(concurrent) == len(_CONCURRENT_INDEXES)
    for name in _CONCURRENT_INDEXES:
        assert any(f"CONCURRENTLY IF NOT EXISTS {name} " in s for s in concurrent)


def test_an_existing_delivered_evidence_check_is_not_re_added(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Python ``pg_constraint`` guard: a re-run over a committed CHECK
    emits no ``ADD CONSTRAINT`` (which PostgreSQL would refuse as a duplicate)."""
    first = " ".join(_recorded_upgrade(monkeypatch))
    assert "ADD CONSTRAINT session_messages_delivered_evidence_check" in first
    executed: list[str] = []

    class _Context:
        @staticmethod
        @contextlib.contextmanager
        def autocommit_block() -> Iterator[None]:
            yield

    class _RecordingOp:
        @staticmethod
        def execute(sql: object) -> None:
            executed.append(str(sql))

        @staticmethod
        def get_context() -> _Context:
            return _Context()

    module = _revision_module()
    monkeypatch.setattr(module, "op", _RecordingOp)
    monkeypatch.setattr(module, "_index_is_invalid", lambda _name: False)
    monkeypatch.setattr(module, "_constraint_exists", lambda _table, _name: True)
    module.upgrade()
    assert not any("ADD CONSTRAINT" in sql for sql in executed)


def test_upgrade_drops_nothing_but_an_invalid_index_leftover() -> None:
    """Outside ``downgrade()``, the only DROP is the INVALID-index guard."""
    tree = ast.parse(_revision_source())
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade":
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module docstring is prose
        for literal in (
            n.value
            for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
        ):
            for match in re.finditer(r"\bDROP\s+(\w+)", literal, re.I):
                assert match.group(1).upper() == "INDEX", literal
                assert "DROP INDEX CONCURRENTLY IF EXISTS coord." in literal


# ---------------------------------------------------------------------------
# Live-schema helpers. The walks below skip without a reachable Postgres; a
# skip proves nothing.
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {name: (dtype, nullable) for name, dtype, nullable in rows}


def _ordered_columns(engine: Engine, table: str) -> list[str]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    """
                    SELECT column_name
                      FROM information_schema.columns
                     WHERE table_schema = 'coord' AND table_name = :table
                     ORDER BY ordinal_position
                    """
                ),
                {"table": table},
            ).scalars()
        )


# pg_get_indexdef / pg_get_constraintdef omit a schema that is on search_path,
# so every catalog read runs with ``search_path = pg_catalog``: ``coord.`` is
# then always rendered, whatever the connection's default path is.
_CATALOG_SEARCH_PATH = "SET LOCAL search_path = pg_catalog"


def _index_state(engine: Engine, name: str) -> tuple[bool, bool, str, str] | None:
    """``(indisvalid, indisunique, table, pg_get_indexdef)`` or None."""
    with engine.begin() as conn:
        conn.execute(text(_CATALOG_SEARCH_PATH))
        row = conn.execute(
            text(
                """
                SELECT i.indisvalid, i.indisunique, t.relname,
                       pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_class t ON t.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'coord' AND c.relname = :idx
                """
            ),
            {"idx": name},
        ).one_or_none()
    return None if row is None else (row[0], row[1], row[2], row[3])


def _table_constraints(engine: Engine, table: str) -> dict[str, str]:
    """Every constraint on ``coord.<table>``, name -> pg_get_constraintdef."""
    with engine.begin() as conn:
        conn.execute(text(_CATALOG_SEARCH_PATH))
        rows = conn.execute(
            text(
                """
                SELECT c.conname, pg_get_constraintdef(c.oid)
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord' AND t.relname = :table
                """
            ),
            {"table": table},
        ).all()
    return {row[0]: row[1] for row in rows}


def _table_indexes(engine: Engine, table: str) -> dict[str, str]:
    """Every index on ``coord.<table>``, name -> pg_get_indexdef."""
    with engine.begin() as conn:
        conn.execute(text(_CATALOG_SEARCH_PATH))
        rows = conn.execute(
            text(
                """
                SELECT c.relname, pg_get_indexdef(i.indexrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_class t ON t.oid = i.indrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord' AND t.relname = :table
                """
            ),
            {"table": table},
        ).all()
    return {row[0]: row[1] for row in rows}


def _constraint_def(engine: Engine, table: str, name: str) -> str | None:
    with engine.begin() as conn:
        conn.execute(text(_CATALOG_SEARCH_PATH))
        return conn.execute(
            text(
                """
                SELECT pg_get_constraintdef(c.oid)
                  FROM pg_constraint c
                  JOIN pg_class t ON t.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = t.relnamespace
                 WHERE n.nspname = 'coord' AND t.relname = :table
                   AND c.conname = :name
                """
            ),
            {"table": table, "name": name},
        ).scalar_one_or_none()


def _assert_revision_present(engine: Engine) -> None:
    for table, expected in _EXPECTED_NEW_TABLES.items():
        assert _columns(engine, table) == expected, (
            f"coord.{table}'s column set moved; it is the contract coord's "
            "writers are built against"
        )
    assert _columns(engine, "session_census_device") == _EXPECTED_DEVICE_COLUMNS
    for table, added in _ADDED_COLUMNS.items():
        columns = _columns(engine, table)
        for name, shape in added.items():
            assert columns.get(name) == shape, (table, name, columns.get(name))
    assert _ordered_columns(engine, "agent_questions")[
        -len(_QUESTION_TRAILING) :
    ] == list(_QUESTION_TRAILING), (
        "the question contract columns must be appended trailing, in order "
        "(append-only, for consistency with the existing column order)"
    )

    for name, (table, unique, definition) in _CONCURRENT_INDEXES.items():
        state = _index_state(engine, name)
        assert state is not None, f"coord.{name} is missing"
        valid, is_unique, on_table, indexdef = state
        assert valid, f"coord.{name} is INVALID"
        assert is_unique is unique, name
        assert on_table == table, name
        assert indexdef == definition, indexdef
    # Every constraint and every index of the six new tables, exactly: a
    # widened CHECK, a dropped UNIQUE or a moved partial predicate goes red.
    for table in _EXPECTED_NEW_TABLES:
        assert _table_constraints(engine, table) == _NEW_TABLE_CONSTRAINTS[table], (
            f"coord.{table}'s constraint set moved"
        )
        assert _table_indexes(engine, table) == _NEW_TABLE_INDEX_DEFS[table], (
            f"coord.{table}'s index set moved"
        )
    for name in _NEW_TABLE_INDEXES:
        state = _index_state(engine, name)
        assert state is not None and state[0], f"coord.{name} is missing or INVALID"

    assert _constraint_def(
        engine, "session_messages", "session_messages_delivered_evidence_check"
    ) == (
        "CHECK ((delivered_evidence = ANY "
        "(ARRAY['pty_inject'::text, 'transcript'::text]))) NOT VALID"
    )


def _assert_revision_absent(engine: Engine) -> None:
    for table in _EXPECTED_NEW_TABLES:
        assert not table_exists(engine, "coord", table), f"coord.{table} survived"
    assert _columns(engine, "session_census_device") == _CENSUS_01_DEVICE_COLUMNS
    for table, added in _ADDED_COLUMNS.items():
        residue = set(added) & set(_columns(engine, table))
        assert not residue, f"coord.{table} kept {sorted(residue)}"
    for name in (*_CONCURRENT_INDEXES, *_NEW_TABLE_INDEXES):
        assert _index_state(engine, name) is None, f"coord.{name} survived"
    assert (
        _constraint_def(
            engine, "session_messages", "session_messages_delivered_evidence_check"
        )
        is None
    )


def _exec(engine: Engine, sql: str, params: dict[str, Any] | None = None) -> Any:
    with engine.begin() as conn:
        return conn.execute(text(sql), params or {})


def _refused(
    engine: Engine,
    sql: str,
    params: dict[str, Any],
    sqlstate: str,
    constraint: str,
) -> None:
    """Assert the statement is refused with ``sqlstate`` by ``constraint``."""
    with pytest.raises(IntegrityError) as excinfo:
        _exec(engine, sql, params)
    orig = excinfo.value.orig
    assert getattr(orig, "pgcode", None) == sqlstate, orig
    assert constraint in str(orig), orig


# Fixed fixtures; every behaviour cell is scoped by the tenant created here.
_OBSERVED = datetime(2026, 11, 24, 9, 0, tzinfo=UTC)
_EXPIRES = datetime(2099, 1, 1, tzinfo=UTC)


def _seed_parent_rows(engine: Engine) -> dict[str, uuid.UUID]:
    """Rows that exist BEFORE the revision: they must survive up and down."""
    ids = {
        "tenant": uuid.uuid4(),
        "device": uuid.uuid4(),
        "session": uuid.uuid4(),
        "message": uuid.uuid4(),
        "question": uuid.uuid4(),
    }
    _exec(
        engine,
        """
        INSERT INTO coord.tenants (tenant_id, slug, display_name)
        VALUES (:tenant, :slug, 'lifecycle_01 test tenant')
        """,
        {"tenant": ids["tenant"], "slug": f"lifecycle01-{ids['tenant'].hex[:8]}"},
    )
    _exec(
        engine,
        """
        INSERT INTO coord.devices (device_id, name, hostname, tenant_id)
        VALUES (:device, 'lifecycle01', 'lifecycle01.test', :tenant)
        """,
        ids,
    )
    _exec(
        engine,
        """
        INSERT INTO coord.sessions (id, tenant_id, device_id, session_kind, intent)
        VALUES (:session, :tenant, :device, 'terminal_claude', '{}'::jsonb)
        """,
        ids,
    )
    _exec(
        engine,
        """
        INSERT INTO coord.session_messages
            (message_id, tenant_id, to_address, body, expires_at)
        VALUES (:message, :tenant, 'session-x', 'hello', :expires)
        """,
        {**ids, "expires": _EXPIRES},
    )
    _exec(
        engine,
        """
        INSERT INTO coord.agent_questions
            (question_id, agent_id, question, options, tenant_id)
        VALUES (:question, :device, 'pre-existing?', '[]'::jsonb, :tenant)
        """,
        ids,
    )
    _exec(
        engine,
        """
        INSERT INTO coord.session_census_device
            (device_id, tenant_id, observed_at, row_count, account_homes)
        VALUES (:device, :tenant, :observed, 0, 1)
        """,
        {**ids, "observed": _OBSERVED},
    )
    return ids


def _assert_parent_rows_survive(engine: Engine, ids: dict[str, uuid.UUID]) -> None:
    for table, column, key in (
        ("tenants", "tenant_id", "tenant"),
        ("devices", "device_id", "device"),
        ("sessions", "id", "session"),
        ("session_messages", "message_id", "message"),
        ("agent_questions", "question_id", "question"),
        ("session_census_device", "device_id", "device"),
    ):
        found = _exec(
            engine,
            f"SELECT EXISTS (SELECT 1 FROM coord.{table} WHERE {column} = :id)",
            {"id": ids[key]},
        ).scalar_one()
        assert found, f"a pre-existing coord.{table} row was lost"


# ---------------------------------------------------------------------------
# Behaviour cells
# ---------------------------------------------------------------------------

_INSERT_SESSION = """
    INSERT INTO coord.sessions
        (id, tenant_id, device_id, session_kind, intent, state, pane_id)
    VALUES (:id, :tenant, :device, 'terminal_claude', '{}'::jsonb, :state, :pane)
"""


def _session(
    engine: Engine, ids: dict[str, uuid.UUID], state: str, pane: str
) -> uuid.UUID:
    sid = uuid.uuid4()
    _exec(engine, _INSERT_SESSION, {**ids, "id": sid, "state": state, "pane": pane})
    return sid


def _cell_one_open_row_per_pane(engine: Engine, ids: dict[str, uuid.UUID]) -> None:
    # A STALE holder still holds its pane: a twin is refused.
    stale = _session(engine, ids, "stale", "pane-1")
    _refused(
        engine,
        _INSERT_SESSION,
        {**ids, "id": uuid.uuid4(), "state": "active", "pane": "pane-1"},
        "23505",
        "uq_sessions_active_pane",
    )
    # Partner: another pane on the same device is free.
    _session(engine, ids, "active", "pane-2")
    # An ACTIVE holder is refused a twin too.
    _refused(
        engine,
        _INSERT_SESSION,
        {**ids, "id": uuid.uuid4(), "state": "expected", "pane": "pane-2"},
        "23505",
        "uq_sessions_active_pane",
    )
    # A CLOSED holder frees the pane.
    _exec(
        engine,
        "UPDATE coord.sessions SET state = 'closed', closed_at = now() WHERE id = :id",
        {"id": stale},
    )
    _session(engine, ids, "active", "pane-1")
    # Not asserted here: rows with no pane are never constrained. Two NULL-pane
    # inserts would pass with or without the `pane_id IS NOT NULL` conjunct,
    # because NULLs are distinct in a unique index; the exact indexdef
    # equality in _assert_revision_present is what pins that conjunct.


_INSERT_QUESTION = """
    INSERT INTO coord.agent_questions
        (question_id, agent_id, question, options, tenant_id, dedupe_key, basis)
    VALUES (:qid, :device, 'typed?', '[]'::jsonb, :tenant, :key,
            '{"variant": "typed"}'::jsonb)
"""

# The producer's arbiter form; the index predicate must be inferable from it.
_INSERT_QUESTION_ARBITER = (
    _INSERT_QUESTION
    + """
    ON CONFLICT (tenant_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL AND responded_at IS NULL
            AND withdrawn_at IS NULL
    DO NOTHING
    RETURNING question_id
"""
)


def _cell_withdrawn_question_frees_its_key(
    engine: Engine, ids: dict[str, uuid.UUID]
) -> None:
    first = uuid.uuid4()
    _exec(engine, _INSERT_QUESTION, {**ids, "qid": first, "key": "typed:k1"})
    # An open question holds its key.
    _refused(
        engine,
        _INSERT_QUESTION,
        {**ids, "qid": uuid.uuid4(), "key": "typed:k1"},
        "23505",
        "uq_agent_questions_open_dedupe",
    )
    # The arbiter form resolves to DO NOTHING rather than raising.
    returned = _exec(
        engine,
        _INSERT_QUESTION_ARBITER,
        {**ids, "qid": uuid.uuid4(), "key": "typed:k1"},
    ).all()
    assert returned == [], "the arbiter inserted a duplicate open question"
    # Partner: a different key is free.
    _exec(engine, _INSERT_QUESTION, {**ids, "qid": uuid.uuid4(), "key": "typed:k2"})

    # WITHDRAWN (responded_at stays NULL) frees the key — the third conjunct.
    _exec(
        engine,
        """
        UPDATE coord.agent_questions
           SET withdrawn_at = now(), withdrawn_by = 'test'
         WHERE question_id = :qid
        """,
        {"qid": first},
    )
    second = uuid.uuid4()
    returned = _exec(
        engine, _INSERT_QUESTION_ARBITER, {**ids, "qid": second, "key": "typed:k1"}
    ).all()
    assert [r[0] for r in returned] == [second], (
        "a withdrawn question still holds its dedupe_key"
    )
    # ANSWERED frees it too.
    _exec(
        engine,
        "UPDATE coord.agent_questions SET responded_at = now() WHERE question_id = :q",
        {"q": second},
    )
    _exec(engine, _INSERT_QUESTION, {**ids, "qid": uuid.uuid4(), "key": "typed:k1"})


_INSERT_LEASE = """
    INSERT INTO coord.session_message_leases
        (tenant_id, session_id, message_id, holder, scope, expires_at)
    VALUES (:tenant, :session, :msg, :holder, :scope, :expires)
"""


def _cell_lease_scope_checks(engine: Engine, ids: dict[str, uuid.UUID]) -> None:
    base = {**ids, "expires": _EXPIRES}
    # Allowed: a message lease names its message; a session lease names none.
    _exec(
        engine,
        _INSERT_LEASE,
        {**base, "msg": ids["message"], "holder": "h1", "scope": "message"},
    )
    _exec(
        engine, _INSERT_LEASE, {**base, "msg": None, "holder": "h1", "scope": "session"}
    )
    # Refused: a message lease with no message.
    _refused(
        engine,
        _INSERT_LEASE,
        {**base, "msg": None, "holder": "h2", "scope": "message"},
        "23514",
        "session_message_leases_scope_message_check",
    )
    # Refused: a session lease that names a message.
    _refused(
        engine,
        _INSERT_LEASE,
        {**base, "msg": ids["message"], "holder": "h2", "scope": "session"},
        "23514",
        "session_message_leases_scope_message_check",
    )
    # Refused: a scope outside the vocabulary.
    _refused(
        engine,
        _INSERT_LEASE,
        {**base, "msg": None, "holder": "h2", "scope": "tenant"},
        "23514",
        "session_message_leases_scope_check",
    )
    # The renewal arbiters: one lease per holder within each scope.
    _refused(
        engine,
        _INSERT_LEASE,
        {**base, "msg": ids["message"], "holder": "h1", "scope": "message"},
        "23505",
        "uq_session_message_leases_message_holder",
    )
    _refused(
        engine,
        _INSERT_LEASE,
        {**base, "msg": None, "holder": "h1", "scope": "session"},
        "23505",
        "uq_session_message_leases_session_holder",
    )


_INSERT_ITEM = """
    INSERT INTO coord.work_items (tenant_id, kind, subject, first_seen_at, state)
    VALUES (:tenant, :kind, :subject, :seen, 'open')
"""


def _cell_work_item_identity(engine: Engine, ids: dict[str, uuid.UUID]) -> None:
    other_tenant = uuid.uuid4()
    _exec(
        engine,
        """
        INSERT INTO coord.tenants (tenant_id, slug, display_name)
        VALUES (:t, :slug, 'lifecycle_01 second tenant')
        """,
        {"t": other_tenant, "slug": f"lifecycle01-{other_tenant.hex[:8]}"},
    )
    subject = "owner/repo#7@abc123"
    row = {**ids, "kind": "ci_red", "subject": subject, "seen": _OBSERVED}
    _exec(engine, _INSERT_ITEM, row)
    _refused(engine, _INSERT_ITEM, row, "23505", "uq_work_items_tenant_kind_subject")
    # Partners: another kind, or another tenant, is a different identity.
    _exec(engine, _INSERT_ITEM, {**row, "kind": "pr_watch"})
    _exec(engine, _INSERT_ITEM, {**row, "tenant": other_tenant})
    # The kind vocabulary is closed.
    _refused(
        engine, _INSERT_ITEM, {**row, "kind": "bogus"}, "23514", "work_items_kind_check"
    )
    # An item's events cascade away with it.
    item_id = _exec(
        engine,
        """
        SELECT item_id FROM coord.work_items
         WHERE tenant_id = :tenant AND kind = 'ci_red' AND subject = :subject
        """,
        {**ids, "subject": subject},
    ).scalar_one()
    _exec(
        engine,
        """
        INSERT INTO coord.work_item_events (tenant_id, item_id, event_kind, actor)
        VALUES (:tenant, :item, 'opened', 'test')
        """,
        {**ids, "item": item_id},
    )
    _exec(engine, "DELETE FROM coord.work_items WHERE item_id = :i", {"i": item_id})
    remaining = _exec(
        engine,
        "SELECT count(*) FROM coord.work_item_events WHERE item_id = :i",
        {"i": item_id},
    ).scalar_one()
    assert remaining == 0, "work_item_events did not cascade with their item"


def _cell_delivered_evidence_check(engine: Engine, ids: dict[str, uuid.UUID]) -> None:
    update = """
        UPDATE coord.session_messages SET delivered_evidence = :ev
         WHERE message_id = :message
    """
    for allowed in ("pty_inject", "transcript", None):
        _exec(engine, update, {**ids, "ev": allowed})
    _refused(
        engine,
        update,
        {**ids, "ev": "guessed"},
        "23514",
        "session_messages_delivered_evidence_check",
    )


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no reachable Postgres at {url}; set QONTINUI_TEST_PG_DSN")
    return url


def test_up_behaviour_down_up() -> None:
    admin_url = _admin_url_or_skip()
    root = backend_root()
    with ephemeral_database(admin_url, "lifecycle01") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        _assert_revision_absent(engine)
        ids = _seed_parent_rows(engine)

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_revision_present(engine)
        _assert_parent_rows_survive(engine, ids)
        complete = _exec(
            engine,
            "SELECT complete FROM coord.session_census_device WHERE device_id = :d",
            {"d": ids["device"]},
        ).scalar_one()
        assert complete is False, "a pre-existing census row must read complete=false"

        _cell_one_open_row_per_pane(engine, ids)
        _cell_withdrawn_question_frees_its_key(engine, ids)
        _cell_lease_scope_checks(engine, ids)
        _cell_work_item_identity(engine, ids)
        _cell_delivered_evidence_check(engine, ids)

        run_alembic(root, db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_revision_absent(engine)
        _assert_parent_rows_survive(engine, ids)

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_revision_present(engine)
        # Idempotent: re-running the upgrade body over an applied schema (what a
        # retry after a failed CONCURRENTLY build does) is a no-op.
        run_alembic(root, db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_revision_present(engine)


def _create_concurrently_sql(name: str) -> str:
    """The revision's own CREATE for ``name``, minus ``IF NOT EXISTS``: the
    same definition, so a build of it fails exactly as the revision's would."""
    _, unique, definition = _CONCURRENT_INDEXES[name]
    # pg_get_indexdef text -> runnable DDL: insert CONCURRENTLY after INDEX.
    head = "CREATE UNIQUE INDEX " if unique else "CREATE INDEX "
    assert definition.startswith(head)
    return head + "CONCURRENTLY " + definition[len(head) :]


def _fail_build_on_duplicates(
    engine: Engine, ids: dict[str, uuid.UUID], name: str
) -> Callable[[], None]:
    """Two open rows on one key make a UNIQUE CONCURRENTLY build fail with a
    unique violation, leaving an INVALID index. Returns the cleanup that
    removes one duplicate so the rebuild can succeed."""
    if name == "uq_sessions_active_pane":
        duplicate = _session(engine, ids, "active", "pane-dup")
        _session(engine, ids, "stale", "pane-dup")
        table, column = "sessions", "id"
    else:
        duplicate = uuid.uuid4()
        _exec(engine, _INSERT_QUESTION, {**ids, "qid": duplicate, "key": "typed:dup"})
        _exec(
            engine, _INSERT_QUESTION, {**ids, "qid": uuid.uuid4(), "key": "typed:dup"}
        )
        table, column = "agent_questions", "question_id"
    autocommit = engine.execution_options(isolation_level="AUTOCOMMIT")
    with pytest.raises(IntegrityError), autocommit.connect() as conn:
        conn.execute(text(_create_concurrently_sql(name)))

    def _cleanup() -> None:
        _exec(
            engine,
            f"DELETE FROM coord.{table} WHERE {column} = :id",
            {"id": duplicate},
        )

    return _cleanup


def _fail_build_on_lock_timeout(
    engine: Engine, ids: dict[str, uuid.UUID], name: str
) -> Callable[[], None]:
    """A non-unique index cannot fail on duplicates, so its build is failed the
    other real way: CONCURRENTLY commits the INVALID catalog entry, then waits
    for every transaction holding a write lock on the table. With an open
    writer and a short ``lock_timeout`` that wait aborts, which leaves the
    INVALID index exactly as a killed build does."""
    autocommit = engine.execution_options(isolation_level="AUTOCOMMIT")
    with engine.connect() as writer:
        writer.execute(
            text(
                """
                UPDATE coord.agent_questions SET context = context
                 WHERE question_id = :q
                """
            ),
            {"q": ids["question"]},
        )  # the open transaction now holds ROW EXCLUSIVE on the table
        with pytest.raises(OperationalError) as excinfo, autocommit.connect() as conn:
            conn.execute(text("SET lock_timeout = '1s'"))
            try:
                conn.execute(text(_create_concurrently_sql(name)))
            finally:
                conn.execute(text("RESET lock_timeout"))
        assert getattr(excinfo.value.orig, "pgcode", None) == "55P03", excinfo.value
        writer.rollback()
    return lambda: None


_INVALID_LEFTOVER_CASES = {
    "uq_sessions_active_pane": _fail_build_on_duplicates,
    "uq_agent_questions_open_dedupe": _fail_build_on_duplicates,
    "idx_agent_questions_open_typed": _fail_build_on_lock_timeout,
}


@pytest.mark.parametrize("name", list(_INVALID_LEFTOVER_CASES))
def test_an_invalid_leftover_index_is_dropped_and_rebuilt(name: str) -> None:
    """A failed CONCURRENTLY build leaves an INVALID index that ``IF NOT
    EXISTS`` would keep. A re-run of the upgrade must drop and rebuild it,
    ending VALID with the stated definition. Each case drives a REAL failed
    build of the revision's own definition, not a catalog edit."""
    admin_url = _admin_url_or_skip()
    root = backend_root()
    _, unique, definition = _CONCURRENT_INDEXES[name]
    with ephemeral_database(admin_url, "lifecycle01inv") as (engine, db_url):
        run_alembic(root, db_url, "upgrade", _PARENT_REVISION_ID)
        ids = _seed_parent_rows(engine)
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        run_alembic(root, db_url, "stamp", _PARENT_REVISION_ID)
        _exec(engine, f"DROP INDEX coord.{name}")

        cleanup = _INVALID_LEFTOVER_CASES[name](engine, ids, name)
        state = _index_state(engine, name)
        assert state is not None and state[0] is False, (
            f"precondition: expected an INVALID leftover, got {state}"
        )
        cleanup()

        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        state = _index_state(engine, name)
        assert state is not None, f"coord.{name} is missing after the re-run"
        valid, is_unique, _, indexdef = state
        assert valid, "the re-run kept the INVALID leftover instead of rebuilding"
        assert is_unique is unique
        assert indexdef == definition, indexdef


def test_census_01_is_still_this_revisions_ancestor() -> None:
    """The ``_01`` device column set imported above is the right base only
    while ``coord_session_census_01`` precedes this revision in the chain."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(Config(str(backend_root() / "alembic.ini")))
    ancestors = {rev.revision for rev in script.iterate_revisions(_REVISION_ID, "base")}
    assert _CENSUS_01_REVISION_ID in ancestors
