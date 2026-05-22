#!/usr/bin/env python3
"""Drift guard for the dev-credentials single source of truth.

`dev-credentials.json` (repo root) is the ONE place the local dev
credentials are defined. `backend/app/core/test_credentials.py` (Python)
and `frontend/tests/e2e/test-credentials.ts` (TypeScript) both read it at
runtime, so they cannot drift from it.

This guard fails CI when that discipline is broken:
  1. The JSON is missing or missing required keys.
  2. A consumer stops referencing the JSON (i.e. someone re-hardcoded).
  3. The current password value is hardcoded in any git-tracked file
     other than the JSON itself.
  4. A retired password literal (e.g. the old "dev123") still lingers in
     any git-tracked file.

Scope is the qontinui-web repo (the JSON lives here). Sibling repos
(qontinui-runner, ui-bridge) read the value via env with this JSON's
value as the documented default; they are not scanned here.

stdlib-only, no app dependencies — runs in a bare `python` step.
Exit 0 = clean, 1 = drift detected.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
CREDENTIALS_PATH = REPO_ROOT / "dev-credentials.json"
REQUIRED_KEYS = ("email", "username", "password", "is_superuser", "is_verified")

# Consumers that MUST read the JSON rather than define their own literal.
CONSUMERS = (
    REPO_ROOT / "backend" / "app" / "core" / "test_credentials.py",
    REPO_ROOT / "frontend" / "tests" / "e2e" / "test-credentials.ts",
)

# Passwords retired over time. Any lingering occurrence is drift.
RETIRED_PASSWORDS = ("dev123",)

# Files allowed to contain a password literal (the source of truth + this guard).
ALLOWLIST = {
    CREDENTIALS_PATH.relative_to(REPO_ROOT).as_posix(),
    Path(__file__).resolve().relative_to(REPO_ROOT).as_posix(),
}


def fail(msg: str) -> None:
    print(f"  [DRIFT] {msg}")


def git_tracked_files() -> list[Path]:
    """Git-tracked files only — gitignored .env.local / runner .env are skipped."""
    out = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [REPO_ROOT / line for line in out.stdout.splitlines() if line.strip()]


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None  # binary or unreadable — nothing to scan


def main() -> int:
    problems = 0

    # 1. JSON present + well-formed.
    if not CREDENTIALS_PATH.exists():
        fail(f"single source missing: {CREDENTIALS_PATH}")
        return 1
    try:
        creds = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"dev-credentials.json is not valid JSON: {e}")
        return 1
    missing = [k for k in REQUIRED_KEYS if k not in creds]
    if missing:
        fail(f"dev-credentials.json missing keys: {', '.join(missing)}")
        problems += 1

    password = creds.get("password", "")

    # 2. Consumers must reference the JSON.
    for consumer in CONSUMERS:
        text = read_text(consumer)
        if text is None:
            fail(f"consumer missing/unreadable: {consumer}")
            problems += 1
        elif "dev-credentials.json" not in text:
            fail(
                f"{consumer.relative_to(REPO_ROOT).as_posix()} no longer reads "
                "dev-credentials.json — read the single source, do not hardcode"
            )
            problems += 1

    # 3 & 4. Scan tracked files for hardcoded current / retired passwords.
    forbidden = {p for p in (password, *RETIRED_PASSWORDS) if p}
    for path in git_tracked_files():
        rel = path.relative_to(REPO_ROOT).as_posix()
        if rel in ALLOWLIST:
            continue
        text = read_text(path)
        if text is None:
            continue
        for literal in forbidden:
            if literal in text:
                kind = "current password" if literal == password else "retired password"
                fail(f"{rel} hardcodes a {kind} literal ({literal!r})")
                problems += 1

    if problems:
        print(f"\nDev-credentials drift check FAILED ({problems} problem(s)).")
        print("Fix: read credentials from dev-credentials.json; never hardcode.")
        return 1

    print("Dev-credentials drift check passed: single source intact.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
