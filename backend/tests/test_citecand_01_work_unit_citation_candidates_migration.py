"""Structural and round-trip test for alembic ``citecand_01``.

Plan ``2026-09-20-coord-reads-a-clean-not-delivered-for-work-that-landed-without-a-plan-trailer``
Phase 1. ``coord.work_unit_citation_candidates`` is the contract coord's
candidate capture (plan Phase 2) and delivery reduction (plan Phase 3) code
against, so the properties their safety argument rests on are pinned here:

* the identity key ``(work_unit_id, repo, pr_number)`` — one candidate per PR
  per unit whatever the source, so ``ON CONFLICT DO NOTHING`` never re-raises a
  dismissed row;
* the closed ``source`` / ``resolution`` vocabularies, the ``pr_number > 0`` and
  500-char ``evidence`` bounds, and the resolved-pair CHECK that makes a
  half-resolved row unrepresentable;
* both indexes are PARTIAL on ``resolved_at IS NULL`` (the open queue);
* the ``ON DELETE CASCADE`` back to ``coord.work_units``.

Like ``test_phaseatt_01_…``, this test deliberately does NOT pin the parent
revision: ``down_revision`` is re-pointed at the merged head at land time, so
only the chain's well-formedness is asserted.

Without a database (always runs): chain wiring; coord-qualified DDL with DROPs
only in ``downgrade()``; static ``op.execute`` only; the DDL text of the key,
the CHECKs and the partial indexes.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``: column shape,
every constraint refusing what it exists to refuse and nothing else, the
cascade, the partial index predicates read from the catalog, idempotent
upgrade, and up/down/up with no residue.
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

_REVISION_ID = "citecand_01"
_REVISION_FILENAME = "citecand_01_work_unit_citation_candidates.py"

_SCHEMA = "coord"
_TABLE = "work_unit_citation_candidates"
_UNIQUE = "work_unit_citation_candidates_unit_repo_pr_uq"
_OPEN_INDEX = "idx_work_unit_citation_candidates_open"
_TENANT_INDEX = "idx_work_unit_citation_candidates_tenant_open"

_SOURCES = ("worktree_link", "inferred_branch", "inferred_prose", "plan_body_link")

# (name, information_schema data_type, nullable, default-substring or None)
_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("id", "uuid", False, "gen_random_uuid()"),
    ("tenant_id", "uuid", False, None),
    ("work_unit_id", "uuid", False, None),
    ("repo", "text", False, None),
    ("pr_number", "integer", False, None),
    ("source", "text", False, None),
    ("evidence", "text", False, None),
    ("created_at", "timestamp with time zone", False, "now()"),
    ("resolved_at", "timestamp with time zone", True, None),
    ("resolution", "text", True, None),
    ("resolved_by", "text", True, None),
)

_NOT_NULL_COLUMNS = (
    "tenant_id",
    "work_unit_id",
    "repo",
    "pr_number",
    "source",
    "evidence",
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


def _declared_parent() -> str:
    """The parent this revision currently names — READ, never pinned."""
    parent = _revision_module().down_revision
    assert isinstance(parent, str) and parent, (
        f"down_revision is {parent!r}; this revision takes exactly one parent"
    )
    return parent


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


def _string_constants(node: ast.AST) -> list[str]:
    """Every string constant anywhere under ``node``."""
    return [
        n.value
        for n in ast.walk(node)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
    ]


def _upgrade_sql() -> str:
    return "\n".join(_sql_literals(_function(_tree(), "upgrade")))


# ---------------------------------------------------------------------------
# 1. chain wiring — well-formed, NOT pinned
# ---------------------------------------------------------------------------


def test_revision_id_is_wired() -> None:
    module = _revision_module()
    assert module.revision == _REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None


def test_the_declared_parent_is_exactly_one_real_sibling() -> None:
    parent = _declared_parent()
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


def test_docstring_header_agrees_with_the_declared_parent() -> None:
    source = _revision_source()
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    parent = _declared_parent()
    assert re.search(rf"^Revises: {re.escape(parent)}$", source, re.M), (
        f"the docstring's `Revises:` line does not name {parent!r}"
    )


def test_docstring_states_candidates_are_never_citations() -> None:
    """R1 is the design; the revision must say so where the next author looks."""
    doc = ast.get_docstring(_tree()) or ""
    assert "CANDIDATE, never a citation" in doc
    assert "never derives ``shipped``" in doc
    assert "fail-closed" in doc
    for source in _SOURCES:
        assert f"``{source}``" in doc, f"the docstring does not explain {source}"


# ---------------------------------------------------------------------------
# 2. coord-qualified, and the only DROPs are in downgrade()
# ---------------------------------------------------------------------------

_TABLE_OBJECT_RE = re.compile(
    r"(?:CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|REFERENCES"
    r"|COMMENT\s+ON\s+TABLE|COMMENT\s+ON\s+COLUMN)"
    r"(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([A-Za-z_.\"]+)",
    re.I,
)
_INDEX_OBJECT_RE = re.compile(
    r"(?:CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?"
    r"\s+\w+\s+ON"
    r"|DROP\s+INDEX(?:\s+IF\s+EXISTS)?)\s+([A-Za-z_.\"]+)",
    re.I,
)
_OWNED = (f"{_SCHEMA}.{_TABLE}", f"{_SCHEMA}.work_units")


def test_every_ddl_object_is_coord_qualified() -> None:
    tree = _tree()
    for fn_name in ("upgrade", "downgrade"):
        for sql in _sql_literals(_function(tree, fn_name)):
            for obj in _TABLE_OBJECT_RE.findall(sql):
                assert obj.startswith(_OWNED), (
                    f"{fn_name}(): object {obj!r} is not one of {_OWNED}"
                )
            for obj in _INDEX_OBJECT_RE.findall(sql):
                assert obj in (
                    f"{_SCHEMA}.{_TABLE}",
                    f"{_SCHEMA}.{_OPEN_INDEX}",
                    f"{_SCHEMA}.{_TENANT_INDEX}",
                ), f"{fn_name}(): index object {obj!r} is not coord-qualified"


def test_every_drop_is_inside_downgrade() -> None:
    assert not re.search(r"\bDROP\b", _upgrade_sql(), re.I), "upgrade() must not DROP"
    down = "\n".join(_sql_literals(_function(_tree(), "downgrade")))
    assert re.search(rf"DROP\s+TABLE\s+IF\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", down, re.I)
    for index in (_OPEN_INDEX, _TENANT_INDEX):
        assert re.search(
            rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{_SCHEMA}\.{index}\b", down, re.I
        ), f"downgrade() must drop {index}"


def test_the_drop_guard_reads_the_upgrade_path_as_dropping_nothing() -> None:
    scan = guard.scan_source(_revision_source(), _revision_path())
    assert not scan.drops, [(d.table, d.column) for d in scan.drops]
    assert not scan.unresolved, scan.unresolved
    assert not scan.violations, scan.violations


# ---------------------------------------------------------------------------
# 3. static SQL through op.execute only, and the contract's DDL text
# ---------------------------------------------------------------------------


def test_both_directions_are_static_op_execute_with_no_bind() -> None:
    calls = [
        node
        for node in ast.walk(_tree())
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]
    assert calls, "no op calls found"
    attrs = {c.func.attr for c in calls}  # type: ignore[attr-defined]
    assert attrs == {"execute", "get_context"}, attrs
    for call in calls:
        if call.func.attr == "get_context":  # type: ignore[attr-defined]
            # Only as the autocommit_block() receiver; it binds nothing.
            assert not call.args and not call.keywords
            continue
        assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
            f"op.execute at line {call.lineno} must take one static SQL literal"
        )
        assert isinstance(call.args[0].value, str)


def _is_autocommit_with(node: ast.stmt) -> bool:
    """``with op.get_context().autocommit_block():`` — nothing else."""
    if not isinstance(node, ast.With) or len(node.items) != 1:
        return False
    ctx = node.items[0].context_expr
    return (
        isinstance(ctx, ast.Call)
        and isinstance(ctx.func, ast.Attribute)
        and ctx.func.attr == "autocommit_block"
        and isinstance(ctx.func.value, ast.Call)
        and isinstance(ctx.func.value.func, ast.Attribute)
        and ctx.func.value.func.attr == "get_context"
        and isinstance(ctx.func.value.func.value, ast.Name)
        and ctx.func.value.func.value.id == "op"
    )


def test_every_index_build_is_concurrent_inside_the_last_autocommit_block() -> None:
    """The form coord's merge-train migration classifier admits as auto-safe.

    It rejects any non-concurrent ``CREATE INDEX`` on the upgrade path and
    admits ``CREATE INDEX CONCURRENTLY IF NOT EXISTS`` only when the
    ``op.execute`` sits lexically inside ``with
    op.get_context().autocommit_block():``. The block is last so no statement
    runs after it in a transaction the block already committed.
    """
    up = _function(_tree(), "upgrade")
    body = up.body[1:] if ast.get_docstring(up) is not None else up.body
    blocks = [n for n in body if _is_autocommit_with(n)]
    assert len(blocks) == 1, "upgrade() must hold exactly one autocommit_block()"
    assert body[-1] is blocks[0], "the autocommit_block() must be upgrade()'s last"
    inside = _string_constants(blocks[0])
    outside = "\n".join(
        lit for n in body if n is not blocks[0] for lit in _string_constants(n)
    )
    assert not re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", outside, re.I), (
        "an index build outside the autocommit_block() is a non-concurrent build"
    )
    # One op.execute literal per build, so each literal is one statement.
    builds = [
        lit.strip()
        for lit in inside
        if re.search(r"\bCREATE\s+(?:UNIQUE\s+)?INDEX\b", lit, re.I)
    ]
    assert len(builds) == 2, builds
    for build in builds:
        assert re.match(
            r"CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\b", build, re.I
        ), f"not a guarded concurrent build: {build!r}"


def test_upgrade_ddl_is_idempotent_and_carries_the_contract() -> None:
    up = _upgrade_sql()
    assert re.search(r"CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+coord\b", up, re.I)
    assert re.search(
        rf"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+{_SCHEMA}\.{_TABLE}\b", up, re.I
    )
    assert re.search(
        rf"CONSTRAINT\s+{_UNIQUE}\s+UNIQUE\s*\(work_unit_id,\s*repo,\s*pr_number\)",
        up,
        re.I,
    ), "the identity key is UNIQUE (work_unit_id, repo, pr_number), named"
    for index, cols in (
        (_OPEN_INDEX, r"work_unit_id"),
        (_TENANT_INDEX, r"tenant_id,\s*created_at"),
    ):
        assert re.search(
            rf"CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+{index}\s+ON\s+"
            rf"{_SCHEMA}\.{_TABLE}\s*\({cols}\)\s*WHERE\s+resolved_at\s+IS\s+NULL",
            up,
            re.I,
        ), f"{index} must be the partial open-queue index over ({cols})"
    assert re.search(
        rf"REFERENCES\s+{_SCHEMA}\.work_units\(id\)\s+ON\s+DELETE\s+CASCADE", up, re.I
    ), "a candidate must not outlive its work unit"
    assert re.search(
        r"CHECK\s*\(\s*\(resolved_at\s+IS\s+NULL\)\s*=\s*\(resolution\s+IS\s+NULL\)\s*\)",
        up,
        re.I,
    )
    assert not re.search(r"CREATE\s+TRIGGER", up, re.I), "house convention: no triggers"


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------

_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")


def _seed_work_unit(engine: Engine, slug: str) -> uuid.UUID:
    with engine.begin() as conn:
        row = conn.execute(
            text(
                "INSERT INTO coord.work_units (slug, tenant_id, status, title) "
                "VALUES (:slug, :tenant, 'in_progress', :title) RETURNING id"
            ),
            {"slug": slug, "tenant": _TENANT, "title": slug},
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _row(work_unit_id: uuid.UUID, **overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "tenant_id": _TENANT,
        "work_unit_id": work_unit_id,
        "repo": "qontinui/qontinui-web",
        "pr_number": 1234,
        "source": "inferred_prose",
        "evidence": "Phase 2 of plan 2026-09-20-some-plan",
    }
    params.update(overrides)
    return params


def _insert(engine: Engine, params: dict[str, object]) -> uuid.UUID:
    cols = ", ".join(params)
    binds = ", ".join(f":{k}" for k in params)
    with engine.begin() as conn:
        row = conn.execute(
            text(f"INSERT INTO coord.{_TABLE} ({cols}) VALUES ({binds}) RETURNING id"),
            params,
        ).one()
    assert isinstance(row[0], uuid.UUID)
    return row[0]


def _count(engine: Engine, work_unit_id: uuid.UUID) -> int:
    """Candidates for ONE work unit — scoped, never a store-wide count."""
    value = scalar(
        engine,
        f"SELECT count(*) FROM coord.{_TABLE} WHERE work_unit_id = :unit",
        unit=work_unit_id,
    )
    assert isinstance(value, int)
    return value


def _refused(
    engine: Engine, params: dict[str, object]
) -> sqlalchemy.exc.IntegrityError:
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _insert(engine, params)
    return excinfo.value


def _constraint_of(err: sqlalchemy.exc.IntegrityError) -> str | None:
    diag = getattr(err.orig, "diag", None)
    return getattr(diag, "constraint_name", None)


@_needs_pg
def test_table_shape_and_both_partial_indexes() -> None:
    with ephemeral_database(admin_database_url(), "citecand01_shape") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT column_name, data_type, is_nullable, column_default "
                    "FROM information_schema.columns "
                    "WHERE table_schema = :s AND table_name = :t"
                ),
                {"s": _SCHEMA, "t": _TABLE},
            ).all()
        got = {r[0]: (r[1], r[2] == "YES", r[3]) for r in rows}
        assert set(got) == {c[0] for c in _COLUMNS}, f"columns: {set(got)}"
        for name, data_type, nullable, default in _COLUMNS:
            got_type, got_nullable, got_default = got[name]
            assert got_type == data_type, f"{name}: {got_type} != {data_type}"
            assert got_nullable is nullable, f"{name}: nullable {got_nullable}"
            if default is None:
                assert got_default is None, f"{name}: unexpected {got_default}"
            else:
                assert got_default is not None and default in got_default

        for index, cols in (
            (_OPEN_INDEX, "(work_unit_id)"),
            (_TENANT_INDEX, "(tenant_id, created_at)"),
        ):
            indexdef = scalar(
                engine,
                "SELECT indexdef FROM pg_indexes WHERE schemaname = :s AND indexname = :i",
                s=_SCHEMA,
                i=index,
            )
            assert isinstance(indexdef, str)
            assert indexdef.startswith("CREATE INDEX"), indexdef
            assert f"{cols} WHERE (resolved_at IS NULL)" in indexdef, indexdef

        assert (
            scalar(
                engine,
                "SELECT contype::text FROM pg_constraint WHERE conname = :c "
                f"AND conrelid = 'coord.{_TABLE}'::regclass",
                c=_UNIQUE,
            )
            == "u"
        )


@_needs_pg
def test_every_constraint_refuses_what_it_exists_to_refuse_and_nothing_else() -> None:
    with ephemeral_database(admin_database_url(), "citecand01_ck") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "citecand-constraints")
        other = _seed_work_unit(engine, "citecand-constraints-other")

        # Every source literal is accepted, each on its own PR.
        for i, source in enumerate(_SOURCES, start=1):
            _insert(engine, _row(unit, pr_number=i, source=source))
        assert _count(engine, unit) == len(_SOURCES)

        # Identity: same (unit, repo, pr) collides whatever the source...
        err = _refused(engine, _row(unit, pr_number=1, source="plan_body_link"))
        assert _constraint_of(err) == _UNIQUE
        # ...while another repo, another PR, another unit all coexist.
        _insert(engine, _row(unit, pr_number=1, repo="qontinui/qontinui-coord"))
        _insert(engine, _row(unit, pr_number=99))
        _insert(engine, _row(other, pr_number=1))
        # ON CONFLICT DO NOTHING — the writers' idiom — is a silent no-op.
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO coord.{_TABLE} "
                    "(tenant_id, work_unit_id, repo, pr_number, source, evidence) "
                    "VALUES (:t, :u, 'qontinui/qontinui-web', 1, 'worktree_link', 'x') "
                    "ON CONFLICT (work_unit_id, repo, pr_number) DO NOTHING"
                ),
                {"t": _TENANT, "u": unit},
            )
        assert _count(engine, unit) == len(_SOURCES) + 2

        # Vocabulary and bounds.
        for bad, constraint in (
            ({"source": "pr_body"}, "source_ck"),
            ({"source": "landed_commit"}, "source_ck"),
            ({"pr_number": 0}, "pr_number_ck"),
            ({"pr_number": -3}, "pr_number_ck"),
            ({"evidence": "x" * 501}, "evidence_len_ck"),
        ):
            err = _refused(engine, _row(unit, **{"pr_number": 500, **bad}))
            assert getattr(err.orig, "pgcode", None) == "23514", f"{bad}: {err.orig!r}"
            assert _constraint_of(err) == f"{_TABLE}_{constraint}", f"{bad}"
        _insert(engine, _row(unit, pr_number=500, evidence="x" * 500))

        # Resolution pairing: both NULL or both set; the vocabulary is closed.
        for bad, constraint in (
            ({"resolution": "confirmed"}, "resolved_pair_ck"),
            ({"resolved_at": "2026-09-29T00:00:00Z"}, "resolved_pair_ck"),
            (
                {"resolved_at": "2026-09-29T00:00:00Z", "resolution": "maybe"},
                "resolution_ck",
            ),
        ):
            err = _refused(engine, _row(unit, **{"pr_number": 501, **bad}))
            assert getattr(err.orig, "pgcode", None) == "23514", f"{bad}: {err.orig!r}"
            assert _constraint_of(err) == f"{_TABLE}_{constraint}", f"{bad}"
        for n, resolution in ((502, "confirmed"), (503, "dismissed")):
            _insert(
                engine,
                _row(
                    unit,
                    pr_number=n,
                    resolved_at="2026-09-29T00:00:00Z",
                    resolution=resolution,
                    resolved_by="device:test",
                ),
            )

        # NOT NULL on every required column.
        for column in _NOT_NULL_COLUMNS:
            params = _row(unit, pr_number=600)
            params[column] = None
            err = _refused(engine, params)
            assert getattr(err.orig, "pgcode", None) == "23502", (
                f"{column}: {err.orig!r}"
            )
            assert err.orig.diag.column_name == column  # type: ignore[union-attr]


@_needs_pg
def test_the_cascade_back_to_the_work_unit_and_the_comments() -> None:
    source = _revision_source()
    with ephemeral_database(admin_database_url(), "citecand01_fk") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "citecand-cascade")
        _insert(engine, _row(unit))
        assert _count(engine, unit) == 1
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM coord.work_units WHERE id = :id"), {"id": unit}
            )
        assert _count(engine, unit) == 0

        table_comment = scalar(
            engine, f"SELECT obj_description('coord.{_TABLE}'::regclass)"
        )
        assert table_comment == comment_body_from_source(
            source, f"{_SCHEMA}.{_TABLE}", object_kind="TABLE"
        )
        assert "never a" in str(table_comment) and "citation" in str(table_comment)
        for column in ("source", "resolution"):
            assert column_comment(engine, _TABLE, column) == comment_body_from_source(
                source, f"{_SCHEMA}.{_TABLE}.{column}"
            ), f"comment on {column} differs from the revision source"


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "citecand01_idem") as (
        engine,
        db_url,
    ):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "citecand-idempotent")
        _insert(engine, _row(unit))

        run_alembic(backend_root(), db_url, "stamp", parent)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _OPEN_INDEX)
        assert index_exists(engine, _TENANT_INDEX)
        assert _count(engine, unit) == 1


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    parent = _declared_parent()
    with ephemeral_database(admin_database_url(), "citecand01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        unit = _seed_work_unit(engine, "citecand-roundtrip")
        _insert(engine, _row(unit))

        run_alembic(backend_root(), db_url, "downgrade", parent)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _OPEN_INDEX)
        assert not index_exists(engine, _TENANT_INDEX)
        assert table_exists(engine, _SCHEMA, "work_units")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert _count(engine, unit) == 0
