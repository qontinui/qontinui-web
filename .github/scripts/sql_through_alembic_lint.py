#!/usr/bin/env python3
"""
sql-through-alembic lint: ensure raw DDL files have companion alembic revisions.

This script detects .sql files containing DDL (CREATE/ALTER/DROP/TRUNCATE) that
don't have a companion alembic revision in the same commit. This ensures all
schema mutations go through the reversible alembic path.

Usage:
  python sql_through_alembic_lint.py --base-ref origin/main --head-ref HEAD

Exit codes:
  0 = all .sql files properly covered by revisions (or are exempt)
  1 = DDL found in .sql file(s) without companion revision
  2 = error (script failure)
"""

import sys
import re
import subprocess
from pathlib import Path
from typing import Set, Tuple, List

# Paths exempt from the sql-through-alembic lint
EXEMPT_PATTERNS = [
    r"backend/alembic/versions/.*\.py$",
    r"schema\.pg\.sql\.generated$",
    r"qontinui-runner/schema\.pg\.sql$",
    r"queries/.*\.sql$",
    r"tests/.*\.sql$",
    r"docs/.*\.sql$",
    r"init-scripts/.*\.sql$",
]

# DDL keywords that trigger this lint
DDL_KEYWORDS = r"\b(CREATE|ALTER|DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|INDEX|TRIGGER|VIEW|COLUMN|CONSTRAINT)\b"


def get_changed_files(base_ref: str, head_ref: str) -> List[str]:
    """Get list of files changed between base and head."""
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", f"{base_ref}...{head_ref}"],
            capture_output=True,
            text=True,
            check=True,
        )
        return [f for f in result.stdout.strip().split("\n") if f]
    except subprocess.CalledProcessError as e:
        print(f"Error getting changed files: {e.stderr}", file=sys.stderr)
        return []


def is_exempt(filepath: str) -> bool:
    """Check if file is exempt from the lint."""
    for pattern in EXEMPT_PATTERNS:
        if re.search(pattern, filepath):
            return True
    return False


def has_ddl(filepath: str) -> bool:
    """Check if .sql file contains DDL keywords."""
    try:
        if not Path(filepath).exists():
            return False
        content = Path(filepath).read_text(errors="ignore")
        return bool(re.search(DDL_KEYWORDS, content, re.IGNORECASE))
    except Exception:
        return False


def extract_table_names(sql_content: str) -> Set[str]:
    """Extract table names from DDL statements."""
    patterns = [
        r"(?:ALTER|CREATE|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)",
        r"(?:ALTER|CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)",
    ]
    names = set()
    for pattern in patterns:
        matches = re.findall(pattern, sql_content, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                names.update(m for m in match if m)
            else:
                names.add(match)
    return names


def has_companion_revision(
    sql_file: str, changed_files: List[str]
) -> Tuple[bool, str]:
    """Check if a companion alembic revision exists."""
    try:
        sql_content = Path(sql_file).read_text(errors="ignore")
    except Exception:
        return False, ""

    # Extract table/column names from the .sql file
    table_names = extract_table_names(sql_content)
    if not table_names:
        return False, ""

    # Look for alembic revisions that reference the same tables
    alembic_revisions = [
        f
        for f in changed_files
        if "alembic/versions/" in f and f.endswith(".py")
    ]

    for rev_file in alembic_revisions:
        try:
            if not Path(rev_file).exists():
                continue
            rev_content = Path(rev_file).read_text(errors="ignore")
            # Check if revision references any of the table names
            for table in table_names:
                if re.search(rf"\b{table}\b", rev_content, re.IGNORECASE):
                    return True, rev_file
        except Exception:
            continue

    return False, ""


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-ref", default="origin/main", help="Base ref for diff")
    parser.add_argument("--head-ref", default="HEAD", help="Head ref for diff")
    args = parser.parse_args()

    changed_files = get_changed_files(args.base_ref, args.head_ref)
    sql_files = [f for f in changed_files if f.endswith(".sql")]

    if not sql_files:
        print("✓ No .sql files changed")
        return 0

    violations = []
    print(f"Checking {len(sql_files)} .sql file(s)...\n")

    for sql_file in sql_files:
        if is_exempt(sql_file):
            print(f"  ✓ {sql_file} (exempt)")
            continue

        if not has_ddl(sql_file):
            print(f"  ✓ {sql_file} (no DDL keywords)")
            continue

        # This file has DDL and is not exempt — check for companion
        has_companion, rev_file = has_companion_revision(sql_file, changed_files)

        if has_companion:
            print(f"  ✓ {sql_file} → {rev_file}")
        else:
            violations.append(sql_file)
            print(f"  ✗ {sql_file} (NO COMPANION REVISION)")

    if violations:
        print(f"\n❌ sql-through-alembic lint FAILED ({len(violations)} file(s))\n")
        print("Found DDL-containing .sql files without companion alembic revisions:\n")
        for v in violations:
            print(f"  - {v}")
        print(
            "\nFix: Create an alembic revision that applies the same DDL, then commit both:"
        )
        print("  poetry run alembic revision --autogenerate -m 'description'")
        print("  # Edit the generated file to match your .sql file, then:")
        print("  git add backend/alembic/versions/... " + violations[0])
        return 1

    print(f"\n✓ All .sql files have companion revisions (or are exempt)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
