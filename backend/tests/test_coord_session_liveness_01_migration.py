"""Pins for alembic revision ``coord_session_liveness_01``.

Plan ``2026-11-12-coord-closes-a-live-sessions-row-because-last-seen-is-not-a-heartbeat``
Phase 4, the EXPAND migration: ``coord.agent_sessions.closed_reason`` (with its
vocabulary CHECK and the ``unrecorded`` backfill), the restated ``last_seen``
comment, and ``coord.session_handles.status`` made NOT NULL with a ``'live'``
default and two CHECKs. What is pinned:

1. the chain is wired: ``down_revision`` names a parent defined in exactly one
   file and the docstring's ``Revises:`` line agrees (a land-time re-point that
   moves one but not the other fails here);
2. the reason vocabulary is exactly the plan's six (``stamp_reported_ended``
   was added at vet) and the column comment names every one;
3. the transaction shape the docstring promises: each table's DDL is its own
   lock-bounded group, every CHECK is added ``NOT VALID`` behind an existence
   test and validated inside an ``autocommit_block``, the ``unrecorded``
   backfill runs inside one, and ``SET DEFAULT`` precedes the status backfill,
   which precedes ``SET NOT NULL`` -- read from the source AND from the offline
   ``--sql`` render, where an autocommit block is a ``COMMIT;``/``BEGIN;`` pair;
4. nothing outside ``downgrade()`` carries a destructive token, so coord's
   alembic re-point (its E6 clause) can still move this revision;
5. no literal carries a ``:word`` bind parameter;
6. ``downgrade()`` removes exactly what ``upgrade()`` added;
7. live: the backfills follow the rule, the default applies to an INSERT that
   omits ``status``, every contradicting handle write and every reason outside
   the vocabulary is refused by the named constraint, each of the six reasons
   is admitted, the downgrade restores the catalog, an upgrade over a
   pre-existing contradicting row FAILS LOUDLY and converges once the row is
   repaired, and re-running every upgrade statement changes nothing.

Structural tests always run; the live one self-skips without a test Postgres
(``QONTINUI_TEST_PG=host:port`` or ``QONTINUI_TEST_PG_DSN``) and REPORTS the skip.
"""

from __future__ import annotations

import ast
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_session_liveness_01"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_PLAN_STEM = (
    "2026-11-12-coord-closes-a-live-sessions-row-because-last-seen-is-not-a-heartbeat"
)

#: The plan's closed_reason vocabulary, in the order the CHECK lists it.
_REASONS = (
    "handle_autoclose",
    "superseded_reap",
    "rebind_reap",
    "stamp_ended_insert",
    "stamp_reported_ended",
    "unrecorded",
)
_HANDLE_STATUSES = ("live", "stale", "closed")

_REASON_CHECK = "ck_agent_sessions_closed_reason"
_STATUS_CHECK = "ck_session_handles_status"
_PAIR_CHECK = "ck_session_handles_status_closed_at"
_CHECKS = {
    _REASON_CHECK: "agent_sessions",
    _STATUS_CHECK: "session_handles",
    _PAIR_CHECK: "session_handles",
}

_LOCK_BOUND = "SET LOCAL lock_timeout = '3s'"
_CHECK_VIOLATION = "23514"
_NOT_NULL_VIOLATION = "23502"

# An offline (--sql) render connects to nothing; the URL only names the dialect.
_OFFLINE_URL = "postgresql://nobody:nothing@127.0.0.1:1/coord_session_liveness_01"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port or "
        "QONTINUI_TEST_PG_DSN, so set one)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """This revision's own ``down_revision``, parsed at runtime.

    Never hardcoded: coord re-points ``down_revision`` at land time when a
    peer revision lands first, and a pinned constant would then walk back to a
    revision that is no longer this one's parent.
    """
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level def {name}()")


def _upgrade_source() -> str:
    """``upgrade()``'s own source text.

    The comment bodies are read from here, not from the whole file: the
    downgrade's ``COMMENT ON COLUMN ... last_seen IS NULL`` carries the same
    marker, and ``comment_body_from_source`` refuses a marker it finds twice.
    """
    segment = ast.get_source_segment(_revision_source(), _function("upgrade"))
    assert segment is not None
    return segment


def _execute_literals(fn: ast.FunctionDef) -> list[str]:
    """The SQL of every ``op.execute`` call in ``fn``; each must be one literal."""
    literals: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            assert len(node.args) == 1 and isinstance(node.args[0], ast.Constant), (
                f"op.execute at line {node.lineno} must take one static SQL literal"
            )
            assert isinstance(node.args[0].value, str)
            literals.append(node.args[0].value)
    return literals


def _collapsed(sql: str) -> str:
    return " ".join(sql.split())


#: Each upgrade statement, recognised by a pattern over its whitespace-collapsed
#: SQL, mapped to a name. The order of this table is irrelevant; the expected
#: SEQUENCE is ``_UPGRADE_SHAPE``.
_UPGRADE_KINDS: tuple[tuple[str, str], ...] = (
    ("lock bound", r"SET LOCAL lock_timeout = '3s'"),
    (
        "add closed_reason",
        r"ALTER TABLE coord\.agent_sessions ADD COLUMN IF NOT EXISTS closed_reason TEXT",
    ),
    (
        f"add {_REASON_CHECK} NOT VALID",
        rf"DO \$\$ .*conname = '{_REASON_CHECK}'.* ADD CONSTRAINT {_REASON_CHECK} "
        r"CHECK \(.*\) NOT VALID; END IF; END \$\$",
    ),
    (
        "comment closed_reason",
        r"COMMENT ON COLUMN coord\.agent_sessions\.closed_reason IS .*",
    ),
    ("comment last_seen", r"COMMENT ON COLUMN coord\.agent_sessions\.last_seen IS .*"),
    (
        "backfill unrecorded",
        r"UPDATE coord\.agent_sessions SET closed_reason = 'unrecorded' "
        r"WHERE closed_at IS NOT NULL AND closed_reason IS NULL",
    ),
    (
        f"validate {_REASON_CHECK}",
        rf"ALTER TABLE coord\.agent_sessions VALIDATE CONSTRAINT {_REASON_CHECK}",
    ),
    (
        "default live",
        r"ALTER TABLE coord\.session_handles ALTER COLUMN status SET DEFAULT 'live'",
    ),
    (
        "backfill status",
        r"UPDATE coord\.session_handles SET status = CASE WHEN closed_at IS NOT NULL "
        r"THEN 'closed' ELSE 'stale' END WHERE status IS NULL",
    ),
    (
        "status not null",
        r"ALTER TABLE coord\.session_handles ALTER COLUMN status SET NOT NULL",
    ),
    (
        f"add {_STATUS_CHECK} NOT VALID",
        rf"DO \$\$ .*conname = '{_STATUS_CHECK}'.* ADD CONSTRAINT {_STATUS_CHECK} "
        r"CHECK \(status IN \('live', 'stale', 'closed'\)\) NOT VALID; END IF; END \$\$",
    ),
    (
        f"add {_PAIR_CHECK} NOT VALID",
        rf"DO \$\$ .*conname = '{_PAIR_CHECK}'.* ADD CONSTRAINT {_PAIR_CHECK} "
        r"CHECK \(\(status = 'closed'\) = \(closed_at IS NOT NULL\)\) NOT VALID; "
        r"END IF; END \$\$",
    ),
    (
        f"validate {_STATUS_CHECK}",
        rf"ALTER TABLE coord\.session_handles VALIDATE CONSTRAINT {_STATUS_CHECK}",
    ),
    (
        f"validate {_PAIR_CHECK}",
        rf"ALTER TABLE coord\.session_handles VALIDATE CONSTRAINT {_PAIR_CHECK}",
    ),
)

#: (statement, inside an autocommit block?) in order -- the four steps the
#: revision docstring describes, one table at a time.
_UPGRADE_SHAPE: tuple[tuple[str, bool], ...] = (
    # Step 1: coord.agent_sessions DDL, one transactional group.
    ("lock bound", False),
    ("add closed_reason", False),
    (f"add {_REASON_CHECK} NOT VALID", False),
    ("comment closed_reason", False),
    ("comment last_seen", False),
    # Step 2: commit step 1, then backfill and validate under no table lock.
    ("backfill unrecorded", True),
    (f"validate {_REASON_CHECK}", True),
    # Step 3: coord.session_handles DDL, the default before the backfill before
    # NOT NULL.
    ("lock bound", False),
    ("default live", False),
    ("backfill status", False),
    ("status not null", False),
    (f"add {_STATUS_CHECK} NOT VALID", False),
    (f"add {_PAIR_CHECK} NOT VALID", False),
    # Step 4: commit step 3, then validate.
    (f"validate {_STATUS_CHECK}", True),
    (f"validate {_PAIR_CHECK}", True),
)


def _kind(sql: str) -> str:
    collapsed = _collapsed(sql)
    matches = [
        name for name, pattern in _UPGRADE_KINDS if re.fullmatch(pattern, collapsed)
    ]
    assert len(matches) == 1, f"unrecognised or ambiguous statement: {collapsed!r}"
    return matches[0]


# ---------------------------------------------------------------------------
# structural (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_defined_exactly_once() -> None:
    parent = _parent_revision_id()
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == parent
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']',
        re.M,
    )
    versions_dir = backend_root() / "alembic" / "versions"
    parent_definitions = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(parent_definitions) == 1, [f.name for f in parent_definitions]
    assert module.branch_labels is None
    assert module.depends_on is None
    src = _revision_source()
    assert f"Revision ID: {_REVISION_ID}" in src
    assert f"Revises: {parent}" in src, (
        "the docstring's Revises: line disagrees with down_revision -- a "
        "re-point must move both"
    )


def test_the_reason_check_admits_exactly_the_plans_vocabulary() -> None:
    adds = [
        sql
        for sql in _execute_literals(_function("upgrade"))
        if f"ADD CONSTRAINT {_REASON_CHECK}" in sql
    ]
    assert len(adds) == 1, adds
    found = re.search(
        r"closed_reason IS NULL OR closed_reason IN \(([^)]*)\)", _collapsed(adds[0])
    )
    assert found is not None, adds[0]
    listed = tuple(re.findall(r"'([a-z_]+)'", found.group(1)))
    assert listed == _REASONS


def test_the_comments_carry_the_contracts_they_restate() -> None:
    src = _upgrade_source()
    reason = comment_body_from_source(src, "coord.agent_sessions.closed_reason")
    for value in _REASONS:
        assert value in reason, f"the closed_reason comment never names {value}"
    assert "Meaningful only while closed_at is set" in reason
    last_seen = comment_body_from_source(src, "coord.agent_sessions.last_seen")
    assert last_seen.startswith("Latest positive evidence that this session is alive")
    assert "evidence of life, not a heartbeat" in last_seen
    assert "design decision D2" in last_seen
    for body in (reason, last_seen):
        assert _PLAN_STEM in body
        # No doubled apostrophe: the bodies stay plain literals.
        assert "'" not in body


def test_upgrade_runs_one_table_at_a_time_with_every_check_validated_late() -> None:
    calls = upgrade_execute_calls(_revision_path())
    assert all(call.sql is not None for call in calls), (
        "every op.execute in upgrade() must take one static literal"
    )
    shape = tuple((_kind(call.sql or ""), call.in_autocommit_block) for call in calls)
    assert shape == _UPGRADE_SHAPE


def test_offline_render_commits_each_table_before_backfill_and_validate() -> None:
    """Rendered offline, an ``autocommit_block`` is a bare ``COMMIT;`` before its
    statements and a ``BEGIN;`` after. So the framing must be exactly the
    batch's own ``BEGIN;`` ... ``COMMIT;`` around two blocks, and the statements
    must fall between the frames in the documented order.
    """
    parent = _parent_revision_id()
    sql = run_alembic(
        backend_root(), _OFFLINE_URL, "upgrade", f"{parent}:{_REVISION_ID}", "--sql"
    ).stdout
    lines = [line.strip() for line in sql.splitlines()]
    framing = [line for line in lines if line in ("BEGIN;", "COMMIT;")]
    assert framing == ["BEGIN;", "COMMIT;", "BEGIN;", "COMMIT;", "BEGIN;", "COMMIT;"]

    in_order = (
        _LOCK_BOUND + ";",
        "ALTER TABLE coord.agent_sessions ADD COLUMN IF NOT EXISTS closed_reason TEXT;",
        "COMMENT ON COLUMN coord.agent_sessions.last_seen IS",
        "COMMIT;",
        "UPDATE coord.agent_sessions SET closed_reason = 'unrecorded'",
        f"ALTER TABLE coord.agent_sessions VALIDATE CONSTRAINT {_REASON_CHECK};",
        "BEGIN;",
        _LOCK_BOUND + ";",
        "ALTER TABLE coord.session_handles ALTER COLUMN status SET DEFAULT 'live';",
        "UPDATE coord.session_handles SET status = CASE",
        "ALTER TABLE coord.session_handles ALTER COLUMN status SET NOT NULL;",
        f"ADD CONSTRAINT {_PAIR_CHECK}",
        "COMMIT;",
        f"ALTER TABLE coord.session_handles VALIDATE CONSTRAINT {_STATUS_CHECK};",
        f"ALTER TABLE coord.session_handles VALIDATE CONSTRAINT {_PAIR_CHECK};",
        "BEGIN;",
        f"UPDATE alembic_version SET version_num='{_REVISION_ID}'",
    )
    at = 0
    for marker in in_order:
        found = sql.find(marker, at)
        assert found >= 0, f"{marker!r} missing or out of order in:\n{sql}"
        at = found + len(marker)


def test_nothing_outside_downgrade_carries_a_destructive_token() -> None:
    """coord's alembic re-point refuses (E6) a revision with a destructive token
    in CODE outside ``downgrade()`` -- strings an ``op.execute`` is passed
    included, comment bodies too; only docstrings and ``#`` comments are prose.
    This is stricter than E6 (any ``drop`` / ``delete`` / ``truncate`` word), so
    a later edit cannot slip a token in by spelling it inside a comment body.
    """
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    docstrings = {
        id(holder.body[0].value)
        for holder in [tree, *ast.walk(tree)]
        if isinstance(holder, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef)
        and holder.body
        and isinstance(holder.body[0], ast.Expr)
        and isinstance(holder.body[0].value, ast.Constant)
        and isinstance(holder.body[0].value.value, str)
    }
    destructive = re.compile(r"\b(drop|delete|truncate)\b", re.IGNORECASE)
    offenders: list[str] = []
    for top in tree.body:
        if isinstance(top, ast.FunctionDef) and top.name == "downgrade":
            continue
        for node in ast.walk(top):
            if (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and id(node) not in docstrings
                and destructive.search(node.value)
            ):
                offenders.append(f"line {node.lineno}: {node.value!r}")
            if isinstance(node, ast.Attribute) and node.attr.startswith("drop_"):
                offenders.append(f"line {node.lineno}: .{node.attr}")
    assert offenders == [], offenders


def test_no_literal_carries_a_bind_parameter() -> None:
    """SQLAlchemy's own parser finds no ``:word`` parameter in any literal.

    ``op.execute(str)`` runs the string through ``text()``: a ``:word`` inside
    a comment body would compile to a bind parameter with no value and fail the
    upgrade in production. (``::regclass`` is a cast, not a parameter.)
    """
    for name in ("upgrade", "downgrade"):
        for sql in _execute_literals(_function(name)):
            assert text(sql).compile().params == {}, (name, sql)


def test_downgrade_removes_exactly_what_upgrade_added() -> None:
    expected = (
        _LOCK_BOUND,
        f"ALTER TABLE coord.session_handles DROP CONSTRAINT IF EXISTS {_PAIR_CHECK}",
        f"ALTER TABLE coord.session_handles DROP CONSTRAINT IF EXISTS {_STATUS_CHECK}",
        "ALTER TABLE coord.session_handles ALTER COLUMN status DROP NOT NULL",
        "ALTER TABLE coord.session_handles ALTER COLUMN status DROP DEFAULT",
        "COMMENT ON COLUMN coord.agent_sessions.last_seen IS NULL",
        f"ALTER TABLE coord.agent_sessions DROP CONSTRAINT IF EXISTS {_REASON_CHECK}",
        "ALTER TABLE coord.agent_sessions DROP COLUMN IF EXISTS closed_reason",
    )
    literals = tuple(
        _collapsed(sql) for sql in _execute_literals(_function("downgrade"))
    )
    assert literals == expected


# ---------------------------------------------------------------------------
# live (self-skip without a test Postgres)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Seed:
    tenant: uuid.UUID
    device: uuid.UUID
    open_session: uuid.UUID
    closed_session: uuid.UUID
    #: handle -> (status written at the parent, closed?, status after upgrade)
    handles: dict[str, tuple[str | None, bool, str]]


_CONSTRAINTS_SQL = text(
    """
    SELECT c.conname, c.convalidated, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
     WHERE c.conrelid IN ('coord.agent_sessions'::regclass,
                          'coord.session_handles'::regclass)
       AND c.conname IN ('ck_agent_sessions_closed_reason',
                         'ck_session_handles_status',
                         'ck_session_handles_status_closed_at')
    """
)


def _constraints(engine: Engine) -> dict[str, tuple[bool, str]]:
    """This revision's three CHECKs as ``name -> (validated, definition)``."""
    with engine.connect() as conn:
        rows = conn.execute(_CONSTRAINTS_SQL).all()
    return {name: (validated, definition) for name, validated, definition in rows}


def _assert_constraints_validated(engine: Engine) -> None:
    found = _constraints(engine)
    assert set(found) == set(_CHECKS), found
    for name, (validated, _definition) in found.items():
        assert validated, f"{name} is still NOT VALID"
    assert "closed_reason IS NULL" in found[_REASON_CHECK][1]
    for value in _REASONS:
        assert f"'{value}'" in found[_REASON_CHECK][1], value
    for value in _HANDLE_STATUSES:
        assert f"'{value}'" in found[_STATUS_CHECK][1], value
    assert "closed_at IS NOT NULL" in found[_PAIR_CHECK][1]


def _version(engine: Engine) -> object:
    return scalar(engine, "SELECT version_num FROM alembic_version")


def _status(engine: Engine, handle: str) -> object:
    return scalar(
        engine,
        "SELECT status FROM coord.session_handles WHERE handle = :handle",
        handle=handle,
    )


def _reason(engine: Engine, session_id: uuid.UUID) -> object:
    return scalar(
        engine,
        "SELECT closed_reason FROM coord.agent_sessions WHERE id = :id",
        id=session_id,
    )


def _insert_handle(
    conn: Connection,
    seed: _Seed,
    handle: str,
    status: str | None,
    closed: bool,
) -> None:
    """Insert a handle WITH an explicit ``status`` (``None`` writes SQL NULL)."""
    conn.execute(
        text(
            """
            INSERT INTO coord.session_handles
                (handle, claude_session_id, tenant_id, device_id, status, closed_at)
            VALUES (:handle, :csid, :tenant, :device, :status,
                    CASE WHEN :closed THEN now() END)
            """
        ),
        {
            "handle": handle,
            "csid": f"csid-{handle}",
            "tenant": seed.tenant,
            "device": seed.device,
            "status": status,
            "closed": closed,
        },
    )


def _insert_handle_omitting_status(
    conn: Connection, seed: _Seed, handle: str, closed: bool
) -> None:
    """The coord test-fixture shape: no ``status`` column in the INSERT at all."""
    conn.execute(
        text(
            """
            INSERT INTO coord.session_handles
                (handle, claude_session_id, tenant_id, device_id, closed_at)
            VALUES (:handle, :csid, :tenant, :device,
                    CASE WHEN :closed THEN now() END)
            """
        ),
        {
            "handle": handle,
            "csid": f"csid-{handle}",
            "tenant": seed.tenant,
            "device": seed.device,
            "closed": closed,
        },
    )


def _seed_at_parent(engine: Engine) -> _Seed:
    tag = uuid.uuid4().hex[:10]
    seed = _Seed(
        tenant=uuid.uuid4(),
        device=uuid.uuid4(),
        open_session=uuid.uuid4(),
        closed_session=uuid.uuid4(),
        handles={
            f"fsh_null_closed_{tag}": (None, True, "closed"),
            f"fsh_null_open_{tag}": (None, False, "stale"),
            f"fsh_live_{tag}": ("live", False, "live"),
            f"fsh_stale_{tag}": ("stale", False, "stale"),
            f"fsh_closed_{tag}": ("closed", True, "closed"),
        },
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:tenant, :slug, 'session liveness test tenant')"
            ),
            {"tenant": seed.tenant, "slug": f"sesslive-{tag}"},
        )
        conn.execute(
            text(
                "INSERT INTO coord.devices (device_id, tenant_id, name, hostname) "
                "VALUES (:device, :tenant, 'sesslive-device', 'sesslive-host')"
            ),
            {"device": seed.device, "tenant": seed.tenant},
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.agent_sessions (id, device_id, closed_at)
                VALUES (:open, :device, NULL), (:closed, :device, now())
                """
            ),
            {
                "open": seed.open_session,
                "closed": seed.closed_session,
                "device": seed.device,
            },
        )
        for handle, (status, closed, _after) in seed.handles.items():
            _insert_handle(conn, seed, handle, status, closed)
    return seed


def _refusal(engine: Engine, statement: str, params: dict[str, object]) -> object:
    """Run ``statement`` expecting an IntegrityError; return the psycopg2 error."""
    with pytest.raises(IntegrityError) as excinfo, engine.begin() as conn:
        conn.execute(text(statement), params)
    return excinfo.value.orig


def _assert_refused_by(error: object, pgcode: str, constraint: str | None) -> None:
    assert getattr(error, "pgcode", None) == pgcode, error
    if constraint is not None:
        diag = getattr(error, "diag", None)
        assert getattr(diag, "constraint_name", None) == constraint, error


_INSERT_HANDLE_SQL = """
    INSERT INTO coord.session_handles
        (handle, claude_session_id, tenant_id, device_id, status, closed_at)
    VALUES (:handle, :csid, :tenant, :device, :status,
            CASE WHEN :closed THEN now() END)
"""


def _assert_handle_writes_are_constrained(engine: Engine, seed: _Seed) -> None:
    def params(status: str | None, closed: bool) -> dict[str, object]:
        handle = f"fsh_refused_{uuid.uuid4().hex[:10]}"
        return {
            "handle": handle,
            "csid": f"csid-{handle}",
            "tenant": seed.tenant,
            "device": seed.device,
            "status": status,
            "closed": closed,
        }

    # A status that contradicts the handle's own close, in every direction.
    for status, closed in (("closed", False), ("live", True), ("stale", True)):
        _assert_refused_by(
            _refusal(engine, _INSERT_HANDLE_SQL, params(status, closed)),
            _CHECK_VIOLATION,
            _PAIR_CHECK,
        )
    # A status outside the vocabulary, and an explicit NULL.
    _assert_refused_by(
        _refusal(engine, _INSERT_HANDLE_SQL, params("zombie", False)),
        _CHECK_VIOLATION,
        _STATUS_CHECK,
    )
    _assert_refused_by(
        _refusal(engine, _INSERT_HANDLE_SQL, params(None, False)),
        _NOT_NULL_VIOLATION,
        None,
    )
    # A writer that sets one half of a close and forgets the other.
    live_handle = next(h for h, (s, _c, _a) in seed.handles.items() if s == "live")
    _assert_refused_by(
        _refusal(
            engine,
            "UPDATE coord.session_handles SET closed_at = now() WHERE handle = :h",
            {"h": live_handle},
        ),
        _CHECK_VIOLATION,
        _PAIR_CHECK,
    )
    # The default makes an open status-less INSERT legal, never a closed one.
    _assert_refused_by(
        _refusal(
            engine,
            """
            INSERT INTO coord.session_handles
                (handle, claude_session_id, tenant_id, device_id, closed_at)
            VALUES (:handle, :csid, :tenant, :device, now())
            """,
            {
                "handle": "fsh_closed_without_status",
                "csid": "csid-closed-without-status",
                "tenant": seed.tenant,
                "device": seed.device,
            },
        ),
        _CHECK_VIOLATION,
        _PAIR_CHECK,
    )


def _assert_reasons_are_constrained(engine: Engine, seed: _Seed) -> None:
    for value in _REASONS:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.agent_sessions SET closed_reason = :reason "
                    "WHERE id = :id"
                ),
                {"reason": value, "id": seed.closed_session},
            )
        assert _reason(engine, seed.closed_session) == value
    _assert_refused_by(
        _refusal(
            engine,
            "UPDATE coord.agent_sessions SET closed_reason = :reason WHERE id = :id",
            {"reason": "process_exited", "id": seed.closed_session},
        ),
        _CHECK_VIOLATION,
        _REASON_CHECK,
    )


def _catalog(engine: Engine) -> tuple[object, ...]:
    """Everything this revision shapes, for an unchanged-by-a-re-run comparison."""
    return (
        column_info(engine, "agent_sessions", "closed_reason"),
        column_info(engine, "session_handles", "status"),
        column_comment(engine, "agent_sessions", "closed_reason"),
        column_comment(engine, "agent_sessions", "last_seen"),
        sorted(_constraints(engine).items()),
    )


@_needs_pg
def test_live_backfills_constraints_refusal_and_up_down_up() -> None:
    root = backend_root()
    parent = _parent_revision_id()
    src = _upgrade_source()
    with ephemeral_database(admin_database_url(), "sesslive01") as (engine, db_url):
        # 1. The parent: no closed_reason, a free-form nullable status, and no
        #    comment on last_seen.
        run_alembic(root, db_url, "upgrade", parent)
        assert column_info(engine, "agent_sessions", "closed_reason") is None
        assert column_info(engine, "session_handles", "status") == ("text", "YES", None)
        assert column_comment(engine, "agent_sessions", "last_seen") is None
        seed = _seed_at_parent(engine)

        # 2. Apply.
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        assert _version(engine) == _REVISION_ID
        assert column_info(engine, "agent_sessions", "closed_reason") == (
            "text",
            "YES",
            None,
        )
        assert column_comment(
            engine, "agent_sessions", "closed_reason"
        ) == comment_body_from_source(src, "coord.agent_sessions.closed_reason")
        assert column_comment(
            engine, "agent_sessions", "last_seen"
        ) == comment_body_from_source(src, "coord.agent_sessions.last_seen")
        # A row closed before the revision is backfilled; an open one is not.
        assert _reason(engine, seed.closed_session) == "unrecorded"
        assert _reason(engine, seed.open_session) is None
        # The status rule: a NULL becomes closed iff closed_at is set, else
        # stale; a status already written is kept.
        for handle, (_before, _closed, after) in seed.handles.items():
            assert _status(engine, handle) == after, handle
        assert column_info(engine, "session_handles", "status") == (
            "text",
            "NO",
            "'live'::text",
        )
        _assert_constraints_validated(engine)
        # An INSERT that omits status -- coord's fixture shape -- reads 'live'.
        with engine.begin() as conn:
            _insert_handle_omitting_status(conn, seed, "fsh_no_status", closed=False)
        assert _status(engine, "fsh_no_status") == "live"
        _assert_handle_writes_are_constrained(engine, seed)
        _assert_reasons_are_constrained(engine, seed)

        # 3. Downgrade: the catalog returns to the parent's; the status
        #    backfill is data and stays.
        run_alembic(root, db_url, "downgrade", parent)
        assert _version(engine) == parent
        assert column_info(engine, "agent_sessions", "closed_reason") is None
        assert column_info(engine, "session_handles", "status") == ("text", "YES", None)
        assert column_comment(engine, "agent_sessions", "last_seen") is None
        assert set(_constraints(engine)) == set()
        null_open = next(
            h for h, (s, c, _a) in seed.handles.items() if s is None and not c
        )
        assert _status(engine, null_open) == "stale"

        # 4. A row that contradicts its own close, written before the revision,
        #    makes the upgrade FAIL LOUDLY, naming the constraint; the steps
        #    before the refusing VALIDATE stay committed, the stamp does not.
        contradicting = "fsh_contradicting"
        with engine.begin() as conn:
            _insert_handle(conn, seed, contradicting, "live", closed=True)
        failed = run_alembic(
            root, db_url, "upgrade", _REVISION_ID, expect_success=False
        )
        assert _PAIR_CHECK in failed.stderr, failed.stderr
        assert _version(engine) == parent
        left = _constraints(engine)
        assert left[_REASON_CHECK][0] and left[_STATUS_CHECK][0], left
        assert not left[_PAIR_CHECK][0], "the refused CHECK must be left NOT VALID"
        # ... and the NOT VALID CHECK already refuses a new contradicting write.
        _assert_refused_by(
            _refusal(
                engine,
                _INSERT_HANDLE_SQL,
                {
                    "handle": "fsh_after_refusal",
                    "csid": "csid-after-refusal",
                    "tenant": seed.tenant,
                    "device": seed.device,
                    "status": "closed",
                    "closed": False,
                },
            ),
            _CHECK_VIOLATION,
            _PAIR_CHECK,
        )

        # 5. Repair the named row and re-run: the upgrade converges.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.session_handles SET status = 'closed' "
                    "WHERE handle = :handle"
                ),
                {"handle": contradicting},
            )
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        assert _version(engine) == _REVISION_ID
        _assert_constraints_validated(engine)
        assert _reason(engine, seed.closed_session) == "unrecorded"

        # 6. Every upgrade statement re-run on top changes nothing, and the
        #    backfill never overwrites a reason a writer recorded.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.agent_sessions SET closed_reason = 'rebind_reap' "
                    "WHERE id = :id"
                ),
                {"id": seed.closed_session},
            )
        before = _catalog(engine)
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            for call in upgrade_execute_calls(_revision_path()):
                if call.sql is not None and call.sql != _LOCK_BOUND:
                    conn.execute(text(call.sql))
        assert _catalog(engine) == before
        assert _reason(engine, seed.closed_session) == "rebind_reap"
