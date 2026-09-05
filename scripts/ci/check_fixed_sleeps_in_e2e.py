#!/usr/bin/env python3
"""No fixed sleep may be ADDED to the Playwright E2E suite — a per-file ratchet.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/forbid-fixed-sleeps-in-e2e.yml``, step
    "Count fixed sleeps in frontend/tests/e2e against the allowlist"
  * ``.qontinui/ci.toml``, step ``forbid-fixed-sleeps-in-e2e``
  * ``.pre-commit-config.yaml``, hook ``forbid-fixed-sleeps-in-e2e``

Plan ``2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time``, Phase 1.

WHAT IT FORBIDS: a ``waitForTimeout(`` call under ``frontend/tests/e2e/`` in
any file beyond the count that file is allowed in
``frontend/tests/e2e/.fixed-sleeps-allowlist``. A file with no row is allowed
zero. ``page.waitForTimeout(N)`` sleeps for exactly N ms and then the test
reads the page with ``locator.count()``, which does not auto-wait — so a page
that renders at N+100 ms fails a test that passes at N-100 ms. That is an
assertion on wall-clock, not on state; on 2026-09-05 it red-mained ``main``
(run 33950897170, ``configure.spec.ts:70``) on a land that never touched the
page under test. Playwright's auto-waiting assertions (``toBeVisible``,
``toHaveCount``, ``toContainText``) are the replacement: they poll until the
condition holds or the timeout elapses, so a slow page costs seconds instead
of a red.

THE ALLOWLIST IS A RATCHET, matched EXACTLY — the same posture as
qontinui-runner's ``scripts/untimed-subprocess-baseline.json``:

  * a file whose actual count EXCEEDS its row (or has no row)  -> violation
  * a file whose actual count is BELOW its row                 -> violation
    ("lower the row"): a stale row is a hole the count can silently climb
    back into, so converting a file and leaving its row alone is refused. A
    conversion PR edits the spec file and its row in the same commit.
  * a row for a file that no longer exists                     -> violation
    ("remove the row"), same reason.

So the allowlist can only shrink, and a green means "no file carries more
fixed sleeps than it did when the ratchet was set" — nothing more. It does
not mean the suite is free of them; the rows say how many remain, per file.

WHAT COUNTS: every occurrence of ``waitForTimeout(`` on a line that is not a
comment (a line whose first non-blank characters are ``//``, ``*`` or ``/*``
is skipped — ``captures-recordings.spec.ts`` documents the idiom it removed
in a doc comment, and that is not a sleep). A commented-OUT sleep inside a
block comment that does not start its line with ``*`` still counts; that is
conservative in the direction that matters. Scanned suffixes are ``.ts``,
``.tsx``, ``.js`` and ``.mjs``; ``fixtures.ts``, ``auth.setup.ts`` and the
helpers count like any spec — a sleep in a fixture is paid by every test
that uses it.

``--write-allowlist`` regenerates the file from the current tree (rows for
every file with a non-zero count, sorted by path). It exists to set the
ratchet and to lower it after a conversion; the gate never runs it.

Exit codes: 0 clean, 1 at least one file is over, under or missing relative
to its row, 2 the scan proved nothing (no files under the E2E root, an
unreadable allowlist) — vacuous, not a pass.
"""

from __future__ import annotations

import argparse
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

E2E_ROOT = REPO_ROOT / "frontend" / "tests" / "e2e"
ALLOWLIST = E2E_ROOT / ".fixed-sleeps-allowlist"
SCAN_SUFFIXES = (".ts", ".tsx", ".js", ".mjs")
SLEEP_CALL = re.compile(r"\bwaitForTimeout\(")
COMMENT_PREFIXES = ("//", "*", "/*")

ALLOWLIST_HEADER = """\
# Fixed-sleep ratchet for frontend/tests/e2e — read by
# scripts/ci/check_fixed_sleeps_in_e2e.py (workflow
# forbid-fixed-sleeps-in-e2e.yml). One row per file that still calls
# `waitForTimeout(`: `<repo-relative path> <count>`. A file with no row is
# allowed 0. Rows are matched EXACTLY: a PR may lower a count or remove a
# row, never raise one — and a converted file must lower its row in the
# same commit, or the gate fails with "lower the row". Regenerate with
# `python scripts/ci/check_fixed_sleeps_in_e2e.py --write-allowlist`.
# Plan: 2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time
"""


def _rel(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def scan_files() -> list[Path]:
    if not E2E_ROOT.is_dir():
        return []
    return sorted(
        p
        for p in E2E_ROOT.rglob("*")
        if p.is_file()
        and p.suffix in SCAN_SUFFIXES
        and "node_modules" not in p.relative_to(E2E_ROOT).parts
    )


def count_fixed_sleeps(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    total = 0
    for line in text.splitlines():
        if line.lstrip().startswith(COMMENT_PREFIXES):
            continue
        total += len(SLEEP_CALL.findall(line))
    return total


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
        if len(parts) != 2 or not parts[1].isdigit():
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
        f"row(s), {sum(counts.values())} fixed sleep(s)."
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
    require_nonempty(len(files), "TypeScript/JavaScript files", _rel(E2E_ROOT))
    counts = {_rel(p): count_fixed_sleeps(p) for p in files}

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
            f"fixed-sleep ratchet violated: {len(over)} file(s) over their row, "
            f"{len(under)} under, {len(gone)} row(s) for files that do not exist."
        )
        width = max(
            (len(r) for r, *_ in over + under) if (over or under) else [0],
            default=0,
        )
        width = max(width, *(len(r) for r, _ in gone), len("file"))
        print(f"\n  {'file':<{width}}  allowed  actual  verdict", file=sys.stderr)
        for rel, cap, n in over:
            print(
                f"  {rel:<{width}}  {cap:>7}  {n:>6}  OVER — replace the new "
                "waitForTimeout() with an auto-waiting assertion "
                "(expect(locator).toBeVisible/toHaveCount/toContainText)",
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
        print(
            "\nThe allowlist is a ratchet: rows may go down or away, never up. "
            "A green here means no file carries more fixed sleeps than its row, "
            "not that the suite has none. Plan: "
            "2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time",
            file=sys.stderr,
        )
        return EXIT_VIOLATION

    note(
        f"No fixed sleep added: {total} waitForTimeout() call(s) remain across "
        f"{sum(1 for n in counts.values() if n > 0)} file(s), matching the "
        f"{len(allowed)}-row allowlist ({listed} allowed); scanned {len(files)} "
        f"file(s) under {_rel(E2E_ROOT)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
