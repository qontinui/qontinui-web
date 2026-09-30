"""Schema + round-trip test for alembic ``wuverif_02``.

Four verification dials on ``coord.tenant_merge_settings``. What is asserted:

1. **Types and nullability.** The two ``_bp`` dials and the salt are nullable
   with no default (NULL = inherit / not yet minted); the demotion mode is NOT
   NULL with default ``'shadow'``.
2. **A pre-existing tenant row starts in ``shadow``.** The load-bearing one:
   this revision must arm no demotion anywhere.
3. **The CHECKs refuse out-of-range rates (0, 10001) and an unknown mode.**
4. **Up -> down -> up leaves no residue and keeps the settings row.**

Substrate is ``_alembic_harness`` (see ``test_wuverif_01_...``); a skip proves
nothing — set ``QONTINUI_TEST_PG=host:port``.
"""

from __future__ import annotations

import uuid

import pytest
import sqlalchemy
from sqlalchemy import text
from sqlalchemy.engine import Engine

from tests._alembic_harness import (
    admin_database_url,
    backend_root,
    can_connect,
    column_info,
    ephemeral_database,
    run_alembic,
    scalar,
    table_exists,
)

_REVISION_ID = "wuverif_02"
_PARENT_REVISION_ID = "wuverif_01"  # sibling revision in the same PR; stable.

_SCHEMA = "coord"
_TABLE = "tenant_merge_settings"

# (column, data_type, is_nullable, default-substring or None)
_EXPECTED: tuple[tuple[str, str, str, str | None], ...] = (
    ("verification_sample_rate_bp", "integer", "YES", None),
    ("calibration_floor_bp", "integer", "YES", None),
    ("verification_salt", "bytea", "YES", None),
    ("verification_demotion_mode", "text", "NO", "'shadow'"),
)

_CK_RATE = "tenant_merge_settings_verification_sample_rate_bp_check"
_CK_FLOOR = "tenant_merge_settings_calibration_floor_bp_check"
_CK_MODE = "tenant_merge_settings_verification_demotion_mode_check"

_needs_pg = pytest.mark.skipif(
    not can_connect(admin_database_url()),
    reason=(
        "test Postgres unreachable via DATABASE_URL (under pytest, conftest.py "
        "derives DATABASE_URL from QONTINUI_TEST_PG=host:port, so set that)"
    ),
)


def _assert_present(engine: Engine) -> None:
    for column, data_type, nullable, default in _EXPECTED:
        info = column_info(engine, _TABLE, column, _SCHEMA)
        assert info is not None, f"coord.{_TABLE} is missing {column}"
        got_type, got_nullable, got_default = info
        assert got_type == data_type, f"{column}: {got_type} != {data_type}"
        assert got_nullable == nullable, f"{column}: nullable {got_nullable}"
        if default is None:
            assert got_default is None, f"{column}: unexpected default {got_default}"
        else:
            assert got_default is not None and default in got_default, (
                f"{column}: default {got_default!r} lacks {default!r}"
            )


def _assert_absent(engine: Engine) -> None:
    for column, *_ in _EXPECTED:
        assert column_info(engine, _TABLE, column, _SCHEMA) is None, (
            f"coord.{_TABLE}.{column} survived downgrade()"
        )


def _seed_tenant_settings(engine: Engine) -> uuid.UUID:
    tenant_id = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO coord.tenants (tenant_id, slug, display_name) "
                "VALUES (:t, :slug, 'wuverif_02 fixture')"
            ),
            {"t": str(tenant_id), "slug": f"wuverif-{tenant_id.hex[:12]}"},
        )
        conn.execute(
            text("INSERT INTO coord.tenant_merge_settings (tenant_id) VALUES (:t)"),
            {"t": str(tenant_id)},
        )
    return tenant_id


def _set(engine: Engine, tenant_id: uuid.UUID, column: str, value: object) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(f"UPDATE coord.{_TABLE} SET {column} = :v WHERE tenant_id = :t"),
            # f-string: column is a module constant, never input
            {"v": value, "t": str(tenant_id)},
        )


def _refused_by(
    engine: Engine, tenant_id: uuid.UUID, column: str, value: object, constraint: str
) -> None:
    with pytest.raises(sqlalchemy.exc.IntegrityError) as excinfo:
        _set(engine, tenant_id, column, value)
    diag = getattr(excinfo.value.orig, "diag", None)
    assert diag is not None and diag.constraint_name == constraint, (
        f"{column}={value!r}: expected {constraint}, got "
        f"{getattr(diag, 'constraint_name', None)!r}"
    )


@_needs_pg
def test_an_existing_tenant_starts_in_shadow_and_the_checks_hold() -> None:
    with ephemeral_database(admin_database_url(), "wuverif02_chk") as (engine, db_url):
        # Seed a settings row BEFORE the columns exist, as production has.
        run_alembic(backend_root(), db_url, "upgrade", _PARENT_REVISION_ID)
        tenant_id = _seed_tenant_settings(engine)

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_present(engine)

        row = scalar(
            engine,
            f"SELECT verification_demotion_mode || ',' || "
            f"(verification_sample_rate_bp IS NULL)::text || ',' || "
            f"(calibration_floor_bp IS NULL)::text || ',' || "
            f"(verification_salt IS NULL)::text "
            f"FROM coord.{_TABLE} WHERE tenant_id = :t",
            t=str(tenant_id),
        )
        assert row == "shadow,true,true,true", (
            f"a pre-existing tenant must start shadow with every dial inheriting; got {row!r}"
        )

        # Bounds: 1 and 10000 are legal, 0 and 10001 are not.
        for column, constraint in (
            ("verification_sample_rate_bp", _CK_RATE),
            ("calibration_floor_bp", _CK_FLOOR),
        ):
            _set(engine, tenant_id, column, 1)
            _set(engine, tenant_id, column, 10000)
            _refused_by(engine, tenant_id, column, 0, constraint)
            _refused_by(engine, tenant_id, column, 10001, constraint)

        _set(engine, tenant_id, "verification_demotion_mode", "live")
        _refused_by(engine, tenant_id, "verification_demotion_mode", "armed", _CK_MODE)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            _set(engine, tenant_id, "verification_demotion_mode", None)

        _set(engine, tenant_id, "verification_salt", b"\x00\x01salt")


@_needs_pg
def test_up_down_up_leaves_no_residue_and_keeps_the_settings_row() -> None:
    with ephemeral_database(admin_database_url(), "wuverif02_rt") as (engine, db_url):
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        tenant_id = _seed_tenant_settings(engine)
        _set(engine, tenant_id, "verification_demotion_mode", "live")

        run_alembic(backend_root(), db_url, "downgrade", _PARENT_REVISION_ID)
        _assert_absent(engine)
        assert table_exists(engine, _SCHEMA, _TABLE)
        assert (
            scalar(
                engine,
                f"SELECT count(*) FROM coord.{_TABLE} WHERE tenant_id = :t",
                t=str(tenant_id),
            )
            == 1
        ), "downgrade() must drop columns, not settings rows"

        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_present(engine)
        # A down/up cycle must not silently re-arm live demotion.
        assert (
            scalar(
                engine,
                f"SELECT verification_demotion_mode FROM coord.{_TABLE} "
                f"WHERE tenant_id = :t",
                t=str(tenant_id),
            )
            == "shadow"
        )

        # Idempotency: a second upgrade is a no-op.
        run_alembic(backend_root(), db_url, "upgrade", _REVISION_ID)
        _assert_present(engine)
