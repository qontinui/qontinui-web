"""Behaviour test for the ``coord_wu_write_log_01`` revision.

The revision creates ``coord.work_unit_write_log``, the function
``coord.log_work_unit_write()`` and the trigger ``wu_write_log`` on
``coord.work_units`` — Phase 1 of plan
``2026-09-18-a-work-unit-write-leaves-no-history-unless-it-changes-status``.

``migration-reversal.yml`` would only confirm the statements execute. What is
worth pinning is the trigger's BEHAVIOUR, because every property the plan rests
on is a property of what the trigger does and does not log.

What is asserted
================

1. The pinned parent is the revision's real ``down_revision`` (no DB needed).
2. Table, function and trigger are absent at the parent and present after
   upgrade; the table and its ``actor`` column carry their comments.
3. An UPDATE that changes only ``updated_at`` logs nothing.
4. An UPDATE that changes only ``metadata.reconcile_checked_at`` (a volatile
   key) logs nothing.
5. A metadata replace that drops ``phases`` logs one ``update`` row with
   ``metadata_keys_removed`` containing ``phases`` and both full objects.
6. A fresh INSERT logs an ``insert`` row; an ``INSERT ... ON CONFLICT (slug)
   DO UPDATE`` that changes the title logs an ``update`` row.
7. A two-statement transaction logs two rows, ordered by ``written_at``.
8. A transaction-local ``set_config('coord.write_actor', ..., true)`` is
   recorded as ``actor``; the NEXT transaction on the SAME connection records
   ``actor`` NULL, not ``''``.
9. A DELETE logs a ``delete`` row that outlives the unit (no FK).
10. A column ADDED to ``coord.work_units`` after the revision is watched with
    no change to the function — the reason no column-coverage list exists.
11. Downgrade removes trigger, function and table and leaves
    ``coord.work_units`` rows intact.

What this file requires
=======================

The pinned-parent test requires nothing. Every other test requires a reachable
Postgres at the URL ``conftest.py`` resolves (``QONTINUI_TEST_PG=host:port``
points them elsewhere); unreachable => they SKIP, and the skip reason says the
trigger was therefore NOT verified.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_comment,
    ephemeral_database,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "coord_wu_write_log_01"
_PARENT_REVISION_ID = "mdroles_01"
_REVISION_FILENAME = "coord_wu_write_log_01_work_unit_write_log.py"

_TENANT = uuid.UUID("00000000-0000-4000-8000-00000000a1a1")

_NO_POSTGRES_REASON = (
    "Postgres not reachable at the conftest URL, so the work-unit write-log "
    "TRIGGER was NOT verified — only the pinned parent. CI provisions a "
    "postgres service; locally, point QONTINUI_TEST_PG at a reachable instance."
)
_PG_REACHABLE = can_connect(admin_database_url())

pg_only = pytest.mark.skipif(not _PG_REACHABLE, reason=_NO_POSTGRES_REASON)


def test_the_pinned_parent_matches_the_revisions_down_revision() -> None:
    """`_PARENT_REVISION_ID` is the revision's real parent — no database needed."""
    source = (backend_root() / "alembic" / "versions" / _REVISION_FILENAME).read_text(
        encoding="utf-8"
    )
    match = re.search(
        r'^down_revision[^=]*=\s*["\'](?P<parent>[^"\']+)["\']',
        source,
        re.MULTILINE,
    )
    assert match is not None, f"no down_revision found in {_REVISION_FILENAME}"
    assert match.group("parent") == _PARENT_REVISION_ID, (
        f"{_REVISION_FILENAME} declares down_revision={match.group('parent')!r} "
        f"but this test pins _PARENT_REVISION_ID={_PARENT_REVISION_ID!r}. "
        "Re-point both together."
    )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _function_exists(engine: Engine) -> bool:
    return bool(
        scalar(
            engine,
            "SELECT EXISTS(SELECT 1 FROM pg_proc p "
            "JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'coord' AND p.proname = 'log_work_unit_write')",
        )
    )


def _trigger_exists(engine: Engine) -> bool:
    return bool(
        scalar(
            engine,
            "SELECT EXISTS(SELECT 1 FROM pg_trigger "
            "WHERE tgname = 'wu_write_log' "
            "AND tgrelid = 'coord.work_units'::regclass AND NOT tgisinternal)",
        )
    )


def _insert_unit(
    engine: Engine, slug: str, metadata: str = "{}", title: str | None = None
) -> uuid.UUID:
    with engine.begin() as conn:
        unit_id: uuid.UUID = conn.execute(
            text(
                "INSERT INTO coord.work_units (slug, tenant_id, status, title, metadata) "
                "VALUES (:slug, :tenant, 'draft', :title, CAST(:meta AS jsonb)) "
                "RETURNING id"
            ),
            {
                "slug": slug,
                "tenant": str(_TENANT),
                "title": title or slug,
                "meta": metadata,
            },
        ).scalar_one()
    return unit_id


def _log_rows(engine: Engine, unit_id: uuid.UUID) -> list[dict[str, Any]]:
    """Every log row for one unit, oldest first."""
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT * FROM coord.work_unit_write_log "
                "WHERE work_unit_id = :id ORDER BY written_at, write_id"
            ),
            {"id": unit_id},
        ).mappings()
        return [dict(r) for r in rows]


def _exec(engine: Engine, sql: str, **params: object) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params)


# --------------------------------------------------------------------------
# Behaviour, against one database at the revision
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def db() -> Iterator[Engine]:
    if not _PG_REACHABLE:
        pytest.skip(_NO_POSTGRES_REASON)
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_wu_write_log_01_test") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _REVISION_ID)
        yield engine


def _slug(name: str) -> str:
    return f"wulog-{name}-{uuid.uuid4().hex[:8]}"


@pg_only
def test_insert_logs_an_insert_row(db: Engine) -> None:
    slug = _slug("insert")
    unit = _insert_unit(db, slug, metadata='{"phases": [1]}')
    rows = _log_rows(db, unit)
    assert len(rows) == 1, rows
    row = rows[0]
    assert row["op"] == "insert"
    assert row["slug"] == slug
    assert row["tenant_id"] == _TENANT
    assert "status" in row["changed_fields"]
    assert "metadata" in row["changed_fields"]
    for excluded in ("id", "created_at", "updated_at"):
        assert excluded not in row["changed_fields"], row["changed_fields"]
    assert row["old_status"] is None and row["new_status"] == "draft"
    assert row["old_metadata"] is None
    assert row["new_metadata"] == {"phases": [1]}
    assert row["metadata_keys_added"] == ["phases"]
    assert row["actor"] is None, "no coord.write_actor set => NULL (unattributed)"


@pg_only
def test_updated_at_only_update_logs_nothing(db: Engine) -> None:
    unit = _insert_unit(db, _slug("tick"))
    _exec(
        db,
        "UPDATE coord.work_units SET updated_at = now() + interval '1 minute' "
        "WHERE id = :id",
        id=unit,
    )
    # A same-value rewrite of a watched column is not a change either.
    _exec(db, "UPDATE coord.work_units SET status = status WHERE id = :id", id=unit)
    assert [r["op"] for r in _log_rows(db, unit)] == ["insert"]


@pg_only
def test_volatile_metadata_key_only_update_logs_nothing(db: Engine) -> None:
    unit = _insert_unit(
        db, _slug("volatile"), metadata='{"phases": [1], "reconcile_checked_at": "a"}'
    )
    _exec(
        db,
        "UPDATE coord.work_units SET metadata = metadata || "
        "jsonb_build_object('reconcile_checked_at', clock_timestamp()::text, "
        "'citations_refreshed_at', clock_timestamp()::text) WHERE id = :id",
        id=unit,
    )
    assert [r["op"] for r in _log_rows(db, unit)] == ["insert"]


@pg_only
def test_metadata_replace_dropping_phases_is_logged_with_key_diff(db: Engine) -> None:
    unit = _insert_unit(
        db,
        _slug("phases"),
        metadata='{"phases": [{"n": 1}], "reconcile_checked_at": "x", "keep": 1}',
    )
    _exec(
        db,
        "UPDATE coord.work_units SET metadata = "
        """'{"keep": 1, "fresh": true}'::jsonb WHERE id = :id""",
        id=unit,
    )
    rows = _log_rows(db, unit)
    assert [r["op"] for r in rows] == ["insert", "update"]
    row = rows[1]
    assert row["changed_fields"] == ["metadata"]
    assert "phases" in row["metadata_keys_removed"]
    assert row["metadata_keys_removed"] == ["phases", "reconcile_checked_at"]
    assert row["metadata_keys_added"] == ["fresh"]
    # Full, unstripped objects, so the lost value is restorable from the row.
    assert row["old_metadata"] == {
        "phases": [{"n": 1}],
        "reconcile_checked_at": "x",
        "keep": 1,
    }
    assert row["new_metadata"] == {"keep": 1, "fresh": True}
    assert row["old_status"] is None and row["new_status"] is None
    assert row["old_values"] is None and row["new_values"] is None


@pg_only
@pytest.mark.parametrize("odd", ["null", "[1]", '"s"', "3"])
def test_non_object_metadata_never_aborts_the_write(db: Engine, odd: str) -> None:
    """``metadata`` has no ``jsonb_typeof`` CHECK, so the trigger must log a
    scalar/array/JSON-null value rather than raise and abort the caller's write
    (the object-only operators ``-`` and ``jsonb_object_keys`` would)."""
    unit = _insert_unit(db, _slug("odd"), metadata=odd)
    # object -> non-object -> object, then a tick-only write, then a delete.
    _exec(
        db,
        """UPDATE coord.work_units SET metadata = '{"a": 1}'::jsonb WHERE id = :id""",
        id=unit,
    )
    _exec(
        db,
        "UPDATE coord.work_units SET metadata = CAST(:m AS jsonb) WHERE id = :id",
        id=unit,
        m=odd,
    )
    _exec(
        db,
        "UPDATE coord.work_units SET updated_at = now() + interval '1 minute' "
        "WHERE id = :id",
        id=unit,
    )
    _exec(db, "DELETE FROM coord.work_units WHERE id = :id", id=unit)
    rows = _log_rows(db, unit)
    assert [r["op"] for r in rows] == ["insert", "update", "update", "delete"]
    assert rows[1]["metadata_keys_added"] == ["a"]
    assert rows[1]["metadata_keys_removed"] == []
    assert rows[2]["metadata_keys_removed"] == ["a"]
    assert rows[2]["metadata_keys_added"] == []


@pg_only
def test_on_conflict_upsert_logs_an_update_row(db: Engine) -> None:
    slug = _slug("upsert")
    upsert = (
        "INSERT INTO coord.work_units (slug, tenant_id, status, title) "
        "VALUES (:slug, :tenant, 'draft', :title) "
        "ON CONFLICT (slug) WHERE slug IS NOT NULL "
        "DO UPDATE SET title = EXCLUDED.title, updated_at = now() "
        "RETURNING id"
    )
    with db.begin() as conn:
        unit = conn.execute(
            text(upsert), {"slug": slug, "tenant": str(_TENANT), "title": "first"}
        ).scalar_one()
    with db.begin() as conn:
        again = conn.execute(
            text(upsert), {"slug": slug, "tenant": str(_TENANT), "title": "second"}
        ).scalar_one()
    assert again == unit
    rows = _log_rows(db, unit)
    assert [r["op"] for r in rows] == ["insert", "update"]
    assert rows[1]["changed_fields"] == ["title"]
    assert (rows[1]["old_title"], rows[1]["new_title"]) == ("first", "second")

    # The adapter's no-op refresh: same values, fresh updated_at — nothing logged.
    with db.begin() as conn:
        conn.execute(
            text(upsert), {"slug": slug, "tenant": str(_TENANT), "title": "second"}
        )
    assert len(_log_rows(db, unit)) == 2


@pg_only
def test_two_statement_transaction_logs_two_rows_in_order(db: Engine) -> None:
    unit = _insert_unit(db, _slug("twostmt"))
    with db.begin() as conn:
        conn.execute(
            text("UPDATE coord.work_units SET title = 'one' WHERE id = :id"),
            {"id": unit},
        )
        conn.execute(
            text("UPDATE coord.work_units SET status = 'in_progress' WHERE id = :id"),
            {"id": unit},
        )
    rows = _log_rows(db, unit)
    assert [r["op"] for r in rows] == ["insert", "update", "update"]
    first, second = rows[1], rows[2]
    assert first["changed_fields"] == ["title"]
    assert second["changed_fields"] == ["status"]
    assert first["written_at"] < second["written_at"], (
        "clock_timestamp() must order two writes inside one transaction"
    )
    assert first["txid"] == second["txid"]
    assert (second["old_status"], second["new_status"]) == ("draft", "in_progress")


@pg_only
def test_transaction_local_actor_is_recorded_and_does_not_leak(db: Engine) -> None:
    unit = _insert_unit(db, _slug("actor"))
    with db.connect() as conn:
        with conn.begin():
            conn.execute(
                text(
                    "SELECT set_config('coord.write_actor', 'device:x', true), "
                    "set_config('coord.write_path', 'test:actor', true)"
                )
            )
            conn.execute(
                text("UPDATE coord.work_units SET title = 'attributed' WHERE id = :id"),
                {"id": unit},
            )
        # Same connection, next transaction: the setting now reads '' — the
        # NULLIF must turn that into NULL, not store an empty string.
        with conn.begin():
            leaked = conn.execute(
                text("SELECT current_setting('coord.write_actor', true)")
            ).scalar()
            conn.execute(
                text(
                    "UPDATE coord.work_units SET title = 'unattributed' WHERE id = :id"
                ),
                {"id": unit},
            )
    assert leaked == "", (
        "precondition: a transaction-local set_config leaves '' behind on the "
        f"session, which is what the NULLIF exists for (got {leaked!r})"
    )
    rows = _log_rows(db, unit)
    assert [r["new_title"] for r in rows[1:]] == ["attributed", "unattributed"]
    assert (rows[1]["actor"], rows[1]["write_path"]) == ("device:x", "test:actor")
    assert rows[2]["actor"] is None, "unattributed must be NULL, never ''"
    assert rows[2]["write_path"] is None


@pg_only
def test_delete_is_logged_and_outlives_the_unit(db: Engine) -> None:
    slug = _slug("delete")
    unit = _insert_unit(db, slug, metadata='{"phases": [1]}')
    _exec(db, "DELETE FROM coord.work_units WHERE id = :id", id=unit)
    assert (
        scalar(db, "SELECT count(*) FROM coord.work_units WHERE id = :id", id=unit) == 0
    )
    rows = _log_rows(db, unit)
    assert [r["op"] for r in rows] == ["insert", "delete"]
    row = rows[1]
    assert row["slug"] == slug
    assert row["old_status"] == "draft" and row["new_status"] is None
    assert row["old_metadata"] == {"phases": [1]} and row["new_metadata"] is None
    assert row["metadata_keys_removed"] == ["phases"]


@pg_only
def test_a_column_added_later_is_watched(db: Engine) -> None:
    """No watched-column list: a new column is logged with no function change."""
    unit = _insert_unit(db, _slug("newcol"))
    _exec(db, "ALTER TABLE coord.work_units ADD COLUMN IF NOT EXISTS probe_col TEXT")
    _exec(db, "UPDATE coord.work_units SET probe_col = 'v1' WHERE id = :id", id=unit)
    rows = _log_rows(db, unit)
    assert [r["op"] for r in rows] == ["insert", "update"]
    row = rows[1]
    assert "probe_col" in row["changed_fields"]
    assert row["old_values"] == {"probe_col": None}
    assert row["new_values"] == {"probe_col": "v1"}


# --------------------------------------------------------------------------
# Parent → upgrade → downgrade, against its own database
# --------------------------------------------------------------------------


@pg_only
def test_objects_absent_at_parent_present_after_upgrade_and_downgrade_is_clean() -> (
    None
):
    root = backend_root()
    with ephemeral_database(admin_database_url(), "coord_wu_write_log_01_dg") as (
        engine,
        url,
    ):
        run_alembic(root, url, "upgrade", _PARENT_REVISION_ID)
        assert not table_exists(engine, "coord", "work_unit_write_log")
        assert not _function_exists(engine)
        assert not _trigger_exists(engine)
        pre_unit = _insert_unit(engine, _slug("pre"))

        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert table_exists(engine, "coord", "work_unit_write_log")
        assert _function_exists(engine)
        assert _trigger_exists(engine)
        table_comment = scalar(
            engine,
            "SELECT obj_description('coord.work_unit_write_log'::regclass, 'pg_class')",
        )
        assert isinstance(table_comment, str) and "No FK" in table_comment
        actor_comment = column_comment(engine, "work_unit_write_log", "actor")
        assert actor_comment and "NULL = UNATTRIBUTED" in actor_comment
        assert _log_rows(engine, pre_unit) == [], (
            "rows predating the trigger have no history"
        )
        post_unit = _insert_unit(engine, _slug("post"))
        assert len(_log_rows(engine, post_unit)) == 1

        run_alembic(root, url, "downgrade", _PARENT_REVISION_ID)
        assert not _trigger_exists(engine)
        assert not _function_exists(engine)
        assert not table_exists(engine, "coord", "work_unit_write_log")
        assert (
            scalar(
                engine,
                "SELECT count(*) FROM coord.work_units WHERE id IN (:a, :b)",
                a=pre_unit,
                b=post_unit,
            )
            == 2
        ), "downgrade must not touch coord.work_units rows"
        # Writes still succeed with the trigger gone.
        _exec(
            engine,
            "UPDATE coord.work_units SET title = 'after' WHERE id = :id",
            id=post_unit,
        )

        # Re-upgrade is clean.
        run_alembic(root, url, "upgrade", _REVISION_ID)
        assert _trigger_exists(engine)
