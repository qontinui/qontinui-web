"""Structural and round-trip test for alembic ``twin_11_seed_qontinui_production_url``.

Plan ``2026-09-17-twin-observer-genericity-non-release-consumers`` Phase 2, the
data half: seed ``production_url`` on qontinui's own ``vercel`` /
``qontinui-web`` row so coord's Phase 3 keeps observing qontinui's site.

Without a database (always runs):

1. Chain wiring: the parent is the current single head (a descendant of
   twin_10, the revision that added the column) and the ``Revises:`` header
   agrees.
2. ``upgrade()`` is exactly one static, ``coord.``-qualified ``UPDATE`` that
   fills NULL only and matches both system-tenant slugs; ``downgrade()`` runs
   nothing.

With a database (skipped when none is reachable; a skip proves nothing). Point
the tests at a live instance with ``QONTINUI_TEST_PG=host:port``:

3. Under either system-tenant slug (``qontinui`` after
   ``coord_system_tenant_rename_qontinui``, ``personal-jspinak`` where that
   rename was a no-op) the seed fills exactly the system tenant's
   ``vercel``/``qontinui-web`` row. It leaves alone a NON-system tenant that
   holds the other system slug, an unrelated tenant, another vercel target,
   and a non-vercel row named ``qontinui-web``.
   A system tenant renamed to any other slug is not seeded.
4. An operator-set value is never overwritten, and a re-run over the seeded
   value writes nothing (``updated_at`` does not move).
5. Up, down, up is clean, and downgrade leaves the value in place.
"""

from __future__ import annotations

import ast
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    run_alembic,
    scalar,
)

_REVISION_ID = "twin_11_seed_qontinui_production_url"
_REVISION_FILENAME = "twin_11_seed_qontinui_production_url.py"
_PARENT_REVISION_ID = "pindisp_01_gates_continuation_pin_disposition"

_SEED_URL = "https://qontinui.io/"
_SYSTEM_SLUGS = ("qontinui", "personal-jspinak")

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


def _tree() -> ast.Module:
    path = _revision_path()
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _function(name: str) -> ast.FunctionDef:
    for node in _tree().body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{_REVISION_FILENAME} has no top-level {name}()")


def _calls(fn: ast.FunctionDef) -> list[ast.Call]:
    return [node for node in ast.walk(fn) if isinstance(node, ast.Call)]


# ---------------------------------------------------------------------------
# 1. chain wiring
# ---------------------------------------------------------------------------


def test_revision_ids_are_wired_onto_the_current_head() -> None:
    module = load_revision_module(_revision_path(), f"_test_{_REVISION_ID}")
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID
    assert module.branch_labels is None
    assert module.depends_on is None
    # Find the parent by its DECLARED revision, not by filename: revision files
    # carry a descriptive suffix, and the parent moves on every re-point.
    declares_parent = re.compile(
        rf'^revision[^=]*=\s*["\']{re.escape(_PARENT_REVISION_ID)}["\']', re.M
    )
    parents = [
        path.name
        for path in (backend_root() / "alembic" / "versions").glob("*.py")
        if declares_parent.search(path.read_text(encoding="utf-8"))
    ]
    assert len(parents) == 1, parents

    source = _revision_path().read_text(encoding="utf-8")
    assert re.search(rf"^Revision ID: {re.escape(_REVISION_ID)}$", source, re.M)
    assert re.search(rf"^Revises: {re.escape(_PARENT_REVISION_ID)}$", source, re.M)


# ---------------------------------------------------------------------------
# 2. one guarded UPDATE; downgrade runs nothing
# ---------------------------------------------------------------------------


def test_upgrade_is_one_static_guarded_update() -> None:
    calls = _calls(_function("upgrade"))
    assert len(calls) == 1, "upgrade() must make exactly one call: op.execute"
    call = calls[0]
    assert isinstance(call.func, ast.Attribute)
    assert isinstance(call.func.value, ast.Name) and call.func.value.id == "op"
    assert call.func.attr == "execute"
    assert len(call.args) == 1 and isinstance(call.args[0], ast.Constant), (
        "op.execute must take one static SQL literal (an f-string escapes the "
        "schema-arg gate)"
    )
    sql = " ".join(str(call.args[0].value).split())
    assert sql.startswith("UPDATE coord.twin_targets SET production_url = ")
    assert f"'{_SEED_URL}'" in sql
    assert "surface = 'vercel'" in sql
    assert "target = 'qontinui-web'" in sql
    assert "production_url IS NULL" in sql, "the seed must fill a NULL only"
    assert (
        "SELECT tenant_id FROM coord.tenants WHERE is_system AND slug IN "
        "('qontinui', 'personal-jspinak')"
    ) in sql
    # op.execute wraps the string in text(), which reads ':word' as a bind
    # parameter; 'https://' is safe (':' followed by '/').
    assert not re.findall(r"(?<![:\w]):[A-Za-z_]\w*", sql)


def test_downgrade_runs_nothing() -> None:
    assert _calls(_function("downgrade")) == []


# ---------------------------------------------------------------------------
# live database
# ---------------------------------------------------------------------------


def _system_tenant(engine: Engine) -> uuid.UUID:
    """The migration chain always mints the system tenant."""
    with engine.connect() as conn:
        return conn.execute(
            text("SELECT tenant_id FROM coord.tenants WHERE is_system")
        ).scalar_one()


def _url_for(
    engine: Engine,
    tenant: uuid.UUID,
    surface: str = "vercel",
    target: str = "qontinui-web",
) -> object:
    with engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT production_url FROM coord.twin_targets WHERE tenant_id = :t "
                "AND surface = :s AND target = :g"
            ),
            {"t": tenant, "s": surface, "g": target},
        ).scalar_one()


def _prepare(engine: Engine, slug: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Give the system tenant ``slug``, add a NON-system tenant holding the
    other system slug plus an unrelated tenant, and insert the target row and
    four near-misses. Returns ``(system, impostor, other)`` tenant ids."""
    system = _system_tenant(engine)
    impostor_slug = next(s for s in _SYSTEM_SLUGS if s != slug)
    impostor = uuid.uuid4()
    other = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE coord.tenants SET slug = :slug WHERE tenant_id = :id"),
            {"id": system, "slug": slug},
        )
        for tenant_id, tenant_slug in (
            (impostor, impostor_slug),
            (other, "twin11-other"),
        ):
            conn.execute(
                text(
                    "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                    "VALUES (:id, :slug, :slug)"
                ),
                {"id": tenant_id, "slug": tenant_slug},
            )
        # The row the seed targets, plus four near-misses it must leave NULL:
        # a non-system tenant holding the other system slug, an unrelated
        # tenant, another system vercel target, and a non-vercel system row
        # named qontinui-web. Each fails a different filter of the seed's WHERE.
        for tenant, surface, target in (
            (system, "vercel", "qontinui-web"),
            (impostor, "vercel", "qontinui-web"),
            (other, "vercel", "qontinui-web"),
            (system, "vercel", "twin11-other-project"),
            (system, "ecs", "qontinui-web"),
        ):
            conn.execute(
                text(
                    "INSERT INTO coord.twin_targets (tenant_id, surface, target) "
                    "VALUES (:t, :s, :g) "
                    "ON CONFLICT (tenant_id, surface, target) "
                    "DO UPDATE SET production_url = NULL"
                ),
                {"t": tenant, "s": surface, "g": target},
            )
    return system, impostor, other


@_needs_pg
@pytest.mark.parametrize("slug", _SYSTEM_SLUGS)
def test_seed_fills_only_the_system_tenants_row(slug: str) -> None:
    with ephemeral_database(admin_database_url(), "twin11_seed") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        system, impostor, other = _prepare(engine, slug)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)

        assert _url_for(engine, system) == _SEED_URL
        assert _url_for(engine, impostor) is None, "a non-system tenant matched"
        assert _url_for(engine, other) is None
        assert _url_for(engine, system, target="twin11-other-project") is None
        assert _url_for(engine, system, surface="ecs") is None
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.twin_targets "
                "WHERE production_url IS NOT NULL",
            )
            == 1
        ), "the seed must fill exactly one row"


@_needs_pg
def test_a_database_built_through_the_chain_is_seeded() -> None:
    """twin_08 inserts the row and #1385 renames its tenant to qontinui, so a
    fresh database is seeded with no setup at all."""
    with ephemeral_database(admin_database_url(), "twin11_fresh") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _url_for(engine, _system_tenant(engine)) == _SEED_URL
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.twin_targets "
                "WHERE production_url IS NOT NULL",
            )
            == 1
        )


@_needs_pg
def test_a_system_tenant_renamed_away_from_qontinui_is_not_seeded() -> None:
    with ephemeral_database(admin_database_url(), "twin11_renamed") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        system, _impostor, _other = _prepare(engine, "qontinui")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.tenants SET slug = 'acme-ops' WHERE tenant_id = :id"
                ),
                {"id": system},
            )
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.twin_targets "
                "WHERE production_url IS NOT NULL",
            )
            == 0
        )


def _updated_at(engine: Engine, tenant: uuid.UUID) -> object:
    return scalar(
        engine,
        "SELECT updated_at FROM coord.twin_targets WHERE tenant_id = :t "
        "AND surface = 'vercel' AND target = 'qontinui-web'",
        t=tenant,
    )


@_needs_pg
def test_rerun_over_the_seeded_value_writes_nothing() -> None:
    with ephemeral_database(admin_database_url(), "twin11_rerun") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        system, _impostor, _other = _prepare(engine, "qontinui")
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _url_for(engine, system) == _SEED_URL
        stamped = _updated_at(engine, system)

        # Downgrade is a no-op, so the re-upgrade meets the seeded value.
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _url_for(engine, system) == _SEED_URL
        assert _updated_at(engine, system) == stamped, "the re-run rewrote the row"


@_needs_pg
def test_operator_value_survives_and_down_up_is_clean() -> None:
    with ephemeral_database(admin_database_url(), "twin11_round") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        system, _impostor, _other = _prepare(engine, "qontinui")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.twin_targets "
                    "SET production_url = 'https://example.test/' "
                    "WHERE tenant_id = :t AND surface = 'vercel' "
                    "AND target = 'qontinui-web'"
                ),
                {"t": system},
            )

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _url_for(engine, system) == "https://example.test/"

        # Downgrade is a no-op: the value stays. Re-upgrade matches nothing.
        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        assert _url_for(engine, system) == "https://example.test/"
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _url_for(engine, system) == "https://example.test/"
