"""Pins for alembic revision ``coord_conditions_04_kinds_and_builds``.

Plan
``2026-11-26-acceptance-results-are-not-kept-and-the-regression-tests-page-has-no-role-beside-ci``
Phase 9: the Regression Tests store learns a ``kind`` and an ingest source per
group, references per check, and a build, basis, source run and branch per run.
What is pinned:

1. the chain is wired: ``down_revision`` names a parent defined in exactly one
   file, and the docstring's ``Revises:`` line agrees with it (the PR re-chains
   onto ``main``'s single head at open and after every rebase);
2. ``upgrade()`` keeps the shape coord's merge-train migration classifier
   admits: every ``op.execute`` is one static literal; every index is built
   ``CONCURRENTLY IF NOT EXISTS`` inside ``autocommit_block()``; every
   ``ADD CONSTRAINT`` ends ``NOT VALID``; every ``ADD COLUMN`` is guarded
   ``IF NOT EXISTS``. ``downgrade()`` drops every object ``upgrade()`` creates,
   in reverse order;
3. live: up, down, up walks to exactly the planned columns, CHECKs and
   indexes and back; a row written before the upgrade keeps its values and
   reads ``kind = 'judged'`` with every new column NULL, and every NOT VALID
   CHECK would validate against it;
4. live refusals: an ``ingested-spec`` group with no source, a ``judged`` group
   with a source, and a duplicate ``source_ref`` within one group are each
   refused by the named constraint or index.

The structural tests always run. The live ones self-skip without a test
Postgres and REPORT the skip (``pytest -rs``): set ``QONTINUI_TEST_PG_DSN``
(e.g. from ``ephemeral-db.sh start pgvector``) or ``QONTINUI_TEST_PG``.
"""

from __future__ import annotations

import ast
import re
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    declared_parent_revision_id,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "coord_conditions_04_kinds_and_builds"
_REVISION_FILENAME = f"{_REVISION_ID}.py"
_SCHEMA = "coord"

# (table, column, information_schema data_type, is_nullable, default), in the
# order upgrade() adds them.
_COLUMNS = (
    ("condition_groups", "kind", "text", "NO", "'judged'::text"),
    ("condition_groups", "ingest_source", "jsonb", "YES", None),
    ("condition_groups", "ingest_state", "jsonb", "YES", None),
    ("conditions", "external_ref", "text", "YES", None),
    ("conditions", "parent_ref", "text", "YES", None),
    ("condition_runs", "build_sha", "text", "YES", None),
    ("condition_runs", "build_sha_basis", "text", "YES", None),
    ("condition_runs", "source_ref", "text", "YES", None),
    ("condition_runs", "source_git_ref", "text", "YES", None),
)
# (table, index name), in the order upgrade() builds them.
_INDEXES = (
    ("conditions", "uq_conditions_group_external_ref"),
    ("conditions", "idx_conditions_tenant_parent_ref"),
    ("condition_runs", "uq_condition_runs_group_source_ref"),
    ("condition_runs", "idx_condition_runs_group_source_git_ref"),
)
# (table, constraint name), in the order upgrade() adds them.
_CHECKS = (
    ("condition_groups", "ck_condition_groups_kind"),
    ("condition_groups", "ck_condition_groups_ingested_spec_requires_source"),
    ("condition_groups", "ck_condition_groups_judged_forbids_source"),
    ("condition_runs", "ck_condition_runs_build_sha_basis"),
)
_TABLES = ("condition_groups", "conditions", "condition_runs")

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG_DSN or QONTINUI_TEST_PG)"
    ),
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _revision_source() -> str:
    return _revision_path().read_text(encoding="utf-8")


def _parent_revision_id() -> str:
    """This revision's own ``down_revision``, read from the file at runtime."""
    return declared_parent_revision_id(_revision_source(), _REVISION_FILENAME)


def _collapsed(sql: str) -> str:
    return " ".join(sql.split())


# ---------------------------------------------------------------------------
# structural (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_defined_exactly_once() -> None:
    parent = _parent_revision_id()
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == parent
    assert module.branch_labels is None
    assert module.depends_on is None
    pattern = re.compile(
        rf'^revision(?:: str)?\s*=\s*["\']{re.escape(parent)}["\']', re.M
    )
    versions_dir = backend_root() / "alembic" / "versions"
    parent_definitions = [
        path.name
        for path in versions_dir.glob("*.py")
        if path.name != _REVISION_FILENAME
        and pattern.search(path.read_text(encoding="utf-8"))
    ]
    assert len(parent_definitions) == 1, parent_definitions
    source = _revision_source()
    assert f"Revision ID: {_REVISION_ID}" in source
    assert f"Revises: {parent}" in source, (
        "the docstring's Revises: line disagrees with down_revision -- a "
        "re-chain must move both"
    )


def test_upgrade_keeps_the_shape_the_classifier_admits() -> None:
    """Static literals only; columns, then concurrent indexes, then NOT VALID CHECKs.

    coord's merge-train classifier (qontinui-coord
    ``crates/coord/src/pr_merge/migration_classifier.rs``) admits a
    ``CREATE INDEX CONCURRENTLY`` only inside ``autocommit_block()`` and with
    ``IF NOT EXISTS``, an ``ADD CONSTRAINT`` only when it ends ``NOT VALID``,
    and an ``ADD COLUMN`` only with ``IF NOT EXISTS``.
    """
    calls = upgrade_execute_calls(_revision_path())
    assert all(call.sql is not None for call in calls), (
        "every op.execute must take one static string literal"
    )
    statements = [_collapsed(call.sql or "") for call in calls]

    adds = [s for s in statements if "ADD COLUMN" in s]
    assert [
        re.search(
            r"ALTER TABLE coord\.(\w+) ADD COLUMN IF NOT EXISTS (\w+)", s
        ).groups()  # type: ignore[union-attr]
        for s in adds
    ] == [(table, column) for table, column, *_ in _COLUMNS]

    index_calls = [c for c in calls if "INDEX" in (c.sql or "")]
    assert [
        re.search(
            r"IF NOT EXISTS (\w+) ON coord\.(\w+)", _collapsed(c.sql or "")
        ).groups()[::-1]  # type: ignore[union-attr]
        for c in index_calls
    ] == list(_INDEXES)
    for call in index_calls:
        sql = _collapsed(call.sql or "")
        assert "CONCURRENTLY IF NOT EXISTS" in sql, sql
        assert call.in_autocommit_block, f"outside autocommit_block(): {sql}"

    constraints = [s for s in statements if "ADD CONSTRAINT" in s]
    assert [
        re.search(r"ALTER TABLE coord\.(\w+) ADD CONSTRAINT (\w+)", s).groups()  # type: ignore[union-attr]
        for s in constraints
    ] == list(_CHECKS)
    for sql in constraints:
        assert sql.endswith("NOT VALID"), sql

    # Order: every column before any index, every index before any CHECK.
    positions = {sql: i for i, sql in enumerate(statements)}
    assert max(positions[s] for s in adds) < min(
        positions[_collapsed(c.sql or "")] for c in index_calls
    )
    assert max(positions[_collapsed(c.sql or "")] for c in index_calls) < min(
        positions[s] for s in constraints
    )
    # Each transactional group opens with a bounded lock wait.
    assert statements[0] == "SET LOCAL lock_timeout = '3s'"
    assert statements[positions[constraints[0]] - 1] == "SET LOCAL lock_timeout = '3s'"
    assert len(statements) == 2 + len(adds) + len(index_calls) + len(constraints)


def test_downgrade_drops_every_object_in_reverse_order() -> None:
    calls = upgrade_execute_calls(_revision_path(), function="downgrade")
    assert all(call.sql is not None for call in calls)
    statements = [_collapsed(call.sql or "") for call in calls]
    assert statements[0] == "SET LOCAL lock_timeout = '3s'"
    expected = (
        [
            f"ALTER TABLE coord.{table} DROP CONSTRAINT IF EXISTS {name}"
            for table, name in reversed(_CHECKS)
        ]
        + [f"DROP INDEX IF EXISTS coord.{name}" for _, name in reversed(_INDEXES)]
        + [
            f"ALTER TABLE coord.{table} DROP COLUMN IF EXISTS {column}"
            for table, column, *_ in reversed(_COLUMNS)
        ]
    )
    assert statements[1:] == expected


def test_the_file_carries_the_idempotency_marker_the_classifier_reads() -> None:
    assert "if not exists" in _revision_source().lower()


def test_no_op_other_than_execute_and_get_context_is_used() -> None:
    """``op.get_bind()`` (SQL outside ``op.execute``) is rejected by the classifier."""
    tree = ast.parse(_revision_source(), filename=str(_revision_path()))
    used = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    }
    assert used == {"execute", "get_context"}, used


# ---------------------------------------------------------------------------
# live (self-skips without a test Postgres)
# ---------------------------------------------------------------------------


def _columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT column_name FROM information_schema.columns
                 WHERE table_schema = :schema AND table_name = :table
                """
            ),
            {"schema": _SCHEMA, "table": table},
        ).all()
    return {row[0] for row in rows}


def _constraints(engine: Engine, table: str) -> dict[str, tuple[str, bool]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conname, pg_get_constraintdef(oid), convalidated
                  FROM pg_constraint
                 WHERE conrelid = to_regclass(:qualified)
                """
            ),
            {"qualified": f"{_SCHEMA}.{table}"},
        ).all()
    return {name: (definition, validated) for name, definition, validated in rows}


def _indexes(engine: Engine, table: str) -> dict[str, str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = :schema AND tablename = :table
                """
            ),
            {"schema": _SCHEMA, "table": table},
        ).all()
    return {row[0]: row[1] for row in rows}


_Catalog = dict[str, tuple[set[str], dict[str, tuple[str, bool]], dict[str, str]]]


def _catalog(engine: Engine) -> _Catalog:
    return {
        table: (
            _columns(engine, table),
            _constraints(engine, table),
            _indexes(engine, table),
        )
        for table in _TABLES
    }


def _insert_group(
    engine: Engine,
    *,
    kind: str | None = None,
    ingest_source: str | None = None,
) -> uuid.UUID:
    """One group; ``kind``/``ingest_source`` only after the upgrade."""
    group_id = uuid.uuid4()
    columns = ["group_id", "tenant_id", "name", "target_url"]
    values = [":group_id", ":tenant_id", "'checkout flow'", "'https://app.test'"]
    params: dict[str, object] = {"group_id": group_id, "tenant_id": uuid.uuid4()}
    if kind is not None:
        columns.append("kind")
        values.append(":kind")
        params["kind"] = kind
    if ingest_source is not None:
        columns.append("ingest_source")
        values.append("CAST(:ingest_source AS jsonb)")
        params["ingest_source"] = ingest_source
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO coord.condition_groups ({', '.join(columns)}) "
                f"VALUES ({', '.join(values)})"
            ),
            params,
        )
    return group_id


def _insert_run(
    engine: Engine, group_id: uuid.UUID, *, source_ref: str | None = None
) -> uuid.UUID:
    run_id = uuid.uuid4()
    extra_col, extra_val = ("", "")
    params: dict[str, object] = {
        "run_id": run_id,
        "tenant_id": uuid.uuid4(),
        "group_id": group_id,
    }
    if source_ref is not None:
        extra_col, extra_val = (", source_ref", ", :source_ref")
        params["source_ref"] = source_ref
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO coord.condition_runs
                    (run_id, tenant_id, group_id, finished_at, status, trigger{extra_col})
                VALUES (:run_id, :tenant_id, :group_id, now(), 'pass', 'ingest'{extra_val})
                """
            ),
            params,
        )
    return run_id


def _seed(engine: Engine) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """A group, a check and a finished run, written at the parent revision."""
    group_id = _insert_group(engine)
    condition_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.conditions (condition_id, tenant_id, group_id, text)
                VALUES (:condition_id, :tenant_id, :group_id, 'the cart keeps its items')
                """
            ),
            {
                "condition_id": condition_id,
                "tenant_id": uuid.uuid4(),
                "group_id": group_id,
            },
        )
    run_id = _insert_run(engine, group_id)
    return group_id, condition_id, run_id


def _row(engine: Engine, table: str, key: str, value: uuid.UUID) -> dict[str, object]:
    with engine.connect() as conn:
        row = conn.execute(
            text(f"SELECT * FROM {_SCHEMA}.{table} WHERE {key} = :value"),
            {"value": value},
        ).one()
    return dict(row._mapping)


def _assert_planned_objects(engine: Engine, *, present: bool) -> None:
    for table, column, data_type, nullable, default in _COLUMNS:
        info = column_info(engine, table, column)
        if present:
            assert info == (data_type, nullable, default), (table, column, info)
        else:
            assert info is None, (table, column, info)
    for table, name in _INDEXES:
        assert (name in _indexes(engine, table)) is present, (table, name)
    for table, name in _CHECKS:
        assert (name in _constraints(engine, table)) is present, (table, name)


@_needs_pg
def test_live_up_down_up_adds_and_drops_exactly_the_planned_objects() -> None:
    root = backend_root()
    parent = _parent_revision_id()
    with ephemeral_database(admin_database_url(), "condkinds04") as (engine, db_url):
        # 1. Parent: the three tables exist, none of this revision's objects do.
        run_alembic(root, db_url, "upgrade", parent)
        _assert_planned_objects(engine, present=False)
        baseline = _catalog(engine)
        group_id, condition_id, run_id = _seed(engine)
        seeded = {
            "condition_groups": _row(engine, "condition_groups", "group_id", group_id),
            "conditions": _row(engine, "conditions", "condition_id", condition_id),
            "condition_runs": _row(engine, "condition_runs", "run_id", run_id),
        }

        # 2. Upgrade: exactly the planned objects; the seeded rows keep every
        #    value, the group reads 'judged' and every other new column NULL.
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_planned_objects(engine, present=True)
        for table, (columns, constraints, indexes) in baseline.items():
            added = {c for t, c, *_ in _COLUMNS if t == table}
            assert _columns(engine, table) == columns | added
            assert set(_constraints(engine, table)) == set(constraints) | {
                n for t, n in _CHECKS if t == table
            }
            assert set(_indexes(engine, table)) == set(indexes) | {
                n for t, n in _INDEXES if t == table
            }
        for table, key, value in (
            ("condition_groups", "group_id", group_id),
            ("conditions", "condition_id", condition_id),
            ("condition_runs", "run_id", run_id),
        ):
            row = _row(engine, table, key, value)
            new = {c for t, c, *_ in _COLUMNS if t == table}
            assert {k: v for k, v in row.items() if k not in new} == seeded[table]
            expected_new: dict[str, object] = dict.fromkeys(new)
            if table == "condition_groups":
                expected_new["kind"] = "judged"
            assert {k: row[k] for k in new} == expected_new

        # 3. Every NOT VALID CHECK would validate against the pre-existing
        #    rows (rolled back, so the catalogue keeps NOT VALID).
        with engine.connect() as conn:
            trans = conn.begin()
            for table, name in _CHECKS:
                conn.execute(
                    text(f"ALTER TABLE {_SCHEMA}.{table} VALIDATE CONSTRAINT {name}")
                )
            trans.rollback()
        for table, name in _CHECKS:
            assert _constraints(engine, table)[name][1] is False, name

        # 4. Downgrade: back to the parent catalogue; the rows keep their values.
        run_alembic(root, db_url, "downgrade", parent)
        _assert_planned_objects(engine, present=False)
        assert _catalog(engine) == baseline
        assert (
            _row(engine, "condition_groups", "group_id", group_id)
            == seeded["condition_groups"]
        )
        assert (
            _row(engine, "condition_runs", "run_id", run_id) == seeded["condition_runs"]
        )

        # 5. Re-upgrade: the objects are back.
        run_alembic(root, db_url, "upgrade", _REVISION_ID)
        _assert_planned_objects(engine, present=True)
        module = load_revision_module(_revision_path(), f"_rerun_{_REVISION_ID}")
        assert module.revision == _REVISION_ID


@pytest.fixture(scope="module")
def upgraded_engine() -> Iterator[Engine]:
    """One throwaway database at this revision, shared by the refusal tests."""
    if not can_connect(admin_database_url()):
        pytest.skip("test Postgres unreachable via DATABASE_URL")
    with ephemeral_database(admin_database_url(), "condkinds04r") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        yield engine


def _refused_by(exc: pytest.ExceptionInfo[IntegrityError], name: str) -> None:
    diag = getattr(exc.value.orig, "diag", None)
    constraint = getattr(diag, "constraint_name", None)
    assert constraint == name or name in str(exc.value), str(exc.value)


@_needs_pg
def test_an_ingested_spec_group_with_no_source_is_refused(
    upgraded_engine: Engine,
) -> None:
    with pytest.raises(IntegrityError) as exc:
        _insert_group(upgraded_engine, kind="ingested-spec")
    _refused_by(exc, "ck_condition_groups_ingested_spec_requires_source")
    # The admitted shape next to it: with a source it is written.
    _insert_group(
        upgraded_engine,
        kind="ingested-spec",
        ingest_source='{"repo": "o/r", "workflow": "acceptance.yml"}',
    )


@_needs_pg
def test_a_judged_group_with_a_source_is_refused(upgraded_engine: Engine) -> None:
    with pytest.raises(IntegrityError) as exc:
        _insert_group(upgraded_engine, kind="judged", ingest_source='{"repo": "o/r"}')
    _refused_by(exc, "ck_condition_groups_judged_forbids_source")
    # The default kind is 'judged', so an omitted kind is held to the same rule.
    with pytest.raises(IntegrityError) as exc_default:
        _insert_group(upgraded_engine, ingest_source='{"repo": "o/r"}')
    _refused_by(exc_default, "ck_condition_groups_judged_forbids_source")


@_needs_pg
def test_an_unknown_kind_and_an_unknown_build_basis_are_refused(
    upgraded_engine: Engine,
) -> None:
    with pytest.raises(IntegrityError) as exc:
        _insert_group(upgraded_engine, kind="ci")
    _refused_by(exc, "ck_condition_groups_kind")
    group_id = _insert_group(upgraded_engine, kind="deployed-watch")
    run_id = _insert_run(upgraded_engine, group_id)
    with pytest.raises(IntegrityError) as exc_basis:
        with upgraded_engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.condition_runs SET build_sha_basis = 'latest' "
                    "WHERE run_id = :run_id"
                ),
                {"run_id": run_id},
            )
    _refused_by(exc_basis, "ck_condition_runs_build_sha_basis")


@_needs_pg
def test_a_duplicate_source_ref_in_one_group_is_refused(
    upgraded_engine: Engine,
) -> None:
    group_id = _insert_group(
        upgraded_engine, kind="ingested-spec", ingest_source='{"repo": "o/r"}'
    )
    other_group_id = _insert_group(
        upgraded_engine, kind="ingested-spec", ingest_source='{"repo": "o/r"}'
    )
    _insert_run(upgraded_engine, group_id, source_ref="gh:101/1/202")
    with pytest.raises(IntegrityError) as exc:
        _insert_run(upgraded_engine, group_id, source_ref="gh:101/1/202")
    _refused_by(exc, "uq_condition_runs_group_source_ref")
    # Partial and per group: another group, another attempt, and NULLs are free.
    _insert_run(upgraded_engine, other_group_id, source_ref="gh:101/1/202")
    _insert_run(upgraded_engine, group_id, source_ref="gh:101/2/202")
    _insert_run(upgraded_engine, group_id)
    _insert_run(upgraded_engine, group_id)


@_needs_pg
def test_a_duplicate_external_ref_in_one_group_is_refused(
    upgraded_engine: Engine,
) -> None:
    group_id = _insert_group(
        upgraded_engine, kind="ingested-spec", ingest_source='{"repo": "o/r"}'
    )

    def insert_condition(external_ref: str | None) -> None:
        with upgraded_engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO coord.conditions
                        (condition_id, tenant_id, group_id, text, external_ref, parent_ref)
                    VALUES (:cid, :tid, :gid, 'a criterion', :ref, 'REQ-CTR-10')
                    """
                ),
                {
                    "cid": uuid.uuid4(),
                    "tid": uuid.uuid4(),
                    "gid": group_id,
                    "ref": external_ref,
                },
            )

    insert_condition("AC-CTR-10-1")
    with pytest.raises(IntegrityError) as exc:
        insert_condition("AC-CTR-10-1")
    _refused_by(exc, "uq_conditions_group_external_ref")
    insert_condition(None)
    insert_condition(None)
