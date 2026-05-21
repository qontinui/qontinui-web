"""Lock-in tests for ``app.models.device.Device`` ↔ migration parity.

The unified-devices migration
(``alembic/versions/ud01_unify_devices_registry.py``) is the source of
truth for the ``coord.devices`` schema. The SQLAlchemy ``Device`` model
must match — when it drifts, the ORM emits an explicit ``NULL`` for a
NOT NULL column on INSERT (overriding the server-side default), and
the next write blows up with ``asyncpg.exceptions.NotNullViolationError``.

Concrete instance that motivated this test (2026-05-21):

* DB migration: ``disk_reserved_gb BIGINT NOT NULL DEFAULT 0``.
* Stale model: ``disk_reserved_gb: Mapped[int | None] = mapped_column(
  Integer, nullable=True)``.
* Result: every ``devices_ws`` ``runner_info`` handshake closed with
  ``code=1011 INTERNAL_ERROR`` because the INSERT failed downstream of
  a successful JWT verify. Empirically surfaced by the unified-devices
  Phase 7 live-stack smoke after qontinui-web #184 unblocked the JWT
  path.

These tests pin the load-bearing properties — type, nullability,
defaults — so the drift can't reappear silently.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Integer

from app.models.device import Device

# ---------------------------------------------------------------------------
# disk_reserved_gb — the column that surfaced the bug
# ---------------------------------------------------------------------------


def test_disk_reserved_gb_is_bigint_not_int() -> None:
    """Migration says BIGINT; model must match (overflows silently otherwise)."""
    col = Device.__table__.c.disk_reserved_gb
    assert isinstance(col.type, BigInteger), (
        f"disk_reserved_gb must be BigInteger to match the migration; "
        f"got {col.type!r}. See ud01_unify_devices_registry.py:240-244."
    )


def test_disk_reserved_gb_not_nullable() -> None:
    """Migration declares NOT NULL — model must mirror so ORM doesn't emit NULL."""
    col = Device.__table__.c.disk_reserved_gb
    assert col.nullable is False, (
        "disk_reserved_gb must be nullable=False; mismatching the migration "
        "causes devices_ws.runner_info INSERTs to fail with "
        "NotNullViolationError. See ud01_unify_devices_registry.py:243."
    )


def test_disk_reserved_gb_has_python_default() -> None:
    """The Python-side ``default=0`` is what makes the ORM omit the column
    on INSERT when the application doesn't supply a value. Without this,
    SQLAlchemy emits an explicit ``$N::INTEGER = None`` which overrides the
    DB's server-side default and trips NOT NULL.
    """
    col = Device.__table__.c.disk_reserved_gb
    assert col.default is not None, (
        "disk_reserved_gb must declare a Python-side default; otherwise the "
        "ORM emits an explicit NULL on INSERT when the application omits "
        "the column."
    )
    assert col.default.arg == 0, (
        f"disk_reserved_gb default must be 0 (mirror the migration's "
        f"server_default text('0')); got {col.default.arg!r}."
    )


def test_disk_reserved_gb_has_server_default() -> None:
    """Belt-and-suspenders: server-side default must also be 0 to match the
    migration and provide protection for any out-of-band raw-SQL INSERTs
    that bypass SQLAlchemy.
    """
    col = Device.__table__.c.disk_reserved_gb
    assert col.server_default is not None, (
        "disk_reserved_gb must declare server_default=text('0')."
    )


# ---------------------------------------------------------------------------
# disk_total_gb — quieter type mismatch (same shape class)
# ---------------------------------------------------------------------------


def test_disk_total_gb_is_bigint_not_int() -> None:
    """Migration is BIGINT; model used to be Integer. Type mismatch only
    bites once disk sizes exceed 2**31 bytes which is unlikely for now,
    but pin the type to avoid silent overflow when fleet hosts grow."""
    col = Device.__table__.c.disk_total_gb
    assert isinstance(col.type, BigInteger), (
        f"disk_total_gb must be BigInteger to match the migration; "
        f"got {col.type!r}. See ud01_unify_devices_registry.py:239."
    )


# ---------------------------------------------------------------------------
# Negative checks: the sibling Integer columns stay Integer
# ---------------------------------------------------------------------------


def test_sibling_int_columns_stay_int() -> None:
    """Sanity: the other budget/capacity columns are Integer in both the
    migration and the model. If a future migration changes any of these
    to BigInteger, the model needs to follow — but until then, this is the
    expected steady-state.
    """
    for col_name in (
        "cpu_cores",
        "memory_gb",
        "max_concurrent_agents",
        "max_concurrent_builds",
        "consecutive_failures",
    ):
        col = Device.__table__.c[col_name]
        assert isinstance(col.type, Integer) and not isinstance(col.type, BigInteger), (
            f"{col_name} unexpectedly is not plain Integer; got {col.type!r}. "
            f"If you're widening to BigInteger, update both the migration "
            f"AND this test."
        )
