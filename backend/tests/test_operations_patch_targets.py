"""Tests patch ``/operations`` names through ``tests/_ops_patch.py`` only.

Plan ``2026-10-04-web-operations-py-is-one-router-for-every-coord-domain``,
decision D6. A patch on ONE module's binding of an imported name stops
reaching a route the moment the route moves to another module of the
``operations`` package, and the test then passes vacuously. So every such
patch goes through :func:`tests._ops_patch.patch_ops` /
:func:`tests._ops_patch.setattr_ops`, which patch every binding.

``test_operations_patch_targets_go_through_patch_ops`` scans ``tests/**`` and
fails on any of:

* a string constant naming ``<operations package>.<attr>`` — the
  ``patch(...)`` / ``mock.patch(...)`` / ``monkeypatch.setattr("...")``
  target form, including one parked in a constant first — other than
  ``httpx.AsyncClient``, which resolves to the global ``httpx`` module and so
  reaches every caller wherever its body lives;
* ``patch.object`` / ``monkeypatch.setattr`` / ``setattr`` / ``delattr`` whose
  first argument is the operations module (or an attribute of it), however it
  was imported;
* a plain ``<operations module>.<attr> = ...`` assignment.
"""

from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests._ops_patch import (
    OPS_PACKAGE,
    patch_ops,
    resolve_ops_targets,
    setattr_ops,
)

TESTS = Path(__file__).resolve().parent
_PREFIX = OPS_PACKAGE + "."
_ALLOWED_TARGET = "httpx.AsyncClient"
_PATCHING_ATTRS = frozenset({"object", "setattr", "delattr"})
_PATCHING_NAMES = frozenset({"setattr", "delattr"})


def _names_ops_module(node: ast.expr) -> bool:
    return isinstance(node, ast.Constant) and (
        node.value == OPS_PACKAGE
        or (isinstance(node.value, str) and node.value.startswith(_PREFIX))
    )


def _module_aliases(tree: ast.AST) -> set[str]:
    """Local names bound to the operations module (or a module under it)."""
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0:
            if node.module == OPS_PACKAGE.rpartition(".")[0]:
                aliases.update(
                    a.asname or a.name
                    for a in node.names
                    if a.name == OPS_PACKAGE.rpartition(".")[2]
                )
        elif isinstance(node, ast.Import):
            for a in node.names:
                if a.asname and (a.name == OPS_PACKAGE or a.name.startswith(_PREFIX)):
                    aliases.add(a.asname)
        elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            # ``mod = importlib.import_module("app...operations")``
            call = node.value
            if call.args and _names_ops_module(call.args[0]):
                aliases.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.Assign) and isinstance(node.value, ast.Subscript):
            # ``mod = sys.modules["app...operations"]``
            if _names_ops_module(node.value.slice):
                aliases.update(t.id for t in node.targets if isinstance(t, ast.Name))
    return aliases


def _root_name(node: ast.expr) -> str | None:
    while isinstance(node, ast.Attribute):
        node = node.value
    return node.id if isinstance(node, ast.Name) else None


def scan_source(source: str) -> tuple[list[str], int]:
    """``(violations, allowed httpx targets)`` for one test module's source."""
    tree = ast.parse(source)
    aliases = _module_aliases(tree)
    violations: list[str] = []
    allowed = 0
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and node.value.startswith(_PREFIX)
        ):
            if node.value[len(_PREFIX) :] == _ALLOWED_TARGET:
                allowed += 1
            else:
                violations.append(f"{node.lineno}: string target {node.value!r}")
        elif isinstance(node, ast.Call) and node.args:
            func = node.func
            patching = (
                isinstance(func, ast.Attribute) and func.attr in _PATCHING_ATTRS
            ) or (isinstance(func, ast.Name) and func.id in _PATCHING_NAMES)
            if patching and _root_name(node.args[0]) in aliases:
                violations.append(
                    f"{node.lineno}: {ast.unparse(func)}({ast.unparse(node.args[0])}, ...)"
                )
        elif isinstance(node, ast.Assign | ast.AugAssign | ast.AnnAssign):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Attribute) and _root_name(target) in aliases:
                    violations.append(
                        f"{node.lineno}: assignment to {ast.unparse(target)}"
                    )
    return violations, allowed


def test_operations_patch_targets_go_through_patch_ops() -> None:
    violations: dict[str, list[str]] = {}
    allowed = 0
    scanned = 0
    for path in sorted(TESTS.rglob("*.py")):
        found, ok = scan_source(path.read_text(encoding="utf-8"))
        scanned += 1
        allowed += ok
        if found:
            violations[str(path.relative_to(TESTS))] = found
    assert scanned > 100, f"scanned only {scanned} test modules"
    # Non-vacuity: the scan must SEE the allowed httpx form, or it is reading
    # nothing (the plan measured 65 of them).
    assert allowed > 0, "the scan saw no operations.httpx.AsyncClient patch"
    assert not violations, (
        "Patch operations names with tests._ops_patch.patch_ops / setattr_ops, "
        "which patch every module of the operations package that binds the "
        f"name: {violations}"
    )


@pytest.mark.parametrize(
    "snippet",
    [
        'patch("app.api.v1.endpoints.operations.logger")',
        'mock.patch("app.api.v1.endpoints.operations.runner_crud.list_runners")',
        'monkeypatch.setattr("app.api.v1.endpoints.operations.logger", 1)',
        'KEY = "app.api.v1.endpoints.operations.get_coord_identity"',
        "from app.api.v1.endpoints import operations\n"
        'patch.object(operations, "logger")',
        "from app.api.v1.endpoints import operations as ops\n"
        'monkeypatch.setattr(\n    ops,\n    "X",\n    0,\n)',
        "from app.api.v1.endpoints import operations as mod\n"
        'patch.object(mod.httpx, "AsyncClient", object)',
        "import app.api.v1.endpoints.operations as ops\nops.X = 1",
        "import importlib\n"
        'm = importlib.import_module("app.api.v1.endpoints.operations")\n'
        'setattr(m, "X", 1)',
    ],
)
def test_the_patch_target_scan_flags_every_form(snippet: str) -> None:
    violations, _ = scan_source(snippet)
    assert violations, f"the scan missed: {snippet!r}"


def test_the_patch_target_scan_allows_the_httpx_form() -> None:
    violations, allowed = scan_source(
        'patch("app.api.v1.endpoints.operations.httpx.AsyncClient")\n'
        "from app.api.v1.endpoints import operations\n"
        "operations.router.routes"
    )
    assert violations == []
    assert allowed == 1


def test_patch_ops_patches_and_restores_every_binding() -> None:
    from app.api.v1.endpoints import operations

    original = operations.logger
    with patch_ops("logger") as log:
        assert isinstance(log, MagicMock)
        assert operations.logger is log
    assert operations.logger is original


def test_patch_ops_patches_a_dotted_name_once_on_its_owner() -> None:
    from app.api.v1.endpoints import operations

    targets = resolve_ops_targets("runner_crud.list_runners")
    assert targets == [(operations.runner_crud, "list_runners")]
    stub = AsyncMock()
    with patch_ops("runner_crud.list_runners", new=stub) as seen:
        assert seen is stub
        assert operations.runner_crud.list_runners is stub
    assert operations.runner_crud.list_runners is not stub


def test_patch_ops_reaches_coord_proxy_too() -> None:
    from app.api import coord_proxy
    from app.api.v1.endpoints import operations

    stub = AsyncMock()
    with patch_ops("_proxy_coord_get", stub):
        assert operations._proxy_coord_get is stub
        assert coord_proxy._proxy_coord_get is stub


def test_patch_ops_refuses_a_name_nothing_binds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(LookupError):
        patch_ops("no_such_name_anywhere").start()
    with pytest.raises(LookupError):
        setattr_ops(monkeypatch, "no_such_name_anywhere", 1)
    with pytest.raises(LookupError):
        resolve_ops_targets("runner_crud.no_such_attribute")
