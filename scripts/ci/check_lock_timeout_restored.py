#!/usr/bin/env python3
"""Alembic lock-timeout restore gate: a bounded ``SET LOCAL lock_timeout``
must be undone in the same function that set it.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/alembic-graph-pr.yml``, step "Check lock_timeout is
    restored" — added beside the sibling-head gate because it is the same
    shape: an offline, no-database scan of
    ``backend/alembic/versions/*.py`` that must run on every PR (branch
    protection has no ``paths:`` filter to spare).
  * ``.qontinui/ci.toml``, step ``alembic-lock-timeout-restored`` — same,
    locally.
  * ``.pre-commit-config.yaml``, hook ``alembic-lock-timeout-restored`` —
    the shift-left lane, on commits touching
    ``backend/alembic/versions/``.

Why this gate exists
=====================

``backend/alembic/env.py`` wraps an entire ``upgrade head`` (or a multi-step
``downgrade``) in ONE transaction — ``context.begin_transaction()`` around
``context.run_migrations()``, with no ``transaction_per_migration``. Postgres
scopes ``SET LOCAL`` to the transaction, not to the statement or the
revision, so a revision that bounds a DDL's lock wait with
``SET LOCAL lock_timeout = '3s'`` and never restores it imposes that same 3
second ceiling on every OTHER revision's DDL that runs later in the same
batch — most commonly a fresh-database build, where many revisions apply in
one shot.

Measured 2026-09-20 (coord finding ``b4782f88-49f2-464e-92f9-4f44194dee34``,
surfaced while reviewing qontinui-web#1423): 18 of the revisions in this tree
bound a lock wait this way, and only 4 also restored it. #1423 fixed its own
revision and documented the convention; this gate is the durable half that
finding called for — "without it the convention stays at 4 of 18." This
session (post-merge follow-up on #1423) fixed the remaining offenders and
added this check so a new one cannot land unrestored again.

What it scans
-------------

Offline, by AST (``ast.parse``) — it never imports ``env.py`` or a revision
module, which would pull in qontinui-web's whole app. For every ``upgrade()``
and ``downgrade()`` function (module-level, in every file under
``backend/alembic/versions/``), it walks the function body for
``op.execute(<string literal>)`` calls and classifies each by the literal's
text:

  * a **set**: the string starts with ``SET LOCAL lock_timeout =`` and is
    NOT the literal restore value ``DEFAULT``;
  * a **restore**: the string is ``SET LOCAL lock_timeout = DEFAULT`` (any
    quoting) or ``RESET lock_timeout`` — both conventions are in live use in
    this tree and are equally valid; Postgres treats them identically.

A function is a violation when it contains more sets than restores. This is
a count, not a strict pairing: a function that sets once and restores once is
fine regardless of what else runs in between (including an
``op.get_context().autocommit_block()``, which itself ends the enclosing
transaction and would discharge an unrestored ``SET LOCAL`` early — but this
gate does not special-case that, on purpose. Relying on an autocommit block's
side effect to discharge the setting is fragile against a later edit that
reorders statements or removes the block, and the whole point of a textual
gate is to make the invariant checkable without reasoning about control
flow. Restore explicitly, always, in the same function.

A ``SET LOCAL`` (or restore) built from an f-string or any non-literal
expression is invisible to this scan and is reported as ``unparsed`` rather
than silently ignored, because a gate that can't see a statement must never
count it as compliant.

Exit codes: 0 no revision under-restores its lock-timeout bound (or no
revision touches ``lock_timeout`` at all — a legitimate pass, not a vacuous
one, since the revision *file set* was non-empty), 1 at least one function
sets more times than it restores, 2 the scan proved nothing (no revision
files found under ``backend/alembic/versions/`` at all, or a file failed to
parse).
"""

from __future__ import annotations

import argparse
import ast
import sys
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

_SET_PREFIX = "SET LOCAL lock_timeout ="
_RESTORE_DEFAULT = "SET LOCAL lock_timeout = DEFAULT"
_RESTORE_RESET = "RESET lock_timeout"


@dataclass
class FunctionFinding:
    path: Path
    func_name: str
    lineno: int
    sets: int = 0
    restores: int = 0
    unparsed: list[int] = field(default_factory=list)

    @property
    def violated(self) -> bool:
        return self.sets > self.restores


def _mentions_lock_timeout(node: ast.AST) -> bool:
    """Best-effort: does this non-literal argument LOOK lock_timeout-shaped?

    Used only to decide whether an argument this gate cannot fully resolve
    (an f-string, a module-level template reference) is worth flagging as
    "unparsed" for a human to check. Every call site actually setting or
    restoring ``lock_timeout`` in this tree today uses a single plain string
    literal, so this is deliberately narrow: an f-string is inspected for the
    substring in its literal fragments, and a ``Name``/``Attribute`` is
    inspected by its own identifier text. Neither resolves the value, so a
    template variable that OBSCURES the word ``lock_timeout`` behind an
    unrelated name would slip past silently — the same failure-open shape as
    the rest of this gate's "unparsed" reporting, spelled out rather than
    left implicit.
    """
    if isinstance(node, ast.JoinedStr):
        return any(
            isinstance(v, ast.Constant)
            and isinstance(v.value, str)
            and "lock_timeout" in v.value.lower()
            for v in node.values
        )
    if isinstance(node, ast.Name):
        return "lock_timeout" in node.id.lower()
    if isinstance(node, ast.Attribute):
        return "lock_timeout" in node.attr.lower()
    return False


def _literal_sql(node: ast.Call) -> str | None:
    """The string argument of ``op.execute(...)``, if it is a plain literal.

    Only handles the shape this tree actually uses for a lock_timeout
    set/restore: a single ``ast.Constant`` string argument, optionally
    triple-quoted. Anything else (an f-string, a name, a call) is NOT
    resolved — resolving it would mean evaluating arbitrary module state,
    which this gate does not do — and is reported as "unparsed" only when
    :func:`_mentions_lock_timeout` says it plausibly concerns lock_timeout at
    all; the overwhelming majority of ``op.execute`` calls in this tree are
    unrelated DDL/DML and would otherwise drown every real finding in noise.
    """
    if not (isinstance(node.func, ast.Attribute) and node.func.attr == "execute"):
        return None
    if not (isinstance(node.func.value, ast.Name) and node.func.value.id == "op"):
        return None
    if not node.args:
        return None
    first = node.args[0]
    if isinstance(first, ast.Constant) and isinstance(first.value, str):
        return first.value
    if _mentions_lock_timeout(first):
        return "__UNPARSED__"
    return None


def _classify(sql: str) -> str | None:
    """ "set" / "restore" / None (unrelated to lock_timeout)."""
    text = " ".join(sql.split())
    if text.startswith(_RESTORE_DEFAULT) or text.startswith(_RESTORE_RESET):
        return "restore"
    if text.startswith(_SET_PREFIX):
        return "set"
    return None


def scan_function(path: Path, func: ast.FunctionDef) -> FunctionFinding | None:
    finding = FunctionFinding(path=path, func_name=func.name, lineno=func.lineno)
    touched = False
    for node in ast.walk(func):
        if not isinstance(node, ast.Call):
            continue
        sql = _literal_sql(node)
        if sql is None:
            continue
        if sql == "__UNPARSED__":
            # Only worth flagging if this call is plausibly an
            # `op.execute` on something lock_timeout-shaped; we cannot tell
            # without resolving it, so record the site and let the human
            # judge. This keeps the common case (module-level SQL templates
            # unrelated to lock_timeout) quiet.
            finding.unparsed.append(node.lineno)
            continue
        kind = _classify(sql)
        if kind == "set":
            finding.sets += 1
            touched = True
        elif kind == "restore":
            finding.restores += 1
            touched = True
    if not touched and not finding.unparsed:
        return None
    return finding


def scan_file(path: Path) -> tuple[list[FunctionFinding], str | None]:
    try:
        source = path.read_text()
    except OSError as exc:
        return [], f"could not read {repo_relative(path)}: {exc}"
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        return [], f"could not parse {repo_relative(path)}: {exc}"
    findings: list[FunctionFinding] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name in ("upgrade", "downgrade"):
            found = scan_function(path, node)
            if found is not None:
                findings.append(found)
    return findings, None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    versions_dir = REPO_ROOT / VERSIONS_DIR
    files = sorted(versions_dir.glob("*.py")) if versions_dir.is_dir() else []
    require_nonempty(
        len(files), "alembic revision file(s)", repo_relative(versions_dir)
    )

    violations: list[FunctionFinding] = []
    scan_errors: list[str] = []
    files_with_unparsed: list[FunctionFinding] = []

    for path in files:
        findings, scan_error = scan_file(path)
        if scan_error:
            scan_errors.append(scan_error)
            continue
        for finding in findings:
            if finding.unparsed:
                files_with_unparsed.append(finding)
            if finding.violated:
                violations.append(finding)

    if scan_errors:
        for message in scan_errors:
            err(message)
        return EXIT_VACUOUS

    if files_with_unparsed:
        note(
            f"{len(files_with_unparsed)} function(s) call `op.execute` with a "
            "non-literal argument this gate cannot read; listed for a human "
            "to check, not counted as a violation:"
        )
        for finding in files_with_unparsed:
            note(
                f"  - {repo_relative(finding.path)}:{finding.func_name} "
                f"(line(s) {', '.join(str(n) for n in finding.unparsed)})"
            )

    if violations:
        err(
            f"{len(violations)} alembic function(s) call "
            "`SET LOCAL lock_timeout = '<value>'` more times than they restore it "
            "(`SET LOCAL lock_timeout = DEFAULT` or `RESET lock_timeout`) in the "
            "same function:"
        )
        for finding in violations:
            err(
                f"  - {repo_relative(finding.path)}:{finding.lineno} "
                f"{finding.func_name}() — sets={finding.sets} restores={finding.restores}"
            )
        err(
            "\n"
            "Why this blocks: env.py runs the whole upgrade/downgrade batch in "
            "ONE transaction, and Postgres scopes SET LOCAL to the transaction "
            "— an unrestored bound silently caps the lock wait of every "
            "revision that runs after this one in the same batch (typically a "
            "fresh-database build). Add "
            '`op.execute("SET LOCAL lock_timeout = DEFAULT")` (or '
            '`op.execute("RESET lock_timeout")`) as the last statement in the '
            "same function, after the DDL it bounds."
        )
        return EXIT_VIOLATION

    note(
        f"scanned {len(files)} alembic revision file(s): every bounded lock wait is restored."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
