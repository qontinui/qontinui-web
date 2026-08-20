#!/usr/bin/env python3
"""web/backend <-> qontinui boundary lint.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/web-boundary-lint.yml``, step
    "Scan backend/app for qontinui.* boundary violations"
  * ``.qontinui/ci.toml``, step ``web-boundary-lint``
  * ``.pre-commit-config.yaml``, hook ``web-boundary-lint`` (``--files`` mode)

Enforces the architectural boundary documented in memo
``proj_arch_web_runner_websocket_boundary``: the qontinui-web backend (the
cloud FastAPI tier) MUST NOT import from the ``qontinui`` namespace (torch,
CV, ML, OCR — runner-side concerns). Communication goes over the WebSocket
bridge (``runner_command_ws``) plus canonical PG; shared types come from
``qontinui-schemas``.

``qontinui-schemas`` is explicitly NOT covered by this rule — it is a
pure-Pydantic shared schemas package with zero heavy deps and is the
canonical type boundary for both sides.

Allowlist:
  * ``backend/app/api/embeddings.py`` — Phase 8 (embeddings runner-bridge) is
    DEFERRED-PENDING-USE-CASE. The file currently returns 503 stubs and holds
    no live qontinui imports, but is allowlisted defensively so a future
    use-case-driven re-introduction of ``qontinui.embeddings`` does not trip
    this gate before Phase 8 lands. Remove the allowlist entry when Phase 8
    ships the WS bridge.

Pattern notes (kept faithful to the ``grep -rnE`` original this replaced):
the token after ``from``/``import`` must be ``qontinui`` followed by ``.``,
whitespace, or end-of-line — i.e. real Python import grammar. That avoids
false positives on prose like "from qontinui-runner's exporter" inside
comments and docstrings, where a ``\\b`` would match the hyphen as a word
boundary. The two post-filters (``qontinui[-_]schemas`` and the embeddings
allowlist) are applied to the whole ``path:lineno:text`` line, exactly as the
original ``grep -v`` pipeline did.

Usage:
    python scripts/ci/check_web_boundary.py            # scan backend/app/**/*.py
    python scripts/ci/check_web_boundary.py --files A B  # scan only A and B

Exit codes: 0 clean, 1 violation found, 2 COULD NOT SCAN — an empty input
set, a path that resolves outside the repo, or a file that would not read.
Exit 2 is never a pass; it is deliberately distinct from 1 so an I/O problem
is not reported as a boundary violation the reader would then hunt for.
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

SCAN_ROOT = "backend/app"

# Real Python import grammar only — see the module docstring.
PATTERN = re.compile(r"(^|[^a-zA-Z0-9_-])(from|import)\s+qontinui([\s.]|$)")

# Post-filters, applied to the full "path:lineno:text" hit line.
SCHEMAS_EXEMPT = re.compile(r"qontinui[-_]schemas")
ALLOWLIST_PREFIXES = ("backend/app/api/embeddings.py:",)


def _rel(path: Path) -> str | None:
    """Repo-relative posix path, or None when ``path`` is outside the repo.

    Returning None rather than letting ``relative_to`` raise matters: an
    uncaught ValueError here would exit 1, which is the code for "found a
    violation". A path the gate cannot place is a CANNOT-SCAN condition, and
    those exit :data:`EXIT_VACUOUS`.
    """
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return None


def _scan(files: list[Path]) -> list[str]:
    hits: list[str] = []
    for path in files:
        rel = _rel(path)
        if rel is None:
            err(f"{path} resolves outside the repo root {REPO_ROOT}; cannot scan it.")
            err("A file the gate cannot place is an unknown, not a clean result.")
            sys.exit(EXIT_VACUOUS)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            # A file we could not read is a file we did not scan. That is the
            # vacuous case (exit 2), NOT a violation (exit 1) — reporting
            # "boundary violation" for an I/O error would send the reader
            # hunting for an import that is not there.
            err(f"could not read {rel}: {exc}")
            err("The scan is incomplete, so this is NOT a clean result.")
            sys.exit(EXIT_VACUOUS)
        for lineno, line in enumerate(text.splitlines(), start=1):
            if not PATTERN.search(line):
                continue
            hit = f"{rel}:{lineno}:{line}"
            if SCHEMAS_EXEMPT.search(hit):
                continue
            if hit.startswith(ALLOWLIST_PREFIXES):
                continue
            hits.append(hit)
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--files",
        nargs="*",
        metavar="PATH",
        help=(
            "Scan only these files (pre-commit passes the changed-file list). "
            f"Non-Python files and files outside {SCAN_ROOT} are ignored."
        ),
    )
    args = parser.parse_args()

    if args.files is None:
        scan_root = REPO_ROOT / SCAN_ROOT
        if not scan_root.is_dir():
            err(f"scan root {SCAN_ROOT}/ does not exist under {REPO_ROOT}.")
            return EXIT_VACUOUS
        files = sorted(scan_root.rglob("*.py"))
        require_nonempty(len(files), "*.py files", f"{SCAN_ROOT}/")
        where = f"{SCAN_ROOT}/"
    else:
        # pre-commit hands us the changed-file list; it filters by the hook's
        # `files:` pattern already, but re-filter so a manual invocation with a
        # wider list behaves identically to the repo-wide scan.
        require_nonempty(
            len(args.files), "files on the command line", "--files (empty list)"
        )
        files = []
        for given in args.files:
            path = (REPO_ROOT / given).resolve()
            rel = _rel(path)
            if rel is None:
                err(f"--files path {given!r} resolves outside the repo root.")
                err("The gate cannot scan it, and 'cannot scan' is never a pass.")
                return EXIT_VACUOUS
            if (
                path.suffix == ".py"
                and path.is_file()
                and rel.startswith(f"{SCAN_ROOT}/")
            ):
                files.append(path)
        if not files:
            # NOT the vacuous case: the caller named files, they were all placed
            # successfully, and none of them is in this gate's scope. "Nothing
            # to check here" is a real answer — distinct from "the scan found
            # no input", which require_nonempty above has already rejected.
            note(
                f"Boundary lint: none of the {len(args.files)} given file(s) are "
                f"{SCAN_ROOT}/**/*.py — nothing in scope."
            )
            return 0
        where = f"{len(files)} given file(s)"

    hits = _scan(files)
    if hits:
        err("web/backend imports from qontinui — architectural boundary violation.")
        err(
            "The qontinui-web cloud tier must not depend on the qontinui "
            "namespace (torch, CV, ML, OCR)."
        )
        err(
            "See memo proj_arch_web_runner_websocket_boundary and "
            "plan-2026-05-17-web-runner-ws-bridge-plan-b."
        )
        err(
            "Communicate with the runner via the WebSocket bridge "
            "(runner_command_ws) or use qontinui-schemas for shared types."
        )
        print("Violations:", file=sys.stderr)
        for hit in hits:
            print(hit, file=sys.stderr)
        return EXIT_VIOLATION

    note(
        f"Boundary lint clean — scanned {len(files)} Python file(s) in {where}, "
        "no qontinui.* imports."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
