"""Shared helpers for the committed CI gate scripts in ``scripts/ci/``.

These scripts exist so that a gate's logic has exactly ONE home. Before
plan ``2026-08-08-ci-tool-registry-and-canonical-configuration-parity``
Phase 5, each gate lived as a multi-line ``run:`` block inside its
workflow, which meant the runner-as-CI-node lane (``.qontinui/ci.toml``,
argv-only, deliberately shell-free) could not mirror it at all — the
manifest header recorded them as inexpressible. Extracting each gate to a
committed script makes both lanes invoke the same code instead of keeping
two divergent copies of the same commands.

Two conventions every gate script here follows:

1. ``ANNOTATIONS`` — on GitHub Actions the scripts emit ``::error::``
   workflow-command annotations so failures land on the PR diff; anywhere
   else (a developer shell, the runner's ci_node lane) they emit plain
   ``ERROR:`` lines, because a bare ``::error::`` prefix is noise outside
   Actions.

2. **Silence is never success.** Every gate script must be able to tell
   "scanned N files and found no violations" apart from "could not scan".
   The second case exits :data:`EXIT_VACUOUS` — a gate that passes because
   its input set was empty is the exact failure class this plan exists to
   eliminate (cf. the 181 self-skipping DB tests, the ``cargo test`` filter
   that matched zero tests and exited 0, and the OpenAPI export that
   silently dropped 31 routes). Use :func:`require_nonempty` for that check
   rather than hand-rolling it.

   State the guarantee precisely, because it is narrower than "never green
   without a scan": what these scripts promise is that they never return 0
   after finding their INPUT SET EMPTY, or after the tool they delegate to
   errored. They may still return 0 having examined no files where emptiness
   is the honest answer — ``check_web_boundary.py --files`` handed a
   non-empty list that contains nothing in its scope says exactly that and
   passes. Emptiness of the INPUT is always an error; emptiness of the
   in-scope SUBSET of a non-empty input is a result. Do not blur the two:
   overclaiming here would make the next reader trust a green the code never
   promised.

   Exit 2 is also deliberately distinct from exit 1 in the other direction.
   An I/O error, an unplaceable path or a missing scan root must NOT be
   reported as "violation found" — that sends the reader hunting for a
   defect that is not in the tree.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# scripts/ci/_gate_lib.py -> scripts/ci -> scripts -> <repo root>
REPO_ROOT = Path(__file__).resolve().parents[2]

#: Violation found — the condition the gate checks is present.
EXIT_VIOLATION = 1
#: The gate could not run meaningfully (empty input set, tool error). NOT a
#: pass: an unrunnable gate is an unknown, and an unknown is not a green.
EXIT_VACUOUS = 2

ANNOTATIONS = os.environ.get("GITHUB_ACTIONS") == "true"


def repo_relative(path: Path | None, fallback: str = "") -> str:
    """``path`` relative to the repo root, or a sane string if it is not under it.

    ``Path.relative_to`` RAISES rather than falling back, so an unguarded call
    turns a formatting detail into an aborted run. An absolute ``/home/...``
    path is also noise in a CI log and unusable to anyone reading it on
    another machine.

    ONE home on purpose: this had already been copied into two gate scripts
    and was diverging (one called ``.resolve()`` and the other did not, so the
    same input rendered two different strings).
    """
    if path is None:
        return fallback
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def err(message: str) -> None:
    """Print an error line, annotated on Actions and plain everywhere else."""
    prefix = "::error::" if ANNOTATIONS else "ERROR: "
    print(f"{prefix}{message}", file=sys.stderr)


def note(message: str) -> None:
    """Print an informational line to stdout."""
    print(message)


def require_nonempty(count: int, what: str, where: str) -> None:
    """Exit :data:`EXIT_VACUOUS` when a gate's input set is empty.

    ``count`` is how many units (files, revisions, …) the gate actually
    looked at. Zero means the scan proved nothing, so the gate must fail
    loudly instead of reporting a green it did not earn.
    """
    if count > 0:
        return
    err(f"gate scanned NOTHING: no {what} found under {where}.")
    err(
        "This is a vacuous pass, not a clean one — the path set is wrong, the "
        "checkout is incomplete, or the gate is being run from outside the repo."
    )
    sys.exit(EXIT_VACUOUS)
