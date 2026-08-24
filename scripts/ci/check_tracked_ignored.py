#!/usr/bin/env python3
"""No tracked file may be matched by the repo's own ignore rules.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/gitignore-tracked-files.yml``, step
    "Scan for tracked-but-ignored files"
  * ``.qontinui/ci.toml``, step ``gitignore-tracked-files``
  * ``.pre-commit-config.yaml``, hook ``gitignore-tracked-files`` — catches
    it before the push, since a commit is what creates this state.

A file that is BOTH tracked and ignored is a contradiction git itself will
not complain about: git keeps updating it (ignore rules do not apply to
files already in the index), so the state is invisible in ``git status`` and
survives indefinitely. What breaks is everything else, because a large part
of the toolchain takes ``.gitignore`` as its file-set boundary:

  * ``ruff`` honours ``.gitignore``, so an ignored-but-tracked ``.py`` file
    is never linted or formatted. This is not hypothetical — it is how
    ``backend/scripts/`` accumulated years of lint debt behind a bare
    ``backend/scripts`` rule while 10 scripts inside it were tracked
    (fixed in ``ec9fae1a``; the debt it exposed was paid in ``e59a14ec``).
  * ``rg``/``fd`` and most editor search skip the file, so it is missing
    from the greps a reader uses to decide whether something is dead.
  * ``npm ci`` needs ``frontend/package-lock.json`` and a fresh checkout
    needs the poetry lockfiles, yet a bare-basename rule intended for stray
    lockfiles matched exactly the two the build reads.

``ec9fae1a`` fixed one instance of that by hand — a ``backend/scripts/*``
rule plus one negation per tracked script. A hand-maintained allowlist is
only as good as the next person's memory, and the same commit's model, the
``frontend/scripts/*`` block, was itself already missing a negation for
``frontend/scripts/generate-api-types.ts``. This gate is what makes the
invariant hold without anyone remembering it.

WHAT COUNTS AS "IGNORED" HERE — deliberately narrower than git's default.
The scan passes ``--exclude-per-directory=.gitignore`` rather than
``--exclude-standard``, so it reads ONLY the committed ``.gitignore`` files.
``--exclude-standard`` would additionally read ``.git/info/exclude`` and the
developer's global ``core.excludesFile``, neither of which is in the repo:
a contributor whose global ignore file happens to list a name this repo
tracks would fail a gate about a file they did not touch, and the runner's
own ci_node lane writes machine-local entries into ``.git/info/exclude``
(``MANAGED_REPO_EXCLUDES``). The invariant this gate defends is a property
of the REPOSITORY — its committed rules against its committed files — so
machine-local exclude sources are correctly out of scope.

Exit codes: 0 clean, 1 at least one tracked file is ignored, 2 the scan
proved nothing (empty index, or ``git`` itself errored) — vacuous, not a
pass.
"""

from __future__ import annotations

import subprocess
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

# Read the repo's committed rules and nothing else — see the module docstring.
EXCLUDE_SOURCE = "--exclude-per-directory=.gitignore"


def _git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def _blame_rule(path: str) -> str:
    """Return ``<gitignore>:<line>:<pattern>`` for the rule that matches ``path``.

    ``--no-index`` is required: without it ``git check-ignore`` reports
    nothing for a TRACKED path, which is every path this gate ever hands it.
    """
    result = _git(["check-ignore", "--no-index", "-v", "--", path])
    if result.returncode != 0 or not result.stdout.strip():
        return "(rule could not be attributed)"
    # Format: <source>:<line>:<pattern>\t<path>
    return result.stdout.splitlines()[0].split("\t")[0]


REMEDIATION = """
Resolution, in order of preference:

  1. The file SHOULD be tracked -> narrow the rule. Turn a bare directory
     rule into `<dir>/*` plus one `!<dir>/<file>` negation per tracked file,
     the shape `.gitignore` already uses for backend/scripts and
     frontend/scripts. Anchor a basename rule you only meant locally:
     `!/frontend/package-lock.json`.

  2. The file should NOT be tracked (runtime output, local scratch, data
     that was swept in by a bulk commit) -> untrack it, keeping the working
     copy:

         git rm -r --cached <path>

Note that a negation cannot re-include a file whose PARENT DIRECTORY is
excluded (`git help gitignore`). If the rule is `some_dir/`, option 1 is not
available as written -- either respell the rule as `some_dir/*` or take
option 2.
"""


def main() -> int:
    # Non-vacuity: an empty index would make the violation scan trivially
    # clean. Prove the index has content before believing a no-match result.
    listing = _git(["ls-files", "--cached"])
    if listing.returncode != 0:
        err(
            f"`git ls-files` failed (exit {listing.returncode}): "
            f"{listing.stderr.strip()}"
        )
        err("The scan did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS
    tracked = [ln for ln in listing.stdout.splitlines() if ln.strip()]
    require_nonempty(len(tracked), "tracked files", "the git index")

    scan = _git(["ls-files", "--cached", "--ignored", EXCLUDE_SOURCE])
    if scan.returncode != 0:
        err(
            f"`git ls-files --ignored` failed (exit {scan.returncode}): "
            f"{scan.stderr.strip()}"
        )
        err("The scan did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS

    offenders = [ln for ln in scan.stdout.splitlines() if ln.strip()]

    if offenders:
        err(
            f"{len(offenders)} tracked file(s) are matched by .gitignore. Git keeps "
            "versioning them, but ruff, rg and the rest of the gitignore-aware "
            "toolchain silently skip them."
        )
        for path in offenders:
            print(f"  {path}\n      matched by {_blame_rule(path)}", file=sys.stderr)
        print(REMEDIATION, file=sys.stderr)
        return EXIT_VIOLATION

    note(f"No tracked file is ignored - scanned {len(tracked)} tracked file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
