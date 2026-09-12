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
4. Full-path collisions are reported at the SHALLOWEST prefix that explains
   them: a colliding directory is one finding, not one per file beneath it,
   and the stems under it are not reported a second time — but a nested pair
   that STILL differs below the colliding ancestor (``Foo/Bar`` vs
   ``Foo/bar``) is a second defect the directory rename leaves behind, and is
   kept. A TS leaf pair that collides as a path is one finding, not one under
   each heading.
5. A directory holding an ``index.<ext>`` is a module stem, so ``Foo/index.ts``
   beside ``foo.ts`` is the #1282 defect with a directory on one side.
   ``.d.mts``/``.d.cts`` strip as one extension like ``.d.ts``, and an
   upper-cased extension is still a module — a probe for ``Foo.ts`` hits
   ``foo.TS`` on the same filesystems.
6. The fold is per-character (``str.lower``), not full case folding: ``ß`` and
   ``ss`` are distinct on NTFS and APFS, so they are distinct here.
7. The gate reads the INDEX, end to end: a temporary repository whose index
   holds both spellings — which no case-insensitive working tree could hold —
   exits 1 and names the pair. Built with ``git update-index --cacheinfo`` so
   the fixture is the same on every platform, including the one where the
   defect is real. And it reads it NUL-delimited: without ``-z`` git C-quotes
   any non-ASCII path, so ``Ärger.ts``/``ärger.ts`` would be folded as the
   literal octal-escaped string and pass — the one place where the sibling
   gate's ``ls-files`` call, copied verbatim, would have been wrong here.
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
    tracked = ["Foo/x.ts", "foo/y.ts", "foo/x.ts", "bar/z.ts"]
    paths = gate.path_collisions(tracked)
    assert paths == [["Foo", "foo"]]
    # `Foo/x.ts` vs `foo/x.ts` collide as stems only BECAUSE the directory
    # does; renaming the directory fixes both, so they are not a second finding.
    assert gate._outside(gate.module_stem_collisions(tracked), paths) == []


def test_a_nested_pair_that_still_differs_below_the_ancestor_is_kept() -> None:
    # Renaming `Foo` -> `foo` leaves `foo/Bar` beside `foo/bar`: a second
    # defect, reported now rather than on the next commit.
    tracked = ["Foo/a.ts", "foo/b.ts", "Foo/Bar/x.ts", "Foo/bar/y.ts"]
    assert gate.path_collisions(tracked) == [["Foo", "foo"], ["Foo/Bar", "Foo/bar"]]
    # ...whereas a nested pair that differs ONLY in the ancestor is explained
    # by it, and dropped.
    tracked = ["Foo/x.ts", "foo/x.ts", "Foo/Bar/q.ts", "foo/Bar/r.ts"]
    assert gate.path_collisions(tracked) == [["Foo", "foo"]]


def test_a_ts_leaf_pair_that_collides_as_a_path_is_reported_once() -> None:
    tracked = ["a/Foo.ts", "a/foo.ts"]
    paths = gate.path_collisions(tracked)
    assert paths == [["a/Foo.ts", "a/foo.ts"]]
    assert gate._outside(gate.module_stem_collisions(tracked), paths) == []
    # A third spelling joining the stem group does not resurrect it: renaming
    # `a/Foo.ts` still fixes all of it.
    tracked = ["a/Foo.ts", "a/foo.ts", "a/foo.tsx"]
    paths = gate.path_collisions(tracked)
    assert gate._outside(gate.module_stem_collisions(tracked), paths) == []


def test_an_upper_cased_index_file_still_makes_its_directory_a_stem() -> None:
    assert gate.module_stem_collisions(["a/Foo/INDEX.TS", "a/foo.ts"]) == [
        ["a/Foo/", "a/foo.ts"]
    ]


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
    assert gate._module_stem("a/foo.d.mts") == "a/foo"
    assert gate._module_stem("a/foo.d.cts") == "a/foo"
    assert gate._module_stem("a/foo.ts") == "a/foo"
    assert gate._module_stem("a/foo.md") is None
    # A bare extension is a dotfile, not a module with an empty name.
    assert gate._module_stem("a/.ts") is None
    assert gate._module_stem(".ts") is None
    assert gate.module_stem_collisions(["a/foo.d.ts", "a/Foo.ts"]) == [
        ["a/Foo.ts", "a/foo.d.ts"]
    ]


def test_an_upper_cased_extension_is_still_a_module() -> None:
    assert gate._module_stem("a/foo.TS") == "a/foo"
    assert gate.module_stem_collisions(["a/Foo.tsx", "a/foo.TS"]) == [
        ["a/Foo.tsx", "a/foo.TS"]
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
BACKSLASH = chr(92)


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )


_AMBIENT_GIT_VARS = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")


def _isolate_git(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the fixture's git calls off the caller's repository.

    Under a git hook (or some wrappers) ``GIT_DIR`` / ``GIT_INDEX_FILE`` are
    exported, and ``update-index`` would then write the fixture's entries into
    the CALLER's index. ``GIT_CEILING_DIRECTORIES`` stops a plain directory
    under ``tmp_path`` from resolving to whatever repository happens to
    enclose the temp root.
    """
    for var in _AMBIENT_GIT_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path))


def _repo_with_index(
    tmp_path: Path, paths: list[str], monkeypatch: pytest.MonkeyPatch
) -> Path:
    """A repository whose INDEX holds ``paths`` — and whose tree holds nothing.

    ``--cacheinfo`` writes index entries directly, so two spellings that a
    case-insensitive filesystem could never both materialise still coexist in
    the index. That is the state a Linux-authored commit leaves a Windows clone
    in, and it is the state the gate must see through.
    """
    _isolate_git(tmp_path, monkeypatch)
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
    repo = _repo_with_index(tmp_path, [*_PR_1282_PAIR, "README.md"], monkeypatch)
    assert _run_gate_in(repo, monkeypatch) == gate.EXIT_VIOLATION
    stderr = capsys.readouterr().err
    for member in _PR_1282_PAIR:
        assert member in stderr, f"{member} not named in:\n{stderr}"
    assert "TS1149" in stderr, "the remediation must name the tsc error a reader saw"


def test_non_ascii_paths_are_folded_not_quoted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Default `core.quotePath` C-quotes every one of these in plain `ls-files`
    # output; `-z` is what lets the gate see the real names. A path pair, a
    # stem pair and a directory pair, each with a non-ASCII byte in play.
    repo = _repo_with_index(
        tmp_path,
        ["Ärger.ts", "ärger.ts", "Foo/ü.ts", "foo/x.ts", "README.md"],
        monkeypatch,
    )
    assert _run_gate_in(repo, monkeypatch) == gate.EXIT_VIOLATION
    stderr = capsys.readouterr().err
    assert "Ärger.ts  <->  ärger.ts" in stderr, stderr
    assert "Foo  <->  foo" in stderr, stderr
    assert BACKSLASH + "303" not in stderr, "a C-quoted path leaked into the report"


def test_a_clean_index_exits_zero_and_reports_the_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    repo = _repo_with_index(
        tmp_path, ["a/foo.ts", "a/Bar.tsx", "README.md"], monkeypatch
    )
    assert _run_gate_in(repo, monkeypatch) == 0
    assert "scanned 3 tracked file(s)" in capsys.readouterr().out


def test_an_empty_index_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _repo_with_index(tmp_path, [], monkeypatch)
    with pytest.raises(SystemExit) as exc:
        _run_gate_in(repo, monkeypatch)
    assert exc.value.code == gate.EXIT_VACUOUS


def test_a_failed_git_call_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Not a repository at all: `git ls-files` errors, and that must not read
    # as "no tracked files collide".
    _isolate_git(tmp_path, monkeypatch)
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
