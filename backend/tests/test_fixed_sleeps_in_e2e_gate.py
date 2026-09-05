"""The lane roster of the fixed-sleep ratchet for the Playwright E2E suite.

``scripts/ci/check_fixed_sleeps_in_e2e.py`` is THE single home of the rule that
no fixed sleep may be *added* to the E2E suite — a per-file ratchet rather than
a ban, so the existing waits are grandfathered while new ones are refused. The
gate exists because a test that waits on wall-clock instead of on a condition
fails for reasons that have nothing to do with the page under test: run
33950897170 red-mained ``main`` on a land that touched nothing the failing spec
exercised. It is a plain file scan — stdlib only, no git — which is why the
runner lane can carry it unchanged.

Three lanes invoke it, and the gate's own docstring names all three:

* ``.github/workflows/forbid-fixed-sleeps-in-e2e.yml`` — the PR gate.
* ``.qontinui/ci.toml``, step ``forbid-fixed-sleeps-in-e2e`` — the
  runner-as-CI-node lane. It invokes this same script rather than mirroring a
  command string, which is the whole point of the extraction: the two lanes
  cannot drift because there is only one copy of the logic.
* ``.pre-commit-config.yaml`` — the shift-left lane, so the ratchet catches an
  added sleep before the push rather than after it.

This module asserts that roster is EXACTLY those three, in both directions. The
missing-lane arm is the quieter of the two: a gate that stops being invoked
looks exactly like a gate that passes.

Why assert it
-------------

``a208240e2`` added a fourth invocation of the sibling ruff-parity gate while
three separate places in the tree went on saying there were three — one of them
stating outright that the gate is *not* a step in ``backend-ci.yml``. Every one
of those statements became false on that commit and **nothing failed**, for 90
commits. The lane count is what makes the one-script-many-lanes shape true, and
it was the one part nothing checked.

Position, not comment-ness
--------------------------

``tests/gate_lane_roster`` decides what "invokes" means by POSITION — a YAML
``run:``/``entry:`` value, or an element of a TOML ``command = [...]`` array —
rather than by #1208's "a tracked non-comment line naming the script" rule.
That rule works for the ruff gate and does not generalise: four tracked,
non-comment lines name ``count_alembic_heads.py`` while invoking nothing (a
sentence in a migration's docstring, and three string literals in
``scripts/ci/notify_forked_open_prs.py``'s remediation text). All four are
``.py`` lines with no leading ``#``. The position rule rejects them by rule
rather than by name, and so needs no exclusion list — not even for this file,
which names the gate throughout and is itself a ``.py``.
"""

from __future__ import annotations

import ast
from pathlib import Path

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

_SCRIPT_REF = "scripts/ci/check_fixed_sleeps_in_e2e.py"

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/forbid-fixed-sleeps-in-e2e.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate.

    These gates are argv-only programs whose import brings module-scope setup
    along for no benefit here, where the docstring is all we want. ``ast``
    never executes a line of one, and every sibling roster module reads the
    same way.
    """
    source = (REPO_ROOT / _SCRIPT_REF).read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    The gate opens by naming its three lanes. That list is what a reader trusts
    instead of grepping, so a lane added without touching it leaves the script
    confidently describing a shape the repo no longer has.
    """
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)
