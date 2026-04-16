"""
Guard against the "Rust enum variant added but Alembic migration forgotten" drift.

The generated Pydantic ``StrEnum`` classes exported from
``qontinui_schemas.generated`` are the API-boundary contract (source of truth:
``qontinui-schemas/rust/src/task_run.rs``). When Rust gains a new variant, the
Pydantic models accept it on parse, but the PostgreSQL ``INSERT`` silently
fails unless an Alembic migration has extended the corresponding PG ``ENUM``
type. The failure mode is insidious: the runner emits findings, the API layer
validates them, and only the DB write rejects them — usually swallowed at the
persistence layer.

Two concrete instances of this drift have already been fixed in-session:

* ``finding_category`` was missing ``data_migration`` and ``warning`` — fixed
  by migration ``tg21f6g7h8c9``.
* ``finding_action_type`` was missing ``manual`` — fixed by migration
  ``uh32g7h8i9d0``.

This parametrized test asserts, for every finding/task-run enum pair, that
the Python contract values are a subset of the PG ENUM values. Extra PG
values (legacy values not yet in Python) are tolerated and will be cleaned
up separately.
"""

from __future__ import annotations

import importlib.util
from enum import Enum
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _load_enum(module_stem: str, class_name: str) -> type[Enum]:
    """Load a generated enum from its per-type file, bypassing the package.

    ``qontinui_schemas.generated.__init__`` eagerly imports every per-type
    module, so any transiently-missing file (common during concurrent
    codegen) takes down the whole namespace.  Loading each enum module in
    isolation keeps this parity test resilient to that flakiness.
    """
    import qontinui_schemas as _root

    schemas_root = Path(_root.__file__).resolve().parent
    module_path = schemas_root / "generated" / "per_type" / f"{module_stem}.py"
    spec = importlib.util.spec_from_file_location(
        f"_enum_parity_{module_stem}", module_path
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cls: type[Enum] = getattr(module, class_name)
    return cls


TaskType = _load_enum("task_type", "TaskType")
TaskRunStatus = _load_enum("task_run_status", "TaskRunStatus")
TaskRunFindingCategory = _load_enum(
    "task_run_finding_category", "TaskRunFindingCategory"
)
TaskRunFindingSeverity = _load_enum(
    "task_run_finding_severity", "TaskRunFindingSeverity"
)
TaskRunFindingStatus = _load_enum("task_run_finding_status", "TaskRunFindingStatus")
TaskRunFindingActionType = _load_enum(
    "task_run_finding_action_type", "TaskRunFindingActionType"
)

# (python_enum_class, pg_enum_type_name) pairs — one row per enum contract.
ENUM_PAIRS: list[tuple[type[Enum], str]] = [
    (TaskType, "task_type"),
    (TaskRunStatus, "task_run_status"),
    (TaskRunFindingCategory, "finding_category"),
    (TaskRunFindingSeverity, "finding_severity"),
    (TaskRunFindingStatus, "finding_status"),
    (TaskRunFindingActionType, "finding_action_type"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("py_enum_class", "pg_enum_type_name"),
    ENUM_PAIRS,
    ids=[pg for _, pg in ENUM_PAIRS],
)
async def test_pg_enum_contains_all_python_enum_values(
    async_db_session: AsyncSession,
    py_enum_class: type[Enum],
    pg_enum_type_name: str,
) -> None:
    """Every generated Python enum value must exist in its PG ENUM counterpart.

    See module docstring for the drift bug class and the two fix migrations
    (``tg21f6g7h8c9`` and ``uh32g7h8i9d0``) that motivated this guard.
    """
    result = await async_db_session.execute(
        text(f"SELECT unnest(enum_range(NULL::{pg_enum_type_name}))::text")
    )
    pg_values: set[str] = set(result.scalars().all())
    py_values: set[str] = {member.value for member in py_enum_class}

    missing = py_values - pg_values
    assert not missing, (
        f"PG ENUM '{pg_enum_type_name}' is missing values present in Python "
        f"enum '{py_enum_class.__name__}': {sorted(missing)}. "
        f"Add an Alembic migration with ALTER TYPE ... ADD VALUE for each "
        f"missing value (see migrations tg21f6g7h8c9 and uh32g7h8i9d0 for "
        f"reference)."
    )
