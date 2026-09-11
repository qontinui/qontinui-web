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
matrix of groups of at most :data:`MAX_FILES_PER_GROUP` files the lane fans out
over (one stack per group; see that constant for why the bound is 6, and what
was measured before leaving it there).

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


#: Largest number of spec files one stack job runs.
#:
#: THE ORIGINAL REASON IS RETIRED; THE NUMBER STILL STANDS. The cap was
#: introduced because the 23-file single-job lane on web#1265 (2026-09-05)
#: degraded its ``next dev`` server late in a long run — four runs, four
#: different tests' FIRST ``page.goto`` past 60 s or dropped. That cannot
#: happen here any more: plan
#: 2026-09-05-web-e2e-runs-against-next-dev-so-a-first-hit-compile-is-a-test-failure
#: moved this lane onto a production build (web#1279), where no route compiles
#: at request time. Do NOT cite dev-server degradation as a live constraint.
#:
#: Phase 3 of that plan re-evaluated the number and deliberately left it at 6.
#: What was measured, so nobody re-derives it — and note the DENOMINATOR IS
#: PULL REQUESTS, because this lane diffs a PR against its base, never a
#: single commit:
#:
#: * HOW OFTEN IT BINDS — of 831 pull requests merged between 2026-03-01 and
#:   2026-09-07, 49 changed at least one e2e spec file (43 once the
#:   :func:`chromium_ignores` exclusions above are applied). Exactly FOUR
#:   exceeded this cap, at 7, 11, 11 and 48 files — raw counts, of which the
#:   largest is 47 runnable; four exceed the cap under either filter.
#:   Measuring per-commit instead gives 97 items and understates the binding
#:   rate roughly twofold, so use the PR figure.
#: * THE FOUR ARE ONE BURST, NOT A RECURRENCE — all four landed between
#:   2026-05-06 and 2026-05-08. In the four months since, no PR has changed
#:   more than THREE spec files. Aggregating commits into PRs was tested and
#:   promoted zero additional items past the cap.
#: * WHAT WIDENING WOULD BUY — a cap of 12 would have dispatched 52 group jobs
#:   instead of 59 across that whole window: 7 fewer jobs, ~34 runner-minutes
#:   in six months, and ALL of the saving comes from the single 48-file PR.
#: * WHAT A GROUP COSTS — ~292 s of fixed overhead (n=1: run 34042226302
#:   group 1, 314 s wall, of which the test step was 22 s — 7% of the job).
#:   131 s of that was ``next build``, a step that did not exist under
#:   ``next dev``, so the fan-out roughly doubled in cost as its justification
#:   disappeared. Treat 292 s as one sample: the same build took 84-88 s in
#:   the four shard jobs of run 34042283673.
#: * WHAT WIDENING WOULD COST — groups are a PARALLEL matrix with
#:   ``fail-fast: false``, so runner-minutes are saved by spending WALL-CLOCK
#:   time to feedback, and precisely on the largest PRs. At cap 6 a 48-file PR
#:   gets 8 concurrent jobs of ~292 s + 6 files of tests; at cap 12, 4 jobs of
#:   ~292 s + 12 files of tests.
#: * THAT WIDENING WOULD BE SAFE — one production-build server already carries
#:   more than six spec files, green: the four shards of run 34042283673 each
#:   held 10, 13, 12 and 13 spec files (9, 10, 11 and 11 of them contributing
#:   an executed test), dispatched up to 219 tests, and summed up to 288 s of
#:   test time, for 491 passed / 0 failed. So a shard's per-server load is
#:   well ABOVE this cap rather than equal to it, and a 12-file group sits
#:   inside the files-present envelope.
#:
#: Verdict: the saving is ~34 runner-minutes per half-year, it is bought with
#: feedback latency on the biggest PRs, and the cap has not bound at all in
#: four months — so the number stays. Raise it here in one line if that tail
#: returns; the evidence above says the per-server load is not what stops you.
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
