#!/usr/bin/env python3
"""coord column-drop guard: a ``coord.*`` DROP/RENAME must not land while a
coord build that is serving — or about to — still reads the surface.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/coord-column-drop-guard.yml``, job
    ``coord-column-drop-guard`` — the PR gate (``--base-ref origin/<base>``)
    and the post-land companion on ``push: main`` (``--base-ref`` = the push
    event's ``before`` sha, so every commit the push carried is scanned), which
    exists so the required-check context has posted on ``main`` before the
    ruleset requires it.
  * ``.qontinui/ci.toml``, step ``coord-column-drop-guard`` — same, locally.
  * ``.pre-commit-config.yaml``, hook ``coord-column-drop-guard`` — the
    shift-left lane, handed the changed revision files as ``--files``.

Plan: ``2026-09-03-coord-column-drop-guard-on-web-migrations`` (Phase 2).

Background: ``pdtier_01`` (web#1102, landed 2026-08-27) dropped
``coord.prompt_documents.agent_writable`` while the DEPLOYED coord build still
read it, and every agent policy write in the fleet failed closed within
minutes. Nothing on the web side knew what coord reads; nothing on the coord
side saw the web PR. This gate closes that: the web PR that drops a
``coord.*`` surface cannot merge while any coord that is deployed, or is on
coord's ``main`` and therefore about to deploy, still names it.

What it scans
-------------
Offline, by AST (``ast.parse``) — it never imports ``env.py`` or the revision
module, which would pull in qontinui-web's whole app. The UPGRADE PATH of each
changed revision file is the whole module minus the ``downgrade()`` function
body AND minus every module-level helper reachable ONLY from it
(``_downgrade_only_helpers``): module-level constants, ``upgrade()``, and every
other helper — one that drops something may be reachable from ``upgrade()`` in a
way this scan cannot prove, so it counts (fail-closed). A module-level template
counts even when nothing references it. Docstrings (the first string statement
of the module, a class or a function) are prose and are skipped.

The downgrade-only exclusion is the same rule as the ``downgrade()`` one, not a
relaxation of it: a DROP that only a downgrade performs does not LAND, and "must
not land" is this gate's own predicate. Excluding the body while still scanning
the helper it calls made an ADDITIVE revision — one whose ``downgrade()``
removes exactly what its ``upgrade()`` added, both generated from a single
column list, the shape every ``fleet_res_tel_*`` revision uses — report an
unresolved site. That forced a ``COORD_SCHEMA_DROPS`` declaration, which
activated the manifest phase against columns no deployed coord can possibly be
reading. Anything referenced outside the downgrade closure, or reached by
``getattr`` / ``globals()`` / a string dispatch table, stays scanned.

Collected as DROP/RENAME sites:

  * ``op.drop_column`` / ``op.drop_table`` / ``op.alter_column(...,
    new_column_name=...)`` / ``op.rename_table`` with ``schema="coord"`` or a
    ``coord.``-qualified table.
  * Raw SQL inside ANY string literal or f-string in the upgrade path (not only
    ``op.execute`` arguments): ``ALTER TABLE coord.<t> DROP [COLUMN] <c>``,
    ``DROP TABLE coord.<t>``, ``ALTER TABLE coord.<t> RENAME [COLUMN] <c> TO``,
    ``ALTER TABLE coord.<t> RENAME TO`` and ``ALTER TABLE coord.<t> SET
    SCHEMA``. A ``DROP COLUMN`` fragment with no ``ALTER TABLE`` in the same
    string is a site whose table is unknown.

Resolution — the part that decides the design. A table or column token that
is a placeholder (``{table}``, ``{{doomed_column}}`` in an f-string, ``%s``,
``:param``, a ``.format()`` target, a bare name) is UNRESOLVED. An unresolved
DROP/RENAME site is a VIOLATION on its own, before any manifest is consulted:
the author must declare, at module level,

    COORD_SCHEMA_DROPS: list[tuple[str, str]] = [
        ("prompt_documents", "agent_writable"),
        ("prompt_document_versions", "agent_writable"),
    ]

whose pairs then ARE the drops (unioned with anything the scan resolved on its
own). The declaration is cross-checked, not trusted: every declared table and
column must also appear as a string literal or identifier somewhere in the
module outside the declaration, so a stale or laundering declaration fails.
The ``coord.`` prefix is normalised on both sides — ``pdtier_01`` names its
tables ``coord.prompt_documents`` and feeds them through a loop variable, so
the scanner sees a bare name and the cross-check finds the qualified literal.
A column of ``*`` declares a whole-table drop.

What it consults
----------------
Zero ``coord.*`` drops across the changed files — the common case — exits 0
WITHOUT any network call and prints what it scanned. Only when a drop is found
does it fetch ``GET <coord-url>/schema/read-surfaces`` (20 s timeout, 3
tries), the manifest coord serves in two halves: ``deployed`` (compiled into
the serving binary, with its ``build_sha``) and ``main`` (pushed by coord's CI
on every land, with its ``sha``). Both halves are unioned; a dropped surface
present in either is a violation naming which sha(s) still read it. A ``*``
wildcard row means coord reads columns of that table it could not statically
name (its ``INTENTIONALLY_UNRESOLVED`` waiver), so a drop on that table is
UNKNOWN — exit 2 naming the waiver, never a pass.

Exit codes: 0 no coord drop, or every drop is read by no coord; 1 a violation
(an unresolved site with no declaration, a bad declaration, or a drop coord
still reads); 2 the gate could not decide (no input files under ``--files``,
an unreadable file, a git error, a manifest half missing / null / empty /
unparseable, or a wildcard waiver on the dropped table). Exit 2 is NOT a pass:
an unknown is not a green (``_gate_lib`` — silence is never success).

``--report-only`` downgrades ONLY exit 1 to 0; it still exits 2 on anything
the gate could not decide. ``--manifest-json`` reads the manifest from a file
instead of the network (tests, dry-runs, and the closeout's counterfactual
proof against a reconstructed historical manifest).
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    EXIT_VIOLATION,
    REPO_ROOT,
    err,
    note,
    repo_relative,
    require_nonempty,
)

VERSIONS_DIR = "backend/alembic/versions"
DEFAULT_COORD_URL = "https://coord.qontinui.io"
MANIFEST_ROUTE = "/schema/read-surfaces"
DECLARATION_NAME = "COORD_SCHEMA_DROPS"
FETCH_TIMEOUT_S = 20.0
FETCH_TRIES = 3
WHOLE_TABLE = "*"

#: Statuses that mean coord does not SERVE :data:`MANIFEST_ROUTE` at all, as
#: opposed to serving it and refusing this caller. Measured against controls on
#: 2026-09-06: coord answers an existing-but-forbidden route (``/coord/fleet/
#: health``) **403**, and an invented one (``/coord/definitely-not-a-route``)
#: **401** — so a 401 here is the signature of an UNROUTED path, not of an auth
#: failure. A 404 is the same statement from a host that routes differently.
ROUTE_ABSENT_STATUSES = frozenset({401, 404})

Fetcher = Callable[[str], bytes]


class ManifestUnavailableError(Exception):
    """The manifest could not be fetched or is not usable. Exit 2, never 1."""

    def __init__(self, message: str, *, http_status: int | None = None) -> None:
        super().__init__(message)
        #: The HTTP status the fetch saw, when the failure was an HTTP one.
        #: ``None`` for a timeout, a DNS failure, or an unusable payload.
        self.http_status = http_status


# ---------------------------------------------------------------------------
# The scan result
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Drop:
    """One resolved ``coord.*`` removal in a revision's upgrade path.

    ``column`` is :data:`WHOLE_TABLE` for ``drop_table`` / ``rename_table`` /
    ``SET SCHEMA``: every column coord reads on that table is affected.
    """

    table: str
    column: str
    where: str
    how: str


@dataclass(frozen=True)
class Unresolved:
    """A DROP/RENAME site whose table or column the scan cannot name."""

    where: str
    how: str
    detail: str


@dataclass
class FileScan:
    path: Path
    drops: list[Drop] = field(default_factory=list)
    unresolved: list[Unresolved] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    declared: list[tuple[str, str]] | None = None


# ---------------------------------------------------------------------------
# Token classification
# ---------------------------------------------------------------------------

_PLACEHOLDER_CHARS = re.compile(r"[{}%:$?<>]")


def _strip_quotes(token: str) -> str:
    token = token.strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'`":
        return token[1:-1]
    return token


def _is_placeholder(token: str) -> bool:
    """A token that is not a literal identifier at scan time."""
    bare = _strip_quotes(token)
    return not bare or bool(_PLACEHOLDER_CHARS.search(bare))


def _split_ident(token: str) -> tuple[str | None, str]:
    """``schema.name`` → ``(schema, name)``; ``name`` → ``(None, name)``.

    Quotes on either half are stripped so ``"coord"."prompt_documents"`` and
    ``coord.prompt_documents`` classify the same way. The split is on the
    first dot OUTSIDE a quoted half, so the quoted form is not torn apart.
    """
    token = token.strip()
    m = re.fullmatch(r'("[^"]*"|[^".]+)\.(.+)', token, flags=re.DOTALL)
    if m:
        return _strip_quotes(m.group(1)).lower(), _strip_quotes(m.group(2))
    return None, _strip_quotes(token)


def normalise_table(table: str) -> str:
    """Bare table name — the manifest's spelling — with any ``coord.`` removed."""
    schema, name = _split_ident(table)
    if schema == "coord":
        return name
    return _strip_quotes(table)


# ---------------------------------------------------------------------------
# Raw-SQL scanning
# ---------------------------------------------------------------------------

# A token is a run of characters that can form an identifier or a placeholder.
# Whitespace, parentheses, commas and semicolons end it. Braces, percent,
# colon and dollar are ALLOWED inside so `{table}`, `%(t)s` and `:t` survive
# as one token and are then classified as placeholders.
_TOKEN = r'(?:"[^"]*"|[^\s(),;"]+)+'

_ALTER_TABLE = re.compile(
    rf"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?P<table>{_TOKEN})",
    re.IGNORECASE,
)
_DROP_TABLE = re.compile(
    rf"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?P<tables>{_TOKEN}(?:\s*,\s*{_TOKEN})*)",
    re.IGNORECASE,
)
# Inside one ALTER TABLE statement. `DROP` alone drops a column in Postgres
# (COLUMN is optional), so the negative lookahead excludes every other DROP
# sub-clause the grammar allows.
_DROP_COLUMN_CLAUSE = re.compile(
    r"\bDROP\s+(?!CONSTRAINT\b|DEFAULT\b|NOT\b|IDENTITY\b|EXPRESSION\b)"
    rf"(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(?P<column>{_TOKEN})",
    re.IGNORECASE,
)
_RENAME_COLUMN_CLAUSE = re.compile(
    rf"\bRENAME\s+(?!CONSTRAINT\b|TO\b)(?:COLUMN\s+)?(?P<column>{_TOKEN})\s+TO\b",
    re.IGNORECASE,
)
_RENAME_TABLE_CLAUSE = re.compile(r"\bRENAME\s+TO\b", re.IGNORECASE)
_SET_SCHEMA_CLAUSE = re.compile(r"\bSET\s+SCHEMA\b", re.IGNORECASE)
# A DROP/RENAME COLUMN fragment anywhere: used to catch the ones that sit
# OUTSIDE any ALTER TABLE in the same string (a concatenated statement whose
# table half lives elsewhere), which this scan cannot attribute to a table.
_ANY_DROP_COLUMN = re.compile(r"\bDROP\s+COLUMN\b", re.IGNORECASE)
_ANY_RENAME_COLUMN = re.compile(r"\bRENAME\s+COLUMN\b", re.IGNORECASE)


def _strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", sql)


def _statement_span(sql: str, start: int) -> tuple[int, int]:
    """From ``start`` to the next ``;`` (or the end of the string)."""
    end = sql.find(";", start)
    return start, (len(sql) if end == -1 else end)


def _classify_table(token: str, where: str, how: str, scan: FileScan) -> str | None:
    """Return the bare coord table name, or None when the site is not coord's.

    Records an :class:`Unresolved` for a placeholder. An unqualified name is
    not coord's: it resolves against ``search_path`` (``public``), and the
    ``alembic-schema-arg-gate`` hook is the gate that rejects it.
    """
    if _is_placeholder(token):
        scan.unresolved.append(Unresolved(where, how, f"table token {token!r}"))
        return None
    schema, name = _split_ident(token)
    if schema == "coord":
        return name
    return None


def scan_sql(sql: str, where: str, scan: FileScan) -> None:
    """Collect every coord DROP/RENAME in one rendered SQL string."""
    body = _strip_sql_comments(sql)
    covered: list[tuple[int, int]] = []

    for m in _ALTER_TABLE.finditer(body):
        start, end = _statement_span(body, m.end())
        covered.append((m.start(), end))
        statement = body[start:end]
        has_column_ops = bool(
            _DROP_COLUMN_CLAUSE.search(statement)
            or _RENAME_COLUMN_CLAUSE.search(statement)
        )
        has_table_ops = bool(
            _RENAME_TABLE_CLAUSE.search(statement)
            or _SET_SCHEMA_CLAUSE.search(statement)
        )
        if not (has_column_ops or has_table_ops):
            continue
        table = _classify_table(m.group("table"), where, "raw SQL ALTER TABLE", scan)
        if table is None:
            continue
        if has_table_ops:
            scan.drops.append(
                Drop(
                    table,
                    WHOLE_TABLE,
                    where,
                    "raw SQL ALTER TABLE ... RENAME TO / SET SCHEMA",
                )
            )
        for clause, how in (
            (_DROP_COLUMN_CLAUSE, "raw SQL ALTER TABLE ... DROP COLUMN"),
            (_RENAME_COLUMN_CLAUSE, "raw SQL ALTER TABLE ... RENAME COLUMN"),
        ):
            for c in clause.finditer(statement):
                column = c.group("column")
                if _is_placeholder(column):
                    scan.unresolved.append(
                        Unresolved(
                            where, how, f"column token {column!r} on coord.{table}"
                        )
                    )
                else:
                    scan.drops.append(Drop(table, _strip_quotes(column), where, how))

    for m in _DROP_TABLE.finditer(body):
        start, end = _statement_span(body, m.start())
        covered.append((start, end))
        for token in re.split(r"\s*,\s*", m.group("tables")):
            table = _classify_table(token, where, "raw SQL DROP TABLE", scan)
            if table is not None:
                scan.drops.append(Drop(table, WHOLE_TABLE, where, "raw SQL DROP TABLE"))

    # A column DROP/RENAME with no ALTER TABLE around it in this string: the
    # table half is somewhere this scan cannot follow.
    for pattern, how in (
        (_ANY_DROP_COLUMN, "raw SQL DROP COLUMN"),
        (_ANY_RENAME_COLUMN, "raw SQL RENAME COLUMN"),
    ):
        for m in pattern.finditer(body):
            if any(s <= m.start() < e for s, e in covered):
                continue
            scan.unresolved.append(
                Unresolved(
                    where, how, "no ALTER TABLE in the same string names its table"
                )
            )


# ---------------------------------------------------------------------------
# AST walking
# ---------------------------------------------------------------------------


def _render(node: ast.expr) -> str | None:
    """Render a string-valued expression as text with placeholders.

    Constants render verbatim; an f-string's interpolations render as
    ``{<expr>}`` so they classify as placeholders; ``+``-concatenation folds
    when every operand renders. Anything else is not a string this scan can
    read and returns None.
    """
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, str) else None
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(str(value.value))
            elif isinstance(value, ast.FormattedValue):
                parts.append(
                    "{" + re.sub(r"[^\w.]", "_", ast.unparse(value.value)) + "}"
                )
            else:  # pragma: no cover - the grammar has no third kind
                return None
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _render(node.left)
        right = _render(node.right)
        if left is None and right is None:
            return None
        # A `"..." + name + "..."` chain: keep the string halves visible and
        # mark the operand that is not a string as a placeholder.
        return ("{_}" if left is None else left) + ("{_}" if right is None else right)
    return None


def _kwarg(call: ast.Call, name: str) -> ast.expr | None:
    for kw in call.keywords:
        if kw.arg == name:
            return kw.value
    return None


def _arg(call: ast.Call, index: int, name: str) -> ast.expr | None:
    if len(call.args) > index:
        return call.args[index]
    return _kwarg(call, name)


def _literal(node: ast.expr | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _op_name(call: ast.Call) -> str | None:
    func = call.func
    if (
        isinstance(func, ast.Attribute)
        and isinstance(func.value, ast.Name)
        and func.value.id == "op"
    ):
        return func.attr
    return None


def _scan_op_call(call: ast.Call, where: str, scan: FileScan) -> None:
    """``op.drop_column`` / ``drop_table`` / ``alter_column(new_column_name=)``
    / ``rename_table`` — the alembic-API spellings of a DROP/RENAME."""
    name = _op_name(call)
    if name == "drop_column":
        table_node, column_node = (
            _arg(call, 0, "table_name"),
            _arg(call, 1, "column_name"),
        )
        whole = False
    elif name == "drop_table":
        table_node, column_node, whole = _arg(call, 0, "table_name"), None, True
    elif name == "alter_column":
        if _kwarg(call, "new_column_name") is None:
            return
        table_node, column_node = (
            _arg(call, 0, "table_name"),
            _arg(call, 1, "column_name"),
        )
        whole = False
    elif name == "rename_table":
        table_node, column_node, whole = _arg(call, 0, "old_table_name"), None, True
    else:
        return
    how = f"op.{name}"

    schema_node = _kwarg(call, "schema")
    schema = _literal(schema_node)
    if schema_node is not None and schema is None:
        # `schema=<name>`: could be coord. Fail closed.
        scan.unresolved.append(
            Unresolved(where, how, "schema= is not a string literal")
        )
        return
    table = _literal(table_node)
    if table is None:
        if schema is not None and schema != "coord":
            return  # a literal non-coord schema settles it whatever the table is
        scan.unresolved.append(Unresolved(where, how, "table is not a string literal"))
        return
    qualified_schema, bare = _split_ident(table)
    if schema != "coord" and qualified_schema != "coord":
        return  # not coord's: `schema="project"`, or an unqualified name that
        # resolves against search_path, which alembic-schema-arg-gate rejects
    if whole:
        scan.drops.append(Drop(bare, WHOLE_TABLE, where, how))
        return
    column = _literal(column_node)
    if column is None:
        scan.unresolved.append(
            Unresolved(where, how, f"column is not a string literal on coord.{bare}")
        )
        return
    scan.drops.append(Drop(bare, column, where, how))


def _is_docstring_stmt(stmt: ast.stmt) -> bool:
    return (
        isinstance(stmt, ast.Expr)
        and isinstance(stmt.value, ast.Constant)
        and isinstance(stmt.value.value, str)
    )


def _body_without_docstring(body: list[ast.stmt]) -> list[ast.stmt]:
    if body and _is_docstring_stmt(body[0]):
        return body[1:]
    return body


def _walk(node: ast.AST, label: str, scan: FileScan) -> None:
    """Visit the upgrade path: strings are rendered whole (not descended
    into), ``op.*`` calls are classified, docstrings are skipped."""
    if isinstance(node, ast.Constant | ast.JoinedStr | ast.BinOp):
        rendered = _render(node)
        if rendered is not None:
            scan_sql(rendered, f"{label}:{getattr(node, 'lineno', '?')}", scan)
            return
    if isinstance(node, ast.Call):
        _scan_op_call(node, f"{label}:{node.lineno}", scan)
    if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
        for stmt in _body_without_docstring(node.body):
            _walk(stmt, label, scan)
        for child in node.decorator_list:
            _walk(child, label, scan)
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            _walk(node.args, label, scan)
        return
    for child in ast.iter_child_nodes(node):
        _walk(child, label, scan)


def _referenced_names(node: ast.AST) -> set[str]:
    """Every bare identifier referenced anywhere under ``node``."""
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}


def _downgrade_only_helpers(tree: ast.Module) -> set[str]:
    """Module-level functions reachable from ``downgrade()`` and NOWHERE else.

    The upgrade path already excludes ``downgrade()``'s own body, because a
    DROP that only a downgrade performs does not LAND — and not landing is the
    whole predicate this gate is written against ("a coord.* DROP/RENAME must
    not land while a coord build that is serving still reads the surface").

    A helper that only ``downgrade()`` calls is downgrade code by exactly that
    argument, so scanning it re-imports the drop the exclusion just removed.
    The module docstring justifies scanning every helper on the grounds that
    one "is reachable from ``upgrade()`` whether or not this scan can prove
    it" — but that is a REACHABILITY claim, and reachability is precisely what
    an AST can settle in the common case. This function settles it, and the
    exclusion then matches the contract the docstring already states.

    Conservative in the one direction that matters. A name referenced anywhere
    outside the downgrade closure stays on the upgrade path, and a helper
    reached by any means this pass cannot see (``getattr``, ``globals()``, a
    string dispatch table) never enters the closure at all, so it is scanned.
    The failure mode is a helper scanned needlessly, never one skipped that
    mattered.
    """
    functions = {
        stmt.name: stmt
        for stmt in tree.body
        if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef)
    }
    downgrade = functions.get("downgrade")
    if downgrade is None:
        return set()

    # Fixpoint: what downgrade() calls, then what those call.
    closure: set[str] = set()
    frontier = (_referenced_names(downgrade) & set(functions)) - {"downgrade"}
    while frontier:
        name = frontier.pop()
        if name in closure:
            continue
        closure.add(name)
        frontier |= (
            (_referenced_names(functions[name]) & set(functions))
            - closure
            - {"downgrade"}
        )

    # Everything OUTSIDE downgrade() and outside the closure keeps every name
    # it mentions on the upgrade path. A closure member's DECORATORS count as
    # outside: the decorator runs at import time, on the upgrade path.
    outside: set[str] = set()
    for stmt in tree.body:
        is_closure_fn = (
            isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef)
            and stmt.name in closure
        )
        if is_closure_fn:
            for decorator in stmt.decorator_list:
                outside |= _referenced_names(decorator)
            continue
        if isinstance(stmt, ast.FunctionDef) and stmt.name == "downgrade":
            continue
        outside |= _referenced_names(stmt)
    return closure - outside


# ---------------------------------------------------------------------------
# The COORD_SCHEMA_DROPS declaration
# ---------------------------------------------------------------------------


def _declaration_node(tree: ast.Module) -> ast.stmt | None:
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            targets = stmt.targets
        elif isinstance(stmt, ast.AnnAssign):
            targets = [stmt.target]
        else:
            continue
        for target in targets:
            if isinstance(target, ast.Name) and target.id == DECLARATION_NAME:
                return stmt
    return None


def _parse_declaration(stmt: ast.stmt, scan: FileScan) -> list[tuple[str, str]]:
    value = stmt.value  # type: ignore[union-attr]
    where = f"{repo_relative(scan.path)}:{stmt.lineno}"
    if not isinstance(value, ast.List | ast.Tuple):
        scan.violations.append(
            f"{where}: {DECLARATION_NAME} must be a list of (table, column) "
            "string tuples, written out literally."
        )
        return []
    pairs: list[tuple[str, str]] = []
    for elt in value.elts:
        if not (
            isinstance(elt, ast.Tuple | ast.List)
            and len(elt.elts) == 2
            and all(_literal(e) is not None for e in elt.elts)
        ):
            scan.violations.append(
                f"{where}: {DECLARATION_NAME} entry {ast.unparse(elt)!r} is not a "
                "(table, column) pair of string literals."
            )
            continue
        table_raw, column_raw = (_literal(e) or "" for e in elt.elts)
        schema, table = _split_ident(table_raw)
        if schema not in (None, "coord"):
            scan.violations.append(
                f"{where}: {DECLARATION_NAME} names {table_raw!r}, which is not a "
                "coord.* table — this declaration is for coord surfaces only; a "
                f"{schema}.* drop is outside this gate."
            )
            continue
        if not table or not column_raw:
            scan.violations.append(
                f"{where}: {DECLARATION_NAME} entry {ast.unparse(elt)!r} has an empty name."
            )
            continue
        pairs.append((table, column_raw))
    return pairs


def _corpus(tree: ast.Module, declaration: ast.stmt | None) -> str:
    """Every string literal and identifier in the module, minus docstrings and
    minus the declaration itself — what a declared name must be found in."""
    texts: list[str] = []

    def visit(node: ast.AST) -> None:
        if node is declaration:
            return
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            texts.append(node.value)
        elif isinstance(node, ast.Name):
            texts.append(node.id)
        elif isinstance(node, ast.Attribute):
            texts.append(node.attr)
        if isinstance(
            node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef
        ):
            for stmt in _body_without_docstring(node.body):
                visit(stmt)
            for child in ast.iter_child_nodes(node):
                if child not in node.body:
                    visit(child)
            return
        for child in ast.iter_child_nodes(node):
            visit(child)

    visit(tree)
    return "\n".join(texts)


def _cross_check(
    pairs: list[tuple[str, str]], corpus: str, where: str, scan: FileScan
) -> None:
    for table, column in pairs:
        for what, name in (("table", table), ("column", column)):
            if name == WHOLE_TABLE:
                continue
            if not re.search(rf"(?<![\w]){re.escape(name)}(?![\w])", corpus):
                scan.violations.append(
                    f"{where}: {DECLARATION_NAME} declares {what} {name!r}, which "
                    "appears nowhere else in the module (as a literal, inside a "
                    "literal, or as an identifier). A declaration must name what "
                    "the revision actually drops — a stale one is removed, not kept."
                )


# ---------------------------------------------------------------------------
# Per-file scan
# ---------------------------------------------------------------------------


def scan_source(source: str, path: Path) -> FileScan:
    """Scan one revision's source. Raises SyntaxError on an unparseable file."""
    scan = FileScan(path=path)
    label = repo_relative(path)
    tree = ast.parse(source, filename=str(path))

    downgrade_only = _downgrade_only_helpers(tree)
    for stmt in _body_without_docstring(tree.body):
        if isinstance(stmt, ast.FunctionDef) and stmt.name == "downgrade":
            continue  # the one body that is NOT the upgrade path
        if (
            isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef)
            and stmt.name in downgrade_only
        ):
            continue  # reachable only from downgrade() — downgrade code too
        _walk(stmt, label, scan)

    declaration = _declaration_node(tree)
    if declaration is not None:
        where = f"{label}:{declaration.lineno}"
        pairs = _parse_declaration(declaration, scan)
        _cross_check(pairs, _corpus(tree, declaration), where, scan)
        scan.declared = pairs
        if scan.unresolved and not pairs and not scan.violations:
            scan.violations.append(
                f"{where}: {DECLARATION_NAME} is empty, but this revision has "
                f"{len(scan.unresolved)} DROP/RENAME site(s) the scan cannot resolve. "
                "An empty declaration does not assert 'no coord drops' — name them."
            )
        for table, column in pairs:
            scan.drops.append(
                Drop(table, column, where, f"declared in {DECLARATION_NAME}")
            )
    elif scan.unresolved:
        scan.violations.append(
            f"{label}: {len(scan.unresolved)} DROP/RENAME site(s) whose table or "
            f"column this gate cannot resolve statically, and no {DECLARATION_NAME} "
            "declaration:"
        )
        for site in scan.unresolved:
            scan.violations.append(f"    {site.where}  {site.how}: {site.detail}")
        scan.violations.append(
            "  Declare the coord surfaces this revision removes, at module level:\n"
            f"      {DECLARATION_NAME}: list[tuple[str, str]] = ["
            '("prompt_documents", "agent_writable"), ...]\n'
            '  (bare table names or coord.-qualified; a column of "*" means the '
            "whole table). Each name is cross-checked against the module's literals, "
            "so declare what the SQL actually drops. If the unresolved site drops "
            "nothing in coord.*, declare the coord drops it DOES perform — there "
            "must be at least one, or restructure the SQL so the table and column "
            "are literals the gate can read."
        )
        scan.violations.append(
            f"  NOTE: a {DECLARATION_NAME} declaration ACTIVATES the manifest check, "
            f"which needs coord to serve {MANIFEST_ROUTE}. While that route is "
            "unserved, declaring converts this fixable failure into an unfixable "
            "one. If your DROP sites are reached only from downgrade(), you need no "
            "declaration at all — this gate scans the upgrade path only."
        )
    return scan


def scan_file(path: Path) -> FileScan:
    return scan_source(path.read_text(encoding="utf-8"), path)


# ---------------------------------------------------------------------------
# Input selection
# ---------------------------------------------------------------------------


def changed_revision_files(base_ref: str) -> list[Path]:
    """Revision files added, modified, renamed or copied vs ``base_ref``.

    Three-dot, so the diff is from the merge base — the PR's own changes, not
    everything main gained since the branch was cut. Raises on git error.
    """
    result = subprocess.run(
        [
            "git",
            "diff",
            "--name-only",
            "--diff-filter=AMCR",
            f"{base_ref}...HEAD",
            "--",
            f"{VERSIONS_DIR}/",
        ],
        capture_output=True,
        text=True,
        check=False,
        cwd=REPO_ROOT,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"git diff {base_ref}...HEAD failed (exit {result.returncode}): "
            f"{result.stderr.strip() or '(no stderr)'}"
        )
    files = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if line.endswith(".py") and Path(line).name != "__init__.py":
            files.append(REPO_ROOT / line)
    return files


# ---------------------------------------------------------------------------
# The manifest
# ---------------------------------------------------------------------------


def fetch_manifest(url: str) -> bytes:
    """``GET url`` with the retry budget the docstring states."""
    last: Exception | None = None
    for attempt in range(1, FETCH_TRIES + 1):
        try:
            with urllib.request.urlopen(url, timeout=FETCH_TIMEOUT_S) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if 400 <= exc.code < 500 and exc.code != 429:
                break  # a 4xx will not change on retry: not deployed, or denied
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = exc
        if attempt < FETCH_TRIES:
            time.sleep(attempt)
    status = last.code if isinstance(last, urllib.error.HTTPError) else None
    raise ManifestUnavailableError(f"{url}: {last}", http_status=status)


@dataclass
class Manifest:
    """The union of both halves, keyed for the checks that follow."""

    deployed_sha: str
    main_sha: str
    #: (table, column) -> the labels of the halves that read it
    surfaces: dict[tuple[str, str], list[str]]
    #: table -> labels of the halves carrying a `*` wildcard row for it
    wildcards: dict[str, list[str]]


def _half(payload: dict, key: str, sha_key: str) -> tuple[str, list]:
    half = payload.get(key)
    if half is None:
        reason = payload.get("main_unavailable_reason") if key == "main" else None
        raise ManifestUnavailableError(
            f"the `{key}` half of the manifest is null"
            + (f" — coord says: {reason!r}" if reason else "")
            + ". A missing half is UNKNOWN, not 'reads nothing'."
        )
    if not isinstance(half, dict):
        raise ManifestUnavailableError(f"the `{key}` half is not an object: {half!r}")
    sha = half.get(sha_key)
    surfaces = half.get("surfaces")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ManifestUnavailableError(
            f"the `{key}` half carries no 40-hex `{sha_key}`: {sha!r}"
        )
    if not isinstance(surfaces, list) or not surfaces:
        raise ManifestUnavailableError(
            f"the `{key}` half ({sha_key} {sha}) has no surfaces at all — coord reads "
            "dozens of coord.* columns, so an empty list is a broken manifest, not a "
            "coord that reads nothing."
        )
    return sha, surfaces


def parse_manifest(raw: bytes | str) -> Manifest:
    """Validate the served shape; raise :class:`ManifestUnavailableError` on any gap."""
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise ManifestUnavailableError(f"manifest is not JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ManifestUnavailableError(
            f"manifest is not an object: {type(payload).__name__}"
        )
    deployed_sha, deployed_rows = _half(payload, "deployed", "build_sha")
    main_sha, main_rows = _half(payload, "main", "sha")

    surfaces: dict[tuple[str, str], list[str]] = {}
    wildcards: dict[str, list[str]] = {}
    for label, rows in (
        (f"deployed build {deployed_sha}", deployed_rows),
        (f"main {main_sha}", main_rows),
    ):
        for row in rows:
            if not (
                isinstance(row, list | tuple)
                and len(row) == 3
                and all(isinstance(cell, str) and cell for cell in row)
            ):
                raise ManifestUnavailableError(
                    f"malformed surface row in {label}: {row!r}"
                )
            table, column, source = row
            table = normalise_table(table)
            if column == WHOLE_TABLE:
                wildcards.setdefault(table, []).append(f"{label} ({source})")
            else:
                surfaces.setdefault((table, column), []).append(f"{label} ({source})")
    return Manifest(deployed_sha, main_sha, surfaces, wildcards)


# ---------------------------------------------------------------------------
# The verdict
# ---------------------------------------------------------------------------

REMEDY = """
Why this gate is blocking: coord reads that column/table by name in SQL
(or its readiness probe requires it). Dropping it while a build that
reads it is serving — or is on coord's main and about to be deployed —
turns those reads into 42703 errors and every dependent write fails
closed. That is exactly what pdtier_01 did on 2026-08-27.

Resolution, in order:
  1. Land the coord change that stops reading the surface.
  2. Wait for it to DEPLOY: `curl -s https://coord.qontinui.io/health`
     must report a `build_sha` that is a descendant of that change, AND
     coord's main manifest must no longer list the surface (coord's CI
     re-pushes it on every land to main).
  3. Re-run this check (re-push, or re-run the workflow).
Or split the drop into a LATER revision and land the rest of this one
now — an ADD lands before its consumer; a DROP lands after its last
reader is gone, and "gone" means deployed, not merged.
"""


def _report_scan(scans: list[FileScan], label: str) -> None:
    drops = sum(len(s.drops) for s in scans)
    unresolved = sum(len(s.unresolved) for s in scans)
    note(
        f"coord-column-drop-guard: scanned {len(scans)} revision file(s) ({label}); "
        f"found {drops} resolved coord.* DROP/RENAME site(s) and {unresolved} "
        "unresolved site(s)."
    )
    for s in scans:
        note(
            f"  {repo_relative(s.path)}: {len(s.drops)} drop(s), {len(s.unresolved)} unresolved"
        )
    # stdout is block-buffered under CI; flush so the scan summary lands
    # BEFORE any verdict written to stderr rather than after it.
    sys.stdout.flush()


def check_drops(
    scans: list[FileScan], manifest: Manifest
) -> tuple[list[str], list[str]]:
    """Return ``(violations, waivers)``: what coord still reads, and what it
    cannot say."""
    violations: list[str] = []
    waivers: list[str] = []
    for scan in scans:
        for drop in scan.drops:
            if drop.column == WHOLE_TABLE:
                read = {
                    column: readers
                    for (table, column), readers in manifest.surfaces.items()
                    if table == drop.table
                }
                if read:
                    violations.append(
                        f"{drop.where} removes table coord.{drop.table} ({drop.how}); "
                        f"coord still reads {len(read)} column(s) of it:"
                    )
                    for column, readers in sorted(read.items()):
                        violations.append(f"    {column}: " + "; ".join(readers))
                    continue
            else:
                readers = manifest.surfaces.get((drop.table, drop.column))
                if readers:
                    violations.append(
                        f"{drop.where} drops coord.{drop.table}.{drop.column} ({drop.how}), "
                        "which coord still reads: " + "; ".join(readers)
                    )
                    continue
            wild = manifest.wildcards.get(drop.table)
            if wild:
                target = (
                    f"coord.{drop.table}"
                    if drop.column == WHOLE_TABLE
                    else f"coord.{drop.table}.{drop.column}"
                )
                waivers.append(
                    f"{drop.where} removes {target} ({drop.how}), and coord reads columns "
                    f"of coord.{drop.table} it could not name statically — an "
                    "INTENTIONALLY_UNRESOLVED waiver in schema_read_contract.rs: "
                    + "; ".join(wild)
                )
    return violations, waivers


def main(argv: list[str] | None = None, *, fetch: Fetcher | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--base-ref",
        default="origin/main",
        help=(
            "Scan the revision files added/modified/renamed vs this ref "
            f"(git diff --diff-filter=AMCR <ref>...HEAD -- {VERSIONS_DIR}/). "
            "An empty diff on a PR that touches no revision is an honest pass. "
            "Default: origin/main."
        ),
    )
    source.add_argument(
        "--files",
        nargs="+",
        metavar="FILE",
        help=(
            "Scan exactly these revision files instead of a git diff (the "
            "pre-commit lane, tests, dry-runs). An EMPTY list is exit 2."
        ),
    )
    parser.add_argument(
        "--manifest-json",
        metavar="PATH",
        help=(
            "Read the read-surface manifest from this JSON file instead of "
            f"fetching <coord-url>{MANIFEST_ROUTE}. Same shape as the route."
        ),
    )
    parser.add_argument(
        "--coord-url",
        default=DEFAULT_COORD_URL,
        help=f"coord base URL to fetch the manifest from (default {DEFAULT_COORD_URL}).",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help=(
            "Report violations but exit 0 on them. A scan the gate could not "
            "decide (exit 2) is still exit 2."
        ),
    )
    args = parser.parse_args(argv)
    fetch = fetch or fetch_manifest

    # 1. Which files.
    if args.files is not None:
        files = [Path(f) for f in args.files]
        label = "--files"
        require_nonempty(len(files), "revision files", "the --files list")
    else:
        label = f"changed vs {args.base_ref}"
        try:
            files = changed_revision_files(args.base_ref)
        except (RuntimeError, OSError) as exc:
            err(f"could not list changed revision files: {exc}")
            err(
                "Fetch the base ref (git fetch origin main) and re-run. This is UNKNOWN, not a pass."
            )
            return EXIT_VACUOUS

    # 2. Scan each one.
    scans: list[FileScan] = []
    for path in files:
        try:
            scans.append(scan_file(path))
        except OSError as exc:
            err(f"cannot read {path}: {exc}")
            return EXIT_VACUOUS
        except SyntaxError as exc:
            err(f"cannot parse {repo_relative(path)}: {exc}")
            err(
                "An unparseable revision cannot be scanned; this is UNKNOWN, not a pass."
            )
            return EXIT_VACUOUS
    _report_scan(scans, label)

    # 3. Violations that need no manifest — they fire BEFORE any network call.
    static = [line for scan in scans for line in scan.violations]
    if static:
        err("coord-column-drop-guard: this revision cannot be checked as written:")
        for line in static:
            print(line, file=sys.stderr)
        if args.report_only:
            note("--report-only: reported, not failed.")
            return 0
        return EXIT_VIOLATION

    drops = [drop for scan in scans for drop in scan.drops]
    if not drops:
        note(
            "No coord.* DROP/RENAME in the upgrade path; nothing to check against coord."
        )
        note(
            "  NB: this pass says this revision drops nothing in coord.*. It is NOT "
            "evidence that a drop was checked against coord's read contract — no "
            "manifest was fetched, and none was needed."
        )
        return 0

    # 4. Only now is coord consulted.
    for drop in drops:
        target = (
            f"coord.{drop.table}"
            if drop.column == WHOLE_TABLE
            else f"coord.{drop.table}.{drop.column}"
        )
        note(f"  will check {target}  ({drop.where}, {drop.how})")
    sys.stdout.flush()
    try:
        if args.manifest_json:
            manifest_label = args.manifest_json
            raw: bytes | str = Path(args.manifest_json).read_text(encoding="utf-8")
        else:
            manifest_label = args.coord_url.rstrip("/") + MANIFEST_ROUTE
            raw = fetch(manifest_label)
        manifest = parse_manifest(raw)
    except OSError as exc:
        err(f"cannot read manifest {args.manifest_json}: {exc}")
        return EXIT_VACUOUS
    except ManifestUnavailableError as exc:
        err(f"coord read-surface manifest unusable ({manifest_label}): {exc}")
        if exc.http_status in ROUTE_ABSENT_STATUSES:
            err(
                f"coord does not SERVE {MANIFEST_ROUTE} (HTTP {exc.http_status}). "
                "The coord half of this gate has not shipped, so there is no "
                "manifest for any revision to be checked against — this check "
                "currently has NO passing shape for a coord.* drop."
            )
            err(
                "THIS IS NOT A DEFECT IN THIS REVISION, AND NO EDIT INSIDE THIS PR "
                f"CAN FIX IT. In particular do NOT add a {DECLARATION_NAME} "
                "declaration to try to satisfy this check: a declaration is what "
                "ACTIVATES this phase, so it turns a fixable exit 1 into this "
                "unfixable exit 2. Escalate the gate itself — plan "
                "2026-09-06-devops-coord-column-drop-guard-has-no-served-manifest."
            )
        else:
            err(
                "This revision DROPS a coord.* surface and the gate cannot see what "
                "coord reads, so it cannot pass. UNKNOWN is not green. If the `main` "
                "half is null, coord's CI has not pushed a snapshot since its last "
                "boot — dispatch coord's ci.yml on main, or wait for its next land."
            )
        return EXIT_VACUOUS
    note(
        f"manifest: deployed build {manifest.deployed_sha}, main {manifest.main_sha}, "
        f"{len(manifest.surfaces)} surface(s), {len(manifest.wildcards)} wildcard table(s)"
    )
    sys.stdout.flush()

    violations, waivers = check_drops(scans, manifest)
    if violations:
        err(
            "coord-column-drop-guard: a coord build still reads what this revision drops:"
        )
        for line in violations:
            print(line, file=sys.stderr)
        print(REMEDY, file=sys.stderr)
        if args.report_only:
            note("--report-only: reported, not failed.")
            return 0
        return EXIT_VIOLATION
    if waivers:
        err(
            "coord-column-drop-guard: cannot decide — coord's read contract has a waiver on this table:"
        )
        for line in waivers:
            print(line, file=sys.stderr)
        err(
            "Resolve the INTENTIONALLY_UNRESOLVED entry in coord's "
            "schema_read_contract.rs (so the extractor can name the columns) and land "
            "that first, or split the drop out. UNKNOWN is not green."
        )
        return EXIT_VACUOUS
    note(
        f"OK: none of the {len(drops)} dropped surface(s) is read by coord's deployed "
        f"build ({manifest.deployed_sha}) or main ({manifest.main_sha})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
