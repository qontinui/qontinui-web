"""The lane roster of the web/backend <-> qontinui boundary gate.

``scripts/ci/check_web_boundary.py`` is THE single home of the rule that the
cloud FastAPI tier must not import the ``qontinui`` namespace (torch, CV, ML,
OCR — runner-side concerns); the two sides talk over the WebSocket bridge and
share types through ``qontinui-schemas``. Phase 5 of plan
``2026-08-08-ci-tool-registry-and-canonical-configuration-parity`` extracted
that logic out of a multi-line shell ``run:`` block so a second and third lane
could invoke it instead of re-implementing it. Three lanes do:

* ``.github/workflows/web-boundary-lint.yml``, step "Scan backend/app for
  qontinui.* boundary violations" — the PR gate, the one with teeth.
* ``.qontinui/ci.toml``, step ``web-boundary-lint`` — the runner-as-CI-node
  lane. It is argv-only and deliberately shell-free, which is *why* the logic
  had to leave the workflow's ``run:`` block: the pipes and ``$(...)`` it used
  to hold were inexpressible here, and the manifest header recorded them as
  such until the extraction.
* ``.pre-commit-config.yaml``, hook ``web-boundary-lint`` — ``--files`` mode,
  for feedback before the push rather than after it.

This module asserts that roster is EXACTLY those three, in both directions: a
fourth invocation appearing is a failure, and one of the three ceasing to
invoke the script is a failure too. That second arm is the quieter defect — a
gate that stops running looks like a gate that passes.

Why this is asserted at all: ``a208240e2`` added a fourth invocation of the
sibling ruff gate while three separate places in the tree went on saying there
were three, and nothing failed for 90 commits.

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

_SCRIPT_REF = "scripts/ci/check_web_boundary.py"

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/web-boundary-lint.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate.

    ``test_ruff_version_parity_gate.py`` imports its gate and reads
    ``__doc__``; that is safe there because that suite also calls the gate's
    internals. Here the docstring is all we want, and these gates are argv-only
    programs whose import brings side effects along for no benefit —
    ``check_web_boundary.py`` resolves the repo root and builds its allowlist
    at module scope. Parsing the file is the read that cannot run anything.
    """
    source = (REPO_ROOT / _SCRIPT_REF).read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    The gate opens by naming its three lanes, and so do both YAML files. That
    prose is what a reader trusts instead of grepping, so a lane added without
    touching it leaves the script describing a shape the repo no longer has.
    """
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)
