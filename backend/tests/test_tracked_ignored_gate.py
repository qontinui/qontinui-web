"""The lane roster of the tracked-but-ignored-files gate.

``scripts/ci/check_tracked_ignored.py`` is THE single home of the rule that no
file in the index may be matched by a committed ``.gitignore``. That state is a
contradiction git itself never reports — ignore rules do not apply to files
already tracked, so ``git status`` stays silent while ruff (which honours
``.gitignore``) stops linting the file, ``rg``/``fd`` stop finding it, and a
fresh checkout can lose a lockfile the build reads. ``ec9fae1a`` un-ignored
``backend/scripts/``, where a bare directory rule had hidden 10 tracked scripts
from ruff for long enough that ``e59a14ec`` had to pay off the lint debt; the
hand-written negation list that fixed it was already missing an entry in the
block it was copied from. This gate is what makes the invariant hold without
anyone remembering it. Three lanes invoke it:

* ``.github/workflows/gitignore-tracked-files.yml``, step "Scan for
  tracked-but-ignored files" — the PR gate. It carries no ``paths:`` filter on
  purpose: the pair (rules, index) also breaks when a file is ADDED under an
  existing rule, and that commit touches neither ``.gitignore`` nor the
  workflow, so a path-scoped gate would sit out the very change that breaks it.
* ``.qontinui/ci.toml``, step ``gitignore-tracked-files`` — the
  runner-as-CI-node lane, invoking the same script rather than mirroring a
  command string, so the two cannot drift.
* ``.pre-commit-config.yaml``, hook ``gitignore-tracked-files`` — the earliest
  feedback, because a COMMIT is what creates this state and it is invisible
  afterwards. ``always_run`` with ``pass_filenames: false``, for the same
  reason the workflow has no ``paths:`` filter.

This module asserts that roster is EXACTLY those three, in both directions. The
missing-lane arm matters as much as the extra-lane one: this gate is cheap
(two ``git ls-files`` calls) and quiet, so a lane that silently stopped running
would look exactly like a lane that keeps passing.

Why this is asserted at all: ``a208240e2`` added a fourth invocation of the
sibling ruff gate while three separate places in the tree went on saying there
were three, and nothing failed.

Position, not comment-ness
--------------------------

``tests/gate_lane_roster`` decides what "invokes" means by POSITION — a YAML
``run:``/``entry:`` value, or an element of a TOML ``command = [...]`` array —
rather than by #1208's "a tracked non-comment line naming the script" rule.
That rule holds for the ruff gate and does not generalise: four tracked,
non-comment lines name ``count_alembic_heads.py`` without invoking it (a
sentence in a migration's docstring, and three string literals in
``scripts/ci/notify_forked_open_prs.py``'s remediation text). All four are
``.py`` lines with no leading ``#``, so the non-comment rule admits every one.
The position rule needs no exclusion list to reject them — including for this
file, which names the gate throughout and is itself a ``.py``.
"""

from __future__ import annotations

import ast
from pathlib import Path

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

_SCRIPT_REF = "scripts/ci/check_tracked_ignored.py"

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/gitignore-tracked-files.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate.

    ``test_ruff_version_parity_gate.py`` imports its gate and reads
    ``__doc__``; that is safe there because that suite also calls the gate's
    internals. Here the docstring is all we want, and these gates are argv-only
    programs whose import brings side effects along for no benefit. Parsing the
    file is the read that cannot run anything.
    """
    source = (REPO_ROOT / _SCRIPT_REF).read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    The gate opens by naming its three lanes, and the workflow header repeats
    them. That prose is what a reader trusts instead of grepping, so a lane
    added without touching it leaves the script describing a shape the repo no
    longer has.
    """
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)
