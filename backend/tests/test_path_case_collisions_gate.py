"""Regression tests for the path-case-collision gate.

``scripts/ci/check_path_case_collisions.py`` is THE single home of the rule
that no two tracked paths, and no two TS/JS module stems, may differ only in
case. ``8f053ba47`` (PR #1282) renamed ``TranscriptStores.tsx`` because the
same directory tracked ``transcriptStores.ts`` — two distinct paths, but ONE
module specifier: ``import "./TranscriptStores"`` probes the ``.ts`` spelling
first, and on a case-insensitive filesystem that probe finds the lowercase
module. Every Windows and macOS box then failed the ``tsc-typecheck``
pre-commit hook on every frontend commit, while Linux CI — case-sensitive —
never saw a thing.

What these tests pin:

1. The LIVE invariant — the committed tree has no collision right now. This is
   the assertion with teeth; everything else is about the gate's machinery.
2. The #1282 pair is a MODULE-STEM collision and is reported as one. A gate
   that compared only full paths would pass the exact tree the incident came
   from, because ``.tsx`` and ``.ts`` are different paths — so this is the
   test that says the gate is aimed at the defect that motivated it.
3. Same-case stems with two extensions (``foo.ts`` beside ``foo.tsx``) are NOT
   reported. That resolves identically everywhere by extension priority; it is
   a different smell, and reporting it would make the gate cry wolf on a
   pattern the tree may legitimately hold.
4. Full-path collisions are reported at the SHALLOWEST prefix: a colliding
   directory is one finding, not one per file beneath it, and the stems under
   it are not reported a second time.
5. A directory holding an ``index.<ext>`` is a module stem, so ``Foo/index.ts``
   beside ``foo.ts`` is the #1282 defect with a directory on one side.
6. The fold is per-character (``str.lower``), not full case folding: ``ß`` and
   ``ss`` are distinct on NTFS and APFS, so they are distinct here.
7. The gate reads the INDEX, end to end: a temporary repository whose index
   holds both spellings — which no case-insensitive working tree could hold —
   exits 1 and names the pair. Built with ``git update-index --cacheinfo`` so
   the fixture is the same on every platform, including the one where the
   defect is real.
8. A collision exits 1 and NAMES both members; an empty index exits 2, never
   0 — the vacuous-pass class ``_gate_lib`` exists to prevent.
9. The LANE ROSTER — exactly three files invoke this script, the three the
   tree documents, and the script's own docstring names every one.
"""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

import pytest

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

import check_path_case_collisions as gate  # noqa: E402

_SCRIPT_REF = "scripts/ci/check_path_case_collisions.py"
GATE_SCRIPT = REPO_ROOT / _SCRIPT_REF

_DECLARED_LANES = frozenset(
    {
        ".github/workflows/path-case-collisions.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)

# The two paths #1282 found tracked side by side, exactly as the index spelt
# them. Distinct paths; one module specifier.
_PR_1282_PAIR = [
    "frontend/src/components/sessions/TranscriptStores.tsx",
    "frontend/src/components/sessions/transcriptStores.ts",
]


# --------------------------------------------------------------------------
# 1. The live invariant
# --------------------------------------------------------------------------


def test_the_committed_tree_has_no_collision() -> None:
    result = subprocess.run(
        [sys.executable, str(GATE_SCRIPT)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert result.returncode == 0, (
        f"the gate exited {result.returncode} on the committed tree:\n{result.stderr}"
    )
    assert "scanned" in result.stdout, (
        "a clean run must say how many files it scanned, or a vacuous run "
        f"would be indistinguishable from it: {result.stdout!r}"
    )


# --------------------------------------------------------------------------
# 2-6. The classification, on literal index listings
# --------------------------------------------------------------------------


def test_the_pr_1282_pair_is_a_module_stem_collision_not_a_path_one() -> None:
    tracked = [*_PR_1282_PAIR, "frontend/src/components/sessions/index.ts"]
    assert gate.path_collisions(tracked) == []
    assert gate.module_stem_collisions(tracked) == [sorted(_PR_1282_PAIR)]


def test_same_case_stem_with_two_extensions_is_not_reported() -> None:
    tracked = ["a/foo.ts", "a/foo.tsx", "a/foo.d.ts"]
    assert gate.path_collisions(tracked) == []
    assert gate.module_stem_collisions(tracked) == []


def test_a_colliding_directory_is_one_finding_at_the_shallowest_prefix() -> None:
    tracked = ["Foo/x.ts", "foo/y.ts", "foo/X.ts", "bar/z.ts"]
    paths = gate.path_collisions(tracked)
    assert paths == [["Foo", "foo"]]
    # `Foo/x.ts` vs `foo/X.ts` collide as stems only BECAUSE the directory
    # does; renaming the directory fixes both, so they are not a second finding.
    assert gate._outside(gate.module_stem_collisions(tracked), paths) == []


def test_a_leaf_path_collision_inside_a_clean_directory_names_the_leaves() -> None:
    tracked = ["docs/README.md", "docs/Readme.md", "docs/other.md"]
    assert gate.path_collisions(tracked) == [["docs/README.md", "docs/Readme.md"]]


def test_a_directory_with_an_index_file_is_a_module_stem() -> None:
    tracked = ["a/Foo/index.ts", "a/foo.ts"]
    assert gate.module_stem_collisions(tracked) == [["a/Foo/", "a/foo.ts"]]
    # ...and without the index file it is just a directory, importable by no
    # bare specifier, so there is nothing to collide with.
    assert gate.module_stem_collisions(["a/Foo/bar.ts", "a/foo.ts"]) == []


def test_dot_d_ts_is_stripped_as_one_extension() -> None:
    assert gate._module_stem("a/foo.d.ts") == "a/foo"
    assert gate._module_stem("a/foo.ts") == "a/foo"
    assert gate._module_stem("a/foo.md") is None
    assert gate.module_stem_collisions(["a/foo.d.ts", "a/Foo.ts"]) == [
        ["a/Foo.ts", "a/foo.d.ts"]
    ]


def test_the_fold_is_per_character_not_full_casefold() -> None:
    # `"straße".casefold() == "strasse"`; NTFS and APFS keep them distinct.
    tracked = ["straße.ts", "strasse.ts"]
    assert gate.path_collisions(tracked) == []
    assert gate.module_stem_collisions(tracked) == []


# --------------------------------------------------------------------------
# 7-8. End to end, against a real index
# --------------------------------------------------------------------------

_EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )


def _repo_with_index(tmp_path: Path, paths: list[str]) -> Path:
    """A repository whose INDEX holds ``paths`` — and whose tree holds nothing.

    ``--cacheinfo`` writes index entries directly, so two spellings that a
    case-insensitive filesystem could never both materialise still coexist in
    the index. That is the state a Linux-authored commit leaves a Windows clone
    in, and it is the state the gate must see through.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    # Write the empty blob so every entry points at a real object; `ls-files`
    # would list a dangling entry too, but a fixture should not rely on that.
    written = subprocess.run(
        ["git", "hash-object", "-w", "--stdin"],
        cwd=repo,
        input="",
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout.strip()
    assert written == _EMPTY_BLOB
    for path in paths:
        _git(
            repo, "update-index", "--add", "--cacheinfo", f"100644,{_EMPTY_BLOB},{path}"
        )
    return repo


def _run_gate_in(repo: Path, monkeypatch: pytest.MonkeyPatch) -> int:
    monkeypatch.setattr(gate, "REPO_ROOT", repo)
    return gate.main()


def test_a_colliding_index_exits_one_and_names_both_members(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    repo = _repo_with_index(tmp_path, [*_PR_1282_PAIR, "README.md"])
    assert _run_gate_in(repo, monkeypatch) == gate.EXIT_VIOLATION
    stderr = capsys.readouterr().err
    for member in _PR_1282_PAIR:
        assert member in stderr, f"{member} not named in:\n{stderr}"
    assert "TS1149" in stderr, "the remediation must name the tsc error a reader saw"


def test_a_clean_index_exits_zero_and_reports_the_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    repo = _repo_with_index(tmp_path, ["a/foo.ts", "a/Bar.tsx", "README.md"])
    assert _run_gate_in(repo, monkeypatch) == 0
    assert "scanned 3 tracked file(s)" in capsys.readouterr().out


def test_an_empty_index_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repo_with_index(tmp_path, [])
    with pytest.raises(SystemExit) as exc:
        _run_gate_in(repo, monkeypatch)
    assert exc.value.code == gate.EXIT_VACUOUS


def test_a_failed_git_call_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Not a repository at all: `git ls-files` errors, and that must not read
    # as "no tracked files collide".
    not_a_repo = tmp_path / "plain"
    not_a_repo.mkdir()
    assert _run_gate_in(not_a_repo, monkeypatch) == gate.EXIT_VACUOUS


# --------------------------------------------------------------------------
# 9. The lane roster
# --------------------------------------------------------------------------


def _gate_docstring() -> str | None:
    source = GATE_SCRIPT.read_text(encoding="utf-8")
    return ast.get_docstring(ast.parse(source))


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    assert_docstring_names_every_lane(_gate_docstring(), _SCRIPT_REF, _DECLARED_LANES)
