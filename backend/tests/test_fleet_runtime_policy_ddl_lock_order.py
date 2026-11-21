"""Every revision locks coord.fleet_runtime_policy before its versions table.

coord's write path locks the two policy tables parent first: ``FOR UPDATE`` on
``coord.fleet_runtime_policy``, then the snapshot INSERT into
``coord.fleet_runtime_policy_versions`` (``fleet_policy.rs``
``select_policy_for_update`` then ``insert_version_snapshot_tx``). An
``ALTER TABLE`` or ``DROP TABLE`` takes ACCESS EXCLUSIVE, held until the alembic
transaction commits. A revision that takes that lock on the versions table
first, and then on the parent, takes the two in the opposite order to a
concurrent coord write, and the two can deadlock. capmodel_02
(qontinui-web#2228) set the parent-first order in both directions. Its review
found four earlier revisions whose ``downgrade()`` ran versions-first
(capmodel_01, fcap_01, kernel_gauges_01, secrets_broker_01). A follow-up review
found fleet_res_tel_02's downgrade dropping the versions table before altering
the parent. All five were reordered, and this test keeps every revision that
names either table on that order.

How it reads a revision: it RUNS each ``upgrade()`` and ``downgrade()``
against a recording ``op``, so SQL that a module-level helper builds (the
``for table in _TABLES: op.execute(_add_columns(table))`` shape in
sess_guard_01 and fleet_res_tel_03) is seen exactly as it would execute. An
``op`` method other than ``execute`` that names one of the two tables (e.g.
``op.add_column("fleet_runtime_policy", ...)``) is recorded as a lock on that
table. A revision that cannot be run this way fails the test rather than
being skipped.

Scope: table-lock statements only (``ALTER TABLE``, ``DROP TABLE``,
``LOCK TABLE``, ``TRUNCATE``). A DELETE pair that removes the versions rows
before the parent rows (cihost_01, ciorch_01, fleet_policy_egress_01) is
required by the foreign key and takes row locks, not table locks.

No database: it never connects, so it cannot be skipped.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from tests._alembic_harness import load_revision_module

_VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PARENT = "fleet_runtime_policy"
_VERSIONS = "fleet_runtime_policy_versions"

# Group 1 is "_versions" for the snapshot table; the trailing \b stops the
# parent pattern matching a longer table name.
_TABLE_LOCK = re.compile(
    r"\b(?:ALTER\s+TABLE|DROP\s+TABLE|LOCK\s+TABLE|TRUNCATE(?:\s+TABLE)?)\s+"
    r"(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?coord\.fleet_runtime_policy(_versions)?\b",
    re.IGNORECASE,
)


class _RecordingOp:
    """An alembic ``op`` stand-in that records, in call order, every SQL text
    passed to ``execute`` (on ``op`` itself or on ``op.get_bind()``) and every
    other ``op`` call that names a policy table, as the table-lock statement
    that call would issue."""

    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, sql: object, *args: Any, **kwargs: Any) -> None:
        self.statements.append(str(sql))

    def get_bind(self) -> _RecordingOp:
        # A bind's ``execute`` lands in the same ordered record.
        return self

    def __getattr__(self, name: str) -> Any:
        def record(*args: Any, **kwargs: Any) -> None:
            values = [*args, *kwargs.values()]
            for table in (_PARENT, _VERSIONS):
                if table in values:
                    self.statements.append(f"ALTER TABLE coord.{table} -- op.{name}")

        return record


def _lock_order(statements: list[str]) -> str:
    """``P`` per table lock on the parent, ``V`` per lock on the versions
    table, in execution order."""
    return "".join(
        "V" if match.group(1) else "P"
        for sql in statements
        for match in _TABLE_LOCK.finditer(sql)
    )


def _policy_revisions() -> list[Path]:
    return sorted(
        path
        for path in _VERSIONS_DIR.glob("*.py")
        if _PARENT in path.read_text(encoding="utf-8")
    )


def _orders(monkeypatch: pytest.MonkeyPatch) -> dict[tuple[str, str], str]:
    """``(revision file, direction) -> lock order`` for every revision naming
    a policy table. A revision that raises under the recording op is reported
    as a failure, never dropped from the result."""
    orders: dict[tuple[str, str], str] = {}
    failures: list[str] = []
    for path in _policy_revisions():
        module = load_revision_module(path, f"_lock_order_{path.stem}")
        for direction in ("upgrade", "downgrade"):
            recorder = _RecordingOp()
            monkeypatch.setattr(module, "op", recorder)
            try:
                getattr(module, direction)()
            except Exception as exc:  # noqa: BLE001 - every failure is reported
                failures.append(f"{path.name}:{direction}(): {exc!r}")
                continue
            orders[(path.name, direction)] = _lock_order(recorder.statements)
    assert not failures, (
        "these revisions could not be run against a recording op, so their "
        "lock order is UNKNOWN:\n" + "\n".join(failures)
    )
    return orders


def test_the_scan_reaches_every_revision_that_locks_both_tables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The detector's reach: the revisions known to lock both tables must read
    as locking both, or a pass below proves nothing. sess_guard_01 and
    fleet_res_tel_03 build their SQL in a helper, which a source scan misses."""
    orders = _orders(monkeypatch)
    both = {key for key, order in orders.items() if {"P", "V"} <= set(order)}
    for revision, directions in (
        (
            "capmodel_01_capacity_model_dial_and_operator_bounds.py",
            ("upgrade", "downgrade"),
        ),
        ("capmodel_02_consumer_list_has_one_dimension.py", ("upgrade", "downgrade")),
        ("fcap_01_fleet_capacity_schema.py", ("upgrade", "downgrade")),
        (
            "kernel_gauges_01_kernel_gauges_on_resource_sample.py",
            ("upgrade", "downgrade"),
        ),
        ("secrets_broker_01_coord_tables.py", ("upgrade", "downgrade")),
        ("sess_guard_01_session_protection_floor_columns.py", ("upgrade", "downgrade")),
        ("fleet_res_tel_03_fleet_policy_control_columns.py", ("upgrade", "downgrade")),
        ("fleet_res_tel_02_fleet_runtime_policy_versions.py", ("downgrade",)),
    ):
        for direction in directions:
            assert (revision, direction) in both, (
                revision,
                direction,
                orders.get((revision, direction)),
            )


def test_every_revision_locks_the_parent_before_its_versions_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    offenders = [
        f"{name}:{direction}() locks in order {order}"
        for (name, direction), order in _orders(monkeypatch).items()
        if "P" in order and "V" in order and order.index("V") < order.index("P")
    ]
    assert not offenders, (
        "lock coord.fleet_runtime_policy before coord.fleet_runtime_policy_versions "
        "(coord's write lock order), or a run against a live coord can deadlock:\n"
        + "\n".join(offenders)
    )


def test_the_order_check_fires_on_a_versions_first_sequence() -> None:
    """The check can fail: each versions-first shape reads V before P."""
    recorder = _RecordingOp()
    recorder.execute("DROP TABLE IF EXISTS coord.fleet_runtime_policy_versions")
    recorder.add_column(_VERSIONS, object())
    recorder.execute("ALTER TABLE coord.fleet_runtime_policy DROP COLUMN x")
    assert _lock_order(recorder.statements) == "VVP"
