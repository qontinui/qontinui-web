"""Structural, constraint and round-trip tests for ``coord_repo_tenant_bindings_01``.

Phase 1 of plan ``2026-10-17-per-repo-tenant-binding-overrides-the-org-tenant``
creates ``coord.repo_tenant_bindings``: at most one row per repository, naming
the tenant that governs it over its GitHub org's tenant (D1). coord's later
phases read it on every repo-to-tenant resolution and its bind door writes it,
so each property they rely on is asserted against the live catalog, with the
expected values spelled out here. Changing the revision without changing this
test turns it red.

Without a database (always runs):

1. **Chain wiring.** ``revision`` / ``down_revision`` are what this test pins,
   read through the head gate's own parser.
2. **The upgrade path is the shape coord's migration classifier admits as
   ``AutoSafeIfNewTables``**: exactly two static, ``coord``-qualified
   statements, ``CREATE TABLE IF NOT EXISTS`` and then a ``CREATE INDEX IF NOT
   EXISTS`` on that same new table, with no ``DROP``, ``GRANT``, ``REVOKE`` or
   ``CONCURRENTLY``. The downgrade drops exactly the table.

With a database (skipped when none is reachable):

3. **The table lands as declared**: column types, nullability and defaults;
   the primary key is exactly ``(repo)``; ``tenant_id`` references
   ``coord.tenants`` ``ON DELETE CASCADE``; the tenant index is on exactly
   ``(tenant_id)``; the CHECK set is exactly the three column CHECKs; and the
   table has a replica identity (its primary key).
4. **Valid bindings insert**, including one for a repository that does not
   exist yet, and the defaults stamp.
5. **Each CHECK refuses what it exists to refuse**, by constraint name: a
   mixed-case or malformed ``repo``, an empty or whitespace-only ``reason``
   (spaces, a tab, newlines), an empty ``bound_by``.
6. **One binding per repository**: a second row for the same ``repo`` is
   refused on the primary key and the first row is untouched.
7. **An unknown tenant and every NULL in a NOT NULL column are refused.**
8. **Deleting the bound tenant deletes its bindings, and only its bindings.**
9. **Re-running the upgrade is a no-op** (the ``IF NOT EXISTS`` guards the
   classifier's admission rests on), through alembic's own ``op.execute``.
10. **Up -> down -> up leaves no residue**, and the downgrade leaves the
    ``coord.tenants`` row the binding referenced alone.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, migrated by the real alembic chain. A skip proves nothing —
point it at a live instance with ``QONTINUI_TEST_PG_DSN`` (or
``QONTINUI_TEST_PG=host:port``).
"""

from __future__ import annotations

import ast
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
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
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
    upgrade_execute_calls,
)

# Pinned rather than "head" so a later revision cannot change what this walks.
# MUST equal the revision's own down_revision (the first test enforces it).
_REVISION_ID = "coord_repo_tenant_bindings_01"
_PARENT_REVISION_ID = "replident_01"
_REVISION_FILENAME = "coord_repo_tenant_bindings_01.py"

_SCHEMA = "coord"
_TABLE = "repo_tenant_bindings"
_QUALIFIED = f"{_SCHEMA}.{_TABLE}"
_INDEX = "idx_repo_tenant_bindings_tenant"

# (name, information_schema data_type, nullable, default-substring or None for
# "no default"). Pinned as literals: coord's readers and its bind door name
# exactly these columns.
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("repo", "text", False, None),
    ("tenant_id", "uuid", False, None),
    ("bound_by", "text", False, None),
    ("reason", "text", False, None),
    ("decision_ref", "text", True, None),
    ("created_at", "timestamp with time zone", False, "now()"),
    ("updated_at", "timestamp with time zone", False, "now()"),
)

# PostgreSQL's names for the constraints the revision declares inline.
_PKEY = "repo_tenant_bindings_pkey"
_FKEY = "repo_tenant_bindings_tenant_id_fkey"
_REPO_CHECK = "repo_tenant_bindings_repo_check"
_BOUND_BY_CHECK = "repo_tenant_bindings_bound_by_check"
_REASON_CHECK = "repo_tenant_bindings_reason_check"
_EXPECTED_CHECKS = frozenset({_REPO_CHECK, _BOUND_BY_CHECK, _REASON_CHECK})

# SQLSTATEs.
_NOT_NULL_VIOLATION = "23502"
_FOREIGN_KEY_VIOLATION = "23503"
_UNIQUE_VIOLATION = "23505"
_CHECK_VIOLATION = "23514"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG_DSN or QONTINUI_TEST_PG)",
)

_INSERT = text(
    f"""
    INSERT INTO {_QUALIFIED} (repo, tenant_id, bound_by, reason, decision_ref)
    VALUES (:repo, CAST(:tenant_id AS uuid), :bound_by, :reason, :decision_ref)
    """
)


def _revision_path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module():
    return load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")


def _normalized(sql: str) -> str:
    return " ".join(sql.split())


@pytest.fixture(scope="module")
def upgraded() -> Iterator[Engine]:
    """One database migrated to this revision, shared by the non-destructive tests.

    Every test that writes uses repositories and tenants of its own, so the
    tests do not depend on each other's rows or on their order.
    """
    if not can_connect(admin_database_url()):
        pytest.skip(
            "test Postgres unreachable (set QONTINUI_TEST_PG_DSN or QONTINUI_TEST_PG)"
        )
    with ephemeral_database(admin_database_url(), "rtb01") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        yield engine


def _new_tenant(engine: Engine) -> str:
    tenant_id = str(uuid.uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (CAST(:t AS uuid), :s, :s)"
            ),
            {"t": tenant_id, "s": f"rtb-{tenant_id[:8]}"},
        )
    return tenant_id


def _row(tenant: str, /, **overrides: object) -> dict[str, object]:
    """A row that satisfies every constraint, with ``overrides`` applied.

    ``tenant`` is positional-only so an override may replace ``tenant_id``.
    The default ``repo`` is unique per call, so a refusal case that overrides
    another field cannot collide with a row an earlier test inserted.
    """
    row: dict[str, object] = {
        "repo": f"rtb-test/binding-{uuid.uuid4().hex[:12]}",
        "tenant_id": tenant,
        "bound_by": "operator:rtb-test",
        "reason": "the operator bound this repository to its own tenant",
        "decision_ref": None,
    }
    row.update(overrides)
    return row


def _bind(engine: Engine, row: dict[str, object]) -> None:
    with engine.begin() as conn:
        conn.execute(_INSERT, row)


def _refused(engine: Engine, row: dict[str, object]) -> tuple[str | None, str | None]:
    """Insert ``row``, require a refusal, return ``(SQLSTATE, constraint name)``."""
    with pytest.raises(IntegrityError) as refused:
        _bind(engine, row)
    orig = refused.value.orig
    diag = getattr(orig, "diag", None)
    return getattr(orig, "pgcode", None), getattr(diag, "constraint_name", None)


def _bound_tenant(engine: Engine, repo: str) -> str | None:
    with engine.connect() as conn:
        return conn.execute(
            text(f"SELECT tenant_id::text FROM {_QUALIFIED} WHERE repo = :repo"),
            {"repo": repo},
        ).scalar_one_or_none()


def _index_shape(engine: Engine, index: str) -> tuple[object, ...] | None:
    """``(primary, unique, valid, plain, key columns)`` of ``coord.<index>``.

    ``plain`` is "no predicate and no expression". ``None`` when no index of
    that name exists ON THIS TABLE.
    """
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT i.indisprimary, i.indisunique, i.indisvalid,
                       i.indpred IS NULL AND i.indexprs IS NULL,
                       ARRAY(SELECT a.attname::text
                               FROM unnest(i.indkey::int2[]) WITH ORDINALITY
                                    AS k(attnum, ord)
                               JOIN pg_attribute a
                                 ON a.attrelid = i.indrelid
                                AND a.attnum = k.attnum
                              ORDER BY k.ord)
                  FROM pg_index i
                 WHERE i.indexrelid = to_regclass(:idx)
                   AND i.indrelid = to_regclass(:rel)
                """
            ),
            {"idx": f"{_SCHEMA}.{index}", "rel": _QUALIFIED},
        ).one_or_none()
    if row is None:
        return None
    return (row[0], row[1], row[2], row[3], tuple(row[4]))


# ---------------------------------------------------------------------------
# Source-level checks (no database).
# ---------------------------------------------------------------------------


def test_the_revision_is_wired_to_its_pinned_parent() -> None:
    source = _revision_path().read_text(encoding="utf-8")
    assert declared_parent_revision_id(source, _REVISION_ID) == _PARENT_REVISION_ID
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    doc = ast.get_docstring(ast.parse(source)) or ""
    assert f"Revision ID: {_REVISION_ID}" in doc
    assert f"Revises: {_PARENT_REVISION_ID}" in doc


def test_the_upgrade_is_two_static_coord_statements_the_classifier_admits() -> None:
    calls = upgrade_execute_calls(_revision_path())
    statements = [call.sql for call in calls]
    assert all(sql is not None for sql in statements), (
        "every op.execute in upgrade() must take ONE static string literal; "
        f"got {statements!r}"
    )
    # A non-concurrent index on a table this file creates is admitted only as a
    # new-table claim; CONCURRENTLY (and so an autocommit block) is not needed.
    assert [call.in_autocommit_block for call in calls] == [False, False]
    create, index = (_normalized(sql or "") for sql in statements)
    assert create.startswith(f"CREATE TABLE IF NOT EXISTS {_QUALIFIED} ("), create
    assert "REFERENCES coord.tenants(tenant_id) ON DELETE CASCADE" in create, create
    assert index == (
        f"CREATE INDEX IF NOT EXISTS {_INDEX} ON {_QUALIFIED} (tenant_id)"
    ), index
    for statement in (create, index):
        upper = statement.upper()
        for token in ("DROP", "GRANT", "REVOKE", "CONCURRENTLY", ";"):
            assert token not in upper, (token, statement)


def test_the_downgrade_drops_exactly_the_table() -> None:
    tree = ast.parse(_revision_path().read_text(encoding="utf-8"))
    downgrade = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "downgrade"
    )
    executed = [
        node.args[0].value
        for node in ast.walk(downgrade)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "execute"
        and len(node.args) == 1
        and isinstance(node.args[0], ast.Constant)
    ]
    assert executed == [f"DROP TABLE IF EXISTS {_QUALIFIED}"], executed


# ---------------------------------------------------------------------------
# The catalog at this revision.
# ---------------------------------------------------------------------------


def test_the_table_lands_with_its_columns_and_defaults(upgraded: Engine) -> None:
    assert table_exists(upgraded, _SCHEMA, _TABLE)
    for name, data_type, nullable, default in _EXPECTED_COLUMNS:
        info = column_info(upgraded, _TABLE, name, schema=_SCHEMA)
        assert info is not None, f"{_QUALIFIED}.{name} missing"
        assert info[0] == data_type, (name, info)
        assert info[1] == ("YES" if nullable else "NO"), (name, info)
        if default is None:
            assert info[2] is None, (name, info)
        else:
            assert info[2] is not None and default in info[2], (name, info)
    column_count = scalar(
        upgraded,
        """
        SELECT count(*) FROM information_schema.columns
         WHERE table_schema = :schema AND table_name = :table
        """,
        schema=_SCHEMA,
        table=_TABLE,
    )
    assert column_count == len(_EXPECTED_COLUMNS)


def test_the_key_the_foreign_key_and_the_index(upgraded: Engine) -> None:
    # (primary, unique, valid, plain, key columns)
    assert _index_shape(upgraded, _PKEY) == (True, True, True, True, ("repo",))
    assert index_exists(upgraded, _INDEX, schema=_SCHEMA)
    assert _index_shape(upgraded, _INDEX) == (
        False,
        False,
        True,
        True,
        ("tenant_id",),
    )

    with upgraded.connect() as conn:
        foreign_keys = conn.execute(
            text(
                """
                SELECT con.conname::text,
                       con.confrelid = to_regclass('coord.tenants'),
                       con.confdeltype::text,
                       ARRAY(SELECT a.attname::text
                               FROM unnest(con.conkey) AS k(attnum)
                               JOIN pg_attribute a
                                 ON a.attrelid = con.conrelid
                                AND a.attnum = k.attnum),
                       ARRAY(SELECT a.attname::text
                               FROM unnest(con.confkey) AS k(attnum)
                               JOIN pg_attribute a
                                 ON a.attrelid = con.confrelid
                                AND a.attnum = k.attnum)
                  FROM pg_constraint con
                 WHERE con.conrelid = to_regclass(:rel) AND con.contype = 'f'
                """
            ),
            {"rel": _QUALIFIED},
        ).fetchall()
    # confdeltype 'c' is ON DELETE CASCADE.
    assert [tuple(fk) for fk in foreign_keys] == [
        (_FKEY, True, "c", ["tenant_id"], ["tenant_id"])
    ], foreign_keys

    with upgraded.connect() as conn:
        checks = {
            row[0]
            for row in conn.execute(
                text(
                    """
                    SELECT conname FROM pg_constraint
                     WHERE conrelid = to_regclass(:rel) AND contype = 'c'
                    """
                ),
                {"rel": _QUALIFIED},
            )
        }
    assert checks == _EXPECTED_CHECKS, sorted(checks)

    # 'd' (DEFAULT) identifies rows by the primary key asserted above.
    assert (
        scalar(
            upgraded,
            "SELECT relreplident FROM pg_class WHERE oid = to_regclass(:rel)",
            rel=_QUALIFIED,
        )
        == "d"
    )


# ---------------------------------------------------------------------------
# What the table accepts and refuses.
# ---------------------------------------------------------------------------


def test_valid_bindings_insert_and_stamp_their_defaults(upgraded: Engine) -> None:
    tenant = _new_tenant(upgraded)
    accepted = (
        # The measured case: a repository in an org bound to another tenant.
        ("meryts/bauhaus-b2b-dev-notes", None),
        # A repository that does not exist yet can be bound (D1).
        (
            "meryts/bauhaus-b2b-shop",
            "decision_record/repositories-live-in-the-meryts-org",
        ),
        ("0rg-1/.github", None),
        ("a/b", None),
        ("qontinui/qontinui_web.v2-x", None),
    )
    for repo, decision_ref in accepted:
        _bind(upgraded, _row(tenant, repo=repo, decision_ref=decision_ref))
        assert _bound_tenant(upgraded, repo) == tenant, repo
        with upgraded.connect() as conn:
            created, updated, stored_ref = conn.execute(
                text(
                    f"""
                    SELECT created_at, updated_at, decision_ref
                      FROM {_QUALIFIED} WHERE repo = :repo
                    """
                ),
                {"repo": repo},
            ).one()
        assert created is not None and created == updated, (repo, created, updated)
        assert stored_ref == decision_ref, (repo, stored_ref)


@pytest.mark.parametrize(
    ("overrides", "constraint"),
    [
        # coord's key is case-sensitive text: without this refusal `Meryts/x`
        # and `meryts/x` would be two bindings for one repository.
        pytest.param(
            {"repo": "Meryts/bauhaus-b2b-dev-notes"}, _REPO_CHECK, id="mixed-case-owner"
        ),
        pytest.param(
            {"repo": "meryts/Bauhaus-B2B-Dev-Notes"}, _REPO_CHECK, id="mixed-case-name"
        ),
        pytest.param({"repo": "bauhaus-b2b-dev-notes"}, _REPO_CHECK, id="no-slash"),
        pytest.param(
            {"repo": "meryts/bauhaus/dev-notes"}, _REPO_CHECK, id="two-slashes"
        ),
        pytest.param({"repo": "meryts/"}, _REPO_CHECK, id="empty-name"),
        pytest.param({"repo": "/bauhaus-b2b-dev-notes"}, _REPO_CHECK, id="empty-owner"),
        pytest.param(
            {"repo": "-meryts/bauhaus-b2b-dev-notes"},
            _REPO_CHECK,
            id="owner-leading-hyphen",
        ),
        pytest.param({"repo": "meryts/bauhaus b2b"}, _REPO_CHECK, id="space-in-name"),
        pytest.param(
            {"repo": " meryts/bauhaus-b2b-dev-notes"}, _REPO_CHECK, id="leading-space"
        ),
        pytest.param(
            {"repo": "meryts/bauhaus-b2b-dev-notes\n"},
            _REPO_CHECK,
            id="trailing-newline",
        ),
        pytest.param({"repo": ""}, _REPO_CHECK, id="empty-repo"),
        pytest.param({"reason": ""}, _REASON_CHECK, id="empty-reason"),
        pytest.param({"reason": "   "}, _REASON_CHECK, id="spaces-only-reason"),
        pytest.param({"reason": "\t"}, _REASON_CHECK, id="tab-only-reason"),
        pytest.param({"reason": "\n \r\n"}, _REASON_CHECK, id="newline-only-reason"),
        pytest.param({"bound_by": ""}, _BOUND_BY_CHECK, id="empty-bound-by"),
    ],
)
def test_a_check_refuses_the_value_it_exists_to_refuse(
    upgraded: Engine, overrides: dict[str, object], constraint: str
) -> None:
    tenant = _new_tenant(upgraded)
    pgcode, name = _refused(upgraded, _row(tenant, **overrides))
    assert (pgcode, name) == (_CHECK_VIOLATION, constraint)


def test_a_repository_has_at_most_one_binding(upgraded: Engine) -> None:
    first, second = _new_tenant(upgraded), _new_tenant(upgraded)
    repo = "rtb-pk/one-binding"
    _bind(upgraded, _row(first, repo=repo))
    pgcode, name = _refused(upgraded, _row(second, repo=repo))
    assert (pgcode, name) == (_UNIQUE_VIOLATION, _PKEY)
    assert _bound_tenant(upgraded, repo) == first


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        pytest.param(
            {"tenant_id": str(uuid.uuid4())},
            (_FOREIGN_KEY_VIOLATION, _FKEY),
            id="unknown-tenant",
        ),
        pytest.param(
            {"tenant_id": None}, (_NOT_NULL_VIOLATION, None), id="null-tenant"
        ),
        pytest.param({"repo": None}, (_NOT_NULL_VIOLATION, None), id="null-repo"),
        pytest.param(
            {"bound_by": None}, (_NOT_NULL_VIOLATION, None), id="null-bound-by"
        ),
        pytest.param({"reason": None}, (_NOT_NULL_VIOLATION, None), id="null-reason"),
    ],
)
def test_an_unknown_tenant_and_nulls_are_refused(
    upgraded: Engine,
    overrides: dict[str, object],
    expected: tuple[str, str | None],
) -> None:
    tenant = _new_tenant(upgraded)
    pgcode, name = _refused(upgraded, _row(tenant, **overrides))
    assert pgcode == expected[0], (pgcode, name)
    if expected[1] is not None:
        assert name == expected[1], (pgcode, name)


def test_deleting_the_bound_tenant_deletes_only_its_bindings(upgraded: Engine) -> None:
    doomed, kept = _new_tenant(upgraded), _new_tenant(upgraded)
    doomed_repos = ("rtb-cascade/doomed-1", "rtb-cascade/doomed-2")
    kept_repo = "rtb-cascade/kept"
    for repo in doomed_repos:
        _bind(upgraded, _row(doomed, repo=repo))
    _bind(upgraded, _row(kept, repo=kept_repo))

    with upgraded.begin() as conn:
        conn.execute(
            text("DELETE FROM coord.tenants WHERE tenant_id = CAST(:t AS uuid)"),
            {"t": doomed},
        )

    for repo in doomed_repos:
        assert _bound_tenant(upgraded, repo) is None, repo
    remaining = scalar(
        upgraded,
        f"SELECT count(*) FROM {_QUALIFIED} WHERE tenant_id = CAST(:t AS uuid)",
        t=doomed,
    )
    assert remaining == 0
    assert _bound_tenant(upgraded, kept_repo) == kept


def test_re_running_the_upgrade_is_a_no_op(upgraded: Engine) -> None:
    tenant = _new_tenant(upgraded)
    repo = "rtb-rerun/still-bound"
    _bind(upgraded, _row(tenant, repo=repo))

    module = _module()
    with upgraded.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()

    assert _bound_tenant(upgraded, repo) == tenant
    index_count = scalar(
        upgraded,
        "SELECT count(*) FROM pg_index WHERE indrelid = to_regclass(:rel)",
        rel=_QUALIFIED,
    )
    assert index_count == 2  # the primary key and the tenant index, no duplicate


# ---------------------------------------------------------------------------
# The round trip (its own database: it downgrades).
# ---------------------------------------------------------------------------


@_needs_pg
def test_up_down_up_leaves_no_residue() -> None:
    with ephemeral_database(admin_database_url(), "rtb01_rt") as (engine, url):
        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        tenant = _new_tenant(engine)
        repo = "rtb-roundtrip/bound"
        _bind(engine, _row(tenant, repo=repo))

        run_alembic(backend_root(), url, "downgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _INDEX, schema=_SCHEMA)
        assert (
            scalar(engine, "SELECT version_num FROM public.alembic_version")
            == _PARENT_REVISION_ID
        )
        # The binding's tenant is a neighbouring coord row the downgrade leaves.
        tenant_rows = scalar(
            engine,
            "SELECT count(*) FROM coord.tenants WHERE tenant_id = CAST(:t AS uuid)",
            t=tenant,
        )
        assert tenant_rows == 1

        run_alembic(backend_root(), url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX, schema=_SCHEMA)
        assert (
            scalar(engine, "SELECT version_num FROM public.alembic_version")
            == _REVISION_ID
        )
        # A downgrade discards bindings by design; the table comes back empty.
        assert _bound_tenant(engine, repo) is None
