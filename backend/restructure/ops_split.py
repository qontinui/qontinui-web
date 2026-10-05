#!/usr/bin/env python3
"""Move one domain out of ``operations/__init__.py`` into ``operations/<domain>.py``.

Usage (from anywhere)::

    python backend/restructure/ops_split.py <domain>
    python backend/restructure/ops_split.py --list

This is the ``Coord-Restructure:`` executable of plan
``2026-10-04-web-operations-py-is-one-router-for-every-coord-domain`` (D7). It is
**stdlib-only** so a replay job can run it without the poetry environment, and it
never runs ``ruff --fix``: its output is meant to be lint- and format-clean as
written.

What one run does, for the statement NAMES listed in :data:`DOMAINS`:

1. Cuts each named top-level statement (function, class or assignment, with its
   decorators and its contiguous leading comment block) out of ``__init__.py``
   and writes them, in their original order, into ``<domain>.py``. That module
   owns ``router = APIRouter()`` with no prefix, so the moved ``@router.``
   decorators register on it.
2. Computes the new module's imports from the moved code's free names. Imports
   are copied from ``__init__``'s own import statements; names defined in an
   already-split sibling module are imported from that sibling; names defined in
   ``app.api.coord_proxy`` are imported from there.
3. **Refuses** (D4) when moved code references a name that is still *defined* in
   ``__init__``: a submodule must never import from the package ``__init__``. It
   also refuses when a name resolves nowhere, or when a listed statement is
   missing. A refusal writes nothing, so the tree stays byte-identical.
4. Adds ``from .<domain> import router as _<domain>_router`` plus a compat
   re-export (D5) for every moved name that remaining ``__init__`` code, a
   production module or a test still reaches through the package, and appends
   ``router.include_router(_<domain>_router)`` to the include list (D2), ordered
   by the domain's first route line.
5. Rewrites string patch targets ``"<package>.<moved>"`` under ``backend/tests``
   to ``"<package>.<domain>.<moved>"``.

Idempotent: a domain whose names already live in ``<domain>.py`` and no longer
in ``__init__`` is a no-op.

Known limit: free-name analysis is static. Names reached only through
``globals()``, ``getattr(module, "...")`` or ``eval`` are invisible to it; the
route-table and OpenAPI byte-identity guards are what prove a real move.
"""

from __future__ import annotations

import argparse
import ast
import builtins
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PACKAGE_MODULE = "app.api.v1.endpoints.operations"
PACKAGE_DIR = BACKEND_DIR / "app" / "api" / "v1" / "endpoints" / "operations"
COORD_PROXY_MODULE = "app.api.coord_proxy"
COORD_PROXY_PATH = BACKEND_DIR / "app" / "api" / "coord_proxy.py"
FIRST_PARTY = frozenset({"app"})

#: The paths this transform reads or writes — the restructure's declared input
#: paths for the replay job (hub-files plan, Phase 3 contract).
INPUT_PATHS = (
    "backend/app/api/v1/endpoints/operations/",
    "backend/app/",
    "backend/tests/",
)


@dataclass(frozen=True)
class DomainSpec:
    """One domain's move.

    ``names`` are the top-level statements moved (any order; file order is
    kept). ``order`` is the domain's first route line at the measured base and
    sorts the include list (D2). ``copy`` names statements duplicated into the
    new module rather than moved (e.g. ``logger``), because ``__init__`` still
    needs them.
    """

    names: tuple[str, ...]
    order: int
    copy: tuple[str, ...] = ()


#: The domain table. Empty on purpose in Phase 1: every domain phase is gated on
#: the sibling plan ``2026-10-04-web-coord-http-client-is-copied-across-
#: operations-and-six-modules`` Phase 2 (D4), so each domain's row is added by
#: the PR that moves it, re-measured at that phase's start.
DOMAINS: dict[str, DomainSpec] = {}


class SplitRefused(Exception):
    """The transform declined; nothing was written."""


@dataclass
class SplitPlan:
    """The computed result of a split: new file contents keyed by path."""

    writes: dict[Path, str] = field(default_factory=dict)
    noop: bool = False
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# Free-name analysis
# --------------------------------------------------------------------------

_BUILTINS = frozenset(dir(builtins)) | {
    "__name__",
    "__file__",
    "__doc__",
    "__package__",
    "__spec__",
    "__loader__",
    "__path__",
    "__builtins__",
}


def _bound_in_body(stmts: list[ast.stmt]) -> set[str]:
    """Names a function body binds locally (not descending into nested scopes)."""
    bound: set[str] = set()
    declared_outer: set[str] = set()
    todo: list[ast.AST] = list(stmts)
    while todo:
        node = todo.pop()
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            bound.add(node.name)
            # Decorators/defaults/bases are evaluated in this scope.
            todo.extend(node.decorator_list)
            if isinstance(node, ast.ClassDef):
                todo.extend(node.bases)
                todo.extend(k.value for k in node.keywords)
            else:
                todo.extend(node.args.defaults)
                todo.extend(d for d in node.args.kw_defaults if d is not None)
            continue
        if isinstance(node, ast.Lambda | ast.comprehension):
            # Lambda/comprehension targets are their own scope.
            if isinstance(node, ast.comprehension):
                todo.append(node.iter)
                todo.extend(node.ifs)
            continue
        if isinstance(node, ast.ListComp | ast.SetComp | ast.GeneratorExp):
            todo.extend(node.generators)
            continue
        if isinstance(node, ast.DictComp):
            todo.extend(node.generators)
            continue
        if isinstance(node, ast.Global | ast.Nonlocal):
            declared_outer.update(node.names)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store | ast.Del):
            bound.add(node.id)
        elif isinstance(node, ast.Import | ast.ImportFrom):
            for alias in node.names:
                bound.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, ast.MatchAs | ast.MatchStar) and node.name:
            bound.add(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            bound.add(node.rest)
        todo.extend(ast.iter_child_nodes(node))
    return bound - declared_outer


def _args_names(args: ast.arguments) -> set[str]:
    every = [*args.posonlyargs, *args.args, *args.kwonlyargs]
    if args.vararg:
        every.append(args.vararg)
    if args.kwarg:
        every.append(args.kwarg)
    return {a.arg for a in every}


class _FreeNames:
    """Collect names loaded at module scope or reaching it from a nested scope."""

    def __init__(self) -> None:
        self.free: set[str] = set()

    def _lookup(self, name: str, scopes: list[set[str]]) -> None:
        if not any(name in s for s in scopes):
            self.free.add(name)

    def _annotation(self, node: ast.expr | None, scopes: list[set[str]]) -> None:
        if node is None:
            return
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            try:
                parsed = ast.parse(node.value, mode="eval")
            except SyntaxError:
                return
            self.visit(parsed.body, scopes)
            return
        self.visit(node, scopes)

    def _function(
        self,
        node: ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda,
        scopes: list[set[str]],
    ) -> None:
        args = node.args
        for default in [*args.defaults, *(d for d in args.kw_defaults if d)]:
            self.visit(default, scopes)
        if not isinstance(node, ast.Lambda):
            for dec in node.decorator_list:
                self.visit(dec, scopes)
            for a in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
                self._annotation(a.annotation, scopes)
            for star in (args.vararg, args.kwarg):
                if star is not None:
                    self._annotation(star.annotation, scopes)
            self._annotation(node.returns, scopes)
            local = _args_names(args) | _bound_in_body(node.body)
            for stmt in node.body:
                self.visit(stmt, [*scopes, local])
        else:
            self.visit(node.body, [*scopes, _args_names(args)])

    def visit(self, node: ast.AST, scopes: list[set[str]]) -> None:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
            self._function(node, scopes)
            return
        if isinstance(node, ast.ClassDef):
            for sub in [*node.decorator_list, *node.bases]:
                self.visit(sub, scopes)
            for kw in node.keywords:
                self.visit(kw.value, scopes)
            # Class-body names are visible to the class body, never to methods.
            class_scope = _bound_in_body(node.body)
            for stmt in node.body:
                if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef):
                    for dec in stmt.decorator_list:
                        self.visit(dec, [*scopes, class_scope])
                    self._function(_strip_decorators(stmt), scopes)
                elif isinstance(stmt, ast.AnnAssign):
                    self._annotation(stmt.annotation, [*scopes, class_scope])
                    if stmt.value is not None:
                        self.visit(stmt.value, [*scopes, class_scope])
                else:
                    self.visit(stmt, [*scopes, class_scope])
            return
        if isinstance(
            node, ast.ListComp | ast.SetComp | ast.GeneratorExp | ast.DictComp
        ):
            targets: set[str] = set()
            for gen in node.generators:
                for n in ast.walk(gen.target):
                    if isinstance(n, ast.Name):
                        targets.add(n.id)
            inner = [*scopes, targets]
            for gen in node.generators:
                self.visit(gen.iter, inner)
                for cond in gen.ifs:
                    self.visit(cond, inner)
            if isinstance(node, ast.DictComp):
                self.visit(node.key, inner)
                self.visit(node.value, inner)
            else:
                self.visit(node.elt, inner)
            return
        if isinstance(node, ast.AnnAssign):
            self._annotation(node.annotation, scopes)
            if node.value is not None:
                self.visit(node.value, scopes)
            self.visit(node.target, scopes)
            return
        if isinstance(node, ast.arg):
            self._annotation(node.annotation, scopes)
            return
        if isinstance(node, ast.Name):
            if isinstance(node.ctx, ast.Load | ast.Del):
                self._lookup(node.id, scopes)
            return
        for child in ast.iter_child_nodes(node):
            self.visit(child, scopes)


def _strip_decorators(
    fn: ast.FunctionDef | ast.AsyncFunctionDef,
) -> ast.FunctionDef | ast.AsyncFunctionDef:
    clone = type(fn)(**{f: getattr(fn, f) for f in fn._fields})
    clone.decorator_list = []
    return clone


def free_names(stmts: list[ast.stmt]) -> set[str]:
    """Names the statements read from module scope (builtins excluded)."""
    collector = _FreeNames()
    for stmt in stmts:
        collector.visit(stmt, [])
    return collector.free - _BUILTINS


# --------------------------------------------------------------------------
# Module structure
# --------------------------------------------------------------------------


def _defined_names(stmt: ast.stmt) -> list[str]:
    """Names a selectable top-level statement defines (def/class/assignment)."""
    if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
        return [stmt.name]
    if isinstance(stmt, ast.Assign):
        out: list[str] = []
        for target in stmt.targets:
            for n in ast.walk(target):
                if isinstance(n, ast.Name):
                    out.append(n.id)
        return out
    if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
        return [stmt.target.id]
    return []


def _read(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as fh:
        return fh.read()


def _lines(text: str) -> list[str]:
    """Split on ``\\n`` only — the line numbering ``ast`` uses (unlike
    ``str.splitlines``, which also breaks on form feeds and U+2028)."""
    parts = text.split("\n")
    out = [p + "\n" for p in parts[:-1]]
    if parts[-1]:
        out.append(parts[-1])
    return out


@dataclass
class _Module:
    path: Path
    text: str
    lines: list[str]
    tree: ast.Module

    newline: str = "\n"

    @classmethod
    def load(cls, path: Path) -> _Module:
        raw = _read(path)
        newline = "\r\n" if "\r\n" in raw.split("\n", 1)[0] + "\n" else "\n"
        text = raw.replace("\r\n", "\n")
        try:
            tree = ast.parse(text, filename=str(path))
        except SyntaxError as exc:
            raise SplitRefused(f"{path}: does not parse ({exc})") from exc
        return cls(path, text, _lines(text), tree, newline)

    def definitions(self) -> dict[str, list[ast.stmt]]:
        defs: dict[str, list[ast.stmt]] = {}
        for stmt in self.tree.body:
            for name in _defined_names(stmt):
                defs.setdefault(name, []).append(stmt)
        return defs

    def import_stmts(self) -> list[ast.Import | ast.ImportFrom]:
        return [s for s in self.tree.body if isinstance(s, ast.Import | ast.ImportFrom)]

    def span(self, stmt: ast.stmt) -> tuple[int, int]:
        """0-based [start, end) line span: decorators plus leading comment block."""
        start = min(
            [stmt.lineno, *(d.lineno for d in getattr(stmt, "decorator_list", []))]
        )
        start -= 1
        while start > 0 and self.lines[start - 1].lstrip().startswith("#"):
            start -= 1
        end = stmt.end_lineno
        assert end is not None
        return start, end


# --------------------------------------------------------------------------
# Import rendering (ruff isort, profile defaults: order-by-type, sections)
# --------------------------------------------------------------------------

_SECTIONS = ("future", "stdlib", "thirdparty", "firstparty", "local")


@dataclass(frozen=True)
class _Imp:
    module: str  # "" for "from . import x"
    level: int
    name: str | None  # None => "import module"
    asname: str | None = None

    @property
    def binds(self) -> str:
        if self.name is None:
            return self.asname or self.module.split(".")[0]
        return self.asname or self.name


def _section(imp: _Imp, first_party: frozenset[str]) -> str:
    if imp.level:
        return "local"
    top = imp.module.split(".")[0]
    if top == "__future__":
        return "future"
    if top in sys.stdlib_module_names:
        return "stdlib"
    if top in first_party:
        return "firstparty"
    return "thirdparty"


def _member_key(name: str) -> tuple[int, str, str]:
    if len(name) > 1 and name.isupper():
        rank = 0
    elif name[:1].isupper():
        rank = 1
    else:
        rank = 2
    return rank, name.lower(), name


def _alias(name: str, asname: str | None) -> str:
    return f"{name} as {asname}" if asname else name


def render_imports(imps: set[_Imp], first_party: frozenset[str]) -> str:
    """Render an isort-ordered import block (no trailing blank line)."""
    blocks: list[str] = []
    for section in _SECTIONS:
        group = [i for i in imps if _section(i, first_party) == section]
        if not group:
            continue
        lines: list[str] = []
        plain = sorted(
            (i for i in group if i.name is None),
            key=lambda i: (i.module.lower(), i.module),
        )
        for i in plain:
            lines.append(f"import {_alias(i.module, i.asname)}")
        froms: dict[tuple[int, str], list[_Imp]] = {}
        for i in group:
            if i.name is not None:
                froms.setdefault((i.level, i.module), []).append(i)
        for level, module in sorted(froms, key=lambda k: (k[1].lower(), k[1], -k[0])):
            src = "." * level + module
            members = froms[(level, module)]
            combined = sorted(
                (m for m in members if not m.asname),
                key=lambda m: _member_key(m.name or ""),
            )
            aliased = sorted(
                (m for m in members if m.asname),
                key=lambda m: _member_key(m.name or ""),
            )
            stmts: list[tuple[tuple[int, str, str], str]] = []
            if combined:
                names = [m.name or "" for m in combined]
                one = f"from {src} import {', '.join(names)}"
                if len(one) > 88:
                    body = "".join(f"    {n},\n" for n in names)
                    one = f"from {src} import (\n{body})"
                stmts.append((_member_key(names[0]), one))
            for m in aliased:
                one = f"from {src} import {_alias(m.name or '', m.asname)}"
                if len(one) > 88:
                    one = (
                        f"from {src} import (\n    {_alias(m.name or '', m.asname)},\n)"
                    )
                stmts.append((_member_key(m.name or ""), one))
            lines.extend(s for _, s in sorted(stmts))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _imps_of(stmt: ast.Import | ast.ImportFrom) -> list[_Imp]:
    if isinstance(stmt, ast.Import):
        return [_Imp(a.name, 0, None, a.asname) for a in stmt.names]
    return [_Imp(stmt.module or "", stmt.level, a.name, a.asname) for a in stmt.names]


# --------------------------------------------------------------------------
# Package-reference scan (which moved names need a compat re-export)
# --------------------------------------------------------------------------


def _names_reached_through_package(files: list[Path], package_module: str) -> set[str]:
    """Names other modules take from the package by import or attribute."""
    parent, _, leaf = package_module.rpartition(".")
    reached: set[str] = set()
    for path in files:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        aliases: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 0:
                if node.module == package_module:
                    reached.update(a.name for a in node.names)
                elif node.module == parent:
                    aliases.update(
                        a.asname or a.name for a in node.names if a.name == leaf
                    )
            elif isinstance(node, ast.Import):
                for a in node.names:
                    if a.name == package_module and a.asname:
                        aliases.add(a.asname)
        if not aliases:
            continue
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id in aliases
            ):
                reached.add(node.attr)
            elif (
                isinstance(node, ast.Call)
                and len(node.args) >= 2
                and isinstance(node.args[0], ast.Name)
                and node.args[0].id in aliases
                and isinstance(node.args[1], ast.Constant)
                and isinstance(node.args[1].value, str)
            ):
                # patch.object(ops, "name"), monkeypatch.setattr(ops, "name", ...)
                reached.add(node.args[1].value)
    return reached


def _string_targets(files: list[Path], package_module: str) -> set[str]:
    """First attribute after ``<package>.`` in any string literal (patch targets)."""
    pattern = re.compile(r"[\"']" + re.escape(package_module) + r"\.(\w+)")
    found: set[str] = set()
    for path in files:
        try:
            found.update(pattern.findall(path.read_text(encoding="utf-8")))
        except UnicodeDecodeError:
            continue
    return found


# --------------------------------------------------------------------------
# The split
# --------------------------------------------------------------------------

_INCLUDE_HEADER = (
    "# ops_split include list (D2): one domain router per line, ordered by the\n"
    "# domain's first route line. Managed by backend/restructure/ops_split.py.\n"
)
_INCLUDE_RE = re.compile(
    r"^router\.include_router\((\w+)\)  # ops_split order=(\d+)\n?$"
)
_DOMAIN_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def _module_docstring(domain: str) -> str:
    return (
        f'"""Operations routes for the ``{domain}`` domain.\n\n'
        "Moved verbatim out of ``operations/__init__.py`` by\n"
        "``backend/restructure/ops_split.py`` (plan\n"
        "2026-10-04-web-operations-py-is-one-router-for-every-coord-domain). Routes\n"
        "register on this module's own ``router``; the package ``__init__``\n"
        "includes it (D2). This module never imports from the package ``__init__``\n"
        '(D4)."""\n'
    )


def _join_blocks(chunks: list[str]) -> str:
    return "\n\n\n".join(c.rstrip("\n") for c in chunks) + "\n"


def plan_split(
    domain: str,
    spec: DomainSpec,
    *,
    package_dir: Path,
    package_module: str,
    tests_dir: Path | None = None,
    scan_dirs: tuple[Path, ...] = (),
    coord_proxy_path: Path | None = None,
    coord_proxy_module: str = COORD_PROXY_MODULE,
    first_party: frozenset[str] = FIRST_PARTY,
) -> SplitPlan:
    """Compute the split without writing anything. Raises :class:`SplitRefused`."""
    if not _DOMAIN_RE.match(domain) or domain.startswith("_"):
        raise SplitRefused(f"domain {domain!r} is not a valid module name")
    init_path = package_dir / "__init__.py"
    target_path = package_dir / f"{domain}.py"
    if not init_path.is_file():
        raise SplitRefused(f"{init_path} does not exist")
    init = _Module.load(init_path)
    init_defs = init.definitions()

    # --- idempotency -----------------------------------------------------
    if target_path.exists():
        target_defs = _Module.load(target_path).definitions()
        in_init = [n for n in spec.names if n in init_defs]
        in_target = [n for n in spec.names if n in target_defs]
        if not in_init and len(in_target) == len(spec.names):
            return SplitPlan(noop=True, notes=[f"{domain}: already split; no-op"])
        raise SplitRefused(
            f"{target_path.name} exists but the domain is only partly split "
            f"(still in __init__: {in_init}; missing from {target_path.name}: "
            f"{[n for n in spec.names if n not in target_defs]})"
        )

    # --- select statements -----------------------------------------------
    def select(names: tuple[str, ...], what: str) -> list[ast.stmt]:
        missing = [n for n in names if n not in init_defs]
        if missing:
            raise SplitRefused(
                f"{what} statement(s) not found in __init__.py: {missing}"
            )
        chosen: list[ast.stmt] = []
        for n in names:
            stmts = init_defs[n]
            if len(stmts) > 1:
                raise SplitRefused(
                    f"{n!r} is bound by {len(stmts)} top-level statements"
                )
            extra = [x for x in _defined_names(stmts[0]) if x not in names]
            if extra:
                raise SplitRefused(
                    f"the statement defining {n!r} also binds {extra}; list them too"
                )
            if stmts[0] not in chosen:
                chosen.append(stmts[0])
        return sorted(chosen, key=lambda s: s.lineno)

    if not spec.names:
        raise SplitRefused(f"domain {domain!r} lists no statements")
    if set(spec.names) & set(spec.copy):
        raise SplitRefused(
            f"names both moved and copied: {sorted(set(spec.names) & set(spec.copy))}"
        )
    if "router" in spec.names or "router" in spec.copy:
        raise SplitRefused(
            "'router' is the package router; it is never moved or copied"
        )
    moved = select(spec.names, "listed")
    copied = select(spec.copy, "copy")
    moved_names = set(spec.names)
    local_names = moved_names | set(spec.copy) | {"router"}

    # --- resolve free names ------------------------------------------------
    init_imports: dict[str, list[_Imp]] = {}
    for stmt in init.import_stmts():
        for imp in _imps_of(stmt):
            init_imports.setdefault(imp.binds, []).append(imp)

    siblings: dict[str, str] = {}
    for sib in sorted(package_dir.glob("*.py")):
        if sib.name == "__init__.py" or sib == target_path:
            continue
        for name in _Module.load(sib).definitions():
            if name != "router":
                siblings.setdefault(name, sib.stem)

    proxy_defs: set[str] = set()
    if coord_proxy_path is not None and coord_proxy_path.is_file():
        proxy_defs = set(_Module.load(coord_proxy_path).definitions())

    needed: set[_Imp] = {_Imp("fastapi", 0, "APIRouter")}
    for imp in init_imports.get("APIRouter", []):
        needed = {imp}
    d4: list[str] = []
    nowhere: list[str] = []
    for name in sorted(free_names(moved + copied)):
        if name in local_names:
            continue
        if name in init_imports:
            for imp in init_imports[name]:
                if imp.level and imp.asname == imp.name:
                    imp = _Imp(imp.module, imp.level, imp.name)  # drop redundant alias
                if imp.level == 1 and not imp.module:
                    raise SplitRefused(
                        f"{name!r} is bound by 'from . import'; cannot relocate"
                    )
                needed.add(imp)
        elif name in siblings:
            needed.add(_Imp(siblings[name], 1, name))
        elif name in proxy_defs:
            needed.add(_Imp(coord_proxy_module, 0, name))
        elif name in init_defs:
            d4.append(name)
        else:
            nowhere.append(name)
    if d4:
        raise SplitRefused(
            "moved code references names still defined in __init__.py (D4: a domain "
            f"module never imports from the package __init__): {d4}. Move them with "
            "this domain, into a sibling module, or into app.api.coord_proxy first."
        )
    if nowhere:
        raise SplitRefused(
            f"moved code references names that resolve nowhere: {nowhere}"
        )

    # --- new module ---------------------------------------------------------
    def text_of(stmts: list[ast.stmt]) -> list[str]:
        out = []
        for s in stmts:
            a, b = init.span(s)
            out.append("".join(init.lines[a:b]))
        return out

    # isort wants exactly one blank line between the imports and an assignment.
    header = (
        _module_docstring(domain)
        + "\n"
        + render_imports(needed, first_party)
        + "\n\nrouter = APIRouter()"
    )
    new_module = _join_blocks([header, *text_of(copied), *text_of(moved)])

    # --- remaining __init__ ------------------------------------------------
    remaining_stmts = [s for s in init.tree.body if s not in moved]
    remaining_free = free_names(remaining_stmts)
    reexport = moved_names & remaining_free
    scan_files = [
        p
        for d in scan_dirs
        for p in sorted(d.rglob("*.py"))
        if package_dir not in p.parents
    ]
    reached = _names_reached_through_package(scan_files, package_module)
    reexport |= moved_names & reached

    # Prune an import only when it is PROVABLY dead after the move: the moved
    # code used it, nothing left in __init__ reads it, and nothing outside the
    # package reaches it through the package (import, attribute, patch.object
    # or a string patch target such as "<package>.httpx.AsyncClient").
    protected = remaining_free | reached | _string_targets(scan_files, package_module)
    prunable = (free_names(moved) - moved_names) - protected
    drop: set[int] = set()
    replace: dict[int, str] = {}
    for stmt in init.import_stmts():
        imps = _imps_of(stmt)
        if not any(i.binds in prunable for i in imps) or (
            isinstance(stmt, ast.ImportFrom) and stmt.module == "__future__"
        ):
            continue
        a, b = stmt.lineno - 1, stmt.end_lineno or stmt.lineno
        if any("#" in ln for ln in init.lines[a:b]):
            continue  # a commented import is never rewritten; ruff will flag it
        keep = {i for i in imps if i.binds not in prunable}
        drop.update(range(a, b))
        if keep:
            indent = init.lines[a][: len(init.lines[a]) - len(init.lines[a].lstrip())]
            rendered = render_imports(keep, first_party)
            replace[a] = "".join(indent + ln + "\n" for ln in rendered.split("\n"))
        elif (
            a > 0
            and b < len(init.lines)
            and not init.lines[a - 1].strip()
            and not init.lines[b].strip()
        ):
            drop.add(b)  # the section emptied: do not leave a double blank line

    for s in moved:
        a, b = init.span(s)
        drop.update(range(a, b))
        while b < len(init.lines) and not init.lines[b].strip():
            drop.add(b)
            b += 1
    kept_lines = [
        replace.get(i, "") if i in drop else ln for i, ln in enumerate(init.lines)
    ]

    new_init = "".join(kept_lines)
    new_init = _rewrite_local_imports(
        new_init,
        add={_Imp(domain, 1, "router", f"_{domain}_router")}
        | {_Imp(domain, 1, n, n) for n in reexport},
        first_party=first_party,
    )
    new_init = _rewrite_include_list(new_init, f"_{domain}_router", spec.order)

    plan = SplitPlan()
    for path, text in ((target_path, new_module), (init_path, new_init)):
        try:
            ast.parse(text)
        except SyntaxError as exc:  # pragma: no cover - a transform bug
            raise SplitRefused(f"generated {path.name} does not parse: {exc}") from exc
    if init.newline != "\n":  # keep the source's line endings
        new_module = new_module.replace("\n", init.newline)
        new_init = new_init.replace("\n", init.newline)
    plan.writes[target_path] = new_module
    plan.writes[init_path] = new_init

    # --- test patch targets --------------------------------------------------
    if tests_dir is not None and tests_dir.is_dir():
        pattern = re.compile(
            r"(?<=[\"'])"
            + re.escape(package_module)
            + r"\.("
            + "|".join(re.escape(n) for n in sorted(moved_names))
            + r")(?=[\"'.])"
        )
        copied_pattern = (
            re.compile(
                r"[\"']"
                + re.escape(package_module)
                + r"\.("
                + "|".join(map(re.escape, spec.copy))
                + r")[\"'.]"
            )
            if spec.copy
            else None
        )
        for path in sorted(tests_dir.rglob("*.py")):
            with path.open(encoding="utf-8", newline="") as fh:
                src = fh.read()
            new = pattern.sub(lambda m: f"{package_module}.{domain}.{m.group(1)}", src)
            if new != src:
                plan.writes[path] = new
            if copied_pattern and copied_pattern.search(src):
                plan.notes.append(
                    f"{path.name} patches a copied name on the package; it no longer "
                    f"reaches {domain}.py's copy (use tests/_ops_patch.patch_ops)"
                )
    return plan


def _rewrite_local_imports(
    text: str, *, add: set[_Imp], first_party: frozenset[str]
) -> str:
    """Merge ``add`` into the relative-import tail of the leading import block."""
    tree = ast.parse(text)
    lines = text.splitlines(keepends=True)
    body = list(tree.body)
    idx = 0
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        idx = 1
    block: list[ast.Import | ast.ImportFrom] = []
    while idx < len(body) and isinstance(body[idx], ast.Import | ast.ImportFrom):
        block.append(body[idx])  # type: ignore[arg-type]
        idx += 1
    if not block:
        raise SplitRefused("__init__.py has no leading import block to extend")
    existing_local = [s for s in block if isinstance(s, ast.ImportFrom) and s.level]
    imps = set(add)
    for s in existing_local:
        imps.update(_imps_of(s))
    rendered = render_imports(imps, first_party) + "\n"
    if existing_local:
        start = existing_local[0].lineno - 1
        end = existing_local[-1].end_lineno or start
        if any(
            not isinstance(s, ast.ImportFrom) or not s.level
            for s in block[block.index(existing_local[0]) :]
        ):
            raise SplitRefused(
                "relative imports in __init__.py are not the tail of its import block"
            )
        return "".join(lines[:start]) + rendered + "".join(lines[end:])
    end = block[-1].end_lineno or 0
    return "".join(lines[:end]) + "\n" + rendered + "".join(lines[end:])


def _rewrite_include_list(text: str, router_alias: str, order: int) -> str:
    """Rebuild the include list at end of file with ``router_alias`` added."""
    entries: dict[str, int] = {router_alias: order}
    kept: list[str] = []
    for line in text.splitlines(keepends=True):
        m = _INCLUDE_RE.match(line)
        if m:
            entries[m.group(1)] = int(m.group(2))
            continue
        kept.append(line)
    body = "".join(kept).replace(_INCLUDE_HEADER, "").rstrip("\n") + "\n"
    includes = "".join(
        f"router.include_router({alias})  # ops_split order={n}\n"
        for alias, n in sorted(entries.items(), key=lambda kv: (kv[1], kv[0]))
    )
    return body + "\n\n" + _INCLUDE_HEADER + includes


def apply(plan: SplitPlan) -> None:
    for path, text in plan.writes.items():
        with path.open("w", encoding="utf-8", newline="") as fh:
            fh.write(text)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0] if __doc__ else None
    )
    parser.add_argument("domain", nargs="?")
    parser.add_argument("--list", action="store_true", help="list the known domains")
    args = parser.parse_args(argv)
    if args.list or not args.domain:
        for name, row in sorted(DOMAINS.items(), key=lambda kv: kv[1].order):
            print(f"{name}\torder={row.order}\t{len(row.names)} statements")
        return 0 if args.list else 1
    spec = DOMAINS.get(args.domain)
    if spec is None:
        print(
            f"ops_split: refused: unknown domain {args.domain!r} (known: {sorted(DOMAINS) or 'none'})",
            file=sys.stderr,
        )
        return 2
    try:
        plan = plan_split(
            args.domain,
            spec,
            package_dir=PACKAGE_DIR,
            package_module=PACKAGE_MODULE,
            tests_dir=BACKEND_DIR / "tests",
            scan_dirs=(BACKEND_DIR / "app", BACKEND_DIR / "tests"),
            coord_proxy_path=COORD_PROXY_PATH,
        )
    except SplitRefused as exc:
        print(f"ops_split: refused (tree unchanged): {exc}", file=sys.stderr)
        return 2
    apply(plan)
    for note in plan.notes:
        print(f"ops_split: {note}")
    for path in plan.writes:
        print(f"ops_split: wrote {path.relative_to(BACKEND_DIR.parent).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
