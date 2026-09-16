"""Structural and round-trip test for alembic ``coord_ci_pool_baselines_01``.

Plan ``2026-09-13-coord-counts-ci-runners-it-cannot-route-to`` Phase 3 item 3.

``coord.ci_pool_eligibility_baselines`` is a contract coord's pool-eligibility
tick codes against: it upserts on ``(tenant_id, repo, pool)`` and relies on the
CHECKs and defaults below. The properties pinned here are the ones that would
break that tick at runtime while every migration gate stays green.

Without a database (always runs):

1. Chain wiring: the parent names one real sibling and the ``Revises:`` header
   agrees with ``down_revision``.
2. Every DDL object is ``coord.``-qualified, the only DROP is in
   ``downgrade()``, and the column-drop guard reads the upgrade path as dropping
   nothing.
3. Both directions are pure ``op.execute`` with static SQL, which is what the
   coord merge-train classifier can read and what offline ``--sql`` mode needs.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

4. Column types, nullability and defaults, and the key ``(tenant_id, repo,
   pool)``.
5. The key rejects a duplicate, the FK and each CHECK reject what they name,
   NOT NULL names its column, and the defaults land.
5b. The tenant FK exists with ON DELETE CASCADE, and deleting a tenant removes
    that tenant's baselines and no others.
6. The table and column comments land as the source writes them.
7. ``upgrade()`` is idempotent, and up, down, up leaves no residue.
"""

from __future__ import annotations

import ast
import re
import sys
import uuid
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
    comment_body_from_source,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "ci"))

import check_coord_column_drops as guard  # noqa: E402

_REVISION_ID = "coord_ci_pool_baselines_01"
_REVISION_FILENAME = "coord_ci_pool_baselines_01_create.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change. Whoever re-points the revision
# onto a moved head updates this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "pr_fix_default_on_01"

_SCHEMA = "coord"
_TABLE = "ci_pool_eligibility_baselines"

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("tenant_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("pool", "text", False, None),
    ("max_eligible_registrations", "integer", False, None),
    ("max_observed_at", "timestamp with time zone", False, None),
    ("last_eligible_registrations", "integer", False, None),
    ("last_observed_at", "timestamp with time zone", False, "now()"),
    ("alert_open", "boolean", False, "false"),
)

_COMMENTED_COLUMNS = (
    "tenant_id",
    "repo",
    "pool",
    "max_eligible_registrations",
    "max_observed_at",
    "last_eligible_registrations",
    "last_observed_at",
    "alert_open",
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
# 2. coord-qualified, and the only DROP is in downgrade()
# ---------------------------------------------------------------------------


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in re.findall(
                r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|COMMENT\s+ON\s+TABLE"
                r"|COMMENT\s+ON\s+COLUMN)(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
                sql,
                re.I,
            ):
                assert obj.startswith(f"{_SCHEMA}.{_TABLE}"), (
                    f"{fn_name}(): object {obj!r} is not coord.{_TABLE}"
                )


def test_every_drop_is_inside_downgrade() -> None:
    tree = _tree()
    up = "\n".join(_sql_literals(_function(tree, "upgrade")))
    assert not re.search(r"\bDROP\b", up, re.I), "upgrade() must not DROP anything"
    down = "\n".join(_sql_literals(_function(tree, "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down, re.I)


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
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
_OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000002")
# Never seeded: an insert under it must be refused by the tenant FK.
_UNKNOWN_TENANT = uuid.UUID("00000000-0000-4000-8000-0000000000ff")
_OBSERVED = datetime(2026, 9, 12, 7, 0, tzinfo=UTC)


def _seed_tenant(engine: Engine, tenant_id: uuid.UUID) -> None:
    """Insert a coord.tenants row, the way sibling migration tests seed one."""
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:t, :slug, 'ci pool baselines test tenant')
                """
            ),
            # The full hex: the test UUIDs share their leading digits, and slug
            # is UNIQUE, so a prefix would make the second seed collide.
            {"t": tenant_id, "slug": f"cpb01-{tenant_id.hex}"},
        )


def _columns(engine: Engine) -> dict[str, tuple[str, bool, str | None]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                  FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": _TABLE},
        ).all()
    return {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}


def _insert(engine: Engine, **overrides: object) -> None:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "repo": "qontinui/qontinui-coord",
        "pool": "qontinui,self-hosted",
        "max_eligible_registrations": 3,
        "max_observed_at": _OBSERVED,
        "last_eligible_registrations": 1,
    }
    params.update(overrides)
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds})"),
            params,
        )


def _assert_rejected_by(engine: Engine, constraint: str, **overrides: object) -> None:
    """The insert fails, and the database names ``constraint`` as the reason."""
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, **overrides)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None, f"driver error carries no diag: {excinfo.value.orig!r}"
    assert diag.constraint_name == constraint, (
        f"{overrides}: rejected by {diag.constraint_name!r}, expected {constraint!r}"
    )


def _row_count(engine: Engine) -> int:
    value = scalar(engine, f"SELECT count(*) FROM coord.{_TABLE}")
    assert isinstance(value, int)
    return value


@_needs_pg
def test_table_shape_and_key() -> None:
    with ephemeral_database(admin_database_url(), "cpb01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
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
        assert pk == "tenant_id,repo,pool"


@_needs_pg
def test_key_checks_and_defaults_behave() -> None:
    with ephemeral_database(admin_database_url(), "cpb01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_tenant(engine, _TENANT)
        _seed_tenant(engine, _OTHER_TENANT)

        _insert(engine)
        # Same repo and pool under another tenant, and another pool in the same
        # repo, are distinct baselines.
        _insert(engine, tenant_id=_OTHER_TENANT)
        _insert(engine, pool="msi,self-hosted")

        _assert_rejected_by(engine, f"{_TABLE}_pkey")

        # Each bad row is rejected by the ONE constraint it names, so a row that
        # trips a different check cannot pass this test by accident.
        prefix = _TABLE
        for expected, bad in (
            (
                f"{prefix}_tenant_id_fkey",
                {"pool": "unknown-tenant", "tenant_id": _UNKNOWN_TENANT},
            ),
            (f"{prefix}_repo_nonempty_check", {"pool": "empty-repo", "repo": ""}),
            (
                f"{prefix}_repo_lowercase_check",
                {"pool": "upper-repo", "repo": "Qontinui/qontinui-coord"},
            ),
            (f"{prefix}_pool_nonempty_check", {"pool": ""}),
            (
                f"{prefix}_max_nonnegative_check",
                {"pool": "neg-max", "max_eligible_registrations": -1},
            ),
            (
                f"{prefix}_last_nonnegative_check",
                {"pool": "neg-last", "last_eligible_registrations": -1},
            ),
        ):
            _assert_rejected_by(engine, expected, **bad)

        # A NOT NULL violation carries no constraint name, so pin it by SQLSTATE
        # 23502 (not_null_violation) and the column the database names.
        with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
            _insert(engine, pool="no-max-time", max_observed_at=None)
        orig = excinfo.value.orig
        assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
        assert orig.diag.column_name == "max_observed_at"  # type: ignore[union-attr]

        # Zero is a real observation and must be storable.
        _insert(
            engine,
            pool="zero",
            max_eligible_registrations=0,
            last_eligible_registrations=0,
        )

        with engine.connect() as conn:
            row = conn.execute(
                text(
                    f"""
                    SELECT alert_open, last_observed_at IS NOT NULL
                      FROM coord.{_TABLE}
                     WHERE pool = 'zero'
                    """
                )
            ).one()
        assert row == (False, True)
        assert _row_count(engine) == 4


@_needs_pg
def test_tenant_fk_cascades_on_tenant_delete() -> None:
    with ephemeral_database(admin_database_url(), "cpb01_fk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.connect() as conn:
            fks = conn.execute(
                text(
                    f"""
                    SELECT con.conname,
                           con.confdeltype::text,
                           tn.nspname || '.' || tc.relname,
                           (SELECT string_agg(a.attname, ',')
                              FROM pg_attribute a
                             WHERE a.attrelid = con.conrelid
                               AND a.attnum = ANY (con.conkey)),
                           (SELECT string_agg(a.attname, ',')
                              FROM pg_attribute a
                             WHERE a.attrelid = con.confrelid
                               AND a.attnum = ANY (con.confkey))
                      FROM pg_constraint con
                      JOIN pg_class tc ON tc.oid = con.confrelid
                      JOIN pg_namespace tn ON tn.oid = tc.relnamespace
                     WHERE con.conrelid = 'coord.{_TABLE}'::regclass
                       AND con.contype = 'f'
                    """
                )
            ).all()
        # confdeltype 'c' is ON DELETE CASCADE.
        assert [tuple(r) for r in fks] == [
            (f"{_TABLE}_tenant_id_fkey", "c", "coord.tenants", "tenant_id", "tenant_id")
        ]

        _seed_tenant(engine, _TENANT)
        _seed_tenant(engine, _OTHER_TENANT)
        _insert(engine)
        _insert(engine, pool="msi,self-hosted")
        _insert(engine, tenant_id=_OTHER_TENANT)
        assert _row_count(engine) == 3

        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.tenants WHERE tenant_id = :t"), {"t": _TENANT}
            )

        gone = scalar(
            engine,
            f"SELECT count(*) FROM coord.{_TABLE} WHERE tenant_id = :t",
            t=_TENANT,
        )
        assert gone == 0, "a deleted tenant left baseline rows behind"
        assert _row_count(engine) == 1, "the cascade reached another tenant"


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "cpb01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        for column in _COMMENTED_COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "cpb01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_tenant(engine, _TENANT)
        _insert(engine)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row_count(engine) == 1, "the re-run must not disturb existing rows"


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "cpb01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _seed_tenant(engine, _TENANT)
        _insert(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _row_count(engine) == 0, "the table comes back empty, not restored"
