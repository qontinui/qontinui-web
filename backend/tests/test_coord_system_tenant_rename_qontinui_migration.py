"""Round-trip tests for ``coord_tenant_slug_history`` + ``coord_system_tenant_rename_qontinui``.

Plan ``2026-09-17-tenant-rename`` Phase A. The first revision is DDL (a table
and an index); the second is a guarded DATA migration whose whole contract is
which row it moves, what it records, when it refuses, and that ``downgrade``
puts the row back. None of that is visible from a green ``alembic upgrade``.

What is asserted:

1. **Fresh DB** — the chain mints ``personal-jspinak`` early and ends at
   ``qontinui`` / ``Qontinui`` / ``is_system`` with exactly one history row
   carrying this revision's ``renamed_by`` marker; mappings follow the slug.
2. **``qontinui`` taken** — no-op: the system tenant keeps its slug, the other
   tenant is byte-identical, no history row.
3. **Already renamed** — no-op, no history row invented; a re-run (stamp back,
   upgrade again) after a real rename neither errors nor double-records.
4. **Dangling ``qontinui`` mapping** — no-op, so a mapping with no tenant behind
   it never starts granting roles in the system tenant.
5. **Downgrade** — restores slug, display name and mappings, deletes the
   history row, and leaves the table in place; one more step drops the table.

Substrate comes from ``_alembic_harness``: an ephemeral database inside the
test Postgres, skipped when none is reachable. A skip proves nothing — point it
at a live instance with ``QONTINUI_TEST_PG=host:port``.
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    index_exists,
    run_alembic,
    table_exists,
)

_HISTORY_REVISION = "coord_tenant_slug_history"
_HISTORY_PARENT = "findings_triage_01"
_RENAME_REVISION = "coord_system_tenant_rename_qontinui"

# Literals spelled out here (and inline in the assertions), never imported from
# the revisions, so a change to the revisions' values reddens this test.
_OLD_SLUG = "personal-jspinak"
_OLD_DISPLAY = "Personal (jspinak)"
_NEW_SLUG = "qontinui"


# ---------------------------------------------------------------------------
# Guards — no database, so these never skip.
# ---------------------------------------------------------------------------


def _down_revision_of(filename: str) -> str:
    source = (backend_root() / "alembic" / "versions" / filename).read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']', source, re.MULTILINE
    )
    assert match is not None, f"no down_revision found in {filename}"
    return match.group("parent")


def test_the_pinned_parents_match_the_revisions() -> None:
    assert _down_revision_of(f"{_HISTORY_REVISION}.py") == _HISTORY_PARENT
    assert _down_revision_of(f"{_RENAME_REVISION}.py") == _HISTORY_REVISION


# ---------------------------------------------------------------------------
# Fixtures and helpers.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def _admin_url() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(f"no test Postgres reachable at {url}")
    return url


def _tenants(engine: Engine) -> dict[str, dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT tenant_id::text AS tenant_id, slug, display_name, is_system "
                "FROM coord.tenants"
            )
        ).mappings()
        return {r["slug"]: dict(r) for r in rows}


def _system(engine: Engine) -> dict:
    systems = [t for t in _tenants(engine).values() if t["is_system"]]
    assert len(systems) == 1, f"expected exactly one system tenant, got {systems}"
    return systems[0]


def _history(engine: Engine) -> list[dict]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT old_slug, tenant_id::text AS tenant_id, renamed_by, "
                "renamed_at IS NOT NULL AS has_renamed_at "
                "FROM coord.tenant_slug_history ORDER BY old_slug"
            )
        ).mappings()
        return [dict(r) for r in rows]


def _mapping_slugs(engine: Engine, group_id: str) -> list[str]:
    with engine.connect() as conn:
        return list(
            conn.execute(
                text(
                    "SELECT tenant_slug FROM coord.group_tenant_roles "
                    "WHERE group_id = :g ORDER BY tenant_slug"
                ),
                {"g": group_id},
            ).scalars()
        )


def _execute(engine: Engine, sql: str, **params: object) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


def _up(db_url: str, target: str) -> None:
    run_alembic(backend_root(), db_url, "upgrade", target)


# ---------------------------------------------------------------------------
# Live walks.
# ---------------------------------------------------------------------------


def test_fresh_db_ends_renamed_with_one_history_row(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "tenantrename_fresh") as (engine, db_url):
        _up(db_url, _HISTORY_REVISION)
        assert table_exists(engine, "coord", "tenant_slug_history")
        assert index_exists(engine, "idx_tenant_slug_history_tenant_id")
        before = _system(engine)
        assert before["slug"] == _OLD_SLUG, "fixture precondition: bootstrap slug"
        assert before["display_name"] == _OLD_DISPLAY
        _execute(
            engine,
            "INSERT INTO coord.group_tenant_roles (group_id, tenant_slug, role) "
            "VALUES ('fixture-group', :s, 'admin')",
            s=_OLD_SLUG,
        )

        _up(db_url, _RENAME_REVISION)

        after = _system(engine)
        assert after["tenant_id"] == before["tenant_id"], "the same row is renamed"
        assert after["slug"] == "qontinui"
        assert after["display_name"] == "Qontinui"
        assert after["is_system"] is True
        assert _OLD_SLUG not in _tenants(engine), "no tenant keeps the old slug"
        assert _history(engine) == [
            {
                "old_slug": "personal-jspinak",
                "tenant_id": before["tenant_id"],
                "renamed_by": "alembic:coord_system_tenant_rename_qontinui",
                "has_renamed_at": True,
            }
        ]
        assert _mapping_slugs(engine, "fixture-group") == ["qontinui"]


def test_no_op_when_qontinui_is_taken(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "tenantrename_taken") as (engine, db_url):
        _up(db_url, _HISTORY_REVISION)
        _execute(
            engine,
            "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
            "VALUES (gen_random_uuid(), :s, 'squatter')",
            s=_NEW_SLUG,
        )
        before = _tenants(engine)

        _up(db_url, _RENAME_REVISION)

        assert _tenants(engine) == before, "no tenant row may change"
        assert _system(engine)["slug"] == "personal-jspinak"
        assert _history(engine) == []


def test_no_op_when_already_renamed(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "tenantrename_already") as (engine, db_url):
        _up(db_url, _HISTORY_REVISION)
        _execute(
            engine,
            "UPDATE coord.tenants SET slug = :s, display_name = 'Hand renamed' "
            "WHERE is_system",
            s=_NEW_SLUG,
        )
        before = _tenants(engine)

        _up(db_url, _RENAME_REVISION)

        assert _tenants(engine) == before
        assert _history(engine) == [], "a rename it did not perform is not recorded"


def test_rerun_after_rename_neither_errors_nor_double_records(
    _admin_url: str,
) -> None:
    with ephemeral_database(_admin_url, "tenantrename_rerun") as (engine, db_url):
        _up(db_url, _RENAME_REVISION)
        renamed = _tenants(engine)
        history = _history(engine)
        assert len(history) == 1

        run_alembic(backend_root(), db_url, "stamp", _HISTORY_REVISION)
        _up(db_url, _RENAME_REVISION)

        assert _tenants(engine) == renamed
        assert _history(engine) == history


def test_no_op_when_a_dangling_mapping_names_qontinui(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "tenantrename_dangle") as (engine, db_url):
        _up(db_url, _HISTORY_REVISION)
        _execute(
            engine,
            "INSERT INTO coord.group_tenant_roles (group_id, tenant_slug, role) "
            "VALUES ('stranger-group', :s, 'admin')",
            s=_NEW_SLUG,
        )
        before = _tenants(engine)

        _up(db_url, _RENAME_REVISION)

        assert _tenants(engine) == before
        assert _system(engine)["slug"] == "personal-jspinak"
        assert _history(engine) == []
        assert _mapping_slugs(engine, "stranger-group") == ["qontinui"]


def test_downgrade_restores_the_row_and_removes_the_history(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "tenantrename_down") as (engine, db_url):
        _up(db_url, _HISTORY_REVISION)
        _execute(
            engine,
            "INSERT INTO coord.group_tenant_roles (group_id, tenant_slug, role) "
            "VALUES ('fixture-group', :s, 'admin')",
            s=_OLD_SLUG,
        )
        original = _tenants(engine)

        _up(db_url, _RENAME_REVISION)
        assert _system(engine)["slug"] == "qontinui"

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert _tenants(engine) == original, (
            "downgrade must restore slug and display_name exactly"
        )
        assert _system(engine)["slug"] == "personal-jspinak"
        assert _system(engine)["display_name"] == "Personal (jspinak)"
        assert _history(engine) == []
        assert _mapping_slugs(engine, "fixture-group") == ["personal-jspinak"]
        assert table_exists(engine, "coord", "tenant_slug_history"), (
            "the rename's downgrade only reverses the data; the table is the "
            "previous revision's"
        )

        run_alembic(backend_root(), db_url, "downgrade", "-1")
        assert not table_exists(engine, "coord", "tenant_slug_history")
        assert _tenants(engine) == original


def test_downgrade_keeps_a_later_display_name_edit(_admin_url: str) -> None:
    with ephemeral_database(_admin_url, "tenantrename_keepname") as (engine, db_url):
        _up(db_url, _RENAME_REVISION)
        _execute(
            engine,
            "UPDATE coord.tenants SET display_name = 'Operator chose' WHERE is_system",
        )

        run_alembic(backend_root(), db_url, "downgrade", "-1")

        system = _system(engine)
        assert system["slug"] == "personal-jspinak"
        assert system["display_name"] == "Operator chose"
        assert _history(engine) == []
