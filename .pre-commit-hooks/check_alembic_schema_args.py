"""Pre-commit / CI gate: alembic ops must specify ``schema=``.

Walks alembic revision files (``backend/alembic/versions/*.py``) and
verifies every DDL ``op.<func>(...)`` call carries an explicit ``schema=``
keyword argument with one of the canonical schemas:

    project, coord, agent, auth, cloud

The ``cloud`` schema was added per the cloud-control carve-out
(tmp_cloud_control_carve_out.md §5).
Plan reference: ``D:/qontinui-root/tmp_migration_consolidation_plan.md``
Phase 6.

Why this gate exists:
Without an explicit ``schema=``, alembic ops default to whatever
``search_path`` happens to be set to at apply time — usually
``public``. Post-Phase-7, ``public`` contains only ``alembic_version``
(alembic's own bookkeeping) and every domain table belongs in one of
the canonical schemas above. A missing ``schema=`` argument is almost
always a bug, not a deliberate ``public`` placement.

The previous ALLOWED_SCHEMAS set included ``"public"`` because Phase 7
hadn't run yet (and pre-Phase-7 revisions still referenced ``public.*``
implicitly via the search_path default). With Phase 7 complete and
``public`` drained to a single bookkeeping table, ``public`` is no
longer a legitimate target schema for new ops — drop it.

Gated ops: create_table, add_column, alter_column, drop_column,
drop_table, create_index, drop_index, create_foreign_key,
drop_constraint, create_unique_constraint, create_check_constraint,
rename_table, batch_alter_table.

Raw SQL inside ``op.execute("…")``: also gated, with a regex-based
audit of CREATE / ALTER / DROP / REFERENCES / INDEX-ON statements.
Closes the f9d3e8a4c1b6 / add_arq_job_id_to_training_jobs class of
bugs (2026-05-07 incident: an unqualified ``CREATE TABLE
regression_suites`` and ``op.add_column("training_jobs", …)`` without
``schema="project"`` silently broke the canonical migrator).

The raw-SQL audit accepts ``public`` as a valid schema (Phase 7
revisions legitimately reference ``public.<table>`` while moving
tables out of public). The forbid-public-schema CI workflow is the
backstop that prevents NEW domain references to ``public.*``; this
gate only enforces "DDL must name a schema, any allowed schema."

Pre-commit invokes this script with the changed-file list, so the
raw-SQL audit only runs on migrations actually being modified —
already-applied raw-SQL revisions are not re-audited unless the
author touches them.

Exit code: 0 = all clean; 1 = at least one violation.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

GATED_OPS = {
    "create_table",
    "add_column",
    "alter_column",
    "drop_column",
    "drop_table",
    "create_index",
    "drop_index",
    "create_foreign_key",
    "drop_constraint",
    "create_unique_constraint",
    "create_check_constraint",
    "rename_table",
    "batch_alter_table",
}

ALLOWED_SCHEMAS = {"project", "coord", "agent", "auth", "cloud"}

# Schemas accepted by the raw-SQL audit. ``public`` is included here
# (and only here) because Phase 7 revisions legitimately reference
# ``public.<table>`` while moving tables out of public — the
# forbid-public-schema CI workflow guards against NEW public refs;
# this gate only requires DDL to name *some* allowed schema.
RAW_SQL_ALLOWED_SCHEMAS = ALLOWED_SCHEMAS | {"public"}

# Identifiers the raw-SQL audit accepts unqualified. ``alembic_version``
# is alembic's own bookkeeping table — it's intrinsically in
# ``public`` and migrations that touch it conventionally don't
# schema-qualify (alembic itself doesn't either). Add to this set
# only for similarly-intrinsic identifiers.
RAW_SQL_UNQUALIFIED_OK = {"alembic_version"}

# Regexes for the raw-SQL audit. Each pattern captures the table
# identifier in named group ``ident``. Identifiers may be unqualified
# (``foo``), schema-qualified (``project.foo``), or quoted
# (``"project"."foo"`` / ``"foo"``). The audit accepts any of those
# shapes that names an allowed schema.
#
# Comments are stripped before matching. Patterns are deliberately
# conservative — we'd rather miss a weird construction than false-
# flag a working migration.
_IDENT = r'(?:"[^"]+"|\w+)'  # bare or double-quoted identifier
_QUALIFIED_IDENT = rf'(?:{_IDENT}\s*\.\s*{_IDENT})'  # schema.table form

_DDL_PATTERNS = [
    # CREATE TABLE [IF NOT EXISTS] <name> (
    (
        "CREATE TABLE",
        re.compile(
            r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?P<ident>"
            + _IDENT
            + r"(?:\s*\.\s*"
            + _IDENT
            + r")?)",
            re.IGNORECASE,
        ),
    ),
    # ALTER TABLE [ONLY] <name>
    (
        "ALTER TABLE",
        re.compile(
            r"\bALTER\s+TABLE\s+(?:ONLY\s+)?(?P<ident>"
            + _IDENT
            + r"(?:\s*\.\s*"
            + _IDENT
            + r")?)",
            re.IGNORECASE,
        ),
    ),
    # DROP TABLE [IF EXISTS] <name>
    (
        "DROP TABLE",
        re.compile(
            r"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?P<ident>"
            + _IDENT
            + r"(?:\s*\.\s*"
            + _IDENT
            + r")?)",
            re.IGNORECASE,
        ),
    ),
    # CREATE [UNIQUE] INDEX [IF NOT EXISTS] <idxname> ON [ONLY] <table>
    (
        "INDEX ON",
        re.compile(
            r"\bON\s+(?:ONLY\s+)?(?P<ident>"
            + _IDENT
            + r"(?:\s*\.\s*"
            + _IDENT
            + r")?)\s*(?:\(|USING\b)",
            re.IGNORECASE,
        ),
    ),
    # REFERENCES <name>(col) — inline FK in CREATE TABLE / ALTER TABLE.
    (
        "REFERENCES",
        re.compile(
            r"\bREFERENCES\s+(?P<ident>"
            + _IDENT
            + r"(?:\s*\.\s*"
            + _IDENT
            + r")?)\s*\(",
            re.IGNORECASE,
        ),
    ),
]


def _strip_sql_comments(sql: str) -> str:
    """Strip ``--`` line comments and ``/* … */`` block comments so the
    DDL regexes don't match inside commentary."""
    # Block comments first (greedy-non-greedy combo + DOTALL).
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    # Line comments (-- to end of line).
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def _ident_schema(ident: str) -> str | None:
    """Return the schema part of ``ident`` if schema-qualified.

    Identifiers are normalised by stripping double quotes and
    surrounding whitespace. Returns None for an unqualified identifier
    (no dot)."""
    cleaned = ident.strip()
    if "." not in cleaned:
        return None
    schema_raw = cleaned.split(".", 1)[0].strip()
    if schema_raw.startswith('"') and schema_raw.endswith('"'):
        schema_raw = schema_raw[1:-1]
    return schema_raw


def _check_raw_sql(call: ast.Call) -> list[tuple[int, str]]:
    """Audit raw SQL inside an ``op.execute("…")`` call.

    Returns a list of ``(lineno, message)`` violations. Skips calls
    whose arg is non-literal (e.g. computed at runtime via
    ``sa.text(...)`` with bound params) — those need manual review."""
    if not call.args:
        return []
    first = call.args[0]
    # Plain string literal.
    if isinstance(first, ast.Constant) and isinstance(first.value, str):
        sql = first.value
    else:
        # Computed / dynamic SQL — skip silently. Pre-commit can't
        # statically analyse runtime values without false positives.
        return []

    body = _strip_sql_comments(sql)
    violations: list[tuple[int, str]] = []
    seen: set[tuple[int, str, str]] = set()
    for label, pattern in _DDL_PATTERNS:
        for m in pattern.finditer(body):
            ident = m.group("ident")
            schema = _ident_schema(ident)
            if schema is None:
                bare = ident.strip().strip('"')
                if bare in RAW_SQL_UNQUALIFIED_OK:
                    continue
                key = (call.lineno, label, ident.strip())
                if key in seen:
                    continue
                seen.add(key)
                violations.append(
                    (
                        call.lineno,
                        f"op.execute(...) raw SQL: {label} references unqualified "
                        f"identifier {ident.strip()!r}; schema-qualify it (one of: "
                        f"{sorted(RAW_SQL_ALLOWED_SCHEMAS)})",
                    )
                )
            elif schema not in RAW_SQL_ALLOWED_SCHEMAS:
                key = (call.lineno, label, ident.strip())
                if key in seen:
                    continue
                seen.add(key)
                violations.append(
                    (
                        call.lineno,
                        f"op.execute(...) raw SQL: {label} references "
                        f"{ident.strip()!r} in schema {schema!r} — not in allowed "
                        f"set {sorted(RAW_SQL_ALLOWED_SCHEMAS)}",
                    )
                )
    return violations


def _is_op_execute_call(call: ast.Call) -> bool:
    """Return True if ``call`` is ``op.execute(...)``."""
    func = call.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        return func.value.id == "op" and func.attr == "execute"
    return False


def _is_op_call(call: ast.Call) -> str | None:
    """Return the op function name (e.g. ``"create_table"``) if ``call``
    is ``op.<name>(...)``, else None."""
    func = call.func
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        if func.value.id == "op" and func.attr in GATED_OPS:
            return func.attr
    return None


def _schema_kwarg_value(call: ast.Call) -> str | None | object:
    """Return the value of ``schema=...`` if present.

    - If the kwarg is missing entirely, return the sentinel ``MISSING``.
    - If present with a string literal, return that string.
    - If present but non-literal (e.g. a variable), return the sentinel
      ``DYNAMIC`` so the caller can flag it for manual review without
      falsely failing.
    """
    for kw in call.keywords:
        if kw.arg == "schema":
            if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                return kw.value.value
            return DYNAMIC
    return MISSING


MISSING = object()
DYNAMIC = object()


def check_file(path: Path) -> list[str]:
    """Return a list of violation messages for ``path`` (empty if clean)."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError as exc:
        return [f"{path}: SyntaxError: {exc}"]

    violations: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        # 1. op.<gated_func>(..., schema=...) kwarg gate.
        op_name = _is_op_call(node)
        if op_name is not None:
            schema_value = _schema_kwarg_value(node)
            if schema_value is MISSING:
                violations.append(
                    f"{path}:{node.lineno}: op.{op_name}(...) missing schema= argument; "
                    f"specify one of: {sorted(ALLOWED_SCHEMAS)}"
                )
            elif schema_value is DYNAMIC:
                # Computed schema= (e.g. via a variable). Allow but note.
                # Comment out next line if you want to enforce literals only.
                pass
            elif schema_value not in ALLOWED_SCHEMAS:
                violations.append(
                    f"{path}:{node.lineno}: op.{op_name}(..., schema={schema_value!r}) — "
                    f"not in allowed set {sorted(ALLOWED_SCHEMAS)}"
                )
            continue

        # 2. op.execute("...") raw-SQL gate.
        if _is_op_execute_call(node):
            for lineno, msg in _check_raw_sql(node):
                violations.append(f"{path}:{lineno}: {msg}")
    return violations


SCOPED_DIRS = (
    # Post-transplant scope: every alembic revision lives in versions/
    # now. Pre-consolidation revisions still use unqualified table
    # names that resolve to `public` via search_path; the gate accepts
    # `public` (in ALLOWED_SCHEMAS) so existing files don't false-
    # positive. New PRs that add canonical-schema ops must pass the
    # gate. The previous `_staged_consolidation/`-only scope predated
    # the transplant; that directory no longer exists post-transplant.
    Path("backend/alembic/versions"),
)


def _is_in_scope(path: Path) -> bool:
    """Return True if ``path`` is under one of the gated alembic dirs."""
    try:
        resolved = path.resolve()
    except OSError:
        return False
    for d in SCOPED_DIRS:
        try:
            resolved.relative_to(d.resolve())
            return True
        except (ValueError, OSError):
            continue
    return False


def main(argv: list[str]) -> int:
    if len(argv) <= 1:
        # No paths given (manual run): scan the in-scope dirs.
        files = [
            p
            for root in SCOPED_DIRS
            if root.is_dir()
            for p in root.glob("*.py")
            if p.name != "__init__.py"
        ]
    else:
        # Pre-commit passes the changed files. Filter to in-scope only.
        files = [Path(p) for p in argv[1:] if _is_in_scope(Path(p))]

    all_violations: list[str] = []
    for f in files:
        if not f.exists():
            continue
        all_violations.extend(check_file(f))

    if all_violations:
        print("alembic schema= gate failed:", file=sys.stderr)
        for v in all_violations:
            print(f"  {v}", file=sys.stderr)
        print(
            f"\n{len(all_violations)} violation(s). "
            f"Add an explicit schema= argument or fix the value.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
