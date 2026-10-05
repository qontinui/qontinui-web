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

from restructure.ops_split import DOMAINS, DomainSpec, SplitRefused, apply, plan_split

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

            HELPER = "{pkg}._shared_helper"
            TENANT = "{pkg}.get_tenant"
            NESTED = '{pkg}.AlphaItem.model_validate'


            def test_x():
                with patch("{pkg}.list_alpha"):
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


def test_split_keeps_compat_names_and_rewrites_patch_targets(toy):
    root, pkg = toy
    _split(root, pkg, ALPHA)
    module = _import_fresh(root, pkg)
    alpha = importlib.import_module(f"{pkg}.alpha")
    # Re-exported: used by remaining __init__ code (beta), or imported by app/.
    assert module._shared_helper is alpha._shared_helper
    assert module.AlphaItem is alpha.AlphaItem
    # Not re-exported: nothing reaches list_alpha through the package.
    assert not hasattr(module, "list_alpha")

    test_src = (root / "tests" / "test_toy.py").read_text(encoding="utf-8")
    assert f'HELPER = "{pkg}.alpha._shared_helper"' in test_src
    assert f'TENANT = "{pkg}.get_tenant"' in test_src  # not moved: untouched
    assert f"NESTED = '{pkg}.alpha.AlphaItem.model_validate'" in test_src
    assert f'patch("{pkg}.alpha.list_alpha")' in test_src


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
