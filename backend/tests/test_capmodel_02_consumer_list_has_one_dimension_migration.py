"""Schema test for the ``capmodel_02`` revision (one-dimension consumer list).

Source-level guards never skip. The live walk uses ``_alembic_harness`` and
skips without a reachable test Postgres; a skip proves nothing. Point it at a
live instance with ``QONTINUI_TEST_PG=host:port`` or a full
``QONTINUI_TEST_PG_DSN`` (``conftest.py`` derives ``DATABASE_URL`` from them at
import time, so setting ``DATABASE_URL`` itself has no effect under pytest).
"""

from __future__ import annotations

import uuid
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    ephemeral_database,
    load_revision_module,
    recorded_sql,
    run_alembic,
    upgrade_execute_calls,
)

_REVISION_ID = "capmodel_02"
# MUST equal the revision's own down_revision (first test enforces it).
_PARENT_REVISION_ID = "coord_ci_runs_head_sha_idx_01"
_REVISION_FILENAME = "capmodel_02_consumer_list_has_one_dimension.py"

_PARENT = "fleet_runtime_policy"
_VERSIONS = "fleet_runtime_policy_versions"
_PARENT_CHECK = "fleet_runtime_policy_consumers_ndims_check"
_VERSIONS_CHECK = "fleet_runtime_policy_versions_consumers_ndims_check"

# SQLSTATE check_violation.
_CHECK_VIOLATION = "23514"
_NESTED = "ARRAY[ARRAY['merge_train'], ARRAY['local_builds']]"


def _path() -> Path:
    return backend_root() / "alembic" / "versions" / _REVISION_FILENAME


def _module() -> ModuleType:
    return load_revision_module(_path(), f"_rev_{_REVISION_ID}")


def _flat(sql: str) -> str:
    return " ".join(sql.split())


def test_pinned_parent_matches_down_revision() -> None:
    module = _module()
    assert module.revision == _REVISION_ID
    assert module.down_revision == _PARENT_REVISION_ID


def test_constraints_are_the_interface() -> None:
    module = _module()
    assert tuple(module._CONSTRAINTS) == (
        (f"coord.{_PARENT}", _PARENT_CHECK),
        (f"coord.{_VERSIONS}", _VERSIONS_CHECK),
    )
    assert module._PREDICATE == "array_ndims(capacity_model_off_consumers) <= 1"
    # Postgres stores an identifier past 63 bytes truncated (every statement
    # truncates it the same way, so ADD and DROP would still agree), and this
    # test's lookups by the full name — `_constraints(...)[name]` and the
    # violated constraint's name in `_refused_by` — would then miss it.
    for _, name in module._CONSTRAINTS:
        assert len(name.encode()) <= 63, name


def test_upgrade_adds_one_not_valid_check_per_table_and_downgrade_drops_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    up = [_flat(s) for s in recorded_sql(module, "upgrade", monkeypatch)]
    down = [_flat(s) for s in recorded_sql(module, "downgrade", monkeypatch)]
    (parent, parent_check), (versions, versions_check) = module._CONSTRAINTS
    # Every statement each direction, pinned exactly: the lock bound opens and
    # closes it (restored with `= DEFAULT`, which coord's classifier admits;
    # it rejects RESET), the parent is altered before its versions table, and
    # nothing else runs: no column, no data, no other constraint, no VALIDATE.
    assert up == [
        "SET LOCAL lock_timeout = '3s'",
        f"ALTER TABLE {parent} ADD CONSTRAINT {parent_check} "
        f"CHECK ({module._PREDICATE}) NOT VALID",
        f"ALTER TABLE {versions} ADD CONSTRAINT {versions_check} "
        f"CHECK ({module._PREDICATE}) NOT VALID",
        "SET LOCAL lock_timeout = DEFAULT",
    ]
    # The downgrade drops the parent's CHECK first too: the lock order coord's
    # writes use, so a rollback against a live coord cannot deadlock either.
    assert down == [
        "SET LOCAL lock_timeout = '3s'",
        f"ALTER TABLE {parent} DROP CONSTRAINT IF EXISTS {parent_check}",
        f"ALTER TABLE {versions} DROP CONSTRAINT IF EXISTS {versions_check}",
        "SET LOCAL lock_timeout = DEFAULT",
    ]


def test_every_op_execute_takes_a_static_string_literal() -> None:
    # coord's migration classifier can inspect only a static inline literal;
    # anything else reads back as `sql=None`.
    for function in ("upgrade", "downgrade"):
        calls = upgrade_execute_calls(_path(), function=function)
        assert len(calls) == 4, function
        for call in calls:
            assert call.sql is not None, function
            assert not call.in_autocommit_block, function


def _admin_url_or_skip() -> str:
    url = admin_database_url()
    if not can_connect(url):
        pytest.skip(
            f"no reachable test Postgres at {url}; set QONTINUI_TEST_PG=host:port "
            "or QONTINUI_TEST_PG_DSN (conftest.py derives DATABASE_URL from them)"
        )
    return url


def _insert_policy_row(engine: Engine, tenant_id: str, consumers_sql: str) -> int:
    """A controls row whose consumer list is ``consumers_sql`` (a SQL literal)."""
    with engine.begin() as conn:
        return int(
            conn.execute(
                text(
                    "INSERT INTO coord.fleet_runtime_policy "
                    "(tenant_id, domain, scope_band, scope_key, level, "
                    "master_enabled, updated_by, capacity_model_off_consumers) "
                    "VALUES (CAST(:t AS uuid), 'fleet_resources', 'tenant', NULL, "
                    f"'controls', true, 'seed@example.com', {consumers_sql}) "
                    "RETURNING id"
                ),
                {"t": tenant_id},
            ).scalar_one()
        )


def _constraints(engine: Engine, table: str) -> dict[str, bool]:
    """``{name: convalidated}`` for every constraint on ``coord.<table>``."""
    with engine.connect() as conn:
        return {
            str(name): bool(validated)
            for name, validated in conn.execute(
                text(
                    "SELECT c.conname::text, c.convalidated FROM pg_constraint c "
                    "JOIN pg_class r ON r.oid = c.conrelid "
                    "JOIN pg_namespace n ON n.oid = r.relnamespace "
                    "WHERE n.nspname = 'coord' AND r.relname = :t"
                ),
                {"t": table},
            ).all()
        }


def _refused_by(
    engine: Engine, sql: str, params: dict[str, object], constraint: str
) -> None:
    """``sql`` fails with check_violation, naming ``constraint``."""
    with pytest.raises(IntegrityError) as exc:
        with engine.begin() as conn:
            conn.execute(text(sql), params)
    orig = exc.value.orig
    assert getattr(orig, "pgcode", None) == _CHECK_VIOLATION, orig
    diag = getattr(orig, "diag", None)
    assert getattr(diag, "constraint_name", None) == constraint, orig


def _snapshot_sql(consumers_sql: str, version: int) -> str:
    return (
        "INSERT INTO coord.fleet_runtime_policy_versions "
        "(policy_id, version, level, master_enabled, change_note, updated_by, "
        "capacity_model_off_consumers) VALUES (:id, "
        f"{version}, 'controls', true, 'capmodel_02 test', 'seed@example.com', "
        f"{consumers_sql})"
    )


def test_live_walk_refuses_a_nested_list_and_keeps_the_rows_before_it() -> None:
    admin_url = _admin_url_or_skip()
    with ephemeral_database(admin_url, "capmodel02") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        before = {t: _constraints(engine, t) for t in (_PARENT, _VERSIONS)}
        # A nested list stored BEFORE the revision, as a hand edit could have:
        # NOT VALID must neither fail the upgrade on it nor rewrite it.
        nested_id = _insert_policy_row(engine, str(uuid.uuid4()), _NESTED)
        with engine.begin() as conn:
            conn.execute(text(_snapshot_sql(_NESTED, 1)), {"id": nested_id})
        flat_id = _insert_policy_row(engine, str(uuid.uuid4()), "NULL")

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _constraints(engine, _PARENT)[_PARENT_CHECK] is False
        assert _constraints(engine, _VERSIONS)[_VERSIONS_CHECK] is False
        with engine.connect() as conn:
            kept = conn.execute(
                text(
                    "SELECT array_ndims(capacity_model_off_consumers) "
                    "FROM coord.fleet_runtime_policy WHERE id = :id"
                ),
                {"id": nested_id},
            ).scalar_one()
        assert kept == 2, "the pre-existing row is neither rejected nor rewritten"

        # Every shape coord writes stores, on the parent and in a snapshot.
        for version, ok in enumerate(
            ("NULL", "ARRAY[]::text[]", "ARRAY['merge_train', 'local_builds']"),
            start=2,
        ):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "UPDATE coord.fleet_runtime_policy "
                        f"SET capacity_model_off_consumers = {ok} WHERE id = :id"
                    ),
                    {"id": flat_id},
                )
                conn.execute(text(_snapshot_sql(ok, version)), {"id": flat_id})

        # A nested list is refused from now on, by each table's own CHECK.
        _refused_by(
            engine,
            "UPDATE coord.fleet_runtime_policy "
            f"SET capacity_model_off_consumers = {_NESTED} WHERE id = :id",
            {"id": flat_id},
            _PARENT_CHECK,
        )
        _refused_by(
            engine,
            _snapshot_sql(_NESTED, 99),
            {"id": flat_id},
            _VERSIONS_CHECK,
        )
        # NOT VALID still checks the NEW row of an update: an update that
        # leaves a pre-existing nested list in place is refused, and one that
        # stores the list as one dimension (what a coord write does) succeeds.
        _refused_by(
            engine,
            "UPDATE coord.fleet_runtime_policy SET updated_by = 'hand@example.com' "
            "WHERE id = :id",
            {"id": nested_id},
            _PARENT_CHECK,
        )
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.fleet_runtime_policy SET "
                    "capacity_model_off_consumers = "
                    "ARRAY(SELECT unnest(capacity_model_off_consumers)) "
                    "WHERE id = :id"
                ),
                {"id": nested_id},
            )
            repaired = conn.execute(
                text(
                    "SELECT capacity_model_off_consumers "
                    "FROM coord.fleet_runtime_policy WHERE id = :id"
                ),
                {"id": nested_id},
            ).scalar_one()
        assert repaired == ["merge_train", "local_builds"]

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        # No residue: each table carries exactly the constraints it had.
        for table in (_PARENT, _VERSIONS):
            assert _constraints(engine, table) == before[table], table
        # Without the CHECK a nested list stores again; the rows survive.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE coord.fleet_runtime_policy "
                    f"SET capacity_model_off_consumers = {_NESTED} WHERE id = :id"
                ),
                {"id": flat_id},
            )
            snapshots = conn.execute(
                text(
                    "SELECT count(*) FROM coord.fleet_runtime_policy_versions "
                    "WHERE policy_id IN (:a, :b)"
                ),
                {"a": nested_id, "b": flat_id},
            ).scalar_one()
        assert snapshots == 4

        # And the upgrade re-applies over a table that holds a nested list.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        assert _PARENT_CHECK in _constraints(engine, _PARENT)
        assert _VERSIONS_CHECK in _constraints(engine, _VERSIONS)
