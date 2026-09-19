#!/usr/bin/env python3
"""No global-state assertion may be ADDED to the backend suite — a per-file ratchet.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/global-state-assertions.yml``, step
    "Count global-state assertions in backend/tests against the allowlist"
  * ``.qontinui/ci.toml``, step ``global-state-assertions``
  * ``.pre-commit-config.yaml``, hook ``global-state-assertions``

Plan ``2026-08-31-global-state-assertion-inventory-survives-its-plan``, Phase 2.

WHAT IT FORBIDS: an exact-count or emptiness assertion under ``backend/tests/``
over a value read from SHARED state with no discriminator the test controls, in
any file beyond the count that file is allowed in
``backend/tests/.global-state-assertions-allowlist``. A file with no row is
allowed zero.

Such an assertion is not a statement about the code under test; it is a
statement about everything else that shares the store. ``assert len(jobs) == 1``
over every job row for a tenant passes alone and fails the moment the
session-scoped app's own ``memory_consolidate`` sweep enqueues a second one —
which is exactly how ``assert 2 == 1`` reddened an alembic-only PR
(qontinui-web#1103) that touched nothing the test exercised. It also passes for
the wrong reason: one row, not necessarily the row under test.

A count assertion is LEGITIMATE when it is scoped by a discriminator the test
itself controls — a fresh ``uuid4()`` tenant, an ``input_hash``, an explicit
``kind``, a ``WHERE`` the test wrote. The rule is therefore "exact-count or
emptiness over shared state WITH NO test-controlled discriminator", never
"exact-count assertion": a gate that forbade the second would forbid the
correct spelling along with the broken one, and would be argued with rather
than obeyed.

WHY THIS IS A DETECTOR AND NOT A LIST. Phase 1 of the plan enumerated the class
by hand into a markdown inventory. An enumeration is true on the day it is
written and decays from the next commit: it cannot see a site added afterwards,
and nothing fails when it goes stale. Computing the membership at every CI run
is what makes the class survive its own plan — the inventory becomes the
allowlist, and the allowlist is checked rather than read.

A CANDIDATE, on the parsed AST rather than on text, takes one of two shapes.
Either an ``assert`` whose test is a single ``==`` comparison with a FIXED
EXTENT on one side — an integer literal (``0`` included; ``True``/``False``
excluded, they are not extents) or an empty ``[]`` / ``{}`` display — where the
other side is the SUBJECT, and the subject is ``len(X)`` or ``X`` itself. Or an
``assert not X``, which is the idiomatic pytest spelling of ``assert X == []``
and is the same claim about the same population; ``X`` is the subject and the
negation itself is the extent. Nothing else is a candidate: an ordering
assertion, a membership assertion, and a count compared against a computed
``expected`` are all outside the class.

The ``assert not`` shape is admitted deliberately rather than as a widening.
Leaving it out did not make the rule narrower, it made it BLIND to a spelling
of the very thing it forbids — measured on this suite, 265 ``assert not …``
statements of which exactly one is a Rule-A member
(``test_parkwuslug_01_park_work_unit_slug_migration.py``, an unfiltered
``SELECT … FROM coord.session_messages``). A gate that a rename of the
assertion can evade is an enumeration wearing a detector's clothes.

Two rules then decide, in this order, and the first match wins so one
``assert`` is never counted twice. Both are mechanical — neither guesses at
what a name means:

RULE A — ``unfiltered_sql``. The subject's value derives from SQL with NO
``WHERE`` clause at all. "Derives from" is established two ways, both read out
of the same file: the subject's local dataflow closure (below) contains a
``.execute(...)`` whose arguments carry a SQL string, or it calls a
MODULE-LEVEL HELPER DEFINED IN THIS FILE whose body carries one. A SQL string
that selects ``count(...)`` or reads ``FROM <schema>.<table>`` and mentions no
``WHERE`` anywhere counts every tenant's rows, so the number it returns is owned
by the whole store — that is the entire test for this rule, and it needs no
name heuristics to apply it.

RULE B — ``unused_discriminator``. The subject's value comes from a call to a
module-level helper in this file that declares KEYWORD-ONLY parameters —
anything after the ``*`` in its signature — and the call site passes NONE of
them. This is the important rule, because it is self-enforcing: a helper that
has grown keyword-only discriminators is a helper whose author has already
identified that the unfiltered read is unsafe, so every call that ignores them
is a member of the class BY CONSTRUCTION, with no judgement left for the gate
to get wrong. Scoping ``_job_rows(db, tenant)`` to
``_job_rows(db, tenant, *, input_hash=None, kind=None)`` therefore does two
things at once: it fixes the four sites the author scoped, and it arms the gate
against every future bare call.

THE LOCAL DATAFLOW CLOSURE. ``rows = result.mappings().all()`` says nothing on
its own; the read is two lines up in
``result = await conn.execute(text("SELECT ... FROM coord.memory_jobs"))``. So
the subject is expanded: every name the enclosing function binds that is
reachable from the subject contributes the expressions assigned to it,
transitively, with a visited set. ``for row in rows`` and ``with x() as y``
contribute their iterable and context expression, so a value carried through
either is still traced back to the read it came from.

WHAT IT DELIBERATELY DOES NOT FLAG, because these were measured as false
positives on this very suite and every one of them is either correct or
unknowable:

  * ``len()`` of a string — ``assert len(frame["request_id"]) == 32`` is a
    format assertion, not a population one;
  * a local list the test built itself — ``errors = []`` … ``assert len(errors) == 1``;
  * a mock's call counter — ``assert manager.send_terminal.await_count == 1`` is
    the CORRECT idiom for "called once" and must never be flagged;
  * any attribute of any object — ``session.grants == {}``,
    ``pubsub.close_count == 1``. There is no module-global arm at all. An
    earlier draft had one, keyed on dotted-ness, and it could not tell a
    per-test fake's attribute from a process-wide global: it flagged 582
    assertions of which ~97% were correct tests. A rule that cannot separate
    those two does not belong in a gate; the two rules above can, because they
    read the SQL and the signature rather than the shape of the expression.

So the honest statement of a green is narrow: no file carries more Rule-A or
Rule-B assertions than its row. The class is wider than the detector, and the
detector is the part that cannot go stale.

COMMENTS NEVER REACH US. ``ast`` drops them, so a commented-out assertion is not
counted and no comment-prefix rule is needed — the same "position, not text"
property ``backend/tests/gate_lane_roster.py`` relies on. It also means a
fixture written as a string literal (this gate's own test module is full of
them) is invisible here, which is what lets the detector be tested against
known-positive input inside the directory it scans.

THE ALLOWLIST IS A RATCHET, matched EXACTLY — the same posture as the sibling
gate ``scripts/ci/check_fixed_sleeps_in_e2e.py`` and qontinui-runner's
``scripts/untimed-subprocess-baseline.json``:

  * a file whose actual count EXCEEDS its row (or has no row)  -> violation
  * a file whose actual count is BELOW its row                 -> violation
    ("lower the row"): a stale row is a hole the count can silently climb back
    into, so scoping a site and leaving its row alone is refused. A fix edits
    the test and its row in the same commit.
  * a row for a file that no longer exists                     -> violation
    ("remove the row"), same reason.

So the allowlist can only shrink, and a green means "no file carries more
global-state assertions than it did when the ratchet was set" — nothing more.
It does not mean the suite is free of them; the rows say how many remain, per
file.

``--write-allowlist`` regenerates the file from the current tree (rows for
every file with a non-zero count, sorted by path). It exists to set the ratchet
and to lower it after a fix; the gate never runs it.

Exit codes: 0 clean, 1 at least one file is over, under or missing relative to
its row, 2 the scan proved nothing (no Python files under the tests root, a
file that will not parse, an unreadable allowlist) — vacuous, not a pass.
"""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    EXIT_VIOLATION,
    REPO_ROOT,
    err,
    note,
    require_nonempty,
)

TESTS_ROOT = REPO_ROOT / "backend" / "tests"
ALLOWLIST = TESTS_ROOT / ".global-state-assertions-allowlist"
SCAN_SUFFIX = ".py"

#: A string literal is SQL-that-reads-a-table when it selects an aggregate or
#: names a schema-qualified table. Both spellings appear in this suite; either
#: alone is enough, because a WHERE-less read of one table is as global as a
#: WHERE-less count of it.
SQL_COUNT = re.compile(r"select\s+count\s*\(", re.IGNORECASE)
SQL_TABLE_REF = re.compile(r"from\s+\w+\.", re.IGNORECASE)

#: A WHERE **clause**, as opposed to the English word. This is deliberately not
#: a "does this look like SQL" test: that framing needs a keyword list, and
#: every candidate keyword (``set``, ``and``, ``or``, ``on``, ``order``,
#: ``values``) is an ordinary English word, so prose kept scoring as SQL — "the
#: row set where nothing matched" carries two of them. It also got terse real
#: fragments wrong in the other direction, because ``" WHERE is_active"`` has
#: exactly one keyword and no punctuation.
#:
#: A clause is ``where`` followed by a column and then either a predicate
#: operator (``=``, ``<>``, ``IN``, ``LIKE``, ``BETWEEN``, or ``IS [NOT]
#: NULL/TRUE/FALSE/DISTINCT``) or the end of
#: the fragment — the accumulate/f-string spellings this suite uses cut the
#: string anywhere, so a fragment ending right after ``WHERE`` or after the
#: column is normal. Prose fails on both arms: the word after "where" is a
#: noun, and more prose follows it.
#:
#: ``IS`` is spelled out to its SQL forms rather than left bare, because a bare
#: ``\bis\b`` is the one arm English reaches easily: "returns rows where
#: matching is done later" matched it, and a prose string that scores as a
#: clause hands the false green straight back.
SQL_WHERE_CLAUSE = re.compile(
    r"\bwhere\b(?:"
    r"\s*$"  # the fragment ends at WHERE
    r"|\s+[\w\".]+\s*$"  # WHERE <col> — bare boolean, then end
    r"|[^']{0,80}?(?:=|<>|!=|<=|>=|<|>"  # an expression, then a predicate operator
    r"|\bin\s*\(|\blike\b|\bbetween\b"
    r"|\bis\s+(?:not\s+)?(?:null|true|false|distinct)\b)"
    r")",
    re.IGNORECASE,
)
#: Builtins that return their single argument's population unchanged, so a
#: value wrapped in one is still the value the helper produced.
PASSTHROUGH_BUILTINS = frozenset({"list", "sorted", "set", "tuple", "reversed"})

#: Calls that run a statement. ``exec_driver_sql`` is here for the same reason
#: ``execute`` is: it takes the SQL as an argument, so the string is in reach.
EXECUTE_CALLS = frozenset({"execute", "exec_driver_sql", "executemany"})

ALLOWLIST_HEADER = """\
# Global-state-assertion ratchet for backend/tests — read by
# scripts/ci/check_global_state_assertions.py (workflow
# global-state-assertions.yml). One row per file that still asserts an exact
# count or an emptiness over a value read from shared state with no
# test-controlled discriminator: `<repo-relative path> <count>`. A file with no
# row is allowed 0. Rows are matched EXACTLY: a PR may lower a count or remove
# a row, never raise one — and a scoped test must lower its row in the same
# commit, or the gate fails with "lower the row". Regenerate with
# `python scripts/ci/check_global_state_assertions.py --write-allowlist`.
# Plan: 2026-08-31-global-state-assertion-inventory-survives-its-plan
"""

#: The two rules, named in findings and in the allowlist's remediation text.
RULE_A = "unfiltered_sql"
RULE_B = "unused_discriminator"


class Finding:
    """One assertion of the class, with the rule that classified it."""

    def __init__(self, lineno: int, rule: str, detail: str, source: str) -> None:
        self.lineno = lineno
        self.rule = rule
        self.detail = detail
        self.source = source

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return (
            f"Finding(line={self.lineno}, rule={self.rule!r}, detail={self.detail!r})"
        )


def _rel(path: Path) -> str:
    """Repo-relative POSIX path.

    This adopts the SEMANTICS `_gate_lib.repo_relative` exists to keep in one
    place — resolve first, and fall back to the string instead of raising, the
    two behaviours its docstring records two earlier copies diverging on — but
    it cannot be a call to that function. `repo_relative` closes over
    `_gate_lib`'s own module-level `REPO_ROOT`, while this gate's tests
    monkeypatch `REPO_ROOT` *here* to point at a fixture tree; calling through
    would resolve every fixture path against the real repo, fail the
    `relative_to`, and render absolute paths into the allowlist the test then
    compares. Both sides are resolved so a symlinked temp root still matches.
    """
    try:
        return path.resolve().relative_to(Path(REPO_ROOT).resolve()).as_posix()
    except ValueError:
        return str(path)


# ---------------------------------------------------------------------------
# Scope: what the enclosing function binds, and where a value came from
# ---------------------------------------------------------------------------


def _binding_targets(node: ast.AST) -> tuple[list[ast.expr], ast.expr | None]:
    """``(targets, the expression they are bound to)`` for one statement.

    A ``for`` target is bound to the ITERABLE and a ``with ... as`` to the
    context expression, so a row carried out of either is still traced back to
    the read it came from.
    """
    if isinstance(node, ast.Assign):
        return list(node.targets), node.value
    if isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        return [node.target], node.value
    if isinstance(node, (ast.For, ast.AsyncFor)):
        return [node.target], node.iter
    if isinstance(node, (ast.With, ast.AsyncWith)):
        return (
            [item.optional_vars for item in node.items if item.optional_vars],
            node.items[0].context_expr if node.items else None,
        )
    if isinstance(node, ast.comprehension):
        return [node.target], node.iter
    return [], None


def _names_in(target: ast.expr) -> list[str]:
    return [n.id for n in ast.walk(target) if isinstance(n, ast.Name)]


def _local_bindings(func: ast.AST | None) -> dict[str, list[ast.expr]]:
    """``name -> the expressions assigned to it`` inside one function.

    Nested function bodies are walked too: a helper closure defined inside a
    test is as much the test's own as its body is, and the values it binds are
    on the same dataflow path.
    """
    bindings: dict[str, list[ast.expr]] = {}
    if func is None:
        return bindings

    def bind(name: str, value: ast.expr | None) -> None:
        slot = bindings.setdefault(name, [])
        if value is not None:
            slot.append(value)

    if isinstance(func, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        args = func.args
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
            bind(arg.arg, None)
        for extra in (args.vararg, args.kwarg):
            if extra is not None:
                bind(extra.arg, None)

    for node in ast.walk(func):
        if isinstance(node, ast.NamedExpr):
            bind(node.target.id, node.value)
            continue
        targets, value = _binding_targets(node)
        for target in targets:
            for name in _names_in(target):
                # `x, y = read()` binds both names to the same expression. That
                # is imprecise only in the direction of tracing MORE values back
                # to a read, which is the direction a gate should err in.
                bind(name, value)
    return bindings


def _enclosing_scopes(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    """``node -> the nearest enclosing function``, for every node under one."""
    owner: dict[ast.AST, ast.AST] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        for child in ast.walk(node):
            owner.setdefault(child, node)
    return owner


def module_helpers(
    tree: ast.Module,
) -> dict[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    """The module-level ``def``s of one file, by name.

    Module level only, and this file only. A helper imported from elsewhere is
    not read: the gate would then need the other file's source to say anything,
    and a rule that reaches across files is one import cycle away from being
    unauditable.
    """
    return {
        node.name: node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _closure(expr: ast.expr, bindings: dict[str, list[ast.expr]]) -> list[ast.expr]:
    """``expr`` plus the expressions assigned to every local name inside it."""
    collected: list[ast.expr] = []
    seen: set[str] = set()
    queue: list[ast.expr] = [expr]
    while queue:
        current = queue.pop()
        collected.append(current)
        for node in ast.walk(current):
            if not isinstance(node, ast.Name) or node.id in seen:
                continue
            seen.add(node.id)
            queue.extend(bindings.get(node.id, []))
    return collected


def _calls_in(nodes: list[ast.AST]) -> list[ast.Call]:
    return [n for node in nodes for n in ast.walk(node) if isinstance(n, ast.Call)]


def _docstring_nodes(nodes: list[ast.AST]) -> set[int]:
    """The `ast.Constant` nodes that are DOCSTRINGS, by identity.

    A docstring is prose, never SQL, and letting it into the literal set below
    is a false-GREEN vector rather than a cosmetic one: the WHERE test is
    ``\\bwhere\\b`` over every string in reach, so a helper whose docstring
    contains an ordinary English "where" ("Used where a test needs the raw
    table") suppresses Rule A for every assertion that reads through it. The
    read is still unfiltered; the gate just stops saying so.

    Excluding them changes nothing about today's tree — measured at 60
    findings across 286 files either way — so this closes the hole without
    moving a single ratchet row.
    """
    out: set[int] = set()
    for node in nodes:
        for n in ast.walk(node):
            if not isinstance(
                n, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
            ):
                continue
            body = getattr(n, "body", None)
            if not body:
                continue
            first = body[0]
            if (
                isinstance(first, ast.Expr)
                and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)
            ):
                out.add(id(first.value))
    return out


def _string_literals(nodes: list[ast.AST]) -> list[str]:
    """Every string in reach EXCEPT docstrings — see :func:`_docstring_nodes`."""
    docstrings = _docstring_nodes(nodes)
    return [
        n.value
        for node in nodes
        for n in ast.walk(node)
        if isinstance(n, ast.Constant)
        and isinstance(n.value, str)
        and id(n) not in docstrings
    ]


def _called_helper(
    call: ast.Call, helpers: dict[str, ast.FunctionDef | ast.AsyncFunctionDef]
) -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    if isinstance(call.func, ast.Name):
        return helpers.get(call.func.id)
    return None


# ---------------------------------------------------------------------------
# Rule A — a read whose SQL carries no WHERE
# ---------------------------------------------------------------------------


def _sql_reach(
    closure: list[ast.expr], helpers: dict[str, ast.FunctionDef | ast.AsyncFunctionDef]
) -> list[ast.AST]:
    """Every node whose string literals could be the SQL behind this value.

    The closure itself (a direct ``conn.execute(text("..."))``), plus the body
    of each same-file module-level helper it calls (the ``_job_rows(db, tenant)``
    shape, where the statement lives one call away). One level deep: a helper
    calling a helper is not followed, so the reach cannot spiral through the
    file.
    """
    reach: list[ast.AST] = []
    for call in _calls_in(list(closure)):
        if isinstance(call.func, ast.Attribute) and call.func.attr in EXECUTE_CALLS:
            reach.extend(call.args)
            reach.extend(kw.value for kw in call.keywords)
        helper = _called_helper(call, helpers)
        if helper is not None:
            reach.append(helper)
    return reach


def _is_where_clause(s: str) -> bool:
    """Does this string carry a WHERE CLAUSE, rather than the English word?

    This exists because the WHERE test below is applied over the whole dataflow
    reach, and that made ANY string carrying the word a silencer for Rule A::

        msg = "where the rows are"          # <- suppressed the rule entirely
        return conn.execute(text("SELECT id FROM coord.jobs")).all()

    which is the worst possible shape for this gate: the remediation it PRINTS
    tells the author to add a WHERE, so an author who instead adds a log line
    gets a silent green on the assertion just flagged. Docstrings were the
    first half of this hole and are excluded separately; this is the rest.

    The reach cannot simply be narrowed to the string that matched as a read.
    This suite builds SQL by ACCUMULATION — ``sql = "SELECT ..."`` then
    ``sql += " AND kind = :k"``, and f-string fragments — so SELECT and WHERE
    routinely live in different constants, and scoping the WHERE test to the
    matching string was measured at 8 false positives.

    So the test is for the CLAUSE, delegated to :data:`SQL_WHERE_CLAUSE`. An
    earlier attempt asked "is this string SQL?" instead and was wrong in both
    directions, which is why the question is framed this way: every plausible
    keyword is also an English word (``set``, ``and``, ``on``, ``order``), so
    "the row set where nothing matched" scored as SQL, while the perfectly real
    ``" WHERE is_active"`` did not.
    """
    return bool(SQL_WHERE_CLAUSE.search(s))


def _unfiltered_sql(
    closure: list[ast.expr], helpers: dict[str, ast.FunctionDef | ast.AsyncFunctionDef]
) -> str | None:
    """The offending statement, or ``None``.

    A read is unfiltered when at least one string in reach READS A TABLE
    (``select count(...)`` or ``from <schema>.<table>``) and no SQL-SHAPED
    string in reach mentions ``where`` at all. The WHERE half is deliberately
    over the whole reach rather than over the matching string alone — a helper
    that runs one scoped statement and one bare one is ambiguous, and an
    ambiguous read is not what a ratchet should be set on — but it is
    restricted to strings carrying an actual WHERE CLAUSE
    (:func:`_is_where_clause`),
    because otherwise a prose string containing "where" silences the rule.
    """
    reach = _sql_reach(closure, helpers)
    if not reach:
        return None
    literals = _string_literals(reach)
    reads = [s for s in literals if SQL_COUNT.search(s) or SQL_TABLE_REF.search(s)]
    if not reads:
        return None
    if any(_is_where_clause(s) for s in literals):
        return None
    return " ".join(reads[0].split())[:120]


# ---------------------------------------------------------------------------
# Rule B — a helper's declared discriminators, ignored at the call site
# ---------------------------------------------------------------------------


def _producing_calls(
    expr: ast.expr, bindings: dict[str, list[ast.expr]]
) -> list[ast.Call]:
    """The calls whose RETURN VALUE is ``expr`` — not the calls that fed them.

    This is the whole of Rule B's precision, and both halves of it were
    measured on this suite:

    * ARGUMENTS ARE NOT FOLLOWED. ``_own_dispatches(dispatch, sched_db)``
      derives its *argument* from ``dispatch = _patch_dispatcher(...)``, a
      helper with a keyword-only ``raises``. Following arguments blamed seven
      correct assertions on a discriminator that belongs to a different value.
    * ATTRIBUTES AND SUBSCRIPTS ARE NOT TRAVERSED. ``manager.send_terminal``
      ``.await_args_list == []`` is the CORRECT "not called" idiom; the mock
      happens to have been built by a helper with keyword-only parameters, and
      that says nothing about the attribute being read off it. So an attribute
      of a value is never the value a helper returned.

    What is left is exactly: the call itself, a call awaited, or a name bound
    directly to either.
    """
    if isinstance(expr, ast.Await):
        return _producing_calls(expr.value, bindings)
    if isinstance(expr, ast.Call):
        # A BUILTIN PASSTHROUGH is transparent. `list(_job_rows(db, t))`,
        # `sorted(...)`, `set(...)`, `tuple(...)` all return the helper's rows
        # unchanged, so the value under assertion is still the helper's. These
        # are ordinary spellings, not adversarial ones, and leaving them opaque
        # meant one wrapper silenced Rule B. Only the single-positional form is
        # followed — `sorted(rows, key=...)` still is, `list(a, b)` is not a
        # thing, and a passthrough SHADOWED by a local helper of the same name
        # is left alone, since then it is not the builtin at all.
        if (
            isinstance(expr.func, ast.Name)
            and expr.func.id in PASSTHROUGH_BUILTINS
            and len(expr.args) == 1
            and expr.func.id not in bindings
        ):
            return _producing_calls(expr.args[0], bindings)
        return [expr]
    if isinstance(expr, (ast.ListComp, ast.SetComp, ast.GeneratorExp)):
        # `[r for r in _job_rows(db, t)]` — the population is the iterable of
        # the FIRST generator; the comprehension only re-shapes it.
        if expr.generators:
            return _producing_calls(expr.generators[0].iter, bindings)
        return []
    if isinstance(expr, ast.Name):
        out: list[ast.Call] = []
        for assigned in bindings.get(expr.id, []):
            target = assigned.value if isinstance(assigned, ast.Await) else assigned
            if isinstance(target, ast.Call):
                out.append(target)
        return out
    return []


def _unused_discriminator(
    produced_by: list[ast.Call],
    helpers: dict[str, ast.FunctionDef | ast.AsyncFunctionDef],
) -> str | None:
    """``"<helper>(*, a, b)"`` when the call passed none of them, else ``None``."""
    for call in produced_by:
        helper = _called_helper(call, helpers)
        if helper is None:
            continue
        declared = [arg.arg for arg in helper.args.kwonlyargs]
        if not declared:
            continue
        passed = {kw.arg for kw in call.keywords}
        if None in passed:
            # `f(**overrides)` — the discriminators may well be in there. An
            # unknown is not a violation.
            continue
        # An EXPLICIT `None` is not a discriminator: `_job_rows(db, t,
        # input_hash=None)` is byte-equivalent to the bare call, because the
        # helper's own body is `if input_hash is not None:`. Counting it as
        # "passed" made the cheapest possible silencer — one keystroke, one
        # token away from the fix this rule prints — into a green.
        passed = {
            kw.arg
            for kw in call.keywords
            if not (isinstance(kw.value, ast.Constant) and kw.value.value is None)
        }
        if passed.isdisjoint(declared):
            return f"{helper.name}(*, {', '.join(declared)})"
    return None


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------


def _fixed_extent(node: ast.expr) -> bool:
    """An integer literal or an empty ``[]`` / ``{}`` — a hard-coded extent.

    ``True``/``False`` are ``int`` subclasses and are excluded: ``x == True``
    asserts a flag, not a population.
    """
    if isinstance(node, ast.Constant):
        return isinstance(node.value, int) and not isinstance(node.value, bool)
    if isinstance(node, ast.List):
        return not node.elts
    if isinstance(node, ast.Dict):
        return not node.keys
    return False


def _len_argument(node: ast.expr) -> ast.expr | None:
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "len"
        and len(node.args) == 1
        and not node.keywords
    ):
        return node.args[0]
    return None


def _subject(test: ast.Compare) -> tuple[ast.expr, ast.expr] | None:
    """``(subject, extent)`` of a single ``==`` against a fixed extent, or ``None``."""
    if len(test.ops) != 1 or not isinstance(test.ops[0], ast.Eq):
        return None
    left, right = test.left, test.comparators[0]
    if _fixed_extent(right) and not _fixed_extent(left):
        return left, right
    if _fixed_extent(left) and not _fixed_extent(right):
        return right, left
    # `assert 0 == 0`, and `assert len(a) == len(b)`: no extent asserted over a
    # value, so there is nothing here for either rule to read.
    return None


def find_violations(path: Path) -> list[Finding]:
    """Every assertion of the class in one file.

    Raises ``SyntaxError`` when the file will not parse — an unreadable input is
    the caller's to report as vacuous, never as a clean file.
    """
    source = path.read_text(encoding="utf-8", errors="replace")
    tree = ast.parse(source)
    helpers = module_helpers(tree)
    owner = _enclosing_scopes(tree)
    scoped: dict[int, dict[str, list[ast.expr]]] = {}
    lines = source.splitlines()
    findings: list[Finding] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Assert):
            continue
        if isinstance(node.test, ast.UnaryOp) and isinstance(node.test.op, ast.Not):
            # `assert not rows` is the idiomatic pytest spelling of
            # `assert rows == []`, and it is the SAME class member: an
            # emptiness assertion over a population. Admitting it is not a
            # widening of the rule, it is the rule reaching a spelling it was
            # blind to — this suite carries 265 `assert not ...` statements and
            # exactly one is a Rule-A member
            # (test_parkwuslug_01_park_work_unit_slug_migration.py, an
            # unfiltered `SELECT ... FROM coord.session_messages`).
            subject, extent = node.test.operand, None
        elif isinstance(node.test, ast.Compare):
            candidate = _subject(node.test)
            if candidate is None:
                continue
            subject, extent = candidate
        else:
            continue

        func = owner.get(node)
        key = id(func)
        if key not in scoped:
            scoped[key] = _local_bindings(func)
        bindings = scoped[key]

        counted = _len_argument(subject)
        value = counted if counted is not None else subject
        # `len(X) == N`, `X == []` and `X == {}` assert an extent over a
        # population. A bare `X == <int>` does not, on its own: it is as likely
        # to be a status code or a version. It is in the class only when the
        # SQL behind it is itself an aggregate, which Rule A establishes below
        # and Rule B cannot.
        population = (
            counted is not None
            or isinstance(extent, (ast.List, ast.Dict))
            # `assert not X` carries no extent node; the negation IS the
            # emptiness claim, so it is a population assertion by construction.
            or extent is None
        )

        closure = _closure(value, bindings)
        rule, detail = RULE_A, _unfiltered_sql(closure, helpers)
        if detail is not None and not population:
            reach = _sql_reach(closure, helpers)
            if not any(SQL_COUNT.search(s) for s in _string_literals(reach)):
                detail = None
        if detail is None and population:
            rule = RULE_B
            detail = _unused_discriminator(_producing_calls(value, bindings), helpers)
        if detail is None:
            continue

        text = lines[node.lineno - 1].strip() if node.lineno <= len(lines) else ""
        findings.append(Finding(node.lineno, rule, detail, text))

    findings.sort(key=lambda f: f.lineno)
    return findings


# ---------------------------------------------------------------------------
# The ratchet
# ---------------------------------------------------------------------------


def scan_files() -> list[Path]:
    if not TESTS_ROOT.is_dir():
        return []
    return sorted(
        p
        for p in TESTS_ROOT.rglob("*")
        if p.is_file()
        and p.suffix == SCAN_SUFFIX
        and "__pycache__" not in p.relative_to(TESTS_ROOT).parts
    )


def load_allowlist(path: Path) -> dict[str, int] | None:
    """Parse ``<path> <count>`` rows. ``None`` means the file is unreadable or
    malformed — the caller treats that as vacuous, never as "allow nothing"."""
    if not path.is_file():
        err(f"allowlist not found: {_rel(path)}")
        err(
            "Without it every file is allowed 0, which would fail the whole "
            "suite at once — that is a broken gate, not a finding. Regenerate "
            "it with --write-allowlist."
        )
        return None
    rows: dict[str, int] = {}
    ok = True
    for lineno, raw in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2 or not re.fullmatch(r"[0-9]+", parts[1]):
            err(f"{_rel(path)}:{lineno}: expected `<path> <count>`, got: {raw!r}")
            ok = False
            continue
        rel, count = parts[0], int(parts[1])
        if rel in rows:
            err(f"{_rel(path)}:{lineno}: duplicate row for {rel}")
            ok = False
            continue
        rows[rel] = count
    return rows if ok else None


def write_allowlist(counts: dict[str, int]) -> None:
    body = "".join(f"{rel} {n}\n" for rel, n in sorted(counts.items()) if n > 0)
    ALLOWLIST.write_text(ALLOWLIST_HEADER + body, encoding="utf-8")
    note(
        f"wrote {_rel(ALLOWLIST)}: {sum(1 for n in counts.values() if n > 0)} "
        f"row(s), {sum(counts.values())} global-state assertion(s)."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--write-allowlist",
        action="store_true",
        help="regenerate the allowlist from the current tree instead of checking",
    )
    args = parser.parse_args(argv)

    files = scan_files()
    require_nonempty(len(files), "Python test files", _rel(TESTS_ROOT))

    findings: dict[str, list[Finding]] = {}
    for path in files:
        try:
            findings[_rel(path)] = find_violations(path)
        except SyntaxError as exc:
            err(f"{_rel(path)}:{exc.lineno}: could not be parsed: {exc.msg}")
            err(
                "A file the detector cannot parse was NOT scanned, so this run "
                "proved nothing about it — an unknown, not a clean file."
            )
            return EXIT_VACUOUS
    counts = {rel: len(found) for rel, found in findings.items()}

    if args.write_allowlist:
        write_allowlist(counts)
        return 0

    allowed = load_allowlist(ALLOWLIST)
    if allowed is None:
        err("The allowlist could not be read, so this is NOT a clean result.")
        return EXIT_VACUOUS

    over: list[tuple[str, int, int]] = []
    under: list[tuple[str, int, int]] = []
    gone: list[tuple[str, int]] = []
    for rel, n in counts.items():
        cap = allowed.get(rel, 0)
        if n > cap:
            over.append((rel, cap, n))
        elif n < cap:
            under.append((rel, cap, n))
    for rel, cap in allowed.items():
        if rel not in counts:
            gone.append((rel, cap))

    total = sum(counts.values())
    listed = sum(allowed.values())

    if over or under or gone:
        err(
            f"global-state-assertion ratchet violated: {len(over)} file(s) over "
            f"their row, {len(under)} under, {len(gone)} row(s) for files that "
            "do not exist."
        )
        width = max(
            (len(r) for r, *_ in over + under) if (over or under) else [0],
            default=0,
        )
        width = max(width, *(len(r) for r, _ in gone), len("file"))
        print(f"\n  {'file':<{width}}  allowed  actual  verdict", file=sys.stderr)
        for rel, cap, n in over:
            print(
                f"  {rel:<{width}}  {cap:>7}  {n:>6}  OVER — scope the read by a "
                "discriminator the test controls: a WHERE on the test's own "
                "tenant/hash/kind, or the keyword-only argument the helper "
                "already declares",
                file=sys.stderr,
            )
        for rel, cap, n in under:
            print(
                f"  {rel:<{width}}  {cap:>7}  {n:>6}  UNDER — lower the row to "
                f"{n} (or remove it if 0) in {_rel(ALLOWLIST)}",
                file=sys.stderr,
            )
        for rel, cap in gone:
            print(
                f"  {rel:<{width}}  {cap:>7}  {'-':>6}  MISSING — the file is "
                f"gone; remove its row from {_rel(ALLOWLIST)}",
                file=sys.stderr,
            )
        if over:
            print("\nThe assertions over the row, by line:", file=sys.stderr)
            for rel, _cap, _n in over:
                for found in findings[rel]:
                    print(
                        f"  {rel}:{found.lineno}: [{found.rule}] {found.source}"
                        f"\n      -> {found.detail}",
                        file=sys.stderr,
                    )
        print(
            "\nThe allowlist is a ratchet: rows may go down or away, never up. "
            "A green here means no file asserts an exact count or an emptiness "
            "over an unscoped read more often than its row says, not that the "
            "suite has none. Plan: "
            "2026-08-31-global-state-assertion-inventory-survives-its-plan",
            file=sys.stderr,
        )
        return EXIT_VIOLATION

    note(
        f"No global-state assertion added: {total} assertion(s) remain across "
        f"{sum(1 for n in counts.values() if n > 0)} file(s), matching the "
        f"{len(allowed)}-row allowlist ({listed} allowed); scanned {len(files)} "
        f"file(s) under {_rel(TESTS_ROOT)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
