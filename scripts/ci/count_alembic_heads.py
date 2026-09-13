#!/usr/bin/env python3
"""Alembic sibling-head gate: the chain must have exactly one head.

THE single home of this gate's logic. Four lanes invoke this one script:

  * ``.github/workflows/alembic-graph-pr.yml``, step "Count alembic heads"
    — the PR gate; a forked chain FAILS the check.
  * ``.qontinui/ci.toml``, step ``alembic-single-head`` — same, locally.
  * ``.pre-commit-config.yaml``, hook ``alembic-single-head`` — the
    shift-left lane, on commits that touch ``backend/alembic/versions/``.
  * ``.github/workflows/alembic-graph-check.yml``, step "Count heads"
    — the post-merge companion, which is informational by construction and
    comments on the merging PR instead of failing. It passes ``--report-only``
    so a forked chain does not abort the step before the comment is posted.

The graph parsing itself lives in ``_alembic_graph.py``, shared with
``notify_forked_open_prs.py`` (the post-land open-PR notifier, which runs the
same computation against a simulated tree). This script owns the exit codes
and the author-facing message; it does not own the head computation.

Offline head counter: it scans ``backend/alembic/versions/*.py`` textually
without importing ``env.py`` (which would pull in qontinui-web's full app and
its ML deps). A revision is a head if no other revision names it as a parent.

Background: the 2026-05-07 multi-head divergence (cr01a2b3c4d5 +
7c5e4d3b2a1f) silently broke the canonical migrator container for four hours.
The post-merge informational workflow noticed it but did not block.

**What the local lane can and cannot catch.** All three forks on record
(qontinui-web #1048, #989, and commit ``066c2e6c``) were post-authoring
races: the declared parent WAS the single head at ``git commit`` time and a
sibling landed minutes to hours later. A pre-commit head count exits 0 on
every one of those, so this lane is shift-left convenience, not the guard —
the guard is the CI gate plus ``notify_forked_open_prs.py``. What it does
buy, and the reason its message names the exact ``down_revision`` token to
adopt, is that naming the right token was the core of the fix in 3 of 3
cases. It is not the WHOLE fix: a re-point also moves the module docstring's
``Revises:`` line and the ``_PARENT_REVISION_ID`` pin in the revision's
migration test, and advice omitting the pin turned a red head count into a
red test suite on #1216. So the message names all three sites.

Exit codes: 0 exactly one head, 1 more than one head, 2 the scan proved
nothing (no revision files, no revisions parsed, a DUPLICATE revision id, or
zero heads — a zero-head chain means a cycle, which is a defect, not a pass).

A duplicate revision id is exit 2 rather than 1 because it does not mean "this
tree has two heads"; it means THE HEAD COUNT IS NOT A VERDICT. ``Scan``'s
``revisions`` is keyed by revision id, so the second file to declare one
overwrites the first and that migration vanishes from the graph — and the
count printed above it was computed over a tree the scan did not fully see.
Measured on 2026-09-12: qontinui-web #1316 added a second file declaring
``coord_test_results_idx_01``, ``main``'s own head, and this gate answered
551 files scanned / 550 parsed, ``HEAD_COUNT=1``, exit 0 — green on precisely
the condition it exists to catch.

``--report-only`` downgrades ONLY the multi-head case to exit 0; it still
exits 2 on a scan that proved nothing or on a duplicate revision id, because
an informational workflow that silently counted zero revisions — or counted
heads over a collapsed graph — is exactly as useless as a gate that did.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _alembic_graph import (  # noqa: E402
    BLOCK_CYCLE,
    BLOCK_MERGE_REVISION,
    TESTS_DIR,
    VERSIONS_DIR,
    Remediation,
    RepointSites,
    Scan,
    duplicate_groups,
    no_pin_found_text,
    plan_remediation,
    plan_repoint_sites,
    read_dir_sources,
    read_test_sources,
    revisions_at_ref,
    scan_sources,
)
from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    EXIT_VIOLATION,
    REPO_ROOT,
    err,
    note,
    repo_relative,
    require_nonempty,
)

WHY_BLOCKING = """
Why this gate is blocking: a multi-head chain breaks
`alembic upgrade head` (which refuses to disambiguate), which
in turn breaks the canonical-stack migrator container's
one-shot startup. Since 2026-05-08, services in
qontinui-stack/docker-compose.yml gate on
`migrator: service_completed_successfully`, so a multi-head
merge to main also blocks `coord` from starting.
"""

MERGE_REMEDY = """
Resolution: every head has ALREADY LANDED on {baseline}, so no
`down_revision` can be re-pointed without rewriting landed
history. Author a merge revision:

    cd backend
    alembic merge -m "merge sibling heads" {heads}
    git add alembic/versions/<merge_file>.py
    git commit -m "chore(alembic): merge sibling heads"
    git push

The merge revision is empty bookkeeping (it just joins parents).
Nothing happens at upgrade time beyond stamping the new head.
"""

UNKNOWN_REMEDY = """
Resolution: UNKNOWN — could not read `{baseline}`, so this gate
cannot tell which head already landed and which is yours.

Fetch the baseline and re-run to get the exact token:

    git fetch origin main
    python scripts/ci/count_alembic_heads.py

Do NOT reach for `alembic merge` on the strength of this
message. A merge revision is correct only when BOTH heads have
already landed; if either is still unlanded (an open PR that a
land forked — the common case), the fix is a re-point — its
`down_revision`, its `Revises:` docstring line, and the
`_PARENT_REVISION_ID` pin in its migration test under
`backend/tests/` — and a merge revision would be permanent
bookkeeping added for nothing.
"""


DUPLICATE_REMEDY = """
Why this is exit 2 and not a head count: the revision graph is keyed by
revision id, so the second file to declare an id OVERWRITES the first and that
migration disappears from the graph. Whatever head count this scan printed was
computed over a tree it did not fully see, so it is NOT A VERDICT — in either
direction.

Resolution: give ONE of the two files a new, unique revision id, re-point its
`down_revision` (and the `Revises:` line in its docstring) onto the current
head, update the `_PARENT_REVISION_ID` pin in its migration test under
`backend/tests/` to that same head, and rename any test that pins the old id.

Do NOT reach for `alembic merge`. There is no fork here to merge: there are two
revisions wearing one name, and alembic itself refuses such a tree at
`alembic upgrade head`.
"""


def _where(revision: str, path: Path | None) -> str:
    """A pasteable location for a revision."""
    return repo_relative(path, f"<file for {revision}>")


def _before_after(before: str | None, after: str, unread: str) -> list[str]:
    """``before:`` / ``after:`` lines; ``unread`` names a line nobody quoted."""
    return [
        f"             before: {before if before is not None else unread}",
        f"             after:  {after}",
    ]


def _site_lines(
    revision: str,
    path: Path | None,
    target: str,
    sites: RepointSites | None,
    pin_scope: str | None,
) -> list[str]:
    """The three edit sites for re-pointing ONE revision, as plain text.

    ``sites is None`` means nobody read the file or searched for a pin, so the
    before-lines are named rather than quoted and the pin search is UNKNOWN.
    """
    where = _where(revision, path)
    lines = [f"    {where}   (revision {revision})"]
    down_before, down_after = (
        sites.down_revision
        if sites
        else (None, f'down_revision: str | Sequence[str] | None = "{target}"')
    )
    lines.append("      1. the `down_revision` assignment, in that file:")
    lines += _before_after(down_before, down_after, "(its current down_revision line)")
    if sites is not None and sites.revises is None:
        lines.append(
            "      2. the module docstring has no `Revises:` line — nothing to change."
        )
    else:
        revises_before = sites.revises[0] if sites and sites.revises else None
        lines.append("      2. the module docstring's `Revises:` line, in that file:")
        lines += _before_after(
            revises_before, f"Revises: {target}", "(its current Revises: line)"
        )
    pins = sites.pins if sites else ()
    if pins:
        lines.append("      3. the `_PARENT_REVISION_ID` pin in its migration test:")
        for pin in pins:
            lines.append(f"           {repo_relative(pin.path)}:{pin.lineno}")
            lines += _before_after(pin.before, pin.after, "")
    elif sites is None or pin_scope is None:
        lines += [
            "      3. the test pin: UNKNOWN — the pin search did not run. Look",
            f"         under {TESTS_DIR}/ for this revision's migration test and",
            f'         set its `_PARENT_REVISION_ID` to "{target}" too.',
        ]
    else:
        lines += [
            f"      3. the test pin: {no_pin_found_text(revision)}.",
            f"         (searched: {pin_scope})",
        ]
    lines.append("")
    return lines


def _sites_block(
    remediation: Remediation,
    sites: dict[str, RepointSites] | None,
    pin_scope: str | None,
) -> list[str]:
    """Every edit's three sites. Shared by the ``repoint`` and ``blocked`` arms."""
    lines: list[str] = []
    for revision, path in remediation.edits:
        lines += _site_lines(
            revision,
            path,
            remediation.target or "",
            (sites or {}).get(revision),
            pin_scope,
        )
    return lines


def _repoint_remedy(
    remediation: Remediation,
    baseline: str,
    sites: dict[str, RepointSites] | None = None,
    pin_scope: str | None = None,
) -> str:
    """The author-facing text for the case that actually happens."""
    lines = [
        "",
        f"Resolution: re-point onto the head that already landed on {baseline}.",
        "",
        f"    {remediation.target}",
        "",
        "is the landed head. Re-point the revision(s) below onto it — the",
        "shallowest UNLANDED revision on each forked chain, NOT the head,",
        "since anything stacked above it travels along unchanged.",
        "",
        "A re-point is THREE edits. Skipping the test pin turns this red",
        "head count into a red test suite:",
        "",
    ]
    lines += _sites_block(remediation, sites, pin_scope)
    lines += [
        "Then re-run this gate and the revision's migration test. Do NOT use",
        "`alembic merge` here: the forked revision has not landed, so a",
        "re-point leaves nothing behind, while a merge revision is permanent",
        "bookkeeping.",
        "",
        "This gate serialises alembic PRs by construction (branch protection",
        "is `strict`). If another revision lands before yours merges, the",
        "chain re-forks and you re-point again at the new head.",
        "",
    ]
    return "\n".join(lines)


def _roots_block(remediation: Remediation) -> list[str]:
    """Name the shallowest unlanded revision on each chain, when we have them.

    These were computed and then thrown away on the arms without a single
    landed head, so the message said "no single landed head" and stopped —
    while the exact files to edit were already in hand.
    """
    if not remediation.edits:
        return []
    lines = ["", "The shallowest UNLANDED revision on each forked chain is:", ""]
    for revision, path in remediation.edits:
        lines.append(f"    {_where(revision, path)}   (revision {revision})")
    lines += [
        "",
        "Those are the files to edit — not the heads, which travel along",
        "unchanged. Re-pointing any of them is THREE edits: its",
        "`down_revision`, its module docstring's `Revises:` line, and the",
        f"`_PARENT_REVISION_ID` pin in its migration test under {TESTS_DIR}/.",
        "",
    ]
    return lines


def render_remediation(
    remediation: Remediation,
    baseline: str,
    heads: tuple[str, ...],
    *,
    sites: dict[str, RepointSites] | None = None,
    pin_scope: str | None = None,
) -> str:
    """Pick the remedy text matching what the graph actually shows.

    ``sites`` carries the exact before -> after lines per re-pointed revision,
    and ``pin_scope`` names what the pin search looked at. ``pin_scope is
    None`` means the search did not run, and the text says UNKNOWN rather than
    implying the test has no pin.
    """
    if remediation.kind == "repoint":
        return _repoint_remedy(remediation, baseline, sites, pin_scope)
    if remediation.kind == "merge":
        return MERGE_REMEDY.format(baseline=baseline, heads=" ".join(heads))
    if remediation.kind == "unknown":
        return UNKNOWN_REMEDY.format(baseline=baseline)
    landed = ", ".join(remediation.landed_heads) or "(none)"
    unlanded = ", ".join(remediation.unlanded_heads) or "(none)"
    header = (
        f"\nResolution: landed head(s): {landed}\n"
        f"            unlanded head(s): {unlanded}\n\n"
    )
    if remediation.kind == "blocked":
        # There may well BE one landed head — do not print "no single landed
        # head to re-point onto" under a line that just named exactly one.
        lines: list[str] = []
        if remediation.edits and remediation.target:
            # Name the half that IS a plain re-point. Degrading the whole
            # answer and mentioning only the blocked chain made the author
            # converge in two rounds instead of one.
            lines += [
                f"`{remediation.target}` is the landed head, and PART of this",
                "is a plain re-point — THREE edits per revision below (the",
                "shallowest UNLANDED revision on the chain, NOT the head —",
                "anything stacked above it travels along unchanged and must",
                "not be touched):",
                "",
            ]
            lines += _sites_block(remediation, sites, pin_scope)
        elif remediation.target:
            lines += [f"`{remediation.target}` is the landed head.", ""]
        else:
            lines += [
                "There is no single landed head to re-point onto"
                f" ({len(remediation.landed_heads)} landed), so this gate will",
                "not pick one for you.",
                "",
            ]
            lines += _roots_block(remediation)
        lines += ["At least one chain needs MORE than a re-point:", ""]
        for head, reason, blocker in remediation.blocked:
            named = blocker or head
            if reason == BLOCK_MERGE_REVISION:
                lines += [
                    f"  head {head} — the block is `{named}`, a MERGE revision",
                    "      whose `down_revision` is a tuple. APPEND the landed",
                    "      head to that tuple; replacing it with a scalar drops",
                    "      the existing merge parents and ADDS heads. Note this",
                    f"      is `{named}`'s file, not the head's.",
                ]
            elif reason == BLOCK_CYCLE:
                lines += [
                    f"  head {head} — the block is `{named}`, which sits on a",
                    "      CYCLE, so there is no shallowest revision to",
                    "      re-point. Break the cycle first; the chain is",
                    "      unupgradable until you do.",
                ]
            else:  # pragma: no cover - defensive
                lines.append(f"  head {head} — blocked at `{named}` ({reason}).")
        lines.append("")
        return header + "\n".join(lines)
    # "chain": either the baseline itself is forked (two landed heads), or
    # every head is unlanded. Both need a human to pick an order. A merge
    # revision or a cycle can NO LONGER reach here — those are `blocked`,
    # whatever the landed-head count — which matters because the advice below
    # ("each one's `down_revision` naming the previous") is a scalar write and
    # would destroy a tuple.
    return (
        header + "No single landed head to re-point onto, so this gate will not\n"
        "invent an order. Chain the unlanded revisions one behind the\n"
        "other (each one's `down_revision` naming the previous) so the\n"
        "set ends in exactly one head, and re-run.\n"
        + "\n".join(_roots_block(remediation))
    )


def report(scan: Scan, versions_label: str) -> None:
    """Emit the ``HEAD_COUNT=`` / ``HEAD=`` lines every lane parses."""
    note(f"HEAD_COUNT={len(scan.heads)}")
    for head in scan.heads:
        note(f"HEAD={head}")
    note(
        f"(scanned {scan.file_count} revision file(s), "
        f"parsed {scan.parsed_count} revision(s) in {versions_label})"
    )


#: Where the re-point advice searches for `_PARENT_REVISION_ID` pins. Always the
#: checkout's, even under `--versions-dir`: a pin only matches a revision id it
#: names, so a synthetic versions dir finds none and the advice says so.
TESTS_ROOT = REPO_ROOT / TESTS_DIR


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report-only",
        action="store_true",
        help=(
            "Print the head count and diagnostics but exit 0 on a multi-head "
            "chain. For the post-merge informational workflow, which must reach "
            "its comment step. A scan that proved nothing still exits 2 — and so "
            "does a duplicate revision id, which makes the head count no verdict "
            "at all rather than a verdict worth reporting past."
        ),
    )
    parser.add_argument(
        "--versions-dir",
        default=None,
        help=(
            "Scan this directory instead of the checkout's "
            f"{VERSIONS_DIR}/. No production lane passes it — it exists so the "
            "gate's own tests can exercise every graph shape (fork, cycle, "
            "empty, unparseable) against a real invocation rather than a "
            "mocked one. The post-land notifier imports `_alembic_graph` "
            "directly and does not shell out to this script."
        ),
    )
    parser.add_argument(
        "--baseline-ref",
        default="origin/main",
        help=(
            "Git ref whose revision set counts as ALREADY LANDED. Used only "
            "to choose the remediation text — it never changes pass/fail. "
            "Pass an empty string to skip the lookup."
        ),
    )
    args = parser.parse_args()

    if args.versions_dir:
        versions = Path(args.versions_dir)
        label = str(versions)
    else:
        versions = REPO_ROOT / VERSIONS_DIR
        label = f"{VERSIONS_DIR}/"

    if not versions.is_dir():
        err(f"{label} does not exist (looked under {versions.resolve().parent}).")
        return EXIT_VACUOUS

    # `scan_dir` is exactly these two calls; keeping the text lets the re-point
    # advice quote each revision's real `down_revision` and `Revises:` lines.
    sources = read_dir_sources(versions)
    scan = scan_sources(sources)
    require_nonempty(scan.file_count, "*.py revision files", label)
    # Non-vacuity: N files on disk but zero parsed revisions means the parse is
    # broken (a syntax change in the revision template, say), not a clean chain.
    require_nonempty(
        len(scan.revisions), "parseable `revision = ...` assignments", label
    )
    # Non-vacuity, second half: `revisions` is keyed by revision id, so two
    # files declaring one id collapse into a single node and every count below
    # is computed over a tree we did not fully see. Compared against
    # `parsed_count`, NOT `file_count` — a legitimate non-revision file
    # (`__init__.py`) makes `file_count` exceed the revision count with nothing
    # wrong, so that comparison would fire on a healthy tree.
    if scan.duplicates:
        # Grouped per id, not per overwrite: three files sharing an id record
        # two pairwise collisions, which would print as two unrelated pairs
        # with the first file missing from the second.
        groups = duplicate_groups(scan)
        err(
            f"{len(groups)} DUPLICATE revision id(s) under {label}: "
            f"{scan.parsed_count} file(s) parsed a revision but only "
            f"{len(scan.revisions)} distinct id(s) survived the scan."
        )
        for rev, files in groups.items():
            err(f"  - {rev} is declared by {len(files)} files:")
            for path in files:
                err(f"      {_where(rev, path)}")
        print(DUPLICATE_REMEDY, file=sys.stderr)
        print(WHY_BLOCKING, file=sys.stderr)
        # NOT downgraded by --report-only: unlike a fork, this says the head
        # computation itself proved nothing, which is the vacuous arm.
        return EXIT_VACUOUS

    report(scan, label)

    if not scan.heads:
        err(
            f"Alembic chain has ZERO heads across {len(scan.revisions)} revisions — "
            "every revision is named as someone's parent, which means the chain "
            "has a cycle."
        )
        err("A zero-head chain cannot be upgraded; this is a defect, not a pass.")
        return EXIT_VACUOUS

    if len(scan.heads) > 1:
        err(f"Alembic chain has {len(scan.heads)} heads after this PR:")
        for head in scan.heads:
            err(f"  - {head}")
        baseline = args.baseline_ref or ""
        landed = revisions_at_ref(baseline, REPO_ROOT) if baseline else None
        remediation = plan_remediation(scan, landed)
        sites: dict[str, RepointSites] = {}
        pin_scope: str | None = None
        if remediation.target is not None:
            # Chooses WORDING only, like the baseline lookup: nothing here can
            # move the exit code. An absent tests dir is an UNKNOWN pin search.
            test_sources = read_test_sources(TESTS_ROOT)
            if test_sources is not None:
                pin_scope = f"every *.py under {TESTS_DIR}/ in this checkout"
            sites = plan_repoint_sites(scan, remediation, sources, test_sources or {})
        print(
            render_remediation(
                remediation,
                baseline or "(no baseline ref)",
                scan.heads,
                sites=sites,
                pin_scope=pin_scope,
            ),
            file=sys.stderr,
        )
        print(WHY_BLOCKING, file=sys.stderr)
        if args.report_only:
            # The caller (the post-merge informational workflow) reports this
            # itself, by commenting on the merging PR. Failing here would abort
            # its step before that comment is ever posted.
            note("--report-only: multi-head chain reported, not failed.")
            return 0
        return EXIT_VIOLATION

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
