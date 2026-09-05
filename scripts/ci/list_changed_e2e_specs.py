#!/usr/bin/env python3
"""List the Playwright spec files a pull request changed.

THE input to the `Frontend E2E Tests (changed specs)` lane in
``.github/workflows/e2e-tests.yml`` (job ``changed-specs``, step "List the E2E
spec files this PR changed"). Phase 2.5 of plan
``2026-09-05-web-e2e-fixed-sleeps-red-main-one-test-at-a-time``: the full
Playwright suite never runs on a pull request, so a converted spec's first
real execution used to be the post-land ``push: main`` run -- and a red there
is a red baseline for every open PR. This script names the spec files a PR
touched so the lane can run exactly those, on the same stack, BEFORE the land.

WHAT IT LISTS: every path under ``frontend/tests/e2e/`` ending in ``.spec.ts``
that is added, copied, modified or renamed-to between ``--base`` and
``--head`` (``git diff --name-only --diff-filter=ACMR``; a deleted spec has
nothing to run). Rename detection is OFF so a renamed spec surfaces as its new
path, which is the path that exists at ``--head``.

WHAT IT SKIPS, WITH A REASON ON THE LOG: spec files the ``chromium`` project in
``frontend/playwright.config.ts`` ignores (``testIgnore``) -- ``login.spec.ts``
runs under ``chromium-login``, ``style-gate/*`` under ``style-gate``. Handing
one of those to ``npx playwright test --project=chromium <file>`` yields
"No tests found" and exit 1: a red that says nothing about the spec. The lane
mirrors the shard suite, which is ``--project=chromium`` only, so those specs
are outside it either way. KEEP :func:`chromium_ignores` IN STEP WITH THE
CONFIG'S ``testIgnore``: a stale exclusion here reds the lane loudly ("No
tests found"), it never passes silently.

WHAT IT NOTES BUT DOES NOT RUN: non-spec files under ``frontend/tests/e2e/``
(``fixtures.ts``, ``auth.setup.ts``, ``helpers/``, ``global-setup.ts``) and
``frontend/playwright.config.ts``. A change there affects specs this script
cannot enumerate, so their effect is still first exercised by the post-land
run; the log says so rather than implying coverage it does not have.

OUTPUT: one classified line per changed file, then the frontend-relative list
(``tests/e2e/pages/x.spec.ts`` -- the ``working-directory`` of the test step is
``frontend/``) that will run, or "no spec files changed". With
``--github-output <path>`` it also appends ``files=<space-separated list>`` and
``any=true|false`` for the workflow's job outputs, plus ``groups=<json>`` — the
matrix of ≤6-file groups the lane fans out over (one stack per group).

EXIT CODES: 0 whether or not any spec changed -- an empty list is a RESULT of a
real diff, not a vacuous scan (``_gate_lib``'s distinction); 2 when the diff
itself could not be computed (``git`` failed: unknown rev, not a repo), so the
lane reds as "could not determine" instead of skipping as if nothing changed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _gate_lib import EXIT_VACUOUS, REPO_ROOT, err, note  # noqa: E402

E2E_PREFIX = "frontend/tests/e2e/"
FRONTEND_PREFIX = "frontend/"
SPEC_SUFFIX = ".spec.ts"
#: Files outside the E2E root whose change still reshapes what the specs do.
SUPPORT_FILES = frozenset({"frontend/playwright.config.ts"})


def chromium_ignores(repo_path: str) -> str | None:
    """Why the ``chromium`` project would not run this spec, or None.

    Mirrors the ``testIgnore`` of the ``chromium`` project in
    ``frontend/playwright.config.ts``: ``/login\\.spec\\.ts/`` and the
    style-gate capture spec (``style-gate/style-capture.spec.ts``, matched
    here by directory so a second style-gate spec is treated the same way).
    """
    name = PurePosixPath(repo_path).name
    if name.endswith("login.spec.ts"):
        return "runs under the chromium-login project, not chromium"
    if repo_path.startswith(E2E_PREFIX + "style-gate/"):
        return "runs under the style-gate project, not chromium"
    return None


def changed_paths(base: str, head: str) -> list[str]:
    """Repo-relative paths added/copied/modified/renamed-to from base to head."""
    cmd = [
        "git",
        "-C",
        str(REPO_ROOT),
        "diff",
        "--name-only",
        "--no-renames",
        "--diff-filter=ACMR",
        base,
        head,
        "--",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err(
            f"could not compute the changed-file list: `{' '.join(cmd)}` exited "
            f"{proc.returncode}: {proc.stderr.strip()}"
        )
        err(
            "This is UNKNOWN, not 'nothing changed': the lane must not be skipped "
            "on a diff it never saw."
        )
        sys.exit(EXIT_VACUOUS)
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def classify(
    paths: list[str],
) -> tuple[list[str], list[tuple[str, str]], list[str]]:
    """Split changed paths into (specs to run, (spec, why skipped), support)."""
    specs: list[str] = []
    skipped: list[tuple[str, str]] = []
    support: list[str] = []
    for path in paths:
        if path.startswith(E2E_PREFIX):
            if path.endswith(SPEC_SUFFIX):
                why = chromium_ignores(path)
                if why:
                    skipped.append((path, why))
                else:
                    specs.append(path)
            else:
                support.append(path)
        elif path in SUPPORT_FILES:
            support.append(path)
    return specs, skipped, support


def frontend_relative(repo_path: str) -> str:
    return repo_path[len(FRONTEND_PREFIX) :]


#: Largest number of spec files one stack job runs. A full-suite shard covers a
#: quarter of the suite on its own `next dev`; the 23-file single-job lane on
#: web#1265 (2026-09-05) showed that server degrading late in a long run —
#: four runs, four different tests' FIRST `page.goto` past 60 s or dropped —
#: so a big change set is split into groups that each get their own stack.
MAX_FILES_PER_GROUP = 6


def group_files(files: list[str]) -> list[dict[str, object]]:
    """Chunk ``files`` into the matrix the lane fans out over.

    Each entry is ``{"index": n, "files": "<space-separated list>"}`` so the
    workflow can pass ``files`` straight to the stack's ``spec_files`` input
    and use ``index`` in the artifact suffix. An empty ``files`` yields an
    empty matrix (the lane is skipped upstream on ``any=false`` anyway).
    """
    return [
        {"index": i + 1, "files": " ".join(files[start : start + MAX_FILES_PER_GROUP])}
        for i, start in enumerate(range(0, len(files), MAX_FILES_PER_GROUP))
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True, help="base revision (the PR base)")
    parser.add_argument("--head", default="HEAD", help="head revision (default HEAD)")
    parser.add_argument(
        "--github-output",
        metavar="PATH",
        help="append `files=` and `any=` lines to this file ($GITHUB_OUTPUT)",
    )
    args = parser.parse_args(argv)

    paths = changed_paths(args.base, args.head)
    specs, skipped, support = classify(paths)

    note(f"Changed files ({args.base}..{args.head}): {len(paths)}")
    for path in specs:
        note(f"  spec:    {path}")
    for path, why in skipped:
        note(f"  skipped: {path} ({why})")
    for path in support:
        note(f"  support: {path}")
    if support:
        note(
            f"NOTE: {len(support)} E2E support file(s) changed. This lane runs only "
            "the changed SPEC files, so the effect of a support-file change on "
            "other specs is not exercised here; the post-land main run is where it "
            "first is."
        )

    files = [frontend_relative(path) for path in specs]
    if files:
        note(f"{len(files)} changed spec file(s) will run: {' '.join(files)}")
    else:
        note("no spec files changed - the changed-specs E2E lane will be skipped")

    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as fh:
            fh.write(f"files={' '.join(files)}\n")
            fh.write(f"any={'true' if files else 'false'}\n")
            fh.write(f"groups={json.dumps(group_files(files))}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
