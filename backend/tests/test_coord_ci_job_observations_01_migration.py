"""Structural and round-trip test for alembic ``coord_ci_job_observations_01``.

Plan ``2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it``
Phase 1a.

``coord.ci_job_observations`` and ``coord.ci_runs.run_attempt`` are contracts
coord's ``ci_job_sampler`` codes against: it UPSERTs on ``(repo, job_id)``,
selects completed runs by ``COALESCE(run_attempt, 1)``, and the detector scans
``ix_ci_job_obs_runner_completed``. The properties pinned here are the ones
that would break those readers at runtime while every migration gate stays
green.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.``-qualified, the only DROPs are in
   ``downgrade()``, and the column-drop guard reads the upgrade path as
   dropping nothing.
3. Both directions are pure ``op.execute`` with static SQL, which is what the
   coord merge-train classifier can read and what offline ``--sql`` mode needs.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability and defaults of the new table, its key
   ``(repo, job_id)``, both indexes with the partial predicate on
   ``self_hosted``, and the nullable, default-less ``coord.ci_runs.run_attempt``.
5. The key rejects a duplicate, NOT NULL names its column, the defaults land,
   and a hosted row stays out of the partial index.
6. The table and column comments land as the source writes them.
7. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    column_info,
    comment_body_from_source,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_ci_job_observations_01"
_REVISION_FILENAME = "coord_ci_job_observations_01_create.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change. Whoever re-points the revision
# onto a moved head updates this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "coord_ci_pool_baselines_01"

_SCHEMA = "coord"
_TABLE = "ci_job_observations"
_RUNS_TABLE = "ci_runs"
_RUNS_COLUMN = "run_attempt"
_HOT_INDEX = "ix_ci_job_obs_runner_completed"
_KEY_INDEX = "ix_ci_job_obs_key"

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("repo", "text", False, None),
    ("job_id", "bigint", False, None),
    ("run_id", "bigint", False, None),
    ("run_attempt", "integer", False, "1"),
    ("workflow_name", "text", False, None),
    ("job_name", "text", False, None),
    ("head_sha", "text", True, None),
    ("head_branch", "text", True, None),
    ("runner_name", "text", True, None),
    ("runner_labels", "ARRAY", False, "'{}'"),
    ("self_hosted", "boolean", False, None),
    ("conclusion", "text", True, None),
    ("started_at", "timestamp with time zone", True, None),
    ("completed_at", "timestamp with time zone", True, None),
    ("duration_secs", "integer", True, None),
    ("step_count", "integer", True, None),
    ("failed_step_count", "integer", True, None),
    ("outcome", "text", False, None),
    ("duration_band", "text", True, None),
    ("observed_at", "timestamp with time zone", False, "now()"),
)

_COMMENTED_COLUMNS = (
    "job_id",
    "run_attempt",
    "runner_name",
    "runner_labels",
    "self_hosted",
    "step_count",
    "failed_step_count",
    "outcome",
    "duration_band",
)

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


# ---------------------------------------------------------------------------
# source helpers
# ---------------------------------------------------------------------------


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _revision_module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string constant inside ``fn`` except its own docstring."""
    doc = ast.get_docstring(fn, clean=False)
    return [
        node.value
        for node in ast.walk(fn)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value != doc
    ]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID, (
        f"down_revision is {module.down_revision!r}; if the revision was "
        "re-pointed onto a moved head, _PARENT_REVISION_ID was not updated with it"
    )
    parent = _PARENT_REVISION_ID

    versions_dir = backend_root() / "alembic" / "versions"
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    siblings = [
        f
        for f in versions_dir.glob("*.py")
        if f.name != _REVISION_FILENAME
        and pattern.search(f.read_text(encoding="utf-8"))
    ]
    assert len(siblings) == 1, (
        f"down_revision {parent!r} must name exactly one existing sibling "
        f"(found {[f.name for f in siblings]})"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_identifiers() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROPs are in downgrade()
# ---------------------------------------------------------------------------

# Table-shaped statements name their object right after the verb; index
# statements name it after ON (create) or after the verb (drop).
_TABLE_OBJECT_RE = re.compile(
    r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
    r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)
_INDEX_OBJECT_RE = re.compile(
    r"(?:CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\w+\s+ON"
    r"|DROP\s+INDEX(?:\s+IF\s+EXISTS)?)\s+([A-Za-z_.\"]+)",
    re.I,
)

_OWNED_TABLE_OBJECTS = (
    f"{_SCHEMA}.{_TABLE}",
    f"{_SCHEMA}.{_RUNS_TABLE}.{_RUNS_COLUMN}",
    f"{_SCHEMA}.{_RUNS_TABLE}",
)
_OWNED_INDEX_OBJECTS = (
    f"{_SCHEMA}.{_TABLE}",
    f"{_SCHEMA}.{_HOT_INDEX}",
    f"{_SCHEMA}.{_KEY_INDEX}",
)


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _TABLE_OBJECT_RE.findall(sql):
                # A column comment names the table's column, so the object may
                # extend an owned name by one dotted segment, never more.
                assert any(
                    obj == owned or obj.startswith(owned + ".")
                    for owned in _OWNED_TABLE_OBJECTS
                ), f"{fn_name}(): object {obj!r} is not one of {_OWNED_TABLE_OBJECTS}"
            for obj in _INDEX_OBJECT_RE.findall(sql):
                assert obj in _OWNED_INDEX_OBJECTS, (
                    f"{fn_name}(): index object {obj!r} is not one of "
                    f"{_OWNED_INDEX_OBJECTS}"
                )


def test_the_only_ci_runs_change_is_the_one_nullable_column() -> None:
    """The widening of coord.ci_runs is exactly one ADD COLUMN, nullable, no default."""
    alters = [
        " ".join(sql.split())
        for sql in _sql_literals(_function(_tree(), "upgrade"))
        if re.search(rf"ALTER\s+TABLE\s+{_SCHEMA}\.{_RUNS_TABLE}\b", sql, re.I)
    ]
    assert alters == [
        f"ALTER TABLE {_SCHEMA}.{_RUNS_TABLE} ADD COLUMN IF NOT EXISTS "
        f"{_RUNS_COLUMN} INTEGER"
    ], alters


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down, re.I)
    assert re.search(
        rf"ALTER\s+TABLE\s+{_SCHEMA}\.{_RUNS_TABLE}\s+DROP\s+COLUMN\s+IF\s+EXISTS"
        rf"\s+{_RUNS_COLUMN}\b",
        down,
        re.I,
    )
    for index in (_HOT_INDEX, _KEY_INDEX):
        assert re.search(
            rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{index}\b", down, re.I
        ), f"downgrade() must drop {index}"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    tree = _tree()
    calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    assert {c.func.attr for c in calls} == {"execute"}  # type: ignore[attr-defined]
    for call in calls:
        # coord merge-train classifier: an execute with no static string literal
        # is rejected as dynamic SQL it cannot inspect.
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


def test_upgrade_ddl_is_idempotent_by_construction() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    assert re.search(rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}", up)
    for index in (_HOT_INDEX, _KEY_INDEX):
        assert re.search(rf"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{index}\b", up), index
    assert re.search(rf"ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+{_RUNS_COLUMN}\b", up)
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"
    # The vocabulary columns are deliberately unconstrained (the
    # coord.notifications.kind choice): a CHECK here would make a new outcome
    # class a migration instead of a Rust change.
    assert not re.search(r"\bCHECK\s*\(", up, re.I), (
        "outcome/duration_band carry no CHECK"
    )


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_COMPLETED = datetime(2026, 9, 14, 7, 0, tzinfo=UTC)


def _columns(engine: Engine, table: str) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": table},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


def _insert(engine: Engine, **overrides: object) -> None:
    params: dict[str, object] = {
        "repo": "qontinui/qontinui-coord",
        "job_id": 103990922077,
        "run_id": 18987654321,
        "workflow_name": "ci",
        "job_name": "rust-ci",
        "head_sha": "7d14cb9b",
        "runner_name": "spaceship-wsl",
        "runner_labels": ["self-hosted", "Linux", "X64", "qontinui", "spaceship"],
        "self_hosted": True,
        "conclusion": "failure",
        "completed_at": _COMPLETED,
        "duration_secs": 600,
        "step_count": 16,
        "failed_step_count": 0,
        "outcome": "infra_shaped",
        "duration_band": "reaper_plateau",
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds})"),
            params,
        )


def _row_count(engine: Engine) -> int:
    value = scalar(engine, f"SELECT count(*) FROM coord.{_TABLE}")
    assert isinstance(value, int)
    return value


def _index_predicate(engine: Engine, index: str) -> str | None:
    with engine.connect() as conn:
        value = conn.execute(
            text(
                """
                SELECT pg_get_expr(i.indpred, i.indrelid)
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = :schema AND c.relname = :index
                """
            ),
            {"schema": _SCHEMA, "index": index},
        ).scalar_one()
    assert value is None or isinstance(value, str)
    return value


@_needs_pg
def test_table_shape_key_indexes_and_the_ci_runs_column() -> None:
    with ephemeral_database(admin_database_url(), "cjo01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine, _TABLE)
        for name, data_type, nullable, default in _COLUMNS:
            assert name in got, f"coord.{_TABLE} is missing {name}"
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: unexpected default {got_default}"
            else:
                assert got_default is not None and default in got_default, (
                    f"{name}: default {got_default!r} lacks {default!r}"
                )
        assert set(got) == {c[0] for c in _COLUMNS}, f"unexpected columns {set(got)}"

        pk = scalar(
            engine,
            f"""
            SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM pg_constraint c
              CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a
                ON a.attrelid = c.conrelid AND a.attnum = k.attnum
             WHERE c.conrelid = 'coord.{_TABLE}'::regclass
               AND c.contype = 'p'
            """,
        )
        assert pk == "repo,job_id"

        assert index_exists(engine, _HOT_INDEX)
        assert _index_predicate(engine, _HOT_INDEX) == "self_hosted"
        assert index_exists(engine, _KEY_INDEX)
        assert _index_predicate(engine, _KEY_INDEX) is None

        # coord.ci_runs.run_attempt: nullable INTEGER, no default, so the ALTER
        # rewrote no row and a pre-existing row reads NULL (= attempt 1).
        assert column_info(engine, _RUNS_TABLE, _RUNS_COLUMN) == (
            "integer",
            "YES",
            None,
        )


@_needs_pg
def test_key_not_null_defaults_and_the_partial_index_behave() -> None:
    with ephemeral_database(admin_database_url(), "cjo01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _insert(engine)
        # The same job id in another repo is a different job.
        _insert(engine, repo="qontinui/qontinui-web")
        # A hosted job, and a job whose runner is unknown.
        _insert(
            engine,
            job_id=103973196194,
            runner_name=None,
            runner_labels=["ubuntu-latest"],
            self_hosted=False,
            conclusion="success",
            outcome="pass",
            duration_band=None,
            step_count=None,
            failed_step_count=None,
        )

        with pytest.raises(sqlalchemy.exc.IntegrityError) as dup:
            _insert(engine)
        assert dup.value.orig.diag.constraint_name == f"{_TABLE}_pkey"  # type: ignore[union-attr]

        # A NOT NULL violation carries no constraint name, so pin it by SQLSTATE
        # 23502 (not_null_violation) and the column the database names.
        for column in ("outcome", "self_hosted", "workflow_name"):
            with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
                _insert(engine, job_id=1, **{column: None})
            orig = excinfo.value.orig
            assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
            assert orig.diag.column_name == column  # type: ignore[union-attr]

        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    f"""
                    SELECT run_attempt, runner_labels, observed_at IS NOT NULL
                      FROM coord.{_TABLE}
                     WHERE job_id = 103990922077 AND repo = 'qontinui/qontinui-coord'
                    """
                )
            ).one()
        assert defaults[0] == 1
        assert list(defaults[1]) == [
            "self-hosted",
            "Linux",
            "X64",
            "qontinui",
            "spaceship",
        ]
        assert defaults[2] is True

        # The partial index covers the two self-hosted rows and not the hosted one.
        with engine.connect() as conn:
            conn.execute(text("SET enable_seqscan = off"))
            plan = "\n".join(
                r[0]
                for r in conn.execute(
                    text(
                        f"""
                        EXPLAIN SELECT runner_name, completed_at
                          FROM coord.{_TABLE}
                         WHERE self_hosted AND runner_name = 'spaceship-wsl'
                         ORDER BY completed_at
                        """
                    )
                ).all()
            )
        assert _HOT_INDEX in plan, plan
        assert _row_count(engine) == 3


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "cjo01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        assert "ci_job_sampler" in str(table_comment), (
            "the table comment names its owner"
        )
        for column in _COMMENTED_COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {column} differs from the revision source"

        runs_comment = column_comment(engine, _RUNS_TABLE, _RUNS_COLUMN)
        assert runs_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_RUNS_TABLE}.{_RUNS_COLUMN}"
        )
        assert "ci_runs_watcher" in str(runs_comment), (
            "the column comment names its writer"
        )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "cjo01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _HOT_INDEX)
        assert column_info(engine, _RUNS_TABLE, _RUNS_COLUMN) == (
            "integer",
            "YES",
            None,
        )
        assert _row_count(engine) == 1, "the re-run must not disturb existing rows"


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "cjo01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _HOT_INDEX)
        assert not index_exists(engine, _KEY_INDEX)
        assert column_info(engine, _RUNS_TABLE, _RUNS_COLUMN) is None
        assert table_exists(engine, _SCHEMA, _RUNS_TABLE), (
            "downgrade must not touch ci_runs itself"
        )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert column_info(engine, _RUNS_TABLE, _RUNS_COLUMN) == (
            "integer",
            "YES",
            None,
        )
        assert _row_count(engine) == 0, "the table comes back empty, not restored"
