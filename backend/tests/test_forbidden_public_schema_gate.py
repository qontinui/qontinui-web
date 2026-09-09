"""The lane roster of the forbidden ``public.*`` schema gate.

``scripts/ci/check_forbidden_public_schema.py`` is THE single home of the rule
that no tracked source file may (re-)introduce a ``public.<table>`` reference.
Post-Phase-7 of the migration consolidation the ``public`` schema holds only
``alembic_version`` — alembic's own bookkeeping, filtered out of the match
lines rather than by pathspec because it can legitimately appear anywhere —
while every domain table lives in project / coord / agent / auth / cloud /
strategy / web. TWO lanes invoke it, one fewer than its three siblings:

* ``.github/workflows/forbid-public-schema.yml``, step "Scan for forbidden
  public.* references" — the PR gate, and a required merge gate, which is why
  it also runs on the ``merge-candidate/**`` refs coord's merge scheduler
  pushes.
* ``.qontinui/ci.toml``, step ``forbid-public-schema`` — the runner-as-CI-node
  lane. It is argv-only and deliberately shell-free, which is *why* Phase 5 of
  plan ``2026-08-08-ci-tool-registry-and-canonical-configuration-parity``
  extracted the logic from the workflow at all: the ``run:`` block's pipes,
  arrays and ``$(...)`` were inexpressible here, and the manifest header
  recorded them as such until the extraction.

There is deliberately NO pre-commit hook. That absence is the interesting half
of this roster, and the missing-lane arm of the assertion is what keeps it
honest in the other direction — the gate reads the index via ``git grep``, so a
lane silently dropping out would leave the tree unscanned while looking green.

Why this is asserted at all: ``a208240e2`` added a fourth invocation of the
sibling ruff gate while three separate places in the tree went on saying there
were three, and nothing failed for 90 commits. A two-lane roster is the case
where a third lane appearing is easiest to add without telling anyone.

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
file, and including the gate script itself, which pathspec-excludes its own
path because it is the home of the very pattern it searches for.
"""

from __future__ import annotations

import ast
from pathlib import Path

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

_SCRIPT_REF = "scripts/ci/check_forbidden_public_schema.py"

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/forbid-public-schema.yml",
        ".qontinui/ci.toml",
    }
)


def _gate_docstring() -> str | None:
    """The gate's module docstring, read WITHOUT importing the gate.

    ``test_ruff_version_parity_gate.py`` imports its gate and reads
    ``__doc__``; that is safe there because that suite also calls the gate's
    internals. Here the docstring is all we want, and these gates are argv-only
    programs whose import brings side effects along for no benefit —
    ``check_forbidden_public_schema.py`` resolves the repo root and compiles
    its pattern and pathspecs at module scope. Parsing the file is the read
    that cannot run anything.
    """
    source = (REPO_ROOT / _SCRIPT_REF).read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    The gate opens by naming its two lanes, and the workflow header repeats
    them. That prose is what a reader trusts instead of grepping, so a third
    lane added without touching it leaves the script — and the workflow —
    describing a shape the repo no longer has.
    """
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)
