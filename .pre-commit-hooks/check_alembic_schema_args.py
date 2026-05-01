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

Not gated: execute (raw SQL — out of scope; use search_path prefix or
schema-qualified table names directly). The Phase 7 revisions
themselves are exclusively ``op.execute()``-driven for the same reason
this gate intentionally skips them.

Exit code: 0 = all clean; 1 = at least one violation.
"""

from __future__ import annotations

import ast
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
        op_name = _is_op_call(node)
        if op_name is None:
            continue

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
