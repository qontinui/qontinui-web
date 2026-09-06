"""Which files actually INVOKE a committed CI gate script in ``scripts/ci/``.

Every gate in ``scripts/ci/`` exists so its logic has exactly ONE home, and each
one opens by declaring in prose how many lanes invoke it. That declaration is
the thing that makes the shape true, and until now it was the one part nothing
asserted: ``a208240e2`` (PR #1127) added a fourth invocation of
``check_ruff_version_parity.py`` while three separate places in the tree said
there were three, one of them saying outright that the gate is *not* a step in
``backend-ci.yml``. Every one of those statements became false on that commit
and **nothing failed**. #1208 pinned that one gate's roster; this module is the
generalisation the other four needed.

Position, not comment-ness
--------------------------

#1208's roster test defines an invocation as *a tracked line naming the script
whose stripped form does not start with* ``#``. **That rule does not
generalise**, and the counter-example is already in the tree — four tracked,
non-comment lines name ``count_alembic_heads.py`` and not one of them invokes
it:

* ``backend/alembic/versions/grantorig_01_operator_roles_grant_origin.py:179``
  — a sentence inside a migration's docstring;
* ``scripts/ci/notify_forked_open_prs.py:352,361,373`` — string literals in
  remediation text that the notifier posts into PR comments.

All four are non-comment lines in ``.py`` files, so the ``#``-prefix rule admits
every one of them. Three further classes are on ``main`` today that the same
rule gets wrong in one direction or the other: ``paths:`` filter entries in
``web-boundary-lint.yml`` (non-comment YAML, admitted), the ``backend-ci.yml``
header comment naming the ruff gate (excluded, but only by luck of the ``#``),
and a plain-text mention in ``.gitignore``.

So the distinction this module draws is **invocation position**, per file type:

===========================  =============================================
File                         Invocation slot
===========================  =============================================
``*.yml`` / ``*.yaml``       the value of a ``run:`` or ``entry:`` key
``.qontinui/ci.toml``        an element of a ``command = [...]`` array
anything else                nothing — every mention is just a mention
===========================  =============================================

Prose can name a path in a docstring or a string literal and mean nothing by
it; a YAML ``run:`` key cannot. Both ``run`` and ``entry`` are accepted in any
YAML rather than keyed to a specific filename — ``.pre-commit-config.yaml`` is
itself a ``.yaml``, and a rule that has to know which file it is looking at is
one exclusion list away from the defect this module exists to end.

**No exclusion list.** ``invoking_files`` takes none, and the roster tests pass
without one — not even for a gate script naming itself or for the test module
naming the gate. Both are ``.py`` files, so the position rule already excludes
them, and that is the exit signal the generalisation is real: if this needed a
per-gate list of things to ignore, the rule would be luck rather than position.

Parsing, not scanning
---------------------

The two invocation slots are read with real parsers (``yaml.safe_load_all``,
``tomllib``) rather than a line scanner. That is what makes the multi-line case
correct for free: ``count_alembic_heads.py``'s genuine fourth lane is

.. code-block:: yaml

    run: |
      # ...twelve lines of comment...
      python ../scripts/ci/count_alembic_heads.py --report-only \\
        --baseline-ref HEAD | tee heads.txt

— a block scalar, spelled ``../scripts/ci/...`` from a step with a different
working directory. A scanner reading "the value of a ``run:`` key" as an inline
remainder finds three lanes on a tree that correctly has four, which is this
plan's own failure mode inverted. A parser hands back the whole block as one
string and a substring test finds it, whatever the prefix.

Comments never reach us at all — both parsers drop them — so the ``#`` question
this module exists to replace does not even arise.

Silence is never success
------------------------

Same convention as ``scripts/ci/_gate_lib.py``: a scan that could not run must
not look like a scan that found nothing. Every failure here RAISES —
``git grep`` erroring, a YAML or TOML file that will not parse, or a script
reference no tracked file mentions at all (impossible for a real gate, which at
minimum names itself).
"""

from __future__ import annotations

import subprocess
import tomllib
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml

# backend/tests/gate_lane_roster.py -> backend/tests -> backend -> <repo root>
REPO_ROOT = Path(__file__).resolve().parents[2]

#: YAML keys whose VALUE is a command line. ``run`` is GitHub Actions; ``entry``
#: is pre-commit. Accepted in any YAML file — see the module docstring on why
#: this is deliberately not keyed to a filename.
INVOCATION_KEYS = frozenset({"run", "entry"})

#: TOML keys whose value is an argv array. ``.qontinui/ci.toml``'s steps are
#: ``command = ["python", "scripts/ci/<gate>.py"]`` — argv-only and shell-free,
#: which is why the runner-as-CI-node lane can mirror the workflow at all.
COMMAND_KEYS = frozenset({"command"})

_YAML_SUFFIXES = frozenset({".yml", ".yaml"})


def _tracked_files_mentioning(script_ref: str) -> list[str]:
    """Every tracked file with a line naming ``script_ref``, comments included.

    This is only the CANDIDATE set — the position rules below decide which of
    these actually invoke anything. Using ``git grep`` rather than walking the
    tree keeps untracked scratch files out without a second ignore rule.
    """
    listing = subprocess.run(
        ["git", "grep", "-l", "--fixed-strings", script_ref],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    # `git grep` exits 1 for "no matches". For a real gate that is impossible —
    # the script names itself in its own docstring — so both non-zero codes mean
    # the scan did not happen, which must never read as an empty roster.
    if listing.returncode != 0:
        raise AssertionError(
            f"`git grep` for {script_ref!r} exited {listing.returncode}; the "
            f"lane roster was NOT scanned. stderr: {listing.stderr.strip()}"
        )
    return [line for line in listing.stdout.splitlines() if line]


def _walk(node: Any) -> Iterator[tuple[str, Any]]:
    """Yield every ``(key, value)`` pair anywhere in a parsed document.

    Recursive because an invocation slot can sit at any depth — a ``run:`` is
    nested under ``jobs.<id>.steps[]``, an ``entry:`` under ``repos[].hooks[]``,
    and a ``command`` under ``[[steps]]``.
    """
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(key, str):
                yield key, value
            yield from _walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item)


def _yaml_invokes(path: Path, script_ref: str) -> bool:
    """Does any ``run:`` / ``entry:`` value in this YAML name ``script_ref``?

    ``safe_load_all`` because a YAML file may hold several documents, and
    because block scalars come back as one joined string — which is exactly what
    makes the multi-line ``run: |`` case work without a line scanner.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    try:
        documents = list(yaml.safe_load_all(text))
    except yaml.YAMLError as exc:
        # An unparseable lane file is an unknown, not an absent lane.
        raise AssertionError(
            f"{path.relative_to(REPO_ROOT)} could not be parsed as YAML, so its "
            f"invocation slots were not read: {exc}"
        ) from exc

    for document in documents:
        for key, value in _walk(document):
            if key in INVOCATION_KEYS and isinstance(value, str):
                if script_ref in value:
                    return True
    return False


def _toml_invokes(path: Path, script_ref: str) -> bool:
    """Does any ``command = [...]`` element in this TOML name ``script_ref``?"""
    try:
        document = tomllib.loads(path.read_text(encoding="utf-8", errors="replace"))
    except tomllib.TOMLDecodeError as exc:
        raise AssertionError(
            f"{path.relative_to(REPO_ROOT)} could not be parsed as TOML, so its "
            f"invocation slots were not read: {exc}"
        ) from exc

    for key, value in _walk(document):
        if key in COMMAND_KEYS and isinstance(value, list):
            if any(isinstance(arg, str) and script_ref in arg for arg in value):
                return True
    return False


def invoking_files(script_ref: str) -> set[str]:
    """The repo-relative files that INVOKE ``script_ref``, by position.

    ``script_ref`` is the path exactly as an invoking line spells it, e.g.
    ``scripts/ci/check_web_boundary.py``. Matching is a substring test against
    the parsed slot value, so a lane that spells it ``../scripts/ci/...`` from a
    step with its own ``working-directory`` still counts — the prefix is a
    property of that step's cwd, not of whether it runs the gate.

    Takes no exclusion list, on purpose. See the module docstring.
    """
    found: set[str] = set()
    for rel in _tracked_files_mentioning(script_ref):
        path = REPO_ROOT / rel
        suffix = Path(rel).suffix
        carries_slots = suffix in _YAML_SUFFIXES or suffix == ".toml"

        if not path.is_file():
            # A tracked path that is not a readable file — a submodule gitlink,
            # a broken symlink. `git grep` only lists paths whose CONTENT it
            # matched, so this should be unreachable; the branch exists so that
            # if it ever is reached, it is not reached silently. Skipping a file
            # that CAN hold an invocation slot would be a false negative, and
            # "silence is never success" applies here as much as to the gates:
            # for anything else the answer is "a mention" either way.
            if carries_slots:
                raise AssertionError(
                    f"{rel} names {script_ref} and can hold an invocation slot, "
                    "but is not a readable file — its slots were NOT scanned, so "
                    "the roster below it is incomplete rather than empty."
                )
            continue

        if suffix in _YAML_SUFFIXES:
            if _yaml_invokes(path, script_ref):
                found.add(rel)
        elif suffix == ".toml":
            if _toml_invokes(path, script_ref):
                found.add(rel)
        # Everything else is a mention: .py docstrings and string literals,
        # .gitignore prose, Markdown. Deliberately no branch.
    return found


def assert_lane_roster(script_ref: str, declared: frozenset[str]) -> None:
    """Both arms: nothing invokes it that is not declared, and vice versa.

    Split into two assertions rather than one set-equality so a failure says
    WHICH direction drifted — a lane added without updating the roster reads
    very differently from a lane that silently stopped running.
    """
    found = invoking_files(script_ref)

    extra = found - declared
    assert not extra, (
        f"{sorted(extra)} invoke {script_ref}, but the tree documents "
        f"{len(declared)} lane(s): {sorted(declared)}. Either drop the "
        f"invocation, or add the lane HERE and to every enumeration of the "
        f"roster — starting with {script_ref}'s own module docstring, which "
        "the companion test asserts names every lane."
    )

    missing = declared - found
    assert not missing, (
        f"{sorted(missing)} no longer invoke {script_ref}. A lane that stops "
        "running is a gate that quietly narrowed; delete it from this roster "
        "in the same change that removes it, so the loss is deliberate rather "
        "than discovered later."
    )


def assert_docstring_names_every_lane(
    docstring: str | None, script_ref: str, declared: frozenset[str]
) -> None:
    """The roster in prose must be the roster in the tree.

    Each gate opens by listing the lanes that invoke it. That list is what a
    reader trusts INSTEAD of grepping, so a lane added without touching it
    leaves the script confidently describing a shape the repo no longer has —
    which is the exact state ``a208240e2`` left the tree in for 90 commits.
    """
    text = docstring or ""
    assert text.strip(), (
        f"{script_ref} has no module docstring, so it declares no lane roster "
        "for this test to hold it to."
    )
    for lane in sorted(declared):
        assert lane in text, (
            f"{lane} invokes the gate but is not named in {script_ref}'s module "
            "docstring."
        )
