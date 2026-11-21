"""Every revision ALTERs coord.fleet_runtime_policy before its versions table.

coord's write path locks the two policy tables parent first: ``FOR UPDATE`` on
``coord.fleet_runtime_policy``, then the snapshot INSERT into
``coord.fleet_runtime_policy_versions``. An ``ALTER TABLE`` takes ACCESS
EXCLUSIVE, held until the alembic transaction commits. So a revision that
ALTERs the versions table first, and then the parent, takes the two locks in the
opposite order to a concurrent coord write, and the two can deadlock.
capmodel_02 (qontinui-web#2228) set the parent-first order in both directions.
Its review found four earlier revisions whose ``downgrade()`` ran versions-first
(capmodel_01, fcap_01, kernel_gauges_01 and secrets_broker_01), and the order
there was swapped. This test keeps every revision in the corpus on that order.

Scope: ``ALTER TABLE`` only. A DELETE pair that removes the versions rows before
the parent rows (cihost_01, ciorch_01, fleet_policy_egress_01) is required by
the foreign key and takes row locks, not the table locks this test is about.

Source-only: it reads each revision's AST and never imports or runs it, so it
needs no database and cannot be skipped.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

_VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"

# The table an ALTER names: group 1 is "_versions" for the snapshot table, and
# the trailing \b stops the parent pattern matching a longer table name.
_ALTER = re.compile(
    r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"
    r"coord\.fleet_runtime_policy(_versions)?\b",
    re.IGNORECASE,
)


def _execute_sql(func: ast.FunctionDef) -> list[str]:
    """The SQL of each ``op.execute`` call in ``func``, in source order.

    A string argument is read whole (an implicitly concatenated literal is one
    Constant). An argument that is not a plain string, such as an f-string or a
    ``sa.text(...)`` call, contributes the text of its string parts, so a
    table name inside one is still seen.
    """
    statements: list[tuple[int, int, str]] = []
    for node in ast.walk(func):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "execute"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "op"
            and node.args
        ):
            continue
        parts = [
            sub.value
            for sub in ast.walk(node.args[0])
            if isinstance(sub, ast.Constant) and isinstance(sub.value, str)
        ]
        statements.append((node.lineno, node.col_offset, " ".join(parts)))
    return [sql for _, _, sql in sorted(statements)]


def _policy_alter_order(func: ast.FunctionDef) -> str:
    """``P`` for each ALTER of the parent, ``V`` for each ALTER of the versions
    table, in execution order (source order within the function)."""
    order = []
    for sql in _execute_sql(func):
        for match in _ALTER.finditer(sql):
            order.append("V" if match.group(1) else "P")
    return "".join(order)


def _revision_functions() -> list[tuple[str, str, ast.FunctionDef]]:
    found = []
    for path in sorted(_VERSIONS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in (
                "upgrade",
                "downgrade",
            ):
                found.append((path.name, node.name, node))
    return found


def test_the_scan_reaches_the_revisions_that_alter_both_tables() -> None:
    """The detector's reach: it must see the revisions known to ALTER both
    tables, or a pass below proves nothing."""
    both = {
        (name, direction)
        for name, direction, func in _revision_functions()
        if {"P", "V"} <= set(_policy_alter_order(func))
    }
    for revision in (
        "capmodel_01_capacity_model_dial_and_operator_bounds.py",
        "capmodel_02_consumer_list_has_one_dimension.py",
        "fcap_01_fleet_capacity_schema.py",
        "kernel_gauges_01_kernel_gauges_on_resource_sample.py",
        "secrets_broker_01_coord_tables.py",
    ):
        for direction in ("upgrade", "downgrade"):
            assert (revision, direction) in both, (revision, direction)


def test_every_revision_alters_the_parent_before_its_versions_table() -> None:
    offenders = []
    for name, direction, func in _revision_functions():
        order = _policy_alter_order(func)
        if "P" in order and "V" in order and order.index("V") < order.index("P"):
            offenders.append(f"{name}:{direction}() alters in order {order}")
    assert not offenders, (
        "ALTER coord.fleet_runtime_policy before coord.fleet_runtime_policy_versions "
        "(coord's write lock order), or a run against a live coord can deadlock:\n"
        + "\n".join(offenders)
    )


def test_the_order_check_fires_on_a_versions_first_body() -> None:
    """The check can fail: a versions-first body reads V before P."""
    func = ast.parse(
        "def downgrade():\n"
        "    op.execute('ALTER TABLE coord.fleet_runtime_policy_versions DROP COLUMN x')\n"
        "    op.execute(\n"
        "        'ALTER TABLE coord.fleet_runtime_policy '\n"
        "        'DROP COLUMN x'\n"
        "    )\n"
    ).body[0]
    assert isinstance(func, ast.FunctionDef)
    assert _policy_alter_order(func) == "VP"
