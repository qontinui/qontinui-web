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
* ``patch.object`` / ``patch.multiple`` / ``monkeypatch.setattr`` /
  ``setattr`` / ``delattr`` whose target (first positional argument, or the
  ``target=`` keyword) is the operations module, a submodule of it, or an
  attribute of either, however it was imported — an alias (including
  ``from <package> import <submodule> as f``), the full dotted
  ``app.api.v1.endpoints.operations`` chain, or the package path string;
* a plain ``<operations module>.<attr> = ...`` assignment;
* a patch target BUILT from the bare package path string (literal, or a name
  bound to it) — ``patch(PKG + ".x")`` (``PKG`` on either side of any ``+``,
  however nested), ``patch(f"{PKG}.{name}")``, or the
  same expression parked in a name first. Building a module name for any
  other purpose (``PKG + ".fleet"`` for an import, a prefix test) is not a
  patch and is not flagged. ``tests/_ops_patch.py`` is exempt: it defines
  that prefix.
"""

from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests._ops_patch import (
    OPS_PACKAGE,
    ops_submodules,
    patch_ops,
    resolve_ops_targets,
    setattr_ops,
)

TESTS = Path(__file__).resolve().parent
_PREFIX = OPS_PACKAGE + "."
_ALLOWED_TARGET = "httpx.AsyncClient"
_PATCHING_ATTRS = frozenset({"object", "multiple", "setattr", "delattr"})
_PATCHING_NAMES = frozenset({"setattr", "delattr"})
# Calls whose first argument is a patch target: ``patch(...)``,
# ``mock.patch(...)``, ``patch.object(...)``, ``monkeypatch.setattr(...)`` …
_TARGET_ATTRS = _PATCHING_ATTRS | {"patch"}
_TARGET_NAMES = _PATCHING_NAMES | {"patch"}


def _names_ops_module(node: ast.expr) -> bool:
    return isinstance(node, ast.Constant) and (
        node.value == OPS_PACKAGE
        or (isinstance(node.value, str) and node.value.startswith(_PREFIX))
    )


def _module_aliases(tree: ast.AST, submodules: frozenset[str]) -> set[str]:
    """Local names bound to the operations module (or a module under it).

    ``submodules`` are the dotted submodule names of the package: ``from
    <operations package> import fleet as f`` binds ``f`` to a module under
    the package only when ``fleet`` is one of them (otherwise it is a name
    the module merely binds, such as the shared ``runner_crud`` module,
    whose own patch reaches every caller).
    """
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            if node.module == OPS_PACKAGE.rpartition(".")[0]:
                aliases.update(
                    a.asname or a.name
                    for a in node.names
                    if a.name == OPS_PACKAGE.rpartition(".")[2]
                )
            elif node.module == OPS_PACKAGE or node.module.startswith(_PREFIX):
                aliases.update(
                    a.asname or a.name
                    for a in node.names
                    if f"{node.module}.{a.name}" in submodules
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


def _dotted(node: ast.expr) -> str | None:
    """``a.b.c`` for an ``Attribute``/``Name`` chain, else ``None``."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def _is_ops_object(node: ast.expr, aliases: set[str]) -> bool:
    """``node`` evaluates to the operations module or something under it."""
    if _root_name(node) in aliases:
        return True
    dotted = _dotted(node)
    return dotted is not None and (dotted == OPS_PACKAGE or dotted.startswith(_PREFIX))


def _package_path_names(tree: ast.AST) -> set[str]:
    """Names bound to the bare package path string."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign | ast.AnnAssign) and _is_package_path(
            node.value
        ):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names.update(t.id for t in targets if isinstance(t, ast.Name))
    return names


def _is_package_path(node: ast.expr | None) -> bool:
    return isinstance(node, ast.Constant) and node.value == OPS_PACKAGE


def _is_package_ref(node: ast.expr, names: set[str]) -> bool:
    if isinstance(node, ast.FormattedValue):
        node = node.value
    return _is_package_path(node) or (isinstance(node, ast.Name) and node.id in names)


def _builds_target_from_package(node: ast.expr, names: set[str]) -> bool:
    """``PKG + ...`` (however nested) or an f-string with ``{PKG}.``."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return any(
            _is_package_ref(side, names) or _builds_target_from_package(side, names)
            for side in (node.left, node.right)
        )
    if isinstance(node, ast.JoinedStr):
        values = node.values
        return any(
            _is_package_ref(part, names)
            and isinstance(after, ast.Constant)
            and isinstance(after.value, str)
            and after.value.startswith(".")
            for part, after in zip(values, values[1:], strict=False)
        )
    return False


def _built_target_names(tree: ast.AST, names: set[str]) -> set[str]:
    """Names bound to a target built from the package path."""
    built: set[str] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign | ast.AnnAssign)
            and node.value is not None
            and _builds_target_from_package(node.value, names)
        ):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            built.update(t.id for t in targets if isinstance(t, ast.Name))
    return built


def _target_arg(node: ast.Call) -> ast.expr | None:
    """The patch target of a call: its first positional argument, else its
    ``target=`` keyword (``patch(target=...)``, ``patch.object(target=...)``,
    ``monkeypatch.setattr(target=...)``)."""
    if node.args:
        return node.args[0]
    for keyword in node.keywords:
        if keyword.arg == "target":
            return keyword.value
    return None


def scan_source(
    source: str, submodules: frozenset[str] | None = None
) -> tuple[list[str], int]:
    """``(violations, allowed httpx targets)`` for one test module's source.

    ``submodules`` defaults to the operations package's submodules on disk.
    """
    if submodules is None:
        submodules = ops_submodules()
    tree = ast.parse(source)
    aliases = _module_aliases(tree, submodules)
    package_names = _package_path_names(tree)
    built_names = _built_target_names(tree, package_names)
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
        elif isinstance(node, ast.Call) and (first := _target_arg(node)) is not None:
            func = node.func
            patching = (
                isinstance(func, ast.Attribute) and func.attr in _PATCHING_ATTRS
            ) or (isinstance(func, ast.Name) and func.id in _PATCHING_NAMES)
            takes_target = (
                isinstance(func, ast.Attribute) and func.attr in _TARGET_ATTRS
            ) or (isinstance(func, ast.Name) and func.id in _TARGET_NAMES)
            if takes_target and (
                _builds_target_from_package(first, package_names)
                or (isinstance(first, ast.Name) and first.id in built_names)
            ):
                violations.append(
                    f"{node.lineno}: target built from the package path: "
                    f"{ast.unparse(func)}({ast.unparse(first)}, ...)"
                )
            elif patching and (
                _is_ops_object(first, aliases) or _is_package_ref(first, package_names)
            ):
                violations.append(
                    f"{node.lineno}: {ast.unparse(func)}({ast.unparse(first)}, ...)"
                )
        elif isinstance(node, ast.Assign | ast.AugAssign | ast.AnnAssign):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Attribute) and _is_ops_object(
                    target, aliases
                ):
                    violations.append(
                        f"{node.lineno}: assignment to {ast.unparse(target)}"
                    )
    return violations, allowed


def test_operations_patch_targets_go_through_patch_ops() -> None:
    violations: dict[str, list[str]] = {}
    allowed = 0
    scanned = 0
    for path in sorted(TESTS.rglob("*.py")):
        if path == TESTS / "_ops_patch.py":
            continue  # defines the package-path prefix the helpers patch through
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
        "from app.api.v1.endpoints import operations\npatch.multiple(operations, X=1)",
        'patch.multiple("app.api.v1.endpoints.operations", X=1)',
        "import app.api.v1.endpoints.operations\n"
        'patch.object(app.api.v1.endpoints.operations, "logger")',
        "import app.api.v1.endpoints.operations\n"
        'monkeypatch.setattr(app.api.v1.endpoints.operations.httpx, "X", 1)',
        "import app.api.v1.endpoints.operations\napp.api.v1.endpoints.operations.X = 1",
        'patch("app.api.v1.endpoints.operations" + ".logger")',
        'MOD = "app.api.v1.endpoints.operations"\npatch(MOD + ".logger")',
        'MOD = "app.api.v1.endpoints.operations"\npatch(f"{MOD}.{name}")',
        'MOD: str = "app.api.v1.endpoints.operations"\npatch(f"{MOD}.logger")',
        'MOD = "app.api.v1.endpoints.operations"\nmock.patch(MOD + "." + name)',
        'MOD = "app.api.v1.endpoints.operations"\n'
        'KEY = f"{MOD}.logger"\nmonkeypatch.setattr(KEY, 1)',
    ],
)
def test_the_patch_target_scan_flags_every_form(snippet: str) -> None:
    violations, _ = scan_source(snippet)
    assert violations, f"the scan missed: {snippet!r}"


# A ``fleet.py`` submodule under ``operations/`` (the package is one file today).
_FAKE_SUBMODULES = frozenset({OPS_PACKAGE + ".fleet"})


@pytest.mark.parametrize(
    "snippet",
    [
        # (a) the package path on the right of a nested ``+``.
        'MOD = "app.api.v1.endpoints.operations"\npatch(("" + MOD) + ".logger")',
        'patch(("" + "app.api.v1.endpoints.operations") + ".logger")',
        'MOD = "app.api.v1.endpoints.operations"\nmock.patch("" + (MOD + ".x"))',
        # (b) the target passed by keyword.
        'MOD = "app.api.v1.endpoints.operations"\npatch(target=MOD + ".logger")',
        "from app.api.v1.endpoints import operations\n"
        'patch.object(target=operations, attribute="logger")',
        "import app.api.v1.endpoints.operations as ops\n"
        'monkeypatch.setattr(target=ops, name="X", value=1)',
        # (c) a submodule bound by ``from ... import <sub> as f`` / ``import``.
        "from app.api.v1.endpoints.operations import fleet as f\n"
        'patch.object(f, "logger")',
        "from app.api.v1.endpoints.operations import fleet\n"
        'monkeypatch.setattr(fleet, "X", 1)',
        "from app.api.v1.endpoints.operations import fleet as f\nf.X = 1",
        'import app.api.v1.endpoints.operations.fleet as f\npatch.object(f, "logger")',
    ],
)
def test_the_patch_target_scan_flags_nested_keyword_and_submodule_forms(
    snippet: str,
) -> None:
    violations, _ = scan_source(snippet, _FAKE_SUBMODULES)
    assert violations, f"the scan missed: {snippet!r}"


@pytest.mark.parametrize(
    "snippet",
    [
        # A non-submodule name imported from the package is not the module:
        # patching the shared object it binds reaches every caller.
        "from app.api.v1.endpoints.operations import runner_crud\n"
        'patch.object(runner_crud, "list_runners")',
        "from app.api.v1.endpoints.operations import router\n"
        'monkeypatch.setattr(router, "X", 1)',
        # A keyword that is not the target is not inspected.
        'MOD = "app.api.v1.endpoints.operations"\n'
        'patch.object(other, "X", new=MOD + ".y")',
        'PKG = "app.api.v1.endpoints.operations"\n'
        'importlib.import_module(name=("" + PKG) + ".fleet")',
    ],
)
def test_the_patch_target_scan_allows_non_submodule_and_non_target_forms(
    snippet: str,
) -> None:
    violations, _ = scan_source(snippet, _FAKE_SUBMODULES)
    assert violations == [], violations


@pytest.mark.parametrize(
    "snippet",
    [
        'importlib.import_module("app.api.v1.endpoints.operations")',
        'PKG = "app.api.v1.endpoints.operations"\nprint(f"see {PKG} for details")',
        "import app.api.v1.endpoints.operations\n"
        "app.api.v1.endpoints.operations.router.routes",
        'patch.object(other_module, "X")',
        'PKG = "app.api.v1.endpoints.operations"\n'
        'importlib.import_module(PKG + ".fleet")\nname.startswith(PKG + ".")',
    ],
)
def test_the_patch_target_scan_allows_non_patching_uses(snippet: str) -> None:
    violations, _ = scan_source(snippet)
    assert violations == [], violations


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


def test_ops_patcher_stop_stops_every_patcher_and_reraises_the_first() -> None:
    from tests._ops_patch import _OpsPatcher

    stopped: list[str] = []

    class _Fake:
        def __init__(self, label: str, error: Exception | None) -> None:
            self.label = label
            self.error = error

        def stop(self) -> None:
            stopped.append(self.label)
            if self.error is not None:
                raise self.error

    first, second = RuntimeError("first"), RuntimeError("second")
    patcher = _OpsPatcher("logger", None, {})
    # stop() pops newest first: c (raises first), b (raises second), a.
    patcher._patchers = [_Fake("a", None), _Fake("b", second), _Fake("c", first)]
    with pytest.raises(RuntimeError) as raised:
        patcher.stop()
    assert raised.value is first
    assert stopped == ["c", "b", "a"]
    assert patcher._patchers == []
