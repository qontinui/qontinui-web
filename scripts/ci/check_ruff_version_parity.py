#!/usr/bin/env python3
"""The local ruff and the CI ruff must be the SAME ruff.

THE single home of this gate's logic. Three lanes invoke this one script:

  * ``.github/workflows/backend-ci.yml``, ``lint`` job, step
    "Check ruff version parity (pre-commit vs poetry.lock)"
  * ``.qontinui/ci.toml``, step ``ruff-version-parity``
  * ``.pre-commit-config.yaml``, hook ``ruff-version-parity`` — catches it
    before the push, since editing either file is what creates the skew.

WHY THIS EXISTS — it is the second half of a fix that only landed its first.

``505f5738`` ("chore(pre-commit): check ruff FORMAT locally, scoped exactly
as CI scopes it") added the ``ruff-format`` hook because formatting was
enforced in CI and checked nowhere locally: a backend change could pass every
local gate and still red CI on whitespace. That had happened four times, once
breaking ``main`` and holding four PRs for 40+ merge-train cycles
(``0bb156dd``, "style: ruff format operations.py to unbreak main").

That commit closed the "no local formatter" hole and explicitly recorded the
one it did not close, in its own words:

    Residual, deliberately not fixed here: three ruff versions are in play —
    this hook's ``rev: v0.14.0``, CI's resolved ``0.14.14`` (poetry.lock), and
    whatever a developer has locally. Pinning the hook to CI's exact version
    is the right follow-up.

A hook that runs a DIFFERENT ruff than CI reproduces the original defect
exactly: the local gate goes green, CI goes red, and the contributor has no
way to see it coming. Aligning the two numbers once is necessary but not
sufficient, which is why this is a gate and not just a version bump —
``backend/pyproject.toml`` declares ``ruff = "^0.14"``, a CARET, so any
``poetry lock`` refresh is free to move CI's resolved ruff to another 0.14.x
while ``.pre-commit-config.yaml``'s ``rev`` sits frozen wherever it was last
edited by hand. The skew reopens silently and for free.

This is the shape ``.qontinui/ci.toml``'s header calls the preferred one:

    Four gates are stronger than "mirrored": [...] there is nothing left to
    keep in sync — the two lanes cannot drift because there is only one copy
    of the logic.

There cannot be one copy of a THIRD-PARTY hook's pinned ``rev``, so the next
best thing is a gate that makes the two copies provably equal on every commit
that touches either of them.

WHAT IS COMPARED, and why these two files. ``poetry.lock`` is the resolved
version CI actually installs and runs (``backend-ci.yml``'s ``lint`` job runs
``poetry install`` then ``poetry run ruff``), not the ``^0.14`` range that
permits it — comparing against the range would compare against something no
run ever executes. ``.pre-commit-config.yaml``'s ``rev`` is the ruff-pre-commit
TAG, which upstream keeps identical to the ruff version it vendors, modulo a
leading ``v`` this gate strips.

THE REPO-ROOT ``poetry.lock`` IS NOT COMPARED, and that is a disclosed gap
rather than an oversight. It pins ruff too (same version today, under the same
``^0.14`` caret in the root ``pyproject.toml``), so it is a fourth copy of this
number that nothing holds — but no workflow installs the root env: ``ruff``
appears in ``.github/workflows`` only in backend-ci.yml's ``lint`` job, which
runs ``poetry install`` inside ``backend/``. Comparing against a lockfile no
lane ever installs would fail contributors over a version that gates nothing.
Widen this to the root lock the moment a job starts running from it.

A developer's own interpreter-level ruff is deliberately NOT compared. It is
not a lane: neither pre-commit (which builds the hook its own isolated env)
nor CI ever invokes it, so a mismatch there is not a drift this gate can or
should fail on. The measurement that motivated this file found 0.15.14 on the
box in question, formatting differently from both lanes — which is exactly why
the hook's pinned env, not the ambient binary, is what the two sides compare.

Exit codes: 0 the two agree, 1 they disagree, 2 the gate proved nothing
(either file missing, or the version could not be located in it) — vacuous,
not a pass.
"""

from __future__ import annotations

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
    repo_relative,
)

PRE_COMMIT_CONFIG = REPO_ROOT / ".pre-commit-config.yaml"
POETRY_LOCK = REPO_ROOT / "backend" / "poetry.lock"

# `- repo: <host>/<owner>/ruff-pre-commit[.git]` followed by that entry's
# `rev:`. Matches both the astral-sh and the legacy charliermarsh spelling,
# optional quoting on either line, an optional `.git` suffix, and comment or
# blank lines between the two keys — which the committed config has.
#
# The leading `/` is load-bearing: without it, `\S*ruff-pre-commit` also
# matches a FORK whose name merely ends in that string
# (`.../fork-of-ruff-pre-commit`), and `re.search` takes the first hit — so a
# fork listed above the real entry would silently supply the version this gate
# compares. Owner is not pinned, only the repo NAME, so a legitimate mirror
# still resolves.
#
# Anything this does not match yields EXIT_VACUOUS, never a pass: an
# unrecognised spelling is an unknown, not an agreement.
_RUFF_REPO_REV = re.compile(
    r"-\s*repo:\s*[\"']?\S*/ruff-pre-commit(?:\.git)?[\"']?[ \t]*\n"
    r"(?:[ \t]*(?:#[^\n]*)?\n)*"  # blank / comment-only lines
    r"[ \t]*rev:\s*[\"']?([^\s\"'#]+)",
)


def _read(path: Path) -> str | None:
    """File text, or ``None`` with an error already reported.

    ``UnicodeDecodeError`` is caught alongside ``OSError`` because it is a
    ``ValueError``, not an ``OSError``: letting it escape would abort with a
    traceback and exit 1, reporting "could not read this file" as "version
    skew found" — the confusion ``_gate_lib``'s docstring explicitly forbids.
    """
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        err(f"could not read {repo_relative(path)}: {exc}")
        return None


def _hook_rev(text: str) -> str | None:
    """The ``rev:`` pinned for the ruff-pre-commit repo, ``v`` stripped."""
    match = _RUFF_REPO_REV.search(text)
    if match is None:
        return None
    return match.group(1).lstrip("vV")


def _locked_version(text: str) -> str | None:
    """The ``version`` of the ``ruff`` package recorded in ``poetry.lock``.

    Scans ``[[package]]`` blocks rather than regexing the whole file, so a
    ruff mention inside another package's dependency table cannot be mistaken
    for the ruff package's own pin.
    """
    for block in text.split("[[package]]")[1:]:
        name = re.search(r'^\s*name\s*=\s*"([^"]+)"', block, re.MULTILINE)
        if name is None or name.group(1) != "ruff":
            continue
        version = re.search(r'^\s*version\s*=\s*"([^"]+)"', block, re.MULTILINE)
        if version is not None:
            return version.group(1)
    return None


REMEDIATION = """
Make the two equal. Which side moves depends on which one you meant to change:

  1. You refreshed backend/poetry.lock (the usual case) -> move the hook to
     match the newly resolved version:

         .pre-commit-config.yaml
           - repo: https://github.com/astral-sh/ruff-pre-commit
             rev: v{locked}          <- was v{hook}

  2. You bumped the hook on purpose -> move the lock to match, from backend/:

         poetry add --group dev --lock 'ruff=={hook}'

     NOTE that this REWRITES pyproject.toml's constraint to an exact pin,
     replacing the `ruff = "^0.14"` caret whose existence is the reason this
     gate exists. If you meant to keep the caret and only re-resolve inside
     it, edit the constraint by hand and run `poetry lock` instead.

Then re-run the hooks so the new ruff's opinion is applied before the push, not
after CI reports it:

    pre-commit run --all-files ruff-format
    pre-commit run --all-files ruff-check

Note that bumping ruff moves the LINTER as well as the formatter, so a bump
can surface new lint findings that are unrelated to your change. That is the
intended cost of the two lanes agreeing -- it is strictly cheaper to see them
here than as a red required check.
"""


def main() -> int:
    config_text = _read(PRE_COMMIT_CONFIG)
    lock_text = _read(POETRY_LOCK)
    if config_text is None or lock_text is None:
        err("The comparison did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS

    hook_rev = _hook_rev(config_text)
    if hook_rev is None:
        err(
            f"no ruff-pre-commit `rev:` found in {repo_relative(PRE_COMMIT_CONFIG)}. "
            "Either the hook was removed or the entry was respelled in a way this "
            "gate cannot read."
        )
        err("The comparison did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS

    locked = _locked_version(lock_text)
    if locked is None:
        err(
            f"no `ruff` package found in {repo_relative(POETRY_LOCK)}. ruff is a "
            "dev dependency of the backend; if it was removed, this gate and both "
            "ruff hooks should go with it."
        )
        err("The comparison did not run, so this is NOT a clean result.")
        return EXIT_VACUOUS

    if hook_rev != locked:
        err(
            f"ruff version skew: .pre-commit-config.yaml pins v{hook_rev}, "
            f"backend/poetry.lock resolves {locked}."
        )
        err(
            "The local hooks would run a different ruff than CI, so a commit can "
            "pass every local gate and still red `Lint & Format Check`."
        )
        print(REMEDIATION.format(locked=locked, hook=hook_rev), file=sys.stderr)
        return EXIT_VIOLATION

    note(
        f"ruff version parity OK - pre-commit and backend/poetry.lock both "
        f"resolve {locked}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
