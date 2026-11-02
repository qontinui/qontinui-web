"""Schema-contract and round-trip test for alembic ``merge_lane_ledger_01`` —
Phases 1-2 (schema half) of plan
``2026-10-16-no-read-says-which-term-bounds-a-merge-lane``.

``coord.leader_terms`` (one row per leadership term) and
``coord.merge_lane_intervals`` (the cause-attributed availability ledger) are a
contract with coord's writers: the columns, the CHECK vocabularies, the
conflict targets the writers' ``ON CONFLICT`` clauses name, and the indexes
their reads lean on. Each is pinned EXACTLY against the live catalog, so a
widened vocabulary, a renamed constraint or a dropped index fails here rather
than as a coord write error.

What is pinned:

1. The revision is wired to one real parent and drops nothing on upgrade.
2. Every column (type, nullability), every constraint
   (``pg_get_constraintdef``) and every index (``pg_indexes.indexdef``).
3. The constraints bite: an unknown ``reason`` / ``cause`` / ``source``, a
   half-closed term (``lost_at`` without ``reason`` or the reverse) and a
   duplicate conflict key are refused; the writers' ``ON CONFLICT … DO
   NOTHING`` is a no-op on a re-observation.
4. ``downgrade`` removes both tables and every index, and ``upgrade`` re-applies.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, migrated by the real alembic chain. Without a reachable Postgres the
DB-backed test skips and the source-level ones still run.
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.elements import TextClause

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    table_exists,
)

_REVISION_ID = "merge_lane_ledger_01"
_REVISION_FILENAME = "merge_lane_ledger_01_leader_terms_and_merge_lane_intervals.py"
_TERMS = "leader_terms"
_INTERVALS = "merge_lane_intervals"

_REASONS = ("lease_expired", "shutdown", "deploy", "unknown")
_SOURCES = ("observed", "backfill")
_CAUSES = (
    "ci_offline",
    "billing",
    "red_main",
    "leader_change",
    "rollout",
    "hung_candidate",
    "control_plane_deferral",
    "unknown",
)

# (information_schema data_type, is_nullable) per column.
_EXPECTED_TERM_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("bigint", "NO"),
    "scope": ("text", "NO"),
    "holder_id": ("uuid", "NO"),
    "fenced_token": ("bigint", "NO"),
    "build_id": ("text", "YES"),
    "acquired_at": ("timestamp with time zone", "NO"),
    "lost_at": ("timestamp with time zone", "YES"),
    "reason": ("text", "YES"),
    "source": ("text", "NO"),
    "created_at": ("timestamp with time zone", "NO"),
}

_EXPECTED_INTERVAL_COLUMNS: dict[str, tuple[str, str]] = {
    "id": ("bigint", "NO"),
    "tenant_id": ("uuid", "NO"),
    "repo": ("text", "NO"),
    "started_at": ("timestamp with time zone", "NO"),
    "ended_at": ("timestamp with time zone", "YES"),
    "cause": ("text", "NO"),
    "candidate_state": ("text", "YES"),
    "evidence_ref": ("jsonb", "NO"),
    "source": ("text", "NO"),
    "updated_at": ("timestamp with time zone", "NO"),
}


def _text_array(values: tuple[str, ...]) -> str:
    """How ``pg_get_constraintdef`` renders an ``IN (...)`` list."""
    return "ARRAY[" + ", ".join(f"'{value}'::text" for value in values) + "]"


def _in_check(column: str, values: tuple[str, ...]) -> str:
    return f"CHECK (({column} = ANY ({_text_array(values)})))"


_EXPECTED_TERM_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "leader_terms_pkey": ("p", "PRIMARY KEY (id)"),
    "uq_leader_terms_scope_token": ("u", "UNIQUE (scope, fenced_token)"),
    "ck_leader_terms_reason": (
        "c",
        f"CHECK (((reason IS NULL) OR (reason = ANY ({_text_array(_REASONS)}))))",
    ),
    "ck_leader_terms_source": ("c", _in_check("source", _SOURCES)),
    "ck_leader_terms_close_paired": (
        "c",
        "CHECK (((lost_at IS NULL) = (reason IS NULL)))",
    ),
}

_EXPECTED_INTERVAL_CONSTRAINTS: dict[str, tuple[str, str]] = {
    "merge_lane_intervals_pkey": ("p", "PRIMARY KEY (id)"),
    "uq_merge_lane_intervals_repo_started": ("u", "UNIQUE (repo, started_at)"),
    "ck_merge_lane_intervals_cause": ("c", _in_check("cause", _CAUSES)),
    "ck_merge_lane_intervals_source": ("c", _in_check("source", _SOURCES)),
}

_EXPECTED_TERM_INDEXES: dict[str, str] = {
    "leader_terms_pkey": (
        "CREATE UNIQUE INDEX leader_terms_pkey ON coord.leader_terms USING btree (id)"
    ),
    "uq_leader_terms_scope_token": (
        "CREATE UNIQUE INDEX uq_leader_terms_scope_token "
        "ON coord.leader_terms USING btree (scope, fenced_token)"
    ),
    "ix_leader_terms_scope_acquired": (
        "CREATE INDEX ix_leader_terms_scope_acquired "
        "ON coord.leader_terms USING btree (scope, acquired_at DESC)"
    ),
    "ix_leader_terms_open": (
        "CREATE INDEX ix_leader_terms_open "
        "ON coord.leader_terms USING btree (scope) WHERE (lost_at IS NULL)"
    ),
}

_EXPECTED_INTERVAL_INDEXES: dict[str, str] = {
    "merge_lane_intervals_pkey": (
        "CREATE UNIQUE INDEX merge_lane_intervals_pkey "
        "ON coord.merge_lane_intervals USING btree (id)"
    ),
    "uq_merge_lane_intervals_repo_started": (
        "CREATE UNIQUE INDEX uq_merge_lane_intervals_repo_started "
        "ON coord.merge_lane_intervals USING btree (repo, started_at)"
    ),
    "ix_merge_lane_intervals_tenant_repo_started": (
        "CREATE INDEX ix_merge_lane_intervals_tenant_repo_started "
        "ON coord.merge_lane_intervals USING btree "
        "(tenant_id, repo, started_at DESC)"
    ),
    "ix_merge_lane_intervals_open": (
        "CREATE INDEX ix_merge_lane_intervals_open "
        "ON coord.merge_lane_intervals USING btree (repo) WHERE (ended_at IS NULL)"
    ),
}

# The plan's term-open statement (coord ``leader::try_acquire``).
_OPEN_TERM = text(
    """
    INSERT INTO coord.leader_terms
        (scope, holder_id, fenced_token, build_id, acquired_at)
    VALUES (:scope, :holder, :token, :build, now())
    ON CONFLICT (scope, fenced_token) DO NOTHING
    """
)

_INSERT_TERM = text(
    """
    INSERT INTO coord.leader_terms
        (scope, holder_id, fenced_token, acquired_at, lost_at, reason, source)
    VALUES (:scope, :holder, :token, now(), :lost_at, :reason, :source)
    """
)

# The plan's interval write: leader-only, idempotent on (repo, started_at).
_UPSERT_INTERVAL = text(
    """
    INSERT INTO coord.merge_lane_intervals
        (tenant_id, repo, started_at, cause, candidate_state, source)
    VALUES (:tid, :repo, :started_at, :cause, :candidate_state, :source)
    ON CONFLICT (repo, started_at) DO UPDATE
        SET cause = EXCLUDED.cause, updated_at = now()
    """
)

_INSERT_INTERVAL = text(
    """
    INSERT INTO coord.merge_lane_intervals
        (tenant_id, repo, started_at, cause, source)
    VALUES (:tid, :repo, :started_at, :cause, :source)
    """
)

_TENANT = uuid.UUID("7c2e9a41-3b85-4d16-a0f7-58e1c4d9b263")

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set DATABASE_URL to a dev Postgres)",
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _function_sql(name: str) -> list[str]:
    tree = ast.parse(_revision_path().read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    out: list[str] = []
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
        ):
            out.extend(
                a.value
                for a in node.args
                if isinstance(a, ast.Constant) and isinstance(a.value, str)
            )
    return out


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


def _defaults(engine: Engine, table: str) -> dict[str, str | None]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, column_default
                  FROM information_schema.columns
                 WHERE table_schema = 'coord' AND table_name = :table
                """
            ),
            {"table": table},
        ).all()
    return {str(name): default for name, default in rows}


def _constraints(engine: Engine, table: str) -> dict[str, tuple[str, str]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, contype::text, pg_get_constraintdef(oid)
                  FROM pg_constraint
                 WHERE conrelid = to_regclass('coord.' || :table)
                   -- NOT NULL is pinned by ``_columns``.
                   AND contype <> 'n'
                """
            ),
            {"table": table},
        ).all()
    return {name: (contype, definition) for name, contype, definition in rows}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'coord' AND tablename = :table
                """
            ),
            {"table": table},
        ).all()
    return {str(name): str(definition) for name, definition in rows}


def _count_terms(engine: Engine, *, scope: str) -> int:
    """Terms in ``scope`` — a discriminator the test owns."""
    with engine.connect() as conn:
        return int(
            conn.execute(
                text("SELECT count(*) FROM coord.leader_terms WHERE scope = :scope"),
                {"scope": scope},
            ).scalar_one()
        )


def _count_intervals(engine: Engine, *, tenant_id: uuid.UUID) -> int:
    """Intervals for ``tenant_id`` — a discriminator the test owns."""
    with engine.connect() as conn:
        return int(
            conn.execute(
                text(
                    "SELECT count(*) FROM coord.merge_lane_intervals "
                    "WHERE tenant_id = :tid"
                ),
                {"tid": tenant_id},
            ).scalar_one()
        )


def _run(engine: Engine, statement: TextClause, params: dict[str, object]) -> int:
    with engine.begin() as conn:
        return int(conn.execute(statement, params).rowcount)


def _refused(engine: Engine, statement: TextClause, params: dict[str, object]) -> None:
    with pytest.raises(IntegrityError):
        _run(engine, statement, params)


def _assert_shape(engine: Engine) -> None:
    assert _columns(engine, _TERMS) == _EXPECTED_TERM_COLUMNS
    assert _columns(engine, _INTERVALS) == _EXPECTED_INTERVAL_COLUMNS
    assert _constraints(engine, _TERMS) == _EXPECTED_TERM_CONSTRAINTS
    assert _constraints(engine, _INTERVALS) == _EXPECTED_INTERVAL_CONSTRAINTS
    assert _indexes(engine, _TERMS) == _EXPECTED_TERM_INDEXES
    assert _indexes(engine, _INTERVALS) == _EXPECTED_INTERVAL_INDEXES

    term_defaults = _defaults(engine, _TERMS)
    assert "nextval(" in (term_defaults["id"] or "")
    assert term_defaults["source"] == "'observed'::text"
    assert term_defaults["created_at"] == "now()"
    interval_defaults = _defaults(engine, _INTERVALS)
    assert "nextval(" in (interval_defaults["id"] or "")
    assert interval_defaults["evidence_ref"] == "'{}'::jsonb"
    assert interval_defaults["source"] == "'observed'::text"
    assert interval_defaults["updated_at"] == "now()"


def _assert_absent(engine: Engine) -> None:
    for table in (_TERMS, _INTERVALS):
        assert not table_exists(engine, "coord", table), f"coord.{table} is present"
        assert _indexes(engine, table) == {}, f"coord.{table} left indexes behind"


def test_revision_is_wired_to_one_real_parent() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    parent = module.down_revision
    assert isinstance(parent, str) and parent
    doc = ast.get_docstring(ast.parse(_revision_path().read_text(encoding="utf-8")))
    assert f"Revision ID: {_REVISION_ID}" in (doc or "")
    assert f"Revises: {parent}" in (doc or "")
    assert module.branch_labels is None
    assert module.depends_on is None
    parent_files = list(
        (backend_root() / "alembic" / "versions").glob(f"{parent}_*.py")
    ) + list((backend_root() / "alembic" / "versions").glob(f"{parent}.py"))
    assert parent_files, f"no revision file for parent {parent!r}"


def test_upgrade_drops_nothing_and_is_coord_qualified() -> None:
    sql = _function_sql("upgrade")
    assert sql, "upgrade() executes no SQL"
    for stmt in sql:
        assert "DROP" not in stmt.upper(), stmt
        upper = stmt.upper()
        if "CREATE TABLE" in upper or "CREATE INDEX" in upper:
            assert "coord.leader_terms" in stmt or "coord.merge_lane_intervals" in stmt


def test_downgrade_drops_exactly_what_upgrade_creates() -> None:
    sql = " ".join(_function_sql("downgrade"))
    for table in (_TERMS, _INTERVALS):
        assert f"DROP TABLE IF EXISTS coord.{table}" in sql
    for name in (*_EXPECTED_TERM_INDEXES, *_EXPECTED_INTERVAL_INDEXES):
        if name.endswith("_pkey") or name.startswith("uq_"):
            continue  # owned by the table's constraints
        assert f"DROP INDEX IF EXISTS coord.{name}" in sql, name


@_needs_pg
def test_merge_lane_ledger_01_creates_both_tables_and_enforces_the_contract() -> None:
    with ephemeral_database(admin_database_url(), "mll01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        _assert_shape(engine)

        # --- leader_terms ------------------------------------------------
        holder_a, holder_b = uuid.uuid4(), uuid.uuid4()
        opened = {"scope": "merge", "holder": holder_a, "token": 7, "build": "abc"}
        assert _run(engine, _OPEN_TERM, opened) == 1
        # A replica re-observing its own lease opens nothing new.
        assert _run(engine, _OPEN_TERM, opened) == 0
        assert _count_terms(engine, scope="merge") == 1
        # The same token in another scope is a different term.
        assert _run(engine, _OPEN_TERM, {**opened, "scope": "other"}) == 1

        base = {
            "scope": "merge",
            "holder": holder_b,
            "token": 8,
            "lost_at": None,
            "reason": None,
            "source": "observed",
        }
        _refused(engine, _INSERT_TERM, {**base, "token": 7})  # duplicate term key
        for reason in _REASONS:
            assert (
                _run(
                    engine,
                    _INSERT_TERM,
                    {
                        **base,
                        "token": 100 + _REASONS.index(reason),
                        "lost_at": "2026-10-16T00:00:00Z",
                        "reason": reason,
                        "source": "backfill",
                    },
                )
                == 1
            )
        _refused(
            engine,
            _INSERT_TERM,
            {**base, "lost_at": "2026-10-16T00:00:00Z", "reason": "crashed"},
        )
        # Half-closed terms, either way round.
        _refused(engine, _INSERT_TERM, {**base, "lost_at": "2026-10-16T00:00:00Z"})
        _refused(engine, _INSERT_TERM, {**base, "reason": "shutdown"})
        _refused(engine, _INSERT_TERM, {**base, "source": "guessed"})
        assert _run(engine, _INSERT_TERM, base) == 1  # an open, observed term

        # --- merge_lane_intervals -----------------------------------------
        interval = {
            "tid": _TENANT,
            "repo": "qontinui/qontinui-runner",
            "started_at": "2026-10-14T00:00:00Z",
            "cause": "unknown",
            "candidate_state": "none",
            "source": "observed",
        }
        assert _run(engine, _UPSERT_INTERVAL, interval) == 1
        # Idempotent on (repo, started_at): the re-write updates, never adds.
        assert _run(engine, _UPSERT_INTERVAL, {**interval, "cause": "red_main"}) == 1
        assert _count_intervals(engine, tenant_id=_TENANT) == 1
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT cause, evidence_ref::text, ended_at "
                    "FROM coord.merge_lane_intervals WHERE tenant_id = :tid"
                ),
                {"tid": _TENANT},
            ).one()
        assert tuple(row) == ("red_main", "{}", None)

        plain = {k: v for k, v in interval.items() if k != "candidate_state"}
        _refused(engine, _INSERT_INTERVAL, plain)  # duplicate (repo, started_at)
        for i, cause in enumerate(_CAUSES):
            started = f"2026-10-15T{i:02d}:00:00Z"
            assert (
                _run(
                    engine,
                    _INSERT_INTERVAL,
                    {**plain, "started_at": started, "cause": cause},
                )
                == 1
            )
        _refused(
            engine,
            _INSERT_INTERVAL,
            {**plain, "started_at": "2026-10-16T00:00:00Z", "cause": "flaky"},
        )
        _refused(
            engine,
            _INSERT_INTERVAL,
            {**plain, "started_at": "2026-10-16T01:00:00Z", "source": "guessed"},
        )

        # --- round trip ------------------------------------------------------
        parent = _module().down_revision
        assert isinstance(parent, str)
        run_alembic(backend_root(), url, "downgrade", parent)
        _assert_absent(engine)
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        _assert_shape(engine)
        assert _count_terms(engine, scope="merge") == 0
        assert _count_intervals(engine, tenant_id=_TENANT) == 0
