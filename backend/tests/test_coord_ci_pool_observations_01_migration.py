"""Structural and round-trip test for alembic ``coord_ci_pool_observations_01``.

Plan ``2026-10-04-ci-dashboard-in-the-dev-ops-console`` Phase 1.

``coord.ci_pool_observations`` is a contract coord's CI-pool writer and the
``GET /coord/ci/overview`` reader code against: the writer upserts on
``(repo, pool)``, and the reader renders NULL as UNKNOWN and ``0`` as a real
zero. The properties pinned here are the ones that would break either side at
runtime while every migration gate stays green.

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

4. Column types, nullability and defaults, and the key ``(repo, pool)``.
5. The key rejects a duplicate, each CHECK rejects what it names, NOT NULL
   names its column, a row of all-NULL counts (a failed poll) is storable, an
   eligibility-only row with the whole queue half NULL is storable, and a
   measured zero is storable.
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

_REVISION_ID = "coord_ci_pool_observations_01"
_REVISION_FILENAME = "coord_ci_pool_observations_01_create.py"

# Pinned as a literal, not read back from the module, so a re-point of
# down_revision is a deliberate two-file change. Whoever re-points the revision
# onto a moved head updates this line, the assignment, and the Revises header.
_PARENT_REVISION_ID = "journey_01_edge_ledger"

_SCHEMA = "coord"
_TABLE = "ci_pool_observations"

# (name, information_schema data_type, nullable)
_COLUMNS: tuple[tuple[str, str, bool], ...] = (
    ("repo", "text", False),
    ("pool", "text", False),
    ("observed_at", "timestamp with time zone", True),
    ("stale_after_secs", "integer", True),
    ("poll_ok", "boolean", True),
    ("poll_complete", "boolean", True),
    ("queued_jobs", "integer", True),
    ("oldest_queued_age_secs", "integer", True),
    ("threshold_secs", "integer", True),
    ("p90_wait_secs", "integer", True),
    ("eligibility_state", "text", True),
    ("eligible_runners", "integer", True),
    ("eligible_registrations", "integer", True),
    ("unknown_registrations", "integer", True),
    ("eligible_runners_drained", "integer", True),
    ("eligibility_observed_at", "timestamp with time zone", True),
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
                assert re.fullmatch(rf"{_SCHEMA}\.{_TABLE}(\.\w+)?", obj), (
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


def test_no_tenant_or_required_column_is_declared() -> None:
    # The plan resolved both at vet: tenancy scopes through coord.tenant_repos
    # at read time, and required is derived at read time. A column for either
    # would be a second source of truth.
    up = "\n".join(_sql_literals(_function(_tree(), "upgrade")))
    create = re.search(r"CREATE\s+TABLE.*?\n\s*\)\s*$", up, re.S | re.M)
    assert create is not None
    assert not re.search(r"\btenant_id\b", create.group(0))
    assert not re.search(r"^\s*required\b", create.group(0), re.M)


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


_OBSERVED = datetime(2026, 10, 4, 7, 0, tzinfo=UTC)
# Every row a test writes lives under this repo, and every count it asserts is
# scoped by it, so no assertion reads state the test did not write.
_REPO = "qontinui/cpo01-test-repo"


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
        "repo": _REPO,
        "pool": "qontinui,self-hosted",
        "observed_at": _OBSERVED,
        "stale_after_secs": 180,
        "poll_ok": True,
        "poll_complete": True,
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


def _repo_row_count(engine: Engine, repo: str) -> int:
    value = scalar(
        engine, f"SELECT count(*) FROM coord.{_TABLE} WHERE repo = :repo", repo=repo
    )
    assert isinstance(value, int)
    return value


@_needs_pg
def test_table_shape_and_key() -> None:
    with ephemeral_database(admin_database_url(), "cpo01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        got = _columns(engine)
        for name, data_type, nullable in _COLUMNS:
            assert name in got, f"coord.{_TABLE} is missing {name}"
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            # No column carries a default: the writer decides every value, and
            # a default count would be a stand-in zero.
            assert got_default is None, f"{name}: unexpected default {got_default}"
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
        assert pk == "repo,pool"


@_needs_pg
def test_key_checks_and_nulls_behave() -> None:
    with ephemeral_database(admin_database_url(), "cpo01_rows") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        # A measured pool: every half present, including measured zeros, which
        # must be storable and must read back as zero rather than NULL.
        _insert(
            engine,
            queued_jobs=0,
            oldest_queued_age_secs=0,
            threshold_secs=1800,
            p90_wait_secs=12,
            eligibility_state="eligible",
            eligible_runners=2,
            eligible_registrations=3,
            unknown_registrations=0,
            eligible_runners_drained=0,
            eligibility_observed_at=_OBSERVED,
        )
        # A failed poll: no count at all. NULL is "not measured", and the row
        # must be storable with nothing but the required columns.
        _insert(engine, pool="msi,self-hosted", poll_ok=False, poll_complete=False)
        for state in ("no_eligible_runner", "unknown"):
            _insert(engine, pool=f"state-{state}", eligibility_state=state)
        # A pool first seen by the eligibility pass: no queue poll has happened,
        # so the whole queue half is NULL rather than a fabricated poll_ok.
        _insert(
            engine,
            pool="eligibility-only",
            observed_at=None,
            stale_after_secs=None,
            poll_ok=None,
            poll_complete=None,
            eligibility_state="eligible",
            eligible_runners=1,
            eligible_registrations=1,
            eligibility_observed_at=_OBSERVED,
        )

        _assert_rejected_by(engine, f"{_TABLE}_pkey")

        # Each bad row is rejected by the ONE constraint it names, so a row that
        # trips a different check cannot pass this test by accident.
        prefix = _TABLE
        for expected, bad in (
            (
                f"{prefix}_repo_lowercase_check",
                {"pool": "upper-repo", "repo": "Qontinui/cpo01-test-repo"},
            ),
            (f"{prefix}_repo_nonblank_check", {"pool": "blank-repo", "repo": "  "}),
            (f"{prefix}_pool_nonblank_check", {"pool": ""}),
            (f"{prefix}_pool_nonblank_check", {"pool": "   "}),
            (
                f"{prefix}_stale_after_positive_check",
                {"pool": "zero-stale", "stale_after_secs": 0},
            ),
            (
                f"{prefix}_eligibility_state_check",
                {"pool": "bad-state", "eligibility_state": "healthy"},
            ),
        ):
            _assert_rejected_by(engine, expected, **bad)

        # A NOT NULL violation carries no constraint name, so pin it by SQLSTATE
        # 23502 (not_null_violation) and the column the database names.
        for column in ("repo", "pool"):
            with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
                _insert(engine, **{column: None})
            orig = excinfo.value.orig
            assert getattr(orig, "pgcode", None) == "23502", f"not a NOT NULL: {orig!r}"
            assert orig.diag.column_name == column  # type: ignore[union-attr]

        with engine.connect() as conn:
            measured = conn.execute(
                text(
                    f"""
                    SELECT queued_jobs, unknown_registrations
                      FROM coord.{_TABLE}
                     WHERE repo = :repo AND pool = 'qontinui,self-hosted'
                    """
                ),
                {"repo": _REPO},
            ).one()
            eligibility_only = conn.execute(
                text(
                    f"""
                    SELECT observed_at, stale_after_secs, poll_ok, poll_complete,
                           queued_jobs, eligible_runners
                      FROM coord.{_TABLE}
                     WHERE repo = :repo AND pool = 'eligibility-only'
                    """
                ),
                {"repo": _REPO},
            ).one()
            failed = conn.execute(
                text(
                    f"""
                    SELECT queued_jobs, eligibility_state, eligible_runners
                      FROM coord.{_TABLE}
                     WHERE repo = :repo AND pool = 'msi,self-hosted'
                    """
                ),
                {"repo": _REPO},
            ).one()
        assert tuple(measured) == (0, 0), "a measured zero must read back as zero"
        assert tuple(failed) == (None, None, None), "a failed poll stores no count"
        assert tuple(eligibility_only) == (None, None, None, None, None, 1), (
            "an eligibility-only row stores no queue half"
        )
        assert _repo_row_count(engine, _REPO) == 5


@_needs_pg
def test_comments_land_as_the_source_writes_them() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "cpo01_cmt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        table_comment = scalar(
            engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        for column, _type, _nullable in _COLUMNS:
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    with ephemeral_database(admin_database_url(), "cpo01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "stamp", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _repo_row_count(engine, _REPO) == 1, (
            "the re-run must not disturb existing rows"
        )


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "cpo01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _insert(engine)

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _repo_row_count(engine, _REPO) == 0, (
            "the table comes back empty, not restored"
        )
