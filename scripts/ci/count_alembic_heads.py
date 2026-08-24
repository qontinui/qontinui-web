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
adopt, is that naming the right token was the entire fix in 3 of 3 cases.

Exit codes: 0 exactly one head, 1 more than one head, 2 the scan proved
nothing (no revision files, no revisions parsed, or zero heads — a zero-head
chain means a cycle, which is a defect, not a pass).

``--report-only`` downgrades ONLY the multi-head case to exit 0; it still
exits 2 on a scan that proved nothing, because an informational workflow that
silently counted zero revisions is exactly as useless as a gate that did.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _alembic_graph import (  # noqa: E402
    BLOCK_CYCLE,
    BLOCK_MERGE_REVISION,
    VERSIONS_DIR,
    Remediation,
    Scan,
    plan_remediation,
    revisions_at_ref,
    scan_dir,
)
from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    EXIT_VIOLATION,
    REPO_ROOT,
    err,
    note,
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
land forked — the common case), the fix is a one-token
`down_revision` edit and a merge revision would be permanent
bookkeeping added for nothing.
"""


def _where(revision: str, path: Path | None) -> str:
    """A pasteable location for a revision. Repo-relative when it can be.

    An absolute ``/home/...`` path is noise in a CI log and unusable to anyone
    reading it on another machine.
    """
    if path is None:
        return f"<file for {revision}>"
    try:
        return str(path.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _repoint_remedy(remediation: Remediation, baseline: str) -> str:
    """The author-facing text for the case that actually happens."""
    lines = [
        "",
        f"Resolution: re-point onto the head that already landed on {baseline}.",
        "",
        f"    {remediation.target}",
        "",
        "is the landed head. Set that as the `down_revision` of the",
        "revision(s) below — the shallowest UNLANDED revision on each",
        "forked chain, NOT the head, since anything stacked above it",
        "travels along unchanged:",
        "",
    ]
    for revision, path in remediation.edits:
        where = _where(revision, path)
        lines.append(f"    {where}")
        lines.append(
            f'        down_revision: str | Sequence[str] | None = "{remediation.target}"'
        )
        lines.append("")
    lines += [
        "Also update that file's `Revises:` docstring line to match, then",
        "re-run this gate. Do NOT use `alembic merge` here: the forked",
        "revision has not landed, so re-pointing costs one token and leaves",
        "nothing behind, while a merge revision is permanent bookkeeping.",
        "",
        "This gate serialises alembic PRs by construction (branch protection",
        "is `strict`). If another revision lands before yours merges, the",
        "chain re-forks and you re-point again at the new head.",
        "",
    ]
    return "\n".join(lines)


def render_remediation(
    remediation: Remediation, baseline: str, heads: tuple[str, ...]
) -> str:
    """Pick the remedy text matching what the graph actually shows."""
    if remediation.kind == "repoint":
        return _repoint_remedy(remediation, baseline)
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
            # Name the half that IS a one-token fix. Degrading the whole
            # answer and mentioning only the blocked chain made the author
            # converge in two rounds instead of one.
            lines += [
                f"`{remediation.target}` is the landed head, and PART of this",
                "is a one-token fix. Set it as the `down_revision` of:",
                "",
            ]
            for revision, path in remediation.edits:
                lines.append(f"    {_where(revision, path)}")
                lines.append(
                    "        down_revision: str | Sequence[str] | None = "
                    f'"{remediation.target}"'
                )
            lines.append("")
        elif remediation.target:
            lines += [f"`{remediation.target}` is the landed head.", ""]
        else:
            lines += [
                "There is no single landed head to re-point onto"
                f" ({len(remediation.landed_heads)} landed).",
                "",
            ]
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
    )


def report(scan: Scan, versions_label: str) -> None:
    """Emit the ``HEAD_COUNT=`` / ``HEAD=`` lines every lane parses."""
    note(f"HEAD_COUNT={len(scan.heads)}")
    for head in scan.heads:
        note(f"HEAD={head}")
    note(
        f"(scanned {scan.file_count} revision file(s), "
        f"parsed {len(scan.revisions)} revision(s) in {versions_label})"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--report-only",
        action="store_true",
        help=(
            "Print the head count and diagnostics but exit 0 on a multi-head "
            "chain. For the post-merge informational workflow, which must reach "
            "its comment step. A scan that proved nothing still exits 2."
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

    scan = scan_dir(versions)
    require_nonempty(scan.file_count, "*.py revision files", label)
    # Non-vacuity: N files on disk but zero parsed revisions means the parse is
    # broken (a syntax change in the revision template, say), not a clean chain.
    require_nonempty(
        len(scan.revisions), "parseable `revision = ...` assignments", label
    )

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
        print(
            render_remediation(
                remediation, baseline or "(no baseline ref)", scan.heads
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
