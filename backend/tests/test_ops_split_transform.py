"""Fixture tests for ``restructure/ops_split.py`` (plan 2026-10-04-web-operations-py-…, D7).

A toy three-domain package (``alpha``, ``beta``, ``gamma``) on ONE shared router
is built in ``tmp_path``. ``alpha`` owns a helper ``beta`` also uses (D1) and a
literal-before-param route pair. The split moves ``alpha`` and the tests prove
the properties the real domain phases rely on: the route table is unchanged, a
re-run is a byte-identical no-op, every refusal leaves the tree byte-identical,
and the moved module never imports from the package ``__init__`` (D4).
"""

from __future__ import annotations

import ast
import importlib
import os
import subprocess
import sys
import textwrap
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from restructure import ops_split
from restructure.ops_split import (
    DOMAINS,
    DomainSpec,
    SplitRefused,
    apply,
    first_route_line,
    free_names,
    measure_order,
    plan_split,
)

BACKEND_DIR = Path(__file__).resolve().parent.parent

TOY_INIT = '''\
"""Toy operations package: three domains on one shared router."""

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

router = APIRouter()

_LIMIT = 10


def get_tenant() -> str:
    return "tenant-1"


# ---- alpha ---------------------------------------------------------------


# Shared by alpha and beta; alpha owns it (D1).
def _shared_helper(value: str) -> dict[str, Any]:
    return {"value": value, "encoded": json.dumps(value)}


class AlphaItem(BaseModel):
    name: str


@router.get("/alpha/list")
async def list_alpha() -> list[str]:
    return [item.upper() for item in ("a", "b")]


# The literal route above must stay registered before this parameter route.
@router.get("/alpha/{name}", response_model=AlphaItem)
async def get_alpha(name: str) -> AlphaItem:
    if not name:
        raise HTTPException(status_code=404)
    return AlphaItem(name=_shared_helper(name)["value"])


@router.post("/alpha")
async def post_alpha(item: AlphaItem) -> dict[str, Any]:
    return _shared_helper(item.name)


# ---- beta ----------------------------------------------------------------


@router.get("/beta/{key}")
async def get_beta(key: str, tenant: str = Depends(get_tenant)) -> dict[str, Any]:
    return _shared_helper(key) | {"tenant": tenant}


# ---- gamma ---------------------------------------------------------------


@router.get("/gamma/count")
async def gamma_count() -> dict[str, int]:
    return {"limit": _LIMIT}


@router.delete("/gamma/{item_id}")
async def gamma_delete(item_id: int) -> dict[str, int]:
    return {"deleted": item_id}
'''

ALPHA = DomainSpec(
    names=("_shared_helper", "AlphaItem", "list_alpha", "get_alpha", "post_alpha"),
    order=20,
)


@pytest.fixture
def toy(tmp_path: Path) -> Iterator[tuple[Path, str]]:
    """``(root, package_name)`` — root holds the package, ``tests/`` and ``app/``."""
    pkg = f"toyops_{uuid.uuid4().hex[:10]}"
    (tmp_path / pkg).mkdir()
    (tmp_path / pkg / "__init__.py").write_text(TOY_INIT, encoding="utf-8")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_toy.py").write_text(
        textwrap.dedent(
            f"""\
            from unittest.mock import patch

            TENANT = "{pkg}.get_tenant"


            def test_x():
                with patch("{pkg}.get_tenant"):
                    pass
            """
        ),
        encoding="utf-8",
    )
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "consumer.py").write_text(
        f"from {pkg} import AlphaItem, router\n\n__all__ = ['AlphaItem', 'router']\n",
        encoding="utf-8",
    )
    yield tmp_path, pkg
    for name in [m for m in sys.modules if m == pkg or m.startswith(pkg + ".")]:
        del sys.modules[name]


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file() and "__pycache__" not in p.parts
    }


def _split(root: Path, pkg: str, spec: DomainSpec, domain: str = "alpha") -> None:
    plan = plan_split(
        domain,
        spec,
        package_dir=root / pkg,
        package_module=pkg,
        tests_dir=root / "tests",
        scan_dirs=(root / "app", root / "tests"),
    )
    apply(plan)


def _import_fresh(root: Path, pkg: str) -> ModuleType:
    for name in [m for m in sys.modules if m == pkg or m.startswith(pkg + ".")]:
        del sys.modules[name]
    sys.path.insert(0, str(root))
    try:
        importlib.invalidate_caches()
        return importlib.import_module(pkg)
    finally:
        sys.path.remove(str(root))


def _route_table(module: ModuleType) -> list[tuple[str, str, str]]:
    app = FastAPI()
    app.include_router(module.router, prefix="/ops")
    rows = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if path.startswith("/ops/"):
            methods = ",".join(sorted(getattr(route, "methods", None) or ["WS"]))
            rows.append((methods, path, route.name))
    return rows


def _by_domain(
    rows: list[tuple[str, str, str]],
) -> dict[str, list[tuple[str, str, str]]]:
    out: dict[str, list[tuple[str, str, str]]] = {}
    for row in rows:
        out.setdefault(row[1].split("/")[2], []).append(row)
    return out


def test_split_preserves_the_route_table_and_order_within_each_domain(toy):
    root, pkg = toy
    before = _route_table(_import_fresh(root, pkg))
    assert len(before) == 6

    _split(root, pkg, ALPHA)
    after_module = _import_fresh(root, pkg)
    after = _route_table(after_module)

    assert sorted(after) == sorted(before)
    assert _by_domain(after) == _by_domain(before)
    # The alpha routes really live in the new module now.
    alpha = importlib.import_module(f"{pkg}.alpha")
    assert {r.name for r in alpha.router.routes} == {
        "list_alpha",
        "get_alpha",
        "post_alpha",
    }
    init_src = (root / pkg / "__init__.py").read_text(encoding="utf-8")
    assert "def list_alpha" not in init_src and "class AlphaItem" not in init_src
    # Literal-before-param still wins, and the shared helper works from both sides.
    app = FastAPI()
    app.include_router(after_module.router, prefix="/ops")
    client = TestClient(app)
    assert client.get("/ops/alpha/list").json() == ["A", "B"]
    assert client.get("/ops/alpha/zed").json() == {"name": "zed"}
    assert client.get("/ops/beta/k").json()["tenant"] == "tenant-1"


def test_split_keeps_compat_names_and_rewrites_no_test(toy):
    root, pkg = toy
    tests_before = (root / "tests" / "test_toy.py").read_bytes()
    _split(root, pkg, ALPHA)
    module = _import_fresh(root, pkg)
    alpha = importlib.import_module(f"{pkg}.alpha")
    # Re-exported: used by remaining __init__ code (beta), or imported by app/.
    assert module._shared_helper is alpha._shared_helper
    assert module.AlphaItem is alpha.AlphaItem
    # Not re-exported: nothing reaches list_alpha through the package.
    assert not hasattr(module, "list_alpha")

    # D7 step 4 is superseded: no test file is ever rewritten.
    assert (root / "tests" / "test_toy.py").read_bytes() == tests_before


def test_only_provably_dead_imports_are_pruned_from_init(toy):
    root, pkg = toy
    # A string patch target reaching ``json`` through the package keeps it alive,
    # exactly like the real ``operations.httpx.AsyncClient`` patches.
    (root / "tests" / "test_json_seam.py").write_text(
        f'TARGET = "{pkg}.json.dumps"\n', encoding="utf-8"
    )
    _split(root, pkg, ALPHA)
    init_src = (root / pkg / "__init__.py").read_text(encoding="utf-8")
    assert "import json\n" in init_src  # reached through the package: kept
    assert "HTTPException" not in init_src  # only alpha used it: pruned
    assert "from pydantic import BaseModel" not in init_src
    assert "from fastapi import APIRouter, Depends\n" in init_src
    assert "from typing import Any\n" in init_src  # beta still uses it


def test_rerun_is_a_byte_identical_noop(toy):
    root, pkg = toy
    _split(root, pkg, ALPHA)
    once = _snapshot(root)
    plan = plan_split(
        "alpha",
        ALPHA,
        package_dir=root / pkg,
        package_module=pkg,
        tests_dir=root / "tests",
        scan_dirs=(root / "app", root / "tests"),
    )
    assert plan.noop and not plan.writes
    apply(plan)
    assert _snapshot(root) == once


def test_unknown_statement_name_is_refused_byte_identical(toy):
    root, pkg = toy
    before = _snapshot(root)
    spec = DomainSpec(names=(*ALPHA.names, "no_such_route"), order=20)
    with pytest.raises(SplitRefused, match="no_such_route"):
        _split(root, pkg, spec)
    assert _snapshot(root) == before


def test_reference_that_resolves_nowhere_is_refused_byte_identical(toy):
    root, pkg = toy
    init = root / pkg / "__init__.py"
    init.write_text(
        TOY_INIT.replace(
            'return [item.upper() for item in ("a", "b")]', "return undefined_thing()"
        ),
        encoding="utf-8",
    )
    before = _snapshot(root)
    with pytest.raises(SplitRefused, match="undefined_thing"):
        _split(root, pkg, ALPHA)
    assert _snapshot(root) == before


def test_reference_to_a_name_still_defined_in_init_is_refused_d4(toy):
    root, pkg = toy
    before = _snapshot(root)
    # beta's route depends on get_tenant, which stays in __init__.
    with pytest.raises(SplitRefused, match=r"D4.*get_tenant"):
        _split(root, pkg, DomainSpec(names=("get_beta",), order=50), domain="beta")
    assert _snapshot(root) == before


def test_moved_module_never_imports_from_the_package_init(toy):
    root, pkg = toy
    _split(root, pkg, ALPHA)
    tree = ast.parse((root / pkg / "alpha.py").read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert not (node.level == 1 and not node.module), "from . import …"
            assert node.module != pkg
        elif isinstance(node, ast.Import):
            assert all(a.name != pkg for a in node.names)


def test_second_domain_imports_the_owner_helper_from_its_sibling(toy):
    root, pkg = toy
    before = _route_table(_import_fresh(root, pkg))
    _split(root, pkg, ALPHA)
    _split(
        root,
        pkg,
        DomainSpec(names=("gamma_count", "gamma_delete", "_LIMIT"), order=60),
        "gamma",
    )
    init_src = (root / pkg / "__init__.py").read_text(encoding="utf-8")
    # Include list ordered by first route line (alpha=20 before gamma=60).
    assert init_src.index("_alpha_router)") < init_src.index("_gamma_router)")
    after = _route_table(_import_fresh(root, pkg))
    assert _by_domain(after) == _by_domain(before)


def test_output_is_ruff_clean(toy):
    root, pkg = toy
    try:
        import ruff  # noqa: F401
    except ImportError:
        pytest.skip("ruff is not installed in this environment")
    _split(root, pkg, ALPHA)
    config = str(BACKEND_DIR / "pyproject.toml")
    files = [str(root / pkg / "__init__.py"), str(root / pkg / "alpha.py")]
    check = subprocess.run(
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            "--config",
            config,
            "--no-cache",
            *files,
        ],
        capture_output=True,
        text=True,
    )
    assert check.returncode == 0, check.stdout + check.stderr
    fmt = subprocess.run(
        [
            sys.executable,
            "-m",
            "ruff",
            "format",
            "--check",
            "--diff",
            "--config",
            config,
            "--no-cache",
            *files,
        ],
        capture_output=True,
        text=True,
    )
    assert fmt.returncode == 0, fmt.stdout + fmt.stderr


def test_the_real_domain_table_is_well_formed():
    # Phase 1 ships the mechanism; each gated domain phase adds its row.
    orders = [spec.order for spec in DOMAINS.values()]
    assert len(orders) == len(set(orders))
    for name, spec in DOMAINS.items():
        assert name.isidentifier() and spec.names


# ---------------------------------------------------------------------------
# Review findings (one block per finding; each test fails without its fix)
# ---------------------------------------------------------------------------


def _write_init(root: Path, pkg: str, text: str) -> None:
    (root / pkg / "__init__.py").write_text(text, encoding="utf-8")


_COUNTER_ROUTE = """
_counter = 0


@router.post("/alpha/bump")
async def bump_alpha() -> dict[str, int]:
    global _counter
    _counter += 1
    return {"n": _counter}


"""


# 1. ``global`` -------------------------------------------------------------


def test_global_rebind_of_a_name_init_still_reads_is_refused(toy):
    root, pkg = toy
    _write_init(
        root,
        pkg,
        TOY_INIT.replace("# ---- beta", _COUNTER_ROUTE.lstrip("\n") + "# ---- beta")
        + '\n\n@router.get("/gamma/counter")\nasync def gamma_counter() -> int:\n'
        "    return _counter\n",
    )
    before = _snapshot(root)
    spec = DomainSpec(names=(*ALPHA.names, "_counter", "bump_alpha"), order=20)
    with pytest.raises(SplitRefused, match=r"_counter.*global"):
        _split(root, pkg, spec)
    assert _snapshot(root) == before


def test_global_declared_name_counts_as_referenced_d4(toy):
    root, pkg = toy
    # The moved route only WRITES _counter; the binding stays in __init__.
    write_only = _COUNTER_ROUTE.replace("    _counter += 1\n", "    _counter = 1\n")
    write_only = write_only.replace('{"n": _counter}', '{"n": 1}')
    _write_init(
        root,
        pkg,
        TOY_INIT.replace("# ---- beta", write_only.lstrip("\n") + "# ---- beta"),
    )
    before = _snapshot(root)
    spec = DomainSpec(names=(*ALPHA.names, "bump_alpha"), order=20)
    with pytest.raises(SplitRefused, match=r"D4.*_counter"):
        _split(root, pkg, spec)
    assert _snapshot(root) == before


# 2. scope ------------------------------------------------------------------

_SCOPE_CASES = [
    # A nested class body does not see the enclosing class namespace.
    ("class A:\n    json = 1\n    class B:\n        v = json\n", "json", None),
    # Nor does a method body, a lambda, or a comprehension element.
    ("class A:\n    json = 1\n    def m(self):\n        return json\n", "json", None),
    ("class A:\n    json = 1\n    f = lambda: json\n", "json", None),
    ("class A:\n    json = 1\n    xs = [json for _ in range(2)]\n", "json", None),
    # Only the FIRST iterable evaluates in the class scope.
    (
        "class A:\n    json = 1\n    xs = [i for i in range(2) for j in json]\n",
        "json",
        None,
    ),
    ("class A:\n    json = 1\n    xs = [i for i in json]\n", None, "json"),
    # Defaults and decorators evaluate in the class body: class names bind,
    # module names stay free.
    ("class A:\n    LIM = 1\n    def m(self, x=LIM, y=TOP): ...\n", "TOP", "LIM"),
    (
        "class A:\n    def deco(f): return f\n    @deco\n    @module_deco\n"
        "    def m(self): ...\n",
        "module_deco",
        "deco",
    ),
    # Enclosing FUNCTION scopes stay visible through a class body.
    (
        "def f():\n    k = 1\n    class C:\n        def m(self):\n            return k\n",
        None,
        "k",
    ),
]


@pytest.mark.parametrize(("src", "free", "bound"), _SCOPE_CASES)
def test_free_names_follow_python_class_scoping(src, free, bound):
    names = free_names(ast.parse(src).body)
    if free is not None:
        assert free in names
    if bound is not None:
        assert bound not in names


def test_nested_class_body_reference_gets_its_module_import(toy):
    root, pkg = toy
    _write_init(
        root,
        pkg,
        TOY_INIT.replace(
            "class AlphaItem(BaseModel):\n    name: str\n",
            "class AlphaItem(BaseModel):\n    name: str\n\n"
            "    class Meta:\n        json = 1\n\n"
            "        class Inner:\n            encoded = json.dumps(1)\n",
        ),
    )
    _split(root, pkg, ALPHA)
    assert "import json\n" in (root / pkg / "alpha.py").read_text(encoding="utf-8")
    _import_fresh(root, pkg)  # alpha.py imports cleanly: json resolves


# 3. DomainSpec.copy ----------------------------------------------------------


def test_copy_of_anything_but_a_logger_factory_is_refused(toy):
    root, pkg = toy
    before = _snapshot(root)
    spec = DomainSpec(names=ALPHA.names, order=20, copy=("_LIMIT",))
    with pytest.raises(SplitRefused, match="_LIMIT"):
        _split(root, pkg, spec)
    assert _snapshot(root) == before


def test_copy_of_the_module_logger_is_allowed(toy):
    root, pkg = toy
    text = TOY_INIT.replace("import json\n", "import json\n\nimport structlog\n")
    text = text.replace(
        "_LIMIT = 10\n", "_LIMIT = 10\nlogger = structlog.get_logger(__name__)\n"
    )
    text = text.replace(
        "    return _shared_helper(item.name)\n",
        '    logger.info("alpha")\n    return _shared_helper(item.name)\n',
    )
    text = text.replace(
        '    return {"limit": _LIMIT}\n',
        '    logger.info("gamma")\n    return {"limit": _LIMIT}\n',
    )
    _write_init(root, pkg, text)
    _split(root, pkg, DomainSpec(names=ALPHA.names, order=20, copy=("logger",)))
    factory = "logger = structlog.get_logger(__name__)"
    assert factory in (root / pkg / "alpha.py").read_text(encoding="utf-8")
    assert factory in (root / pkg / "__init__.py").read_text(encoding="utf-8")


def test_name_defined_in_init_and_a_sibling_is_never_resolved_to_the_sibling(toy):
    root, pkg = toy
    (root / pkg / "zeta.py").write_text(
        'def get_tenant() -> str:\n    return "other"\n', encoding="utf-8"
    )
    before = _snapshot(root)
    with pytest.raises(SplitRefused, match=r"D4.*get_tenant"):
        _split(root, pkg, DomainSpec(names=("get_beta",), order=50), domain="beta")
    assert _snapshot(root) == before


# 4. atomic apply ---------------------------------------------------------------


def test_apply_failure_on_second_replace_leaves_tree_byte_identical(toy, monkeypatch):
    root, pkg = toy
    before = _snapshot(root)
    plan = plan_split(
        "alpha",
        ALPHA,
        package_dir=root / pkg,
        package_module=pkg,
        tests_dir=root / "tests",
        scan_dirs=(root / "app", root / "tests"),
    )
    assert len(plan.writes) >= 2
    real_replace = os.replace
    calls = {"n": 0}

    def flaky_replace(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("simulated replace failure")
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", flaky_replace)
    with pytest.raises(OSError, match="simulated"):
        apply(plan)
    assert calls["n"] == 2
    assert _snapshot(root) == before  # also: no staged temp file left behind


# 5. coord_proxy cycle ----------------------------------------------------------


def _proxy_split(root: Path, pkg: str, proxy_src: str) -> None:
    proxy = root / f"{pkg}_proxy.py"
    proxy.write_text(proxy_src, encoding="utf-8")
    plan = plan_split(
        "alpha",
        ALPHA,
        package_dir=root / pkg,
        package_module=pkg,
        tests_dir=root / "tests",
        scan_dirs=(root / "app", root / "tests"),
        coord_proxy_path=proxy,
        coord_proxy_module=f"{pkg}_proxy",
    )
    apply(plan)


def _use_proxy_thing(root: Path, pkg: str) -> None:
    _write_init(
        root,
        pkg,
        TOY_INIT.replace(
            '    return [item.upper() for item in ("a", "b")]',
            '    return [proxy_thing(item) for item in ("a", "b")]',
        ),
    )


def test_resolving_to_coord_proxy_is_refused_while_it_imports_the_package(toy):
    root, pkg = toy
    _use_proxy_thing(root, pkg)
    proxy_src = f"from {pkg} import get_tenant\n\n\ndef proxy_thing(x):\n    return x\n"
    (root / f"{pkg}_proxy.py").write_text(proxy_src, encoding="utf-8")
    before = _snapshot(root)
    with pytest.raises(SplitRefused, match=r"proxy_thing.*cycle"):
        _proxy_split(root, pkg, proxy_src)
    assert _snapshot(root) == before


def test_resolving_to_coord_proxy_is_allowed_once_the_cycle_is_gone(toy):
    root, pkg = toy
    _use_proxy_thing(root, pkg)
    _proxy_split(root, pkg, "def proxy_thing(x):\n    return x.upper()\n")
    alpha_src = (root / pkg / "alpha.py").read_text(encoding="utf-8")
    assert f"from {pkg}_proxy import proxy_thing" in alpha_src


# 6. D5 scan --------------------------------------------------------------------


def test_bare_import_dotted_access_gets_a_compat_reexport(toy):
    root, pkg = toy
    (root / "app" / "bare.py").write_text(
        f"import {pkg}\n\n\ndef f():\n    return {pkg}.list_alpha\n", encoding="utf-8"
    )
    _split(root, pkg, ALPHA)
    module = _import_fresh(root, pkg)
    assert module.list_alpha is importlib.import_module(f"{pkg}.alpha").list_alpha


def test_relative_import_inside_the_package_gets_a_compat_reexport(toy):
    root, pkg = toy
    (root / pkg / "zeta.py").write_text(
        "from . import post_alpha\n\n__all__ = ['post_alpha']\n", encoding="utf-8"
    )
    _split(root, pkg, ALPHA)
    module = _import_fresh(root, pkg)
    assert module.post_alpha is importlib.import_module(f"{pkg}.alpha").post_alpha
    assert importlib.import_module(f"{pkg}.zeta").post_alpha is module.post_alpha


def test_unparseable_scanned_file_is_refused_naming_it(toy):
    root, pkg = toy
    (root / "app" / "broken.py").write_text("def broken(:\n", encoding="utf-8")
    before = _snapshot(root)
    with pytest.raises(SplitRefused, match=r"broken\.py"):
        _split(root, pkg, ALPHA)
    assert _snapshot(root) == before


# 7. string patch targets: refused, never rewritten -----------------------------


def test_string_patch_target_on_a_moved_name_is_refused_with_file_line(toy):
    root, pkg = toy
    (root / "tests" / "test_stale.py").write_text(
        f'from unittest.mock import patch\n\nT = "{pkg}.httpx.AsyncClient"\n'
        f'P = patch("{pkg}._shared_helper.__call__")\n',
        encoding="utf-8",
    )
    before = _snapshot(root)
    with pytest.raises(SplitRefused, match=r"tests/test_stale\.py:4"):
        _split(root, pkg, ALPHA)
    assert _snapshot(root) == before


# 8. include-list order is pinned at the original file ---------------------------


def test_first_route_line_is_the_first_route_decorator_of_the_named_defs():
    line = TOY_INIT.splitlines().index('@router.get("/alpha/list")') + 1
    assert first_route_line(TOY_INIT, ALPHA.names) == line
    with pytest.raises(SplitRefused):
        first_route_line(TOY_INIT, ("_shared_helper", "AlphaItem"))


def _base_available() -> bool:
    probe = subprocess.run(
        ["git", "cat-file", "-e", f"{ops_split.ORDER_BASE_SHA}^{{commit}}"],
        cwd=BACKEND_DIR,
        capture_output=True,
    )
    return probe.returncode == 0


def test_order_is_measured_at_the_original_single_file():
    if not _base_available():
        pytest.skip(f"{ops_split.ORDER_BASE_SHA} is not in this clone")
    assert measure_order(("report_claude_sessions", "runner_heartbeat")) == 458
    for name, spec in DOMAINS.items():
        assert spec.order == measure_order(spec.names), name


# ---------------------------------------------------------------------------
# Phase 1 review follow-ups (post-merge of qontinui-web#1734). Each test fails
# without its fix, except the CRLF test, which pins existing behaviour.
# ---------------------------------------------------------------------------


# 9. an interrupt between os.replace and its bookkeeping still rolls back -------


def test_apply_interrupt_right_after_a_replace_rolls_that_file_back(toy, monkeypatch):
    root, pkg = toy
    before = _snapshot(root)
    plan = plan_split(
        "alpha",
        ALPHA,
        package_dir=root / pkg,
        package_module=pkg,
        tests_dir=root / "tests",
        scan_dirs=(root / "app", root / "tests"),
    )
    real_replace = os.replace

    def replace_then_interrupt(src, dst):
        real_replace(src, dst)  # the replace lands ...
        raise KeyboardInterrupt  # ... and Ctrl-C arrives before it is recorded

    monkeypatch.setattr(os, "replace", replace_then_interrupt)
    with pytest.raises(KeyboardInterrupt):
        apply(plan)
    assert _snapshot(root) == before


# 10. ``global`` on an IMPORTED name is refused ----------------------------------


_RESET_ROUTE = (
    '@router.post("/alpha/reset")\nasync def reset_alpha() -> None:\n'
    "    global json\n    json = None\n\n\n# ---- beta"
)
_GAMMA_JSON_READER = (
    '\n\n@router.get("/gamma/dump")\nasync def gamma_dump() -> str:\n'
    "    return json.dumps(_LIMIT)\n"
)


def test_global_rebind_of_an_imported_name_init_still_reads_is_refused(toy):
    root, pkg = toy
    # ``json`` is imported into __init__, not defined there. gamma, which stays
    # behind, still reads __init__'s copy; after the move the rebinding would
    # reach alpha.py's copy only.
    _write_init(
        root,
        pkg,
        TOY_INIT.replace("# ---- beta", _RESET_ROUTE) + _GAMMA_JSON_READER,
    )
    before = _snapshot(root)
    spec = DomainSpec(names=(*ALPHA.names, "reset_alpha"), order=20)
    with pytest.raises(SplitRefused, match=r"json.*global.*imported"):
        _split(root, pkg, spec)
    assert _snapshot(root) == before


def test_global_rebind_of_an_imported_name_nothing_else_reads_is_allowed(toy):
    root, pkg = toy
    # Every reader of ``json`` moves with alpha, so alpha.py's own import is the
    # only binding left that anything reads: behaviour is unchanged.
    _write_init(root, pkg, TOY_INIT.replace("# ---- beta", _RESET_ROUTE))
    _split(root, pkg, DomainSpec(names=(*ALPHA.names, "reset_alpha"), order=20))
    assert "global json" in (root / pkg / "alpha.py").read_text(encoding="utf-8")


def test_bare_carriage_return_is_refused_byte_identical(toy):
    root, pkg = toy
    _write_init(root, pkg, TOY_INIT.replace("# ---- beta", "# ---- \rbeta"))
    before = _snapshot(root)
    with pytest.raises(SplitRefused, match="carriage return"):
        _split(root, pkg, ALPHA)
    assert _snapshot(root) == before


# 11. line handling: CRLF sources, and ``\f`` / U+2028 inside a source line -----


def test_crlf_source_splits_to_crlf_output_with_the_route_table_kept(toy):
    root, pkg = toy
    before = _route_table(_import_fresh(root, pkg))
    (root / pkg / "__init__.py").write_bytes(TOY_INIT.replace("\n", "\r\n").encode())
    _split(root, pkg, ALPHA)
    for name in ("__init__.py", "alpha.py"):
        raw = (root / pkg / name).read_bytes()
        assert b"\n" in raw and raw.count(b"\r\n") == raw.count(b"\n"), name
    assert sorted(_route_table(_import_fresh(root, pkg))) == sorted(before)


def test_form_feed_and_line_separator_do_not_shift_the_rewritten_imports(toy):
    root, pkg = toy
    # ``str.splitlines`` breaks on both; ``ast`` line numbers do not. A line
    # count mismatch before the import block misplaces the relative imports
    # and the include list.
    _write_init(
        root,
        pkg,
        TOY_INIT.replace(
            '"""Toy operations package: three domains on one shared router."""',
            '"""Toy operations package.\x0c\n\nThree domains\u2028on one router."""',
        ),
    )
    before = _route_table(_import_fresh(root, pkg))
    _split(root, pkg, ALPHA)
    init_src = (root / pkg / "__init__.py").read_text(encoding="utf-8")
    ast.parse(init_src)
    assert "\x0c" in init_src and "\u2028" in init_src
    # The relative imports are the TAIL of the import block, not spliced into it.
    assert init_src.index("from fastapi import APIRouter, Depends\n") < init_src.index(
        "from .alpha import"
    )
    assert sorted(_route_table(_import_fresh(root, pkg))) == sorted(before)
