"""Concurrency guard for the remote-terminal relay: its suspend points must not move.

Plan ``2026-10-04-web-remote-terminal-relay-is-one-class-of-four-protocols``
splits ``app/services/runner/remote_terminal_relay.py`` into collaborators under
``app/services/runner/remote_relay/``. All relay state is mutated on ONE event
loop, so its correctness is a property of WHERE it yields: the races it defends
(an end reply racing ``terminal_exit``, ``_evict`` across concurrent sweeps, a
re-present outliving its socket) are interleavings at its ``await`` points.
Moving code between classes is safe only if no suspend point is added, removed
or reordered, and that is what this file pins.

**What is recorded.** For every function and method in the relay module and in
``remote_relay/*.py`` (absent until the split's Phase 1; tolerated), the ordered
list of its suspend and spawn nodes, in source order:

* ``await <callee>``: an ``await``, named by the awaited call's LAST name
  segment (``await self._send_to_source(...)`` -> ``await _send_to_source``;
  ``await asyncio.shield(...)`` -> ``await shield``);
* ``async with <name>`` / ``async for <name>``, named the same way;
* ``call <name>`` for any call whose last segment is ``create_task``,
  ``shield``, ``sleep`` or ``gather``, awaited or not.

Nested functions are recorded under their own name, not inside their parent.
Functions with no such node are left out, so adding a plain helper changes
nothing.

**The key scheme survives a move.** The snapshot is keyed by the BARE function
name: a method is its method name, with no class and no module. Callees are
likewise their last segment, so ``self._send_to_source`` becoming
``self.core._send_to_source`` is not a change. Where several functions share a
name (the module facade ``release_source`` and the method ``release_source``,
say), the value holds one shape per function, sorted, so file order and
module of origin do not matter. The plan keeps every method name unchanged when
it moves (its D2), so a pure move leaves this snapshot byte-identical, and any
diff is a real change to where the relay yields.

**Regenerating.** When a phase changes the shape ON PURPOSE (the plan's D3
``spawn_background`` relocates three ``create_task`` calls; Phase 5 relocates
the dispatch arms), rerun with ``UPDATE_AWAIT_SHAPE=1`` to rewrite
``tests/fixtures/remote_relay_await_shape.json``. The test then skips rather
than passes, and the JSON diff in the PR is the review artifact::

    UPDATE_AWAIT_SHAPE=1 pytest tests/test_remote_terminal_relay_await_shape.py

The second test is the import boundary the plan's Phase 1 sets for
``remote_relay/protocol.py``: wire vocabulary only, importing nothing from
``app``. It skips until that file exists.
"""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path
from typing import Any

import pytest

_BACKEND = Path(__file__).resolve().parent.parent
_RUNNER = _BACKEND / "app" / "services" / "runner"
_RELAY_MODULE = _RUNNER / "remote_terminal_relay.py"
_RELAY_PACKAGE = _RUNNER / "remote_relay"
_PROTOCOL_MODULE = _RELAY_PACKAGE / "protocol.py"
_SNAPSHOT = (
    Path(__file__).resolve().parent / "fixtures" / "remote_relay_await_shape.json"
)

# Calls recorded whether or not they are awaited: each one spawns or suspends.
# ``spawn_background`` is the relay's single ``create_task`` site since the
# split (plan D3), so its call sites are where a background spawn now sits in
# each caller's order. ``route_target_frame``, ``_ensure_listener`` and
# ``publish_target_frame`` are plain ``def`` delegators returning a coroutine,
# so recording the call pins where that coroutine is created.
_SPAWN_OR_SUSPEND_CALLS = frozenset(
    {
        "create_task",
        "shield",
        "sleep",
        "gather",
        "spawn_background",
        "route_target_frame",
        "_ensure_listener",
        "publish_target_frame",
    }
)

_Shape = list[str]


def _relay_sources() -> list[Path]:
    """The relay module plus every module of the split package, if it exists."""
    sources = [_RELAY_MODULE]
    if _RELAY_PACKAGE.is_dir():
        sources.extend(sorted(_RELAY_PACKAGE.glob("*.py")))
    return sources


def _last_name(node: ast.AST) -> str:
    """The stable descriptor of an expression: its last name segment."""
    if isinstance(node, ast.Call):
        return _last_name(node.func)
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Await):
        return _last_name(node.value)
    return f"<{type(node).__name__}>"


class _ShapeRecorder(ast.NodeVisitor):
    """Collect one function's suspend/spawn nodes in source order."""

    def __init__(self) -> None:
        self.shape: _Shape = []

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return None  # nested: recorded under its own name

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return None  # nested: recorded under its own name

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return None

    def visit_Await(self, node: ast.Await) -> None:
        self.shape.append(f"await {_last_name(node.value)}")
        self.generic_visit(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        for item in node.items:
            self.shape.append(f"async with {_last_name(item.context_expr)}")
        self.generic_visit(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.shape.append(f"async for {_last_name(node.iter)}")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        name = _last_name(node.func)
        if name in _SPAWN_OR_SUSPEND_CALLS:
            self.shape.append(f"call {name}")
        self.generic_visit(node)


def _function_shape(func: ast.FunctionDef | ast.AsyncFunctionDef) -> _Shape:
    recorder = _ShapeRecorder()
    for stmt in func.body:
        recorder.visit(stmt)
    return recorder.shape


def compute_await_shape(sources: list[Path]) -> dict[str, list[_Shape]]:
    """Bare function name -> the sorted shapes of every function so named."""
    shapes: dict[str, list[_Shape]] = {}
    for path in sources:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            shape = _function_shape(node)
            if shape:
                shapes.setdefault(node.name, []).append(shape)
    return {
        name: sorted(found, key=json.dumps) for name, found in sorted(shapes.items())
    }


def _render(shapes: dict[str, Any]) -> str:
    return json.dumps(shapes, indent=2, sort_keys=True) + "\n"


def test_relay_await_shape_matches_the_snapshot() -> None:
    actual = compute_await_shape(_relay_sources())
    assert actual, "no suspend points found: the relay module moved?"

    if os.environ.get("UPDATE_AWAIT_SHAPE") == "1":
        _SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        _SNAPSHOT.write_text(_render(actual), encoding="utf-8", newline="\n")
        pytest.skip(f"await-shape snapshot rewritten: {_SNAPSHOT}")

    assert _SNAPSHOT.is_file(), (
        f"{_SNAPSHOT} is missing; generate it with UPDATE_AWAIT_SHAPE=1"
    )
    expected = json.loads(_SNAPSHOT.read_text(encoding="utf-8"))
    changed = sorted(
        name
        for name in set(expected) | set(actual)
        if expected.get(name) != actual.get(name)
    )
    detail = "\n".join(
        f"  {name}:\n    snapshot: {expected.get(name)}\n    now:      {actual.get(name)}"
        for name in changed
    )
    assert not changed, (
        "The relay's suspend points changed. A pure move must not add, remove "
        "or reorder an await. If the change is intended, regenerate with "
        f"UPDATE_AWAIT_SHAPE=1 and review the JSON diff.\n{detail}"
    )


def _app_imports(tree: ast.Module) -> list[str]:
    """Every import in ``tree`` that reaches into the ``app`` package."""
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend(
                alias.name
                for alias in node.names
                if alias.name == "app" or alias.name.startswith("app.")
            )
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if node.level > 0:
                # A relative import inside ``app/`` is an ``app`` import.
                found.append("." * node.level + module)
            elif module == "app" or module.startswith("app."):
                found.append(module)
    return found


def test_relay_protocol_module_imports_nothing_from_app() -> None:
    if not _PROTOCOL_MODULE.is_file():
        pytest.skip(f"{_PROTOCOL_MODULE.name} does not exist yet (split Phase 1)")
    tree = ast.parse(_PROTOCOL_MODULE.read_text(encoding="utf-8"))
    assert _app_imports(tree) == [], (
        "remote_relay/protocol.py is the pure wire vocabulary: stdlib, "
        "qontinui_schemas and third-party imports only"
    )
