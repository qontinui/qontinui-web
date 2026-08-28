#!/usr/bin/env python3
"""The local ruff and CI's ruff must be the SAME ruff.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/ruff-version-parity.yml``, step
    "Compare the pre-commit ruff pin against the lockfiles"
  * ``.qontinui/ci.toml``, step ``ruff-version-parity``
  * ``.pre-commit-config.yaml``, hook ``ruff-version-parity`` — catches it
    before the push, since editing either side is what creates the drift.

WHY THIS GATE EXISTS. ``505f5738`` added the ``ruff-format`` pre-commit hook so
that formatting is enforced locally and not only by ``backend-ci.yml``'s
``ruff format --check .``. Its own commit message names the residual it did not
close: the hook runs ruff at ``rev: v0.14.0`` while CI runs whatever
``poetry.lock`` resolves, which was ``0.14.14``. Two different formatters behind
one gate is the SAME defect that hook was added to prevent, moved one level up —
a tree the hook calls clean can still red CI, and a tree the hook "fixes" can be
a tree CI rejects.

The two versions happened to AGREE on the tree as of ``bf199372``: measured, both
0.14.0 and 0.14.14 report every tracked file under ``backend/`` already
formatted, and both emit byte-identical ``ruff check`` output over all 1485
tracked Python files. That is luck, not an invariant. ruff's formatter changes
between patch releases, and this repo's ``.pre-commit-config.yaml`` and its
lockfiles are moved by different commits at different times — Dependabot version
PRs are disabled here (``.github/dependabot.yml``, ``open-pull-requests-limit:
0``), so a lockfile bump is hand-written by someone who has no reason to look at
a pre-commit pin.

WHAT IS COMPARED. Every TRACKED ``poetry.lock`` that resolves ruff, against the
``rev`` of the ``astral-sh/ruff-pre-commit`` block. All of them, not only
``backend/poetry.lock``: CI's formatter is backend's, but the ``ruff`` LINTER
hook is repo-wide and the root project resolves a ruff of its own, so "which
ruff is the local one?" only has an answer while every copy agrees. Two
lockfiles disagreeing with each other is itself the ambiguity this gate refuses,
and it is reported as such rather than as a pre-commit problem.

DIRECTION OF AUTHORITY: the lockfile leads and the pre-commit ``rev`` follows,
never the reverse. The lockfile is what CI actually executes.

Exit codes: 0 in parity, 1 a version disagrees, 2 the comparison proved nothing
(no pin found, no lockfile resolving ruff, or a file that would not parse) —
vacuous, not a pass.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    EXIT_VIOLATION,
    REPO_ROOT,
    err,
    note,
    repo_relative,
    require_nonempty,
)

PRE_COMMIT_CONFIG = REPO_ROOT / ".pre-commit-config.yaml"
RUFF_HOOK_REPO = "https://github.com/astral-sh/ruff-pre-commit"

# `- repo: <url>` and `rev: <value>`, the value's optional quotes and any
# trailing `# comment` stripped. Deliberately a line scan and not PyYAML: the
# ci_node lane runs these scripts with whatever python a developer's machine
# has, against a checkout with nothing installed, so a gate script here may use
# the standard library and nothing else. `tomllib` below is the one thing that
# constrains WHICH standard library — it lands in 3.11, which is why this script
# raised that lane's stated interpreter floor from 3.9 (see .qontinui/ci.toml).
_REPO_LINE = re.compile(r"^\s*-\s*repo:\s*(?P<url>\S+)\s*(?:#.*)?$")
_REV_LINE = re.compile(r"""^\s*rev:\s*['"]?(?P<rev>[^\s'"#]+)['"]?\s*(?:#.*)?$""")


def _normalize(version: str) -> str:
    """``v0.14.14`` and ``0.14.14`` are the same version.

    ruff-pre-commit tags its releases with a leading ``v``; PyPI and
    ``poetry.lock`` do not. Comparing the raw strings would report a permanent
    false drift that no edit could ever clear.
    """
    return version.removeprefix("v")


def read_pinned_rev() -> str | None:
    """The ``rev`` of the ruff-pre-commit block, or None when it is absent.

    Scoped to that one block on purpose: the config pins other repos at revs of
    their own (``pre-commit-hooks``), and a scan that took the first ``rev:`` it
    saw would compare ruff against the wrong pin — confidently, and silently.
    """
    try:
        lines = PRE_COMMIT_CONFIG.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        err(f"could not read {repo_relative(PRE_COMMIT_CONFIG)}: {exc}")
        return None

    in_ruff_block = False
    for line in lines:
        repo_match = _REPO_LINE.match(line)
        if repo_match:
            in_ruff_block = repo_match.group("url") == RUFF_HOOK_REPO
            continue
        if in_ruff_block:
            rev_match = _REV_LINE.match(line)
            if rev_match:
                return rev_match.group("rev")
    return None


def locked_ruff_versions() -> dict[str, str] | None:
    """``{repo-relative lockfile: resolved ruff version}``, or None on error.

    TRACKED lockfiles only. ``git ls-files`` rather than a filesystem walk keeps
    vendored copies under ``node_modules`` and a developer's scratch checkout
    out of an invariant that is a property of the REPOSITORY.
    """
    listing = subprocess.run(
        ["git", "ls-files", "--cached", "--", "*poetry.lock"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if listing.returncode != 0:
        err(
            f"`git ls-files` failed (exit {listing.returncode}): "
            f"{listing.stderr.strip()}"
        )
        return None

    found: dict[str, str] = {}
    for rel in (line.strip() for line in listing.stdout.splitlines()):
        if not rel:
            continue
        try:
            with (REPO_ROOT / rel).open("rb") as handle:
                data = tomllib.load(handle)
        except (OSError, tomllib.TOMLDecodeError) as exc:
            err(f"could not parse {rel}: {exc}")
            return None
        for package in data.get("package", []):
            if package.get("name") == "ruff":
                found[rel] = str(package.get("version", ""))
                break
    return found


def main() -> int:
    pinned = read_pinned_rev()
    if pinned is None:
        # Deliberately "could not determine" rather than "not found": this
        # branch is also where an unreadable file lands (the read error is
        # already on stderr above), and reporting an I/O failure as an absent
        # pin would send the reader editing a file that was never the problem.
        err(
            f"could not determine the {RUFF_HOOK_REPO} `rev` in "
            f"{repo_relative(PRE_COMMIT_CONFIG)}."
        )
        err(
            "The comparison did not run, so this is NOT a clean result. If the "
            "ruff hooks were removed on purpose, delete this gate in the same "
            "change rather than leaving it passing on nothing."
        )
        return EXIT_VACUOUS

    locked = locked_ruff_versions()
    if locked is None:
        err("The comparison did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS
    require_nonempty(len(locked), "poetry.lock files resolving `ruff`", "the git index")

    disagreeing = {
        rel: version
        for rel, version in locked.items()
        if _normalize(version) != _normalize(pinned)
    }
    if disagreeing:
        err(
            f"the pre-commit ruff pin ({pinned}) is not the ruff CI runs. A local "
            "hook and a CI gate running different formatters is how a tree passes "
            "every hook and still reds CI on whitespace."
        )
        for rel, version in sorted(disagreeing.items()):
            print(f"  {rel} resolves ruff {version}", file=sys.stderr)

        # Name the token rather than describe it: printing the exact replacement
        # is what makes count_alembic_heads.py a 2-second fix instead of a
        # 17-minute CI round trip, and the same applies here.
        wanted = sorted({_normalize(v) for v in disagreeing.values()})
        if len(wanted) == 1:
            print(
                f"\nFix: in {repo_relative(PRE_COMMIT_CONFIG)}, under "
                f"`- repo: {RUFF_HOOK_REPO}`, write\n\n    rev: v{wanted[0]}\n",
                file=sys.stderr,
            )
        else:
            print(
                "\nThe lockfiles do not agree with EACH OTHER either "
                f"({', '.join(wanted)}), so there is no single version to pin to. "
                "Reconcile the lockfiles first; only then does the pre-commit pin "
                "have an answer.\n",
                file=sys.stderr,
            )
        return EXIT_VIOLATION

    note(
        f"ruff {_normalize(pinned)} is pinned in "
        f"{repo_relative(PRE_COMMIT_CONFIG)} and resolved in "
        f"{len(locked)} lockfile(s): {', '.join(sorted(locked))}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
