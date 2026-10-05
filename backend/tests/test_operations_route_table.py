"""Guards that let ``/api/v1/operations`` be split into per-domain modules.

Plan ``2026-10-04-web-operations-py-is-one-router-for-every-coord-domain``,
Phase 0. ``app/api/v1/endpoints/operations.py`` is one router for every coord
domain; the plan moves it, a domain at a time, into an ``operations/``
package. Each move must be behaviour-preserving, and these tests are what
makes that checkable:

* ``test_operations_route_table`` — one line per mounted ``/operations``
  route (methods, path, name, response model, status code, schema
  visibility, and the qualnames of every dependency FastAPI resolves for it,
  router-level ones included) must equal the committed fixture. Qualnames,
  not module paths, so a move between modules does not change a line while a
  dropped ``Depends`` or a changed response model does.

  Regenerate after an INTENDED route change, and review the diff::

      UPDATE_OPERATIONS_ROUTE_TABLE=1 poetry run pytest tests/test_operations_route_table.py

* ``test_operations_shadow_order`` — FastAPI matches in registration order,
  so a literal route (``/memory/list``) must be registered before the
  parameter route that would also match it (``/memory/{name}``). The pairs
  are computed from the live route table, not listed, so a pair added later
  is covered too.

* ``test_operations_package_has_no_init_imports`` — decision D4: once
  ``operations`` is a package, no module under it imports from the package
  ``__init__`` (a partial-init cycle). Trivially green while it is one file.
"""

from __future__ import annotations

import ast
import os
import re
import types
import typing
from pathlib import Path
from typing import Any

from fastapi.routing import APIRoute, APIWebSocketRoute

OPS_PREFIX = "/api/v1/operations"
OPS_PACKAGE = "app.api.v1.endpoints.operations"
FIXTURE = Path(__file__).parent / "fixtures" / "operations_route_table.txt"
UPDATE_ENV = "UPDATE_OPERATIONS_ROUTE_TABLE"
BACKEND = Path(__file__).resolve().parent.parent

# A path parameter, with or without a convertor (``{name}``, ``{p:path}``).
_PARAM = re.compile(r"\{[^}]+\}")
# Substituted for every path parameter to make a concrete sample path.
_SAMPLE_TOKEN = "x"


def _ops_routes() -> list[tuple[int, Any]]:
    """``(registration index, route)`` for every mounted /operations route."""
    from app.main import app

    return [
        (index, route)
        for index, route in enumerate(app.routes)
        if isinstance(route, APIRoute | APIWebSocketRoute)
        and (route.path == OPS_PREFIX or route.path.startswith(OPS_PREFIX + "/"))
    ]


def _methods(route: Any) -> list[str]:
    if isinstance(route, APIWebSocketRoute):
        return ["WS"]
    return sorted(route.methods)


def _type_name(value: Any) -> str:
    """A module-independent, address-free rendering of a type annotation."""
    if value is None:
        return "None"
    if value is type(None):
        return "None"
    origin = typing.get_origin(value)
    if origin is not None:
        args = typing.get_args(value)
        if origin in (typing.Union, types.UnionType):
            return " | ".join(_type_name(arg) for arg in args)
        rendered = ", ".join(_type_name(arg) for arg in args)
        return f"{_type_name(origin)}[{rendered}]"
    qualname = getattr(value, "__qualname__", None)
    if isinstance(qualname, str):
        return qualname
    return type(value).__qualname__


def _call_name(call: Any) -> str:
    """Qualname of a dependency callable — never a repr with an address."""
    func = getattr(call, "func", None)
    if func is not None and hasattr(call, "args"):  # functools.partial
        return f"partial({_call_name(func)})"
    qualname = getattr(call, "__qualname__", None)
    if isinstance(qualname, str):
        return qualname
    return f"{type(call).__qualname__}()"


def _dependency_names(dependant: Any) -> list[str]:
    """Every dependency call under ``dependant``, depth-first, in order.

    The endpoint itself (the root call) is excluded; it is the ``name`` column.
    """
    names: list[str] = []
    for sub in dependant.dependencies:
        if sub.call is not None:
            names.append(_call_name(sub.call))
        names.extend(_dependency_names(sub))
    return names


def _route_line(route: Any) -> str:
    if isinstance(route, APIWebSocketRoute):
        response_model = status_code = include_in_schema = "-"
    else:
        response_model = _type_name(route.response_model)
        status_code = str(route.status_code)
        include_in_schema = str(route.include_in_schema)
    dependencies = ", ".join(_dependency_names(route.dependant))
    return " ".join(
        [
            ",".join(_methods(route)),
            route.path,
            route.name,
            response_model,
            status_code,
            include_in_schema,
            f"[{dependencies}]",
        ]
    )


def _route_table() -> list[str]:
    return sorted(_route_line(route) for _, route in _ops_routes())


def test_operations_route_table() -> None:
    table = _route_table()
    assert len(table) > 200, f"only {len(table)} /operations routes — app not mounted?"
    for line in table:
        assert not re.search(r"0x[0-9a-fA-F]{6,}", line), (
            f"route-table line carries a memory address, so it is not "
            f"deterministic: {line}"
        )
    rendered = "\n".join(table) + "\n"
    if os.environ.get(UPDATE_ENV) == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(rendered, encoding="utf-8", newline="\n")
    expected = FIXTURE.read_text(encoding="utf-8").splitlines()
    missing = sorted(set(expected) - set(table))
    added = sorted(set(table) - set(expected))
    assert table == expected, (
        "The mounted /api/v1/operations route table differs from "
        f"{FIXTURE.name}.\n  in the fixture, not served: {missing}\n"
        f"  served, not in the fixture: {added}\n"
        "A behaviour-preserving move must leave this table unchanged. If the "
        f"change is intended, regenerate with {UPDATE_ENV}=1 and review the diff."
    )


def _sample_path(path: str) -> str:
    return _PARAM.sub(_SAMPLE_TOKEN, path)


def _shadow_pairs(
    routes: list[tuple[int, Any]],
) -> list[tuple[tuple[int, Any], tuple[int, Any]]]:
    """``[(literal, shadow)]``: same-method routes where ``shadow``'s pattern
    matches a concrete sample of ``literal``'s path but not the reverse — so
    ``literal`` is reachable only if it is registered first."""
    pairs = []
    for literal in routes:
        sample = _sample_path(literal[1].path)
        for shadow in routes:
            if shadow is literal or shadow[1].path == literal[1].path:
                continue
            if not set(_methods(shadow[1])) & set(_methods(literal[1])):
                continue
            if not shadow[1].path_regex.match(sample):
                continue
            if literal[1].path_regex.match(_sample_path(shadow[1].path)):
                # Each matches the other's sample: neither is more specific,
                # so registration order cannot make both reachable. Not a
                # shadow pair; report it as an ambiguity instead.
                raise AssertionError(
                    f"ambiguous /operations routes: {literal[1].path} and "
                    f"{shadow[1].path} each match the other"
                )
            pairs.append((literal, shadow))
    return pairs


def test_operations_shadow_order() -> None:
    pairs = _shadow_pairs(_ops_routes())
    print(f"order-dependent /operations route pairs: {len(pairs)}")
    assert pairs, (
        "no order-dependent /operations pair found — the computation went "
        "vacuous (there were 9 at plan authoring)"
    )
    wrong = [
        f"{','.join(_methods(lit))} {lit.path} (#{li}) is registered after "
        f"{shadow.path} (#{si}), which matches it first"
        for (li, lit), (si, shadow) in pairs
        if li > si
    ]
    assert not wrong, "Shadowed /operations routes:\n" + "\n".join(wrong)


def _imports_package_init(source: str) -> list[int]:
    return [
        node.lineno
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ImportFrom)
        and node.level == 0
        and node.module == OPS_PACKAGE
    ]


def test_operations_package_has_no_init_imports() -> None:
    package_dir = BACKEND / Path(*OPS_PACKAGE.split("."))
    assert package_dir.is_dir() or package_dir.with_suffix(".py").is_file(), (
        f"neither {package_dir} nor its .py exists — the guard lost its target"
    )
    if not package_dir.is_dir():
        return  # still one module: no submodule can import its __init__
    offenders = {
        str(path.relative_to(BACKEND)): lines
        for path in sorted(package_dir.rglob("*.py"))
        if (lines := _imports_package_init(path.read_text(encoding="utf-8")))
    }
    assert not offenders, (
        f"modules under {OPS_PACKAGE} import from the package __init__ "
        f"(D4: import siblings or app.api.coord_proxy instead): {offenders}"
    )
