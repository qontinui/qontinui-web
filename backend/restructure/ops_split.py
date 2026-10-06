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
2. Computes the new module's imports from the moved code's free names (a name
   declared ``global`` counts as referenced). Imports are copied from
   ``__init__``'s own import statements; names defined in an already-split
   sibling module are imported from that sibling; names defined in
   ``app.api.coord_proxy`` are imported from there — but only once
   ``coord_proxy`` no longer imports from the package (the D4 cycle note).
3. **Refuses** (D4) when moved code references a name that is still *defined* in
   ``__init__`` — even when a sibling also defines it: a submodule must never
   import from the package ``__init__``. It also refuses when a name resolves
   nowhere, when a listed statement is missing, when moved code ``global``-
   rebinds a name ``__init__`` still reads or re-exports (two modules would then
   hold two copies of one piece of state), when a ``copy`` row is anything but a
   logger factory call, when a scanned file does not parse, and when a test
   still names a moved statement in a string patch target. A refusal writes
   nothing, so the tree stays byte-identical.
4. Adds ``from .<domain> import router as _<domain>_router`` plus a compat
   re-export (D5) for every moved name that remaining ``__init__`` code, a
   production module, a package sibling or a test still reaches through the
   package, and appends ``router.include_router(_<domain>_router)`` to the
   include list (D2), ordered by :attr:`DomainSpec.order` — the domain's first
   route line in the ORIGINAL file at :data:`ORDER_BASE_SHA`, pinned per row.
5. Rewrites NO test. D7 step 4 (rewriting ``"<package>.<moved>"`` string patch
   targets to ``"<package>.<domain>.<moved>"``) is superseded: the Phase 0
   guard ``test_operations_patch_targets`` rejects every such string target
   except ``httpx.AsyncClient``, and ``tests/_ops_patch.patch_ops`` already
   patches every module of the package that binds a name, so a test needs no
   edit when its name moves. A test that still carries a string target on a
   moved name is a refusal naming ``file:line``; convert it to ``patch_ops``.

Writes are atomic as a set: :func:`apply` stages every file beside its target,
then ``os.replace``-es each, and restores the original bytes of every file
already replaced if any step fails.

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
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PACKAGE_MODULE = "app.api.v1.endpoints.operations"
PACKAGE_DIR = BACKEND_DIR / "app" / "api" / "v1" / "endpoints" / "operations"
COORD_PROXY_MODULE = "app.api.coord_proxy"
COORD_PROXY_PATH = BACKEND_DIR / "app" / "api" / "coord_proxy.py"
FIRST_PARTY = frozenset({"app"})

#: The base the include-list ``order`` of every :data:`DOMAINS` row is measured
#: at: the last commit holding ``operations.py`` as one file (plan, Problem).
ORDER_BASE_SHA = "eb9429e1f"
ORDER_BASE_PATH = "backend/app/api/v1/endpoints/operations.py"

#: The only call targets a ``DomainSpec.copy`` statement may be built from. A
#: copy duplicates a binding, so anything with state (a cache, a client, a
#: ContextVar) would split into two objects; a per-module logger does not.
COPY_FACTORIES = frozenset({"logging.getLogger", "structlog.get_logger"})

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
    kept). ``order`` sorts the include list (D2). It is a PINNED integer: the
    1-based line of the domain's first ``@router.<verb>`` decorator in the
    ORIGINAL single-file ``operations.py`` at :data:`ORDER_BASE_SHA`, as
    :func:`measure_order` computes it. It is never re-measured against the
    current tree, whose line numbers shift with every domain that moves out.
    ``copy`` names statements duplicated into the new module rather than moved,
    because ``__init__`` still needs them; only ``<name> = <factory>(...)`` with
    a factory in :data:`COPY_FACTORIES` (the module ``logger``) may be copied.
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


@dataclass(frozen=True)
class _Scope:
    """One lexical scope on the lookup chain."""

    names: frozenset[str]
    is_class: bool = False


def _enclosing(scopes: list[_Scope]) -> list[_Scope]:
    """The chain a NESTED scope sees: class scopes are never visible to it.

    A function, lambda, comprehension or nested class body defined inside a
    class body resolves free names in the enclosing *function* scopes and then
    the module, skipping every class namespace on the way.
    """
    return [s for s in scopes if not s.is_class]


class _FreeNames:
    """Collect names loaded at module scope or reaching it from a nested scope.

    A name declared ``global`` anywhere counts as free: the code reads or
    rebinds the MODULE binding, so the move must account for it.
    """

    def __init__(self) -> None:
        self.free: set[str] = set()

    def _lookup(self, name: str, scopes: list[_Scope]) -> None:
        if not any(name in s.names for s in scopes):
            self.free.add(name)

    def _annotation(self, node: ast.expr | None, scopes: list[_Scope]) -> None:
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
        scopes: list[_Scope],
    ) -> None:
        # Defaults, decorators and annotations evaluate in the DEFINING scope
        # (a class body included); only the body is a nested scope.
        args = node.args
        for default in [*args.defaults, *(d for d in args.kw_defaults if d)]:
            self.visit(default, scopes)
        inner = _enclosing(scopes)
        if isinstance(node, ast.Lambda):
            self.visit(node.body, [*inner, _Scope(frozenset(_args_names(args)))])
            return
        for dec in node.decorator_list:
            self.visit(dec, scopes)
        for a in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            self._annotation(a.annotation, scopes)
        for star in (args.vararg, args.kwarg):
            if star is not None:
                self._annotation(star.annotation, scopes)
        self._annotation(node.returns, scopes)
        local = _Scope(frozenset(_args_names(args) | _bound_in_body(node.body)))
        for stmt in node.body:
            self.visit(stmt, [*inner, local])

    def visit(self, node: ast.AST, scopes: list[_Scope]) -> None:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
            self._function(node, scopes)
            return
        if isinstance(node, ast.ClassDef):
            for sub in [*node.decorator_list, *node.bases]:
                self.visit(sub, scopes)
            for kw in node.keywords:
                self.visit(kw.value, scopes)
            # The class namespace is visible to the DIRECT class-body
            # statements only (and, through them, to method decorators,
            # defaults and annotations and a comprehension's first iterable).
            body = [
                *_enclosing(scopes),
                _Scope(frozenset(_bound_in_body(node.body)), is_class=True),
            ]
            for stmt in node.body:
                self.visit(stmt, body)
            return
        if isinstance(
            node, ast.ListComp | ast.SetComp | ast.GeneratorExp | ast.DictComp
        ):
            targets: set[str] = set()
            for gen in node.generators:
                for n in ast.walk(gen.target):
                    if isinstance(n, ast.Name):
                        targets.add(n.id)
            inner = [*_enclosing(scopes), _Scope(frozenset(targets))]
            for i, gen in enumerate(node.generators):
                # Only the FIRST iterable evaluates in the enclosing scope.
                self.visit(gen.iter, scopes if i == 0 else inner)
                for cond in gen.ifs:
                    self.visit(cond, inner)
            if isinstance(node, ast.DictComp):
                self.visit(node.key, inner)
                self.visit(node.value, inner)
            else:
                self.visit(node.elt, inner)
            return
        if isinstance(node, ast.Global):
            self.free.update(node.names)
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


def free_names(stmts: list[ast.stmt]) -> set[str]:
    """Names the statements read from module scope (builtins excluded)."""
    collector = _FreeNames()
    for stmt in stmts:
        collector.visit(stmt, [])
    return collector.free - _BUILTINS


def global_rebinds(stmts: list[ast.stmt]) -> set[str]:
    """Names some function in ``stmts`` declares ``global`` (to rebind them)."""
    return {
        name
        for stmt in stmts
        for node in ast.walk(stmt)
        if isinstance(node, ast.Global)
        for name in node.names
    }


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


_ROUTE_VERBS = frozenset(
    {"get", "post", "put", "patch", "delete", "head", "options", "websocket"}
)


def first_route_line(source: str, names: tuple[str, ...]) -> int:
    """1-based line of the first ``@router.<verb>(...)`` decorating a named def.

    This is how a :class:`DomainSpec` ``order`` is measured: against the
    ORIGINAL file at :data:`ORDER_BASE_SHA` (:func:`measure_order`), never the
    current tree.
    """
    found: list[int] = []
    for stmt in ast.parse(source).body:
        if not isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        if stmt.name not in names:
            continue
        for dec in stmt.decorator_list:
            if (
                isinstance(dec, ast.Call)
                and isinstance(dec.func, ast.Attribute)
                and dec.func.attr in _ROUTE_VERBS
                and _dotted(dec.func.value) == "router"
            ):
                found.append(dec.lineno)
    if not found:
        raise SplitRefused(f"none of {sorted(names)} is a @router route")
    return min(found)


def measure_order(names: tuple[str, ...]) -> int:
    """:func:`first_route_line` of ``names`` in ``operations.py`` at the base."""
    src = subprocess.run(
        ["git", "show", f"{ORDER_BASE_SHA}:{ORDER_BASE_PATH}"],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout
    return first_route_line(src, names)


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


def _parse_scanned(path: Path) -> tuple[str, ast.Module]:
    """Read and parse a scanned file, or refuse naming it.

    Skipping an unparseable file would silently drop the re-exports (D5) and
    patch-target refusals it should have produced.
    """
    try:
        text = _read(path).replace("\r\n", "\n")
        return text, ast.parse(text, filename=str(path))
    except (SyntaxError, UnicodeDecodeError, ValueError) as exc:
        raise SplitRefused(
            f"{path}: cannot be scanned for references to the package ({exc}); "
            "fix the file before splitting"
        ) from exc


def _module_of(path: Path, root: Path) -> tuple[list[str], bool] | None:
    """``(dotted parts, is_package)`` of a file under the import ``root``."""
    try:
        rel = path.relative_to(root)
    except ValueError:
        return None
    parts = list(rel.with_suffix("").parts)
    if parts[-1] == "__init__":
        return parts[:-1], True
    return parts, False


def _import_source(node: ast.ImportFrom, module: tuple[list[str], bool] | None) -> str:
    """The absolute module an ``ImportFrom`` reads (relative ones resolved)."""
    if not node.level:
        return node.module or ""
    if module is None:
        return ""
    parts, is_package = module
    base = parts if is_package else parts[:-1]
    drop = node.level - 1
    if drop > len(base):
        return ""
    base = base[: len(base) - drop]
    return ".".join([*base, *([node.module] if node.module else [])])


def _names_reached_through_package(
    files: list[Path], package_module: str, root: Path
) -> set[str]:
    """Names other modules take from the package by import or attribute.

    Covers ``from <package> import x`` (relative forms resolved against the
    file's own module under ``root``), ``from <parent> import <leaf> [as a]``
    then ``a.x``, ``import <package> as a`` then ``a.x``, a bare
    ``import <package>`` then the dotted ``<package>.x``, and
    ``patch.object(a, "x")`` / ``monkeypatch.setattr(<package>, "x", ...)``.
    """
    parent, _, leaf = package_module.rpartition(".")
    reached: set[str] = set()
    for path in files:
        _, tree = _parse_scanned(path)
        module = _module_of(path, root)
        aliases: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                src = _import_source(node, module)
                if src == package_module:
                    reached.update(a.name for a in node.names if a.name != "*")
                elif src == parent:
                    aliases.update(
                        a.asname or a.name for a in node.names if a.name == leaf
                    )
            elif isinstance(node, ast.Import):
                for a in node.names:
                    if a.name == package_module and a.asname:
                        aliases.add(a.asname)

        def is_package(expr: ast.expr, aliases: set[str] = aliases) -> bool:
            if isinstance(expr, ast.Name) and expr.id in aliases:
                return True
            return _dotted(expr) == package_module

        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and is_package(node.value):
                reached.add(node.attr)
            elif (
                isinstance(node, ast.Call)
                and len(node.args) >= 2
                and is_package(node.args[0])
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
        text, _ = _parse_scanned(path)
        found.update(pattern.findall(text))
    return found


def _string_patch_targets(
    files: list[Path], package_module: str, names: set[str]
) -> list[str]:
    """``file:line`` of every string constant ``"<package>.<name>[.…]"``."""
    pattern = re.compile(re.escape(package_module) + r"\.(\w+)(?:\..*)?", re.DOTALL)
    hits: list[str] = []
    for path in files:
        _, tree = _parse_scanned(path)
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                m = pattern.fullmatch(node.value)
                if m and m.group(1) in names:
                    hits.append(f"{path.as_posix()}:{node.lineno}")
    return sorted(set(hits))


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


def _check_copyable(stmt: ast.stmt, init: _Module) -> None:
    """Refuse a ``copy`` statement that is not ``<name> = <logger factory>(...)``.

    The factory is resolved through ``__init__``'s own imports, so
    ``structlog.get_logger`` and ``from structlog import get_logger`` both
    qualify, and a local function merely named ``get_logger`` does not.
    """
    what = ast.get_source_segment(init.text, stmt) or type(stmt).__name__
    if not (
        isinstance(stmt, ast.Assign)
        and len(stmt.targets) == 1
        and isinstance(stmt.targets[0], ast.Name)
        and isinstance(stmt.value, ast.Call)
    ):
        raise SplitRefused(
            f"copy statement {what!r} is not '<name> = <factory>(...)'; only a "
            f"logger built by one of {sorted(COPY_FACTORIES)} may be copied"
        )
    dotted = _dotted(stmt.value.func) or ""
    head, _, rest = dotted.partition(".")
    qualified: str | None = None
    for imp_stmt in init.import_stmts():
        for imp in _imps_of(imp_stmt):
            if imp.binds != head or imp.level:
                continue
            if imp.name is not None:
                base = f"{imp.module}.{imp.name}"
            elif imp.asname:
                base = imp.module
            else:
                base = head  # ``import a.b`` binds ``a``
            qualified = f"{base}.{rest}" if rest else base
    if qualified not in COPY_FACTORIES:
        raise SplitRefused(
            f"copy statement {what!r} calls {qualified or dotted!r}, not one of "
            f"{sorted(COPY_FACTORIES)}; a copy duplicates state, so only a "
            "logger may be copied"
        )


def _imports_package(tree: ast.Module, package_module: str) -> bool:
    """Whether a module imports from ``package_module`` (or a submodule of it)."""
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and not node.level and node.module:
            mods = [node.module, *(f"{node.module}.{a.name}" for a in node.names)]
        elif isinstance(node, ast.Import):
            mods = [a.name for a in node.names]
        else:
            continue
        prefix = package_module + "."
        if any(m == package_module or m.startswith(prefix) for m in mods):
            return True
    return False


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
    for stmt in copied:
        _check_copyable(stmt, init)
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
    proxy_cycle = False
    if coord_proxy_path is not None and coord_proxy_path.is_file():
        proxy = _Module.load(coord_proxy_path)
        proxy_defs = set(proxy.definitions())
        proxy_cycle = _imports_package(proxy.tree, package_module)

    needed: set[_Imp] = {_Imp("fastapi", 0, "APIRouter")}
    for imp in init_imports.get("APIRouter", []):
        needed = {imp}
    d4: list[str] = []
    nowhere: list[str] = []
    cycle: list[str] = []
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
        elif name in init_defs:
            # Checked BEFORE the siblings: a name __init__ still defines is the
            # binding remaining code uses, so a same-named sibling definition is
            # a different object and never the one to import.
            d4.append(name)
        elif name in siblings:
            needed.add(_Imp(siblings[name], 1, name))
        elif name in proxy_defs:
            if proxy_cycle:
                cycle.append(name)
            else:
                needed.add(_Imp(coord_proxy_module, 0, name))
        else:
            nowhere.append(name)
    if d4:
        raise SplitRefused(
            "moved code references names still defined in __init__.py (D4: a domain "
            f"module never imports from the package __init__): {d4}. Move them with "
            "this domain, into a sibling module, or into app.api.coord_proxy first."
        )
    if cycle:
        raise SplitRefused(
            f"moved code would import {cycle} from {coord_proxy_module}, which "
            f"itself imports from {package_module}: an import cycle (D4). Finish "
            f"moving the implementations into {coord_proxy_module} first."
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
    # Every scanned file outside the package, plus the package's own sibling
    # modules (a relative ``from . import x`` there reaches x through __init__).
    package_files = [
        p
        for p in sorted(package_dir.glob("*.py"))
        if p.name != "__init__.py" and p != target_path
    ]
    scan_files = sorted(
        {p for d in scan_dirs for p in d.rglob("*.py") if package_dir not in p.parents}
    )
    import_root = package_dir.parents[len(package_module.split(".")) - 1]
    reached = _names_reached_through_package(
        [*scan_files, *package_files], package_module, import_root
    )
    reexport |= moved_names & reached

    # Two modules would each hold a binding of one piece of state: the moved
    # code rebinds its own copy, the re-export in __init__ keeps the old one.
    split_state = sorted(global_rebinds(moved) & reexport)
    if split_state:
        raise SplitRefused(
            f"moved code rebinds {split_state} via 'global', but __init__ still "
            "reads or re-exports them; the rebinding would not reach __init__'s "
            "copy. Move every reader with this domain first."
        )

    # D7 step 4 is superseded: a string patch target on a moved name would stop
    # reaching the moved code, so it is a refusal, never a rewrite.
    if tests_dir is not None and tests_dir.is_dir():
        stale = _string_patch_targets(
            sorted(tests_dir.rglob("*.py")),
            package_module,
            moved_names | set(spec.copy),
        )
        if stale:
            raise SplitRefused(
                "tests still patch moved/copied names through a string target "
                f"on {package_module} (convert them to tests/_ops_patch.patch_ops): "
                + ", ".join(stale)
            )

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
    """Write every file of ``plan`` or none of them.

    Each file is staged to a temp file beside its target, then the stages are
    ``os.replace``-d in turn. If any step fails, every target already replaced
    gets its original bytes back (a target that did not exist is removed), the
    stages are deleted, and the error propagates.
    """
    originals: dict[Path, bytes | None] = {
        path: path.read_bytes() if path.exists() else None for path in plan.writes
    }
    staged: dict[Path, Path] = {}
    replaced: list[Path] = []
    try:
        for path, text in plan.writes.items():
            tmp = path.with_name(f".{path.name}.ops_split.tmp")
            staged[path] = tmp
            with tmp.open("w", encoding="utf-8", newline="") as fh:
                fh.write(text)
        for path, tmp in staged.items():
            os.replace(tmp, path)
            replaced.append(path)
    except BaseException:
        for path in replaced:
            original = originals[path]
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(original)
        raise
    finally:
        for tmp in staged.values():
            tmp.unlink(missing_ok=True)


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
