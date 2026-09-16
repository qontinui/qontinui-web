"""Structural and round-trip test for the ``remote_create_01`` revision —
Phase 3b of plan ``2026-09-11-headless-runner-parity-from-a-headed-runner``.

Why this file exists
====================

``remote_create_01`` is what the remote-terminal-CREATE feature is blocked on:
coord's mint gate reads ``coord.devices.accept_remote_create`` and fails CLOSED
while the column is absent, and the target runner's independent grant check
reads a list backed by ``coord.create_grants``. So this revision is the
difference between "the feature is off" and "the feature exists", and two of its
properties are load-bearing in a way prose alone does not hold:

1. **The DEFAULT is ``'off'``, not the attach column's ``'same_user'``.** If it
   ever became an admitting value, remote PTY creation would silently turn
   itself on for every device in the fleet at the next deploy. That is asserted
   against the live catalog here, not only in the docstring.
2. **The CHECK admits exactly three values.** Coord reads an out-of-set value as
   the default rather than as an admitting arm, but a column that can HOLD one
   is a column an operator can be confused by.

Nothing else in this repo checks either: ``migration-reversal.yml`` proves only
up → down → up and is non-gating, ``alembic-heads-pr`` counts heads, and
``forbid-public-schema`` excludes ``backend/alembic/versions/`` wholesale.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the test
Postgres, migrated by the real alembic chain. Without a reachable Postgres the
DB-backed tests skip and the source-level ones still run.
"""

from __future__ import annotations

import ast
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    index_exists,
    load_revision_module,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "remote_create_01"
_REVISION_FILENAME = "remote_create_01_accept_remote_create_and_create_grants.py"

_SCHEMA = "coord"
_TABLE = "create_grants"
_INDEX = "idx_create_grants_target_expires"

_COLUMN = "accept_remote_create"
_CHECK_CONSTRAINT = "coord_devices_accept_remote_create_check"

# The dial's vocabulary, and its DEFAULT. Pinned as literals so a change in the
# revision reddens this test rather than moving with it.
_ALLOWED = ("off", "same_user", "tenant")
_DEFAULT = "off"
# The ATTACH column's default, which this one must NOT share. Enabling remote
# attach is not consent to a remote peer spawning PTYs.
_ATTACH_DEFAULT = "same_user"

# (name, information_schema data_type, nullable, default-substring or None)
_EXPECTED_COLUMNS: tuple[tuple[str, str, bool, str | None], ...] = (
    ("jti", "uuid", False, None),
    ("tenant_id", "uuid", False, None),
    ("source_device_id", "uuid", False, None),
    ("target_device_id", "uuid", False, None),
    ("source_user_id", "uuid", True, None),
    ("expires_at", "timestamp with time zone", False, None),
    ("created_at", "timestamp with time zone", False, "now()"),
    ("consumed_at", "timestamp with time zone", True, None),
)

# Columns the ATTACH table has and this one must NOT: a create grant addresses a
# DEVICE and has no session, which is the whole difference between the two
# capabilities. Their presence here would mean the split had been undone.
_FORBIDDEN_COLUMNS = ("target_session_id", "terminal_id")

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason="test Postgres unreachable (set QONTINUI_TEST_PG=host:port)",
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


def _parent_revision_id() -> str:
    parent = _revision_module().down_revision
    assert isinstance(parent, str) and parent, "down_revision must name ONE parent"
    return parent


def _module_tree() -> ast.Module:
    return ast.parse(_revision_source(), filename=str(_revision_path()))


def _revision_id_of(path: Path) -> str | None:
    """The ``revision`` literal of a revision file, read without importing it.

    ``None`` when the file has no top-level ``revision = "<str>"`` — which is
    every non-revision module that happens to live in the directory, and would
    otherwise have to be special-cased by name.
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError):
        return None
    for node in tree.body:
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        if not any(isinstance(t, ast.Name) and t.id == "revision" for t in targets):
            continue
        value = node.value
        if isinstance(value, ast.Constant) and isinstance(value.value, str):
            return value.value
    return None


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _sql_literals(fn: ast.FunctionDef) -> list[str]:
    """Every string literal passed to an ``op.execute`` inside ``fn``."""
    out: list[str] = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "execute"):
            continue
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                out.append(arg.value)
    return out


# ---------------------------------------------------------------------------
# source-level (always run)
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_and_the_parent_is_a_real_sibling() -> None:
    """The chain is coherent, and the parent names exactly one real revision.

    The parent is read FROM the module rather than pinned to a literal: coord
    re-points ``down_revision`` at the live merged head at LAND time, so a pinned
    parent would red on every rebase. What is pinned is coherence.
    """
    module = _revision_module()
    assert module.revision == _REVISION_ID
    parent = _parent_revision_id()
    versions = _revision_path().parent
    # The sibling scan reads each file's ``revision = "..."`` with ``ast``
    # rather than IMPORTING it. Importing executes ~550 migration modules, some
    # of which import optional third-party packages (pgvector, for one), so an
    # import-based scan fails on any environment missing one of them — a
    # question about this revision's chaining answered by an unrelated package's
    # absence. The assignment is a plain literal in every file here.
    siblings = {
        rev
        for p in versions.glob("*.py")
        if p.name != _REVISION_FILENAME
        for rev in (_revision_id_of(p),)
        if rev is not None
    }
    assert parent in siblings, (
        f"down_revision {parent!r} names no revision in {versions}"
    )
    assert module.branch_labels is None
    assert module.depends_on is None


def test_docstring_header_matches_the_assignment() -> None:
    """``Revises:`` in the prose agrees with ``down_revision`` in the code.

    A drifted header is how a reader reconstructs the wrong chain; it has
    happened in this directory before.
    """
    doc = ast.get_docstring(_module_tree()) or ""
    assert f"Revision ID: {_REVISION_ID}" in doc
    assert f"Revises: {_parent_revision_id()}" in doc


def test_every_drop_is_inside_downgrade() -> None:
    """``upgrade()`` drops nothing but its own re-runnable CHECK constraint.

    A ``DROP TABLE`` / ``DROP COLUMN`` on the upgrade path is data loss on
    deploy. The one legitimate drop is the CHECK immediately before it is
    re-added, which is what makes that step idempotent — ``ADD CONSTRAINT`` has
    no ``IF NOT EXISTS`` form.
    """
    tree = _module_tree()
    for sql in _sql_literals(_function(tree, "upgrade")):
        upper = sql.upper()
        if "DROP" not in upper:
            continue
        assert "DROP CONSTRAINT IF EXISTS" in upper, (
            f"upgrade() must not drop anything but its own CHECK: {sql}"
        )
        assert _CHECK_CONSTRAINT in sql


def test_every_upgrade_object_is_coord_qualified() -> None:
    """Nothing lands in ``public``. An unqualified object is a schema bug that
    only shows up as a missing table at query time."""
    for sql in _sql_literals(_function(_module_tree(), "upgrade")):
        if "CREATE TABLE" in sql.upper():
            assert f"{_SCHEMA}.{_TABLE}" in sql, sql
        if "ALTER TABLE" in sql.upper():
            assert f"{_SCHEMA}.devices" in sql, sql
        if "CREATE INDEX" in sql.upper():
            assert f"ON {_SCHEMA}.{_TABLE}" in sql, sql


def test_the_source_declares_the_off_default_and_the_three_values() -> None:
    """The DDL itself, before any database is involved."""
    upgrade_sql = " ".join(_sql_literals(_function(_module_tree(), "upgrade")))
    assert f"DEFAULT '{_DEFAULT}'" in upgrade_sql
    assert f"DEFAULT '{_ATTACH_DEFAULT}'" not in upgrade_sql, (
        "the create dial must not inherit the attach dial's default"
    )
    for value in _ALLOWED:
        assert f"'{value}'" in upgrade_sql


def test_the_source_creates_no_session_shaped_column() -> None:
    """``coord.create_grants`` is not ``coord.attach_grants`` with extra nulls."""
    upgrade_sql = " ".join(_sql_literals(_function(_module_tree(), "upgrade")))
    for forbidden in _FORBIDDEN_COLUMNS:
        assert forbidden not in upgrade_sql, (
            f"a create grant addresses a DEVICE; {forbidden} belongs to the attach table"
        )


# ---------------------------------------------------------------------------
# DB-backed
# ---------------------------------------------------------------------------


def _seed_device(engine: Engine) -> tuple[uuid.UUID, uuid.UUID]:
    """A tenant and a device. Returns ``(tenant_id, device_id)``."""
    tenant_id = uuid.uuid4()
    device_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO coord.tenants (tenant_id, slug, display_name)
                VALUES (:tenant_id, :slug, :display_name)
                """
            ),
            {
                "tenant_id": tenant_id,
                "slug": f"rc01-{tenant_id.hex[:12]}",
                "display_name": "remote_create_01 test tenant",
            },
        )
        conn.execute(
            text(
                """
                INSERT INTO coord.devices (device_id, tenant_id, name, hostname)
                VALUES (:device_id, :tenant_id, :name, :hostname)
                """
            ),
            {
                "device_id": device_id,
                "tenant_id": tenant_id,
                "name": "rc01-test-device",
                "hostname": "rc01-test-host",
            },
        )
    return tenant_id, device_id


def _insert_grant(
    engine: Engine,
    *,
    tenant_id: uuid.UUID,
    source_device_id: uuid.UUID,
    target_device_id: uuid.UUID,
    jti: uuid.UUID | None = None,
    source_user_id: uuid.UUID | None = None,
    expires_in: str = "15 minutes",
) -> uuid.UUID:
    jti = jti or uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO {_SCHEMA}.{_TABLE}
                    (jti, tenant_id, source_device_id, target_device_id,
                     source_user_id, expires_at)
                VALUES (:jti, :tenant_id, :source_device_id, :target_device_id,
                        :source_user_id, now() + interval '{expires_in}')
                """
            ),
            {
                "jti": jti,
                "tenant_id": tenant_id,
                "source_device_id": source_device_id,
                "target_device_id": target_device_id,
                "source_user_id": source_user_id,
            },
        )
    return jti


@_needs_pg
def test_the_preference_column_lands_defaulting_off() -> None:
    """**The security-relevant assertion of this revision.**

    A device that has never been configured must read ``off``. If this default
    ever becomes an admitting value, every device in the fleet accepts remote PTY
    creation from the next deploy with nobody having opted in.
    """
    with ephemeral_database(admin_database_url(), "rc01_default") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        info = column_info(engine, "devices", _COLUMN, schema=_SCHEMA)
        assert info is not None, f"coord.devices.{_COLUMN} is missing"
        data_type, is_nullable, default = info
        assert data_type == "text"
        assert is_nullable == "NO"
        assert default is not None and f"'{_DEFAULT}'" in default, info

        # …and a row inserted with no opinion actually reads `off`.
        _, device_id = _seed_device(engine)
        stored = scalar(
            engine,
            f"SELECT {_COLUMN} FROM {_SCHEMA}.devices WHERE device_id = :d",
            d=device_id,
        )
        assert stored == _DEFAULT

        # The sibling attach dial is untouched and keeps its OWN, different
        # default — the two are separate consents.
        attach = column_info(engine, "devices", "accept_remote_attach", schema=_SCHEMA)
        assert attach is not None, (
            "the attach revision is an ancestor; its column must exist"
        )
        assert attach[2] is not None and f"'{_ATTACH_DEFAULT}'" in attach[2]
        assert _DEFAULT != _ATTACH_DEFAULT


@_needs_pg
def test_the_check_admits_exactly_the_three_values() -> None:
    with ephemeral_database(admin_database_url(), "rc01_check") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _, device_id = _seed_device(engine)

        for value in _ALLOWED:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE {_SCHEMA}.devices SET {_COLUMN} = :v WHERE device_id = :d"
                    ),
                    {"v": value, "d": device_id},
                )

        for rejected in ("everyone", "Off", "SAME_USER", "", "same-user"):
            with pytest.raises(Exception) as excinfo:
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            f"UPDATE {_SCHEMA}.devices SET {_COLUMN} = :v "
                            f"WHERE device_id = :d"
                        ),
                        {"v": rejected, "d": device_id},
                    )
            assert _CHECK_CONSTRAINT in str(excinfo.value), (
                rejected,
                str(excinfo.value),
            )

        # NULL is refused by NOT NULL, not by the CHECK — either way it cannot
        # be stored, which is what coord's "NULL reads as the default" arm is a
        # belt for rather than a live case.
        with pytest.raises(Exception):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE {_SCHEMA}.devices SET {_COLUMN} = NULL WHERE device_id = :d"
                    ),
                    {"d": device_id},
                )


@_needs_pg
def test_the_grant_table_lands_with_the_declared_shape() -> None:
    with ephemeral_database(admin_database_url(), "rc01_shape") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)

        for name, expected_type, nullable, default_fragment in _EXPECTED_COLUMNS:
            info = column_info(engine, _TABLE, name, schema=_SCHEMA)
            assert info is not None, f"{name} is missing"
            data_type, is_nullable, default = info
            assert data_type == expected_type, (name, info)
            assert (is_nullable == "YES") is nullable, (name, info)
            if default_fragment is None:
                assert default is None, (name, info)
            else:
                assert default is not None and default_fragment in default, (name, info)

        for forbidden in _FORBIDDEN_COLUMNS:
            assert column_info(engine, _TABLE, forbidden, schema=_SCHEMA) is None, (
                f"{forbidden} belongs to coord.attach_grants; a create grant has no session"
            )

        actual = scalar(
            engine,
            """
            SELECT count(*) FROM information_schema.columns
             WHERE table_schema = :schema AND table_name = :table
            """,
            schema=_SCHEMA,
            table=_TABLE,
        )
        assert int(actual) == len(_EXPECTED_COLUMNS)  # type: ignore[arg-type]

        # `jti` is the primary key, alone — one row per minted grant, and a
        # replayed mint cannot create a second.
        pk_cols = scalar(
            engine,
            """
            SELECT array_agg(a.attname ORDER BY array_position(i.indkey, a.attnum))
              FROM pg_index i
              JOIN pg_class c ON c.oid = i.indrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
             WHERE i.indisprimary AND n.nspname = :schema AND c.relname = :table
            """,
            schema=_SCHEMA,
            table=_TABLE,
        )
        assert list(pk_cols or []) == ["jti"]  # type: ignore[arg-type]

        assert index_exists(engine, _INDEX, schema=_SCHEMA)


@_needs_pg
def test_the_catch_up_access_path_is_indexed_and_carries_no_foreign_keys() -> None:
    """``(target_device_id, expires_at)`` is the catch-up poll's predicate, and
    the table hangs off nothing: coord's mint must not fail on a device row its
    own registry already vouches for, and expiry — not cascade — is the row's
    lifecycle."""
    with ephemeral_database(admin_database_url(), "rc01_idx") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        indexdef = scalar(
            engine,
            "SELECT indexdef FROM pg_indexes WHERE schemaname = :s AND indexname = :n",
            s=_SCHEMA,
            n=_INDEX,
        )
        assert indexdef is not None
        assert "target_device_id" in str(indexdef) and "expires_at" in str(indexdef)

        fks = scalar(
            engine,
            """
            SELECT count(*) FROM information_schema.table_constraints
             WHERE table_schema = :schema AND table_name = :table
               AND constraint_type = 'FOREIGN KEY'
            """,
            schema=_SCHEMA,
            table=_TABLE,
        )
        assert int(fks) == 0  # type: ignore[arg-type]


@_needs_pg
def test_a_grant_round_trips_and_the_catch_up_predicate_selects_it() -> None:
    """The exact read coord's ``GET /sessions/create-requests`` performs."""
    with ephemeral_database(admin_database_url(), "rc01_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)
        source = uuid.uuid4()

        live = _insert_grant(
            engine,
            tenant_id=tenant_id,
            source_device_id=source,
            target_device_id=device_id,
        )
        expired = _insert_grant(
            engine,
            tenant_id=tenant_id,
            source_device_id=source,
            target_device_id=device_id,
            expires_in="-1 minute",
        )
        consumed = _insert_grant(
            engine,
            tenant_id=tenant_id,
            source_device_id=source,
            target_device_id=device_id,
        )
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE {_SCHEMA}.{_TABLE} SET consumed_at = now() WHERE jti = :j"
                ),
                {"j": consumed},
            )
        elsewhere = _insert_grant(
            engine,
            tenant_id=tenant_id,
            source_device_id=source,
            target_device_id=uuid.uuid4(),
        )

        pending = scalar(
            engine,
            f"""
            SELECT array_agg(jti ORDER BY created_at)
              FROM {_SCHEMA}.{_TABLE}
             WHERE target_device_id = :device
               AND expires_at > now()
               AND consumed_at IS NULL
            """,
            device=device_id,
        )
        got = list(pending or [])
        assert got == [live], (
            "the catch-up read must return the live grant and nothing else",
            {
                "expired": expired,
                "consumed": consumed,
                "elsewhere": elsewhere,
                "got": got,
            },
        )

        # `source_user_id` is the only nullable identity column: coord mints for
        # a principal that may carry no `user_id` claim.
        assert (
            scalar(
                engine,
                f"SELECT source_user_id FROM {_SCHEMA}.{_TABLE} WHERE jti = :j",
                j=live,
            )
            is None
        )


@_needs_pg
def test_upgrade_is_idempotent() -> None:
    """Every statement is ``IF NOT EXISTS`` (or a drop-then-add) — the
    revision's own claim.

    ``stamp`` back to the parent and re-``upgrade`` replays ``upgrade()``
    against a database that already has the column, the CHECK, the table and the
    index, which is the only way alembic will run it twice.
    """
    with ephemeral_database(admin_database_url(), "rc01_idem") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE {_SCHEMA}.devices SET {_COLUMN} = 'tenant' WHERE device_id = :d"
                ),
                {"d": device_id},
            )
        _insert_grant(
            engine,
            tenant_id=tenant_id,
            source_device_id=uuid.uuid4(),
            target_device_id=device_id,
        )

        run_alembic(backend_root(), db_url, "stamp", _parent_revision_id())
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX, schema=_SCHEMA)
        assert column_info(engine, "devices", _COLUMN, schema=_SCHEMA) is not None
        assert (
            int(scalar(engine, f"SELECT count(*) FROM {_SCHEMA}.{_TABLE}"))  # type: ignore[arg-type]
            == 1
        ), "the re-run must not disturb existing rows"
        # A re-run must not reset a device's stored consent to the default.
        assert (
            scalar(
                engine,
                f"SELECT {_COLUMN} FROM {_SCHEMA}.devices WHERE device_id = :d",
                d=device_id,
            )
            == "tenant"
        )
        # …and the CHECK still bites after the drop-then-add replay.
        with pytest.raises(Exception) as excinfo:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE {_SCHEMA}.devices SET {_COLUMN} = 'everyone' "
                        f"WHERE device_id = :d"
                    ),
                    {"d": device_id},
                )
        assert _CHECK_CONSTRAINT in str(excinfo.value)


@_needs_pg
def test_up_down_up_leaves_no_residue_and_spares_the_attach_objects() -> None:
    """The downgrade removes exactly what the upgrade added.

    The neighbour check is the load-bearing half: ``coord.attach_grants`` and
    ``coord.devices.accept_remote_attach`` are ancestors of this revision and
    share its shape almost exactly, which is precisely the kind of neighbour a
    copy-pasted downgrade drops by accident.
    """
    with ephemeral_database(admin_database_url(), "rc01_updown") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id, device_id = _seed_device(engine)
        _insert_grant(
            engine,
            tenant_id=tenant_id,
            source_device_id=uuid.uuid4(),
            target_device_id=device_id,
        )

        run_alembic(backend_root(), db_url, "downgrade", _parent_revision_id())
        assert not table_exists(engine, _SCHEMA, _TABLE)
        assert not index_exists(engine, _INDEX, schema=_SCHEMA)
        assert column_info(engine, "devices", _COLUMN, schema=_SCHEMA) is None

        # The attach half is untouched.
        assert table_exists(engine, _SCHEMA, "attach_grants")
        assert (
            column_info(engine, "devices", "accept_remote_attach", schema=_SCHEMA)
            is not None
        )
        assert index_exists(engine, "idx_attach_grants_target_expires", schema=_SCHEMA)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert index_exists(engine, _INDEX, schema=_SCHEMA)
        # The device survived the round trip and its dial is back at the default.
        assert (
            scalar(
                engine,
                f"SELECT {_COLUMN} FROM {_SCHEMA}.devices WHERE device_id = :d",
                d=device_id,
            )
            == _DEFAULT
        )
