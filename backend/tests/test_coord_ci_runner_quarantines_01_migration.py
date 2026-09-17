"""Structural and round-trip test for alembic ``coord_ci_runner_quarantines_01``.

Plan ``2026-09-14-a-poison-ci-runner-takes-every-job-and-no-detector-sees-it``
Phase 2a.

``coord.ci_runner_quarantines`` and ``coord.ci_runner_probes`` are contracts
coord's ``ci_runner_poison`` and ``ci_runner_probe`` code against. The one
property that carries a safety argument is ``ux_ci_rq_active``: the database,
not the leader, is what keeps a second ACTIVE quarantine from opening on the
same registration label of the same host. The tests here pin that, the
defaults the writers rely on, and the chain wiring.

Without a database (always runs):

1. Chain wiring: the parent is the Phase 1a revision of the same plan, it
   names one real sibling, and the ``Revises:`` header agrees.
2. Every DDL object is ``coord.``-qualified, the only DROPs are in
   ``downgrade()``, and the column-drop guard reads the upgrade path as
   dropping nothing.
3. Both directions are pure ``op.execute`` with static SQL.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability and defaults of both tables, and the ``id`` keys.
5. ``ux_ci_rq_active`` refuses a second ``active`` row per
   ``(tenant_id, runner_name, routing_label)`` and nothing else: shadow rows,
   a restored row beside an active one, another label, another tenant and
   another host all coexist. The defaults land on both tables.
6. The table and column comments land as the source writes them, and each
   table comment names its owner module.
7. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
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

_REVISION_ID = "coord_ci_runner_quarantines_01"
_REVISION_FILENAME = "coord_ci_runner_quarantines_01_create.py"

# Pinned as a literal, not read back from the module. This revision chains off
# Phase 1a of the same plan; a moved head is re-pointed THERE, not here.
_PARENT_REVISION_ID = "coord_ci_job_observations_01"

_SCHEMA = "coord"
_QUARANTINES = "ci_runner_quarantines"
_PROBES = "ci_runner_probes"
_ACTIVE_INDEX = "ux_ci_rq_active"

# (name, information_schema data_type, nullable, default-substring or None)
_QUARANTINE_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("runner_name", "text", False, None),
    ("routing_label", "text", False, None),
    ("state", "text", False, None),
    ("refusal", "text", True, None),
    ("alert_key", "text", False, None),
    ("evidence", "jsonb", False, None),
    ("repos", "ARRAY", False, "'{}'"),
    ("decided_at", "timestamp with time zone", False, "now()"),
    ("acted_at", "timestamp with time zone", True, None),
    ("restored_at", "timestamp with time zone", True, None),
    ("restored_by", "text", True, None),
    ("requarantine_count", "integer", False, "0"),
    ("adjudication", "text", False, "'pending'"),
    ("adjudicated_at", "timestamp with time zone", True, None),
    ("adjudication_basis", "jsonb", True, None),
    ("updated_at", "timestamp with time zone", False, "now()"),
)

_PROBE_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("runner_name", "text", False, None),
    ("repo", "text", False, None),
    ("probe_label", "text", False, None),
    ("quarantine_id", "uuid", True, None),
    ("dispatched_at", "timestamp with time zone", False, "now()"),
    ("run_id", "bigint", True, None),
    ("job_id", "bigint", True, None),
    ("outcome", "text", False, "'dispatched'"),
    ("duration_secs", "integer", True, None),
    ("resolved_at", "timestamp with time zone", True, None),
)

_QUARANTINE_COMMENTED = ("state", "refusal", "evidence", "adjudication", "updated_at")
_PROBE_COMMENTED = ("quarantine_id", "outcome")

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
        f"down_revision is {module.down_revision!r}; this revision chains off "
        "Phase 1a of its plan and is not re-pointed on its own"
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
_OWNED_TABLES = (f"{_SCHEMA}.{_QUARANTINES}", f"{_SCHEMA}.{_PROBES}")


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _TABLE_OBJECT_RE.findall(sql):
                assert obj.startswith(_OWNED_TABLES), (
                    f"{fn_name}(): object {obj!r} is not one of {_OWNED_TABLES}"
                )
            for obj in _INDEX_OBJECT_RE.findall(sql):
                assert obj in (
                    f"{_SCHEMA}.{_QUARANTINES}",
                    f"{_SCHEMA}.{_ACTIVE_INDEX}",
                ), f"{fn_name}(): index object {obj!r} is not coord-qualified"


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    for table in (_QUARANTINES, _PROBES):
        assert re.search(
            rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{table}\b", down, re.I
        ), f"downgrade() must drop {table}"
    assert re.search(
        rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{_ACTIVE_INDEX}\b", down, re.I
    )


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
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


def test_upgrade_ddl_is_idempotent_and_the_active_index_is_unique_partial() -> None:
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    for table in (_QUARANTINES, _PROBES):
        assert re.search(
            rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{table}\b", up
        ), table
    assert re.search(
        rf"CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{_ACTIVE_INDEX}\s+ON\s+"
        rf"{_SCHEMA}\.{_QUARANTINES}\s*\(tenant_id,\s*runner_name,\s*routing_label\)"
        r"\s+WHERE\s+state\s*=\s*'active'",
        up,
    ), "ux_ci_rq_active must be UNIQUE, keyed on the routing label, partial on active"
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"
    # state / adjudication / outcome are deliberately unconstrained (the
    # coord.notifications.kind choice).
    assert not re.search(r"\bCHECK\s*\(", up, re.I), "vocabulary columns carry no CHECK"
    assert not re.search(r"\bREFERENCES\b", up, re.I), "the ledger takes no FK"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000002")


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


def _assert_shape(
    got: dict[str, tuple[str, bool, str | None]],
    expected: tuple[tuple[str, str, bool, str | None], ...],
    table: str,
) -> None:
    for name, data_type, nullable, default in expected:
        assert name in got, f"coord.{table} is missing {name}"
        got_type, got_nullable, got_default = got[name]
        assert got_type == data_type, f"{table}.{name}: {got_type} != {data_type}"
        assert got_nullable is nullable, f"{table}.{name}: nullable {got_nullable}"
        if default is None:
            assert got_default is None, f"{table}.{name}: unexpected {got_default}"
        else:
            assert got_default is not None and default in got_default, (
                f"{table}.{name}: default {got_default!r} lacks {default!r}"
            )
    assert set(got) == {c[0] for c in expected}, f"{table}: unexpected {set(got)}"


def _pk(engine: Engine, table: str) -> object:
    return scalar(
        engine,
        f"""
        SELECT string_agg(a.attname, ',' ORDER BY k.ord)
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = 'coord.{table}'::regclass
           AND c.contype = 'p'
        """,
    )


def _insert_quarantine(engine: Engine, **overrides: object) -> uuid.UUID:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "runner_name": "spaceship-wsl",
        "routing_label": "qontinui",
        "state": "active",
        "alert_key": f"ci_runner_poison_suspected:{_TENANT}:spaceship-wsl",
        "evidence": '{"n": 22, "k": 22, "share": 1.0}',
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(
        f"CAST(:{k} AS jsonb)" if k == "evidence" else f":{k}" for k in params
    )
    with engine.begin() as conn:
        row = conn.execute(
            text(
                f"INSERT INTO coord.{_QUARANTINES} ({cols}) VALUES ({binds}) "
                "RETURNING id"
            ),
            params,
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _insert_probe(engine: Engine, **overrides: object) -> uuid.UUID:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "runner_name": "spaceship-wsl",
        "repo": "qontinui/qontinui-coord",
        "probe_label": "coord-probe-spaceship-wsl",
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        row = conn.execute(
            text(f"INSERT INTO coord.{_PROBES} ({cols}) VALUES ({binds}) RETURNING id"),
            params,
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _count(engine: Engine, table: str) -> int:
    value = scalar(engine, f"SELECT count(*) FROM coord.{table}")
    assert isinstance(value, int)
    return value


def _index_definition(engine: Engine, index: str) -> str:
    value = scalar(
        engine,
        "SELECT indexdef FROM pg_indexes WHERE schemaname = :s AND indexname = :i",
        s=_SCHEMA,
        i=index,
    )
    assert isinstance(value, str)
    return value


@_needs_pg
def test_both_tables_shape_and_keys() -> None:
    with ephemeral_database(admin_database_url(), "crq01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        _assert_shape(_columns(engine, _QUARANTINES), _QUARANTINE_COLUMNS, _QUARANTINES)
        _assert_shape(_columns(engine, _PROBES), _PROBE_COLUMNS, _PROBES)
        assert _pk(engine, _QUARANTINES) == "id"
        assert _pk(engine, _PROBES) == "id"

        definition = _index_definition(engine, _ACTIVE_INDEX)
        assert definition.startswith("CREATE UNIQUE INDEX"), definition
        assert "(tenant_id, runner_name, routing_label)" in definition, definition
        assert definition.endswith("WHERE (state = 'active'::text)"), definition


@_needs_pg
def test_the_active_index_refuses_a_second_active_row_and_nothing_else() -> None:
    with ephemeral_database(admin_database_url(), "crq01_active") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        first = _insert_quarantine(engine)

        # The one thing the index exists to refuse.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            _insert_quarantine(engine)
        diag = getattr(excinfo.value.orig, "diag", None)
        assert diag is not None and diag.constraint_name == _ACTIVE_INDEX

        # Everything else coexists with the active row: shadow rows for the
        # same host (the Phase 2 ledger), a restored row (history), another
        # routing label, another tenant, another host.
        _insert_quarantine(engine, state="shadow_would_act")
        _insert_quarantine(engine, state="shadow_refused", refusal="last_matching_host")
        _insert_quarantine(engine, state="restored", restored_by="ci_runner_probe")
        _insert_quarantine(engine, routing_label="msi")
        _insert_quarantine(engine, tenant_id=_OTHER_TENANT)
        _insert_quarantine(engine, runner_name="msi-wsl")
        assert _count(engine, _QUARANTINES) == 7

        # Once the active row leaves the active state, a new active one may open.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE coord.{_QUARANTINES} SET state = 'restored', "
                    "updated_at = now() WHERE id = :id"
                ),
                {"id": first},
            )
        _insert_quarantine(engine)
        assert _count(engine, _QUARANTINES) == 8

        with engine.connect() as conn:
            defaults = conn.execute(
                text(
                    f"""
                    SELECT repos, requarantine_count, adjudication,
                           decided_at IS NOT NULL, updated_at IS NOT NULL,
                           acted_at, adjudicated_at, adjudication_basis
                      FROM coord.{_QUARANTINES}
                     WHERE id = :id
                    """
                ),
                {"id": first},
            ).one()
        assert list(defaults[0]) == []
        assert tuple(defaults[1:]) == (0, "pending", True, True, None, None, None)

        # NOT NULL on the evidence: a decision row without its inputs is refused.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as nn:
            _insert_quarantine(engine, state="shadow_would_act", evidence=None)
        orig = nn.value.orig
        assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
        assert orig.diag.column_name == "evidence"  # type: ignore[union-attr]


@_needs_pg
def test_probe_defaults_and_the_calibration_arm() -> None:
    with ephemeral_database(admin_database_url(), "crq01_probe") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        decision = _insert_quarantine(engine, state="shadow_would_act")
        served = _insert_probe(engine, quarantine_id=decision)
        calibration = _insert_probe(engine)
        assert served != calibration

        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    f"""
                    SELECT quarantine_id, outcome, dispatched_at IS NOT NULL,
                           run_id, job_id, duration_secs, resolved_at
                      FROM coord.{_PROBES}
                     ORDER BY quarantine_id NULLS LAST
                    """
                )
            ).all()
        assert [tuple(r) for r in rows] == [
            (decision, "dispatched", True, None, None, None, None),
            (None, "dispatched", True, None, None, None, None),
        ]


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "crq01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        for table, columns, owner in (
            (_QUARANTINES, _QUARANTINE_COMMENTED, "ci_runner_poison"),
            (_PROBES, _PROBE_COMMENTED, "ci_runner_probe"),
        ):
            table_comment = scalar(
                engine, f"SELECT obj_description('coord.{table}'::regclass)"
            )
            assert table_comment == comment_body_from_source(
                source, f"{_SCHEMA}.{table}", object_kind="TABLE"
            )
            assert owner in str(table_comment), f"{table}: comment must name {owner}"
            for column in columns:
                assert column_comment(
                    engine, table, column
                ) == comment_body_from_source(source, f"{_SCHEMA}.{table}.{column}"), (
                    f"comment on {table}.{column} differs from the revision source"
                )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "crq01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert_quarantine(engine)
        _insert_probe(engine)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _QUARANTINES)
        assert table_exists(engine, _SCHEMA, _PROBES)
        assert index_exists(engine, _ACTIVE_INDEX)
        assert _count(engine, _QUARANTINES) == 1
        assert _count(engine, _PROBES) == 1


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "crq01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert_quarantine(engine)
        _insert_probe(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _QUARANTINES)
        assert not table_exists(engine, _SCHEMA, _PROBES)
        assert not index_exists(engine, _ACTIVE_INDEX)
        # The Phase 1a table is the parent's and must survive this downgrade.
        assert table_exists(engine, _SCHEMA, "ci_job_observations")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _QUARANTINES)
        assert table_exists(engine, _SCHEMA, _PROBES)
        assert _count(engine, _QUARANTINES) == 0
        assert _count(engine, _PROBES) == 0
