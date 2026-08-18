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
   "scanned N files and found no violations" apart from "scanned nothing".
   The second case exits :data:`EXIT_VACUOUS` — a gate that passes because
   its input set was empty is the exact failure class this plan exists to
   eliminate (cf. the 181 self-skipping DB tests, the ``cargo test`` filter
   that matched zero tests and exited 0, and the OpenAPI export that
   silently dropped 31 routes). Use :func:`require_nonempty` for that check
   rather than hand-rolling it.
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
