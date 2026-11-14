"""Schema + round-trip test for the ``overview_reports_01_create`` revision.

Phase 1 of plan
``2026-11-07-interactive-stakeholder-reports-in-the-project-overview`` creates
``overview.reports``, ``overview.report_versions`` and
``overview.report_snapshots``. What a passing ``upgrade`` does NOT show, and so
what this file pins:

* the upgrade is in the shapes coord's migration classifier admits — static
  ``op.execute`` literals, guarded ``CREATE TABLE IF NOT EXISTS``, and the two
  partial unique indexes ``CONCURRENTLY IF NOT EXISTS`` inside
  ``autocommit_block`` — so the PR lands unattended (checked here statically,
  and by running the classifier itself before pushing);
* no code outside ``downgrade`` removes anything, which is what lets coord's
  alembic re-point move the revision onto a newer main head (its E6 clause) —
  and why the parent is read from the revision rather than pinned here;
* every column arrives with the type, nullability and default the ORM models
  declare (the test database is built from the models, so a drift would pass
  every API test and fail in production), and the models carry the same
  constraint and index names;
* the constraints refuse what the API refuses, for any writer: the pages'
  three source CHECKs mirrored on reports, the method vocabulary, a
  withdrawal's reason without its time (or the reverse), a second report
  mirroring one file in one project, a second snapshot from one file on one
  report; and both partial unique indexes leave rows with no source alone;
* a report's versions and snapshots go with it (``ON DELETE CASCADE``);
* up → down → up leaves no residue, and a re-run after a partial upgrade
  converges.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable (``QONTINUI_TEST_PG`` /
``QONTINUI_TEST_PG_DSN``). A skip proves nothing.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    declared_parent_revision_id,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
    upgrade_execute_calls,
)

_REVISION_ID = "overview_reports_01_create"
_REVISION_FILENAME = "overview_reports_01_create.py"
_TABLES = ("reports", "report_versions", "report_snapshots")
_INDEXES = ("uq_overview_reports_source", "uq_overview_report_snapshots_source")


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """Read from the revision itself: coord's alembic re-point may move it onto
    a newer head, and a pinned copy here would then fail for no fault."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


#: table -> column -> (information_schema.data_type, is_nullable, has a default)
_EXPECTED: dict[str, dict[str, tuple[str, str, bool]]] = {
    "reports": {
        "id": ("uuid", "NO", True),
        "tenant_id": ("uuid", "NO", False),
        "slug": ("text", "NO", False),
        "title": ("text", "NO", False),
        "summary": ("text", "NO", True),
        "body_md": ("text", "NO", True),
        "source_repo": ("text", "YES", False),
        "source_path": ("text", "YES", False),
        "source_sha": ("text", "YES", False),
        "current_version": ("integer", "NO", True),
        "created_by": ("text", "YES", False),
        "updated_by": ("text", "YES", False),
        "created_at": ("timestamp with time zone", "NO", True),
        "updated_at": ("timestamp with time zone", "NO", True),
    },
    "report_versions": {
        "id": ("uuid", "NO", True),
        "tenant_id": ("uuid", "NO", False),
        "report_id": ("uuid", "NO", False),
        "version": ("integer", "NO", False),
        "title": ("text", "NO", False),
        "summary": ("text", "NO", False),
        "body_md": ("text", "NO", False),
        "source_sha": ("text", "YES", False),
        "via_device": ("uuid", "YES", False),
        "via_session": ("text", "YES", False),
        "created_by": ("text", "YES", False),
        "created_at": ("timestamp with time zone", "NO", True),
    },
    "report_snapshots": {
        "id": ("uuid", "NO", True),
        "tenant_id": ("uuid", "NO", False),
        "report_id": ("uuid", "NO", False),
        "seq": ("integer", "NO", False),
        "version": ("integer", "NO", True),
        "label": ("text", "NO", False),
        "as_of": ("timestamp with time zone", "NO", False),
        "method_kind": ("text", "NO", False),
        "method_label": ("text", "NO", False),
        "data": ("jsonb", "NO", False),
        "content_sha256": ("text", "NO", False),
        "allowlist_version": ("integer", "NO", False),
        "scope_version": ("integer", "NO", False),
        "source_path": ("text", "YES", False),
        "withdrawn_at": ("timestamp with time zone", "YES", False),
        "withdrawn_reason": ("text", "YES", False),
        "created_by": ("text", "YES", False),
        "via_device": ("uuid", "YES", False),
        "via_session": ("text", "YES", False),
        "created_at": ("timestamp with time zone", "NO", True),
    },
}

#: table -> {constraint name: pg_constraint.contype}
_CONSTRAINTS: dict[str, dict[str, str]] = {
    "reports": {
        "reports_pkey": "p",
        "uq_overview_reports_slug": "u",
        "ck_overview_reports_source_repo_lowercase": "c",
        "ck_overview_reports_source_pair": "c",
        "ck_overview_reports_source_sha_needs_source": "c",
    },
    "report_versions": {
        "report_versions_pkey": "p",
        "report_versions_report_id_fkey": "f",
        "uq_overview_report_versions": "u",
    },
    "report_snapshots": {
        "report_snapshots_pkey": "p",
        "report_snapshots_report_id_fkey": "f",
        "uq_overview_report_snapshots_seq": "u",
        "ck_overview_report_snapshots_method_kind": "c",
        "ck_overview_report_snapshots_withdrawn_pair": "c",
    },
}


def _declared_revision(path: Path) -> str | None:
    """The ``revision`` a version file assigns, annotated or not."""
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets, value = [node.target], node.value
        if any(isinstance(t, ast.Name) and t.id == "revision" for t in targets):
            literal = ast.literal_eval(value)
            return literal if isinstance(literal, str) else None
    return None


def test_the_parent_is_a_real_revision() -> None:
    """The revision chains off a revision that exists (``alembic heads`` then
    prints one head, which CI's ``alembic-heads-pr`` check holds)."""
    parent = _parent_revision_id()
    versions = backend_root() / "alembic" / "versions"
    declared = {
        _declared_revision(p)
        for p in versions.glob("*.py")
        if p.name != _REVISION_FILENAME
    }
    assert parent in declared, (
        f"{_REVISION_FILENAME} chains off {parent!r}, which no revision declares"
    )


def test_upgrade_is_shaped_for_the_migration_classifier() -> None:
    """Static: the call shapes qontinui-coord's migration classifier admits."""
    calls = upgrade_execute_calls(_revision_path())
    dynamic = [i for i, call in enumerate(calls) if call.sql is None]
    assert calls and not dynamic, (
        f"op.execute call(s) {dynamic} in upgrade() do not take ONE inline static "
        "string literal — coord's classifier holds that as dynamic SQL"
    )
    statements = [(" ".join(c.sql.split()).upper(), c) for c in calls if c.sql]
    tables = [s for s, _ in statements if s.startswith("CREATE TABLE")]
    indexes = [(s, c) for s, c in statements if s.startswith("CREATE UNIQUE INDEX")]
    assert [t.split(" (")[0] for t in tables] == [
        f"CREATE TABLE IF NOT EXISTS OVERVIEW.{table.upper()}" for table in _TABLES
    ]
    assert len(indexes) == len(_INDEXES), statements
    for statement, call in indexes:
        assert statement.startswith("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ")
        assert " WHERE " in statement, "the index must be PARTIAL"
        assert call.in_autocommit_block, (
            "a CONCURRENTLY build must sit inside op.get_context().autocommit_block()"
        )
    assert all(s.startswith("CREATE ") for s, _ in statements), statements


#: The destructive tokens coord's alembic re-point refuses outside
#: ``downgrade()`` (clause E6), as ``test_overview_05_page_sources_migration.py``
#: copies them from qontinui-coord ``crates/coord/src/alembic_repoint_plan.rs``.
_E6_DESTRUCTIVE_TOKENS = re.compile(
    r"\.drop_"
    r"|\bdrop_(?:table|column|index|constraint|schema)\("
    r"|\bdrop(?:table|index|constraint|schema|column|sequence)\b"
    r"|\bdrop (?:materialized view|table|column|schema|index|constraint|type|view"
    r"|sequence|function|procedure|trigger|extension|database)\b"
    r"|\btruncate\b"
    r"|\bdelete from\b"
    r"|\bdelete ?\("
    r"|\balter table\b[^;]{0,300}?\bdrop\b"
)


def test_nothing_outside_downgrade_removes_anything() -> None:
    module = ast.parse(_revision_source())
    # Docstrings are prose, which E6 does not read either.
    for owner in ast.walk(module):
        if isinstance(
            owner, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            body = owner.body
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                owner.body = body[1:] or [ast.Pass()]
    code = " ".join(
        ast.unparse(node)
        for node in module.body
        if not (isinstance(node, ast.FunctionDef) and node.name == "downgrade")
    )
    assert "def upgrade" in code and "CREATE TABLE IF NOT EXISTS" in code, (
        "the scan did not read upgrade()"
    )
    for escape in (chr(92) + "n", chr(92) + "t"):
        code = code.replace(escape, " ")
    normalized = " ".join(code.lower().split())
    removal = _E6_DESTRUCTIVE_TOKENS.search(normalized)
    if removal is not None:
        context = normalized[max(removal.start() - 60, 0) : removal.end() + 60]
        pytest.fail(
            f"{_REVISION_FILENAME} removes something outside downgrade(): {context!r}"
        )


def test_the_models_declare_the_same_schema() -> None:
    """The ORM and the revision describe one schema: the same columns with
    the same nullability and the same server-side defaults, and the same
    constraint and index names."""
    from app.models.overview import Report, ReportSnapshot, ReportVersion

    models = {
        "reports": Report,
        "report_versions": ReportVersion,
        "report_snapshots": ReportSnapshot,
    }
    for table, model in models.items():
        columns = model.__table__.c
        assert set(columns.keys()) == set(_EXPECTED[table]), table
        for name, (_type, nullable, has_default) in _EXPECTED[table].items():
            column = columns[name]
            assert column.nullable == (nullable == "YES"), (table, name)
            assert (column.server_default is not None) == has_default, (table, name)
        declared = {
            c.name
            for c in model.__table__.constraints
            if isinstance(c, (CheckConstraint, UniqueConstraint)) and c.name
        }
        expected = {
            name for name, kind in _CONSTRAINTS[table].items() if kind in ("c", "u")
        }
        assert declared == expected, table
    indexes = {
        i.name: i
        for model in models.values()
        for i in model.__table__.indexes
        if isinstance(i, Index)
    }
    assert set(indexes) == set(_INDEXES)
    assert all(i.unique for i in indexes.values())
    assert [c.name for c in indexes["uq_overview_reports_source"].columns] == [
        "tenant_id",
        "source_repo",
        "source_path",
    ]
    assert [c.name for c in indexes["uq_overview_report_snapshots_source"].columns] == [
        "report_id",
        "source_path",
    ]


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def _columns(engine, table: str) -> dict[str, tuple[str, str, bool]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns "
                "WHERE table_schema = 'overview' AND table_name = :t"
            ),
            {"t": table},
        ).all()
    return {
        name: (dtype, nullable, default is not None)
        for name, dtype, nullable, default in rows
    }


def _constraints(engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT conname, contype FROM pg_constraint "
                "WHERE conrelid = CAST(:t AS regclass)"
            ),
            {"t": f"overview.{table}"},
        ).all()
    return {str(name): str(kind) for name, kind in rows}


def _index_is_valid_and_partial(engine, name: str) -> tuple[bool, bool, bool]:
    with engine.connect() as conn:
        return tuple(  # type: ignore[return-value]
            conn.execute(
                text(
                    "SELECT i.indisvalid, i.indisunique, i.indpred IS NOT NULL "
                    "FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
                    "JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'overview' AND c.relname = :name"
                ),
                {"name": name},
            ).one()
        )


def _report(conn, tenant, slug: str, source: tuple[str, str] | None = None):
    return conn.execute(
        text(
            "INSERT INTO overview.reports (tenant_id, slug, title, source_repo, "
            "source_path) VALUES (:t, :slug, :slug, :repo, :path) RETURNING id"
        ),
        {
            "t": tenant,
            "slug": slug,
            "repo": source[0] if source else None,
            "path": source[1] if source else None,
        },
    ).scalar_one()


def _snapshot(conn, tenant, report_id, seq: int, **overrides):
    values = {
        "t": tenant,
        "r": report_id,
        "seq": seq,
        "kind": "full_review",
        "path": None,
        "at": None,
        "reason": None,
    }
    values.update(overrides)
    conn.execute(
        text(
            "INSERT INTO overview.report_snapshots (tenant_id, report_id, seq, "
            "label, as_of, method_kind, method_label, data, content_sha256, "
            "allowlist_version, scope_version, source_path, withdrawn_at, "
            "withdrawn_reason) VALUES (:t, :r, :seq, 'Stop', now(), :kind, "
            "'Full review', '{}'::jsonb, 'sha', 1, 0, :path, :at, :reason)"
        ),
        values,
    )


def _refused(engine, name: str, write) -> None:
    with pytest.raises(IntegrityError, match=name):
        with engine.begin() as conn:
            write(conn)


def test_upgrade_shape_constraints_and_a_clean_round_trip(_admin_url: str) -> None:
    tenant, other = uuid4(), uuid4()
    source = ("example-org/progress-notes", "reports/platform/report.md")
    parent = _parent_revision_id()
    with ephemeral_database(_admin_url, "overview_reports_01") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", parent)
        for table in _TABLES:
            assert not table_exists(engine, "overview", table), (
                f"{table} must be created by this revision, not an earlier one"
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert _columns(engine, table) == _EXPECTED[table], table
            assert _constraints(engine, table) == _CONSTRAINTS[table], table
        for name in _INDEXES:
            assert _index_is_valid_and_partial(engine, name) == (True, True, True), name

        with engine.begin() as conn:
            # Hand-written reports carry no source and never collide on it.
            mirror = _report(conn, tenant, "mirror", source)
            _report(conn, tenant, "notes-1")
            _report(conn, tenant, "notes-2")
            # The same file mirrored in ANOTHER project is another report.
            _report(conn, other, "mirror", source)
            # Snapshots with no source path never collide on it either.
            _snapshot(conn, tenant, mirror, 1)
            _snapshot(conn, tenant, mirror, 2)
            _snapshot(conn, tenant, mirror, 3, path="snapshots/1.json")
            conn.execute(
                text(
                    "INSERT INTO overview.report_versions (tenant_id, report_id, "
                    "version, title, summary, body_md) "
                    "VALUES (:t, :r, 1, 'Mirror', '', '')"
                ),
                {"t": tenant, "r": mirror},
            )
        _refused(
            engine,
            "uq_overview_reports_source",
            lambda c: _report(c, tenant, "mirror-again", source),
        )
        _refused(
            engine,
            "uq_overview_reports_slug",
            lambda c: _report(c, tenant, "notes-1"),
        )
        _refused(
            engine,
            "uq_overview_report_snapshots_source",
            lambda c: _snapshot(c, tenant, mirror, 4, path="snapshots/1.json"),
        )
        _refused(
            engine,
            "uq_overview_report_snapshots_seq",
            lambda c: _snapshot(c, tenant, mirror, 1),
        )
        _refused(
            engine,
            "ck_overview_report_snapshots_method_kind",
            lambda c: _snapshot(c, tenant, mirror, 5, kind="guesswork"),
        )
        for half in (
            {"at": None, "reason": "why"},
            {"reason": None, "at": "2026-11-08"},
        ):
            _refused(
                engine,
                "ck_overview_report_snapshots_withdrawn_pair",
                lambda c, half=half: _snapshot(c, tenant, mirror, 6, **half),
            )
        for name, (repo, path, sha) in {
            "ck_overview_reports_source_repo_lowercase": (
                "Example-Org/x",
                "a.md",
                None,
            ),
            "ck_overview_reports_source_pair": ("example-org/x", None, None),
            "ck_overview_reports_source_sha_needs_source": (None, None, "a" * 40),
        }.items():
            _refused(
                engine,
                name,
                lambda c, repo=repo, path=path, sha=sha, name=name: c.execute(
                    text(
                        "INSERT INTO overview.reports (tenant_id, slug, title, "
                        "source_repo, source_path, source_sha) VALUES "
                        "(:t, :slug, :slug, :repo, :path, :sha)"
                    ),
                    {
                        "t": tenant,
                        "slug": f"violates-{name}",
                        "repo": repo,
                        "path": path,
                        "sha": sha,
                    },
                ),
            )

        # A report's versions and snapshots go with it.
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM overview.reports WHERE id = :r"), {"r": mirror}
            )
            left = conn.execute(
                text(
                    "SELECT (SELECT count(*) FROM overview.report_snapshots "
                    "WHERE report_id = :r) + (SELECT count(*) FROM "
                    "overview.report_versions WHERE report_id = :r)"
                ),
                {"r": mirror},
            ).scalar_one()
        assert left == 0

        run_alembic(backend_root(), db_url, "downgrade", parent)
        for table in _TABLES:
            assert not table_exists(engine, "overview", table), table
        for name in _INDEXES:
            assert not index_exists(engine, name, schema="overview"), name

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert table_exists(engine, "overview", table), table
        for name in _INDEXES:
            assert index_exists(engine, name, schema="overview"), name


def test_a_rerun_after_a_partial_upgrade_converges(_admin_url: str) -> None:
    """The tables commit before the index builds; a build that then fails
    leaves the version unstamped, and the re-run must converge (every create
    is guarded) rather than trip over what the first run made."""
    with ephemeral_database(_admin_url, "overview_reports_01_rerun") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        with engine.begin() as conn:
            conn.execute(
                text("DROP INDEX overview.uq_overview_report_snapshots_source")
            )
        run_alembic(backend_root(), db_url, "stamp", _parent_revision_id())
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        for table in _TABLES:
            assert _constraints(engine, table) == _CONSTRAINTS[table], table
        for name in _INDEXES:
            assert _index_is_valid_and_partial(engine, name) == (True, True, True), name
