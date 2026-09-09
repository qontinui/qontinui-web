"""Regression tests for the ruff version-parity gate.

``scripts/ci/check_ruff_version_parity.py`` keeps the ruff a developer's
pre-commit hooks run identical to the ruff ``backend-ci.yml``'s ``lint`` job
runs. ``505f5738`` added the ``ruff-format`` hook and named this residual in its
own commit message: the hook was pinned at ``v0.14.0`` while ``poetry.lock``
resolved ``0.14.14``.

What these tests pin:

1. The LIVE invariant — the committed tree is in parity right now. This is the
   assertion with teeth; everything else is about the gate's own machinery.
2. The ``v`` prefix is normalized. ruff-pre-commit tags ``v0.14.14`` and PyPI
   says ``0.14.14``; comparing raw strings would report a permanent false drift
   that no edit could clear.
3. The pin is read from the ruff block SPECIFICALLY. The config pins other
   repos at revs of their own, so a scan taking the first ``rev:`` it saw would
   compare ruff against ``pre-commit-hooks`` and be silently, confidently wrong.
4. Drift exits 1 and NAMES the token to write, the property that makes the
   sibling alembic gate a 2-second fix instead of a CI round trip.
5. Lockfiles that disagree with EACH OTHER are reported as their own condition
   — there is no single version to pin to, so advising one would be a guess.
6. A comparison that could not run exits 2, never 0. A gate that passes because
   it found nothing to check is the failure class ``_gate_lib`` exists to
   prevent.
7. The LANE ROSTER — exactly three files invoke this script, the three the
   tree documents. ``a208240e2`` added a fourth (a step in ``backend-ci.yml``)
   and nothing noticed: all three enumerations went on saying "three lanes",
   and the new one sat behind a ``paths:`` filter naming neither file that can
   create the drift, so it could not fire on the change it was added for.
8. The script's own docstring names every lane. It is the roster a reader
   trusts instead of grepping, so a lane added without touching it leaves the
   script describing a shape the repo no longer has.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
sys.path.insert(0, str(SCRIPTS_CI))

import check_ruff_version_parity as gate  # noqa: E402

GATE_SCRIPT = SCRIPTS_CI / "check_ruff_version_parity.py"

# Two pinned repos, ruff second, so a first-match scan would read the wrong one.
_CONFIG_TWO_REPOS = """\
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: check-yaml

  - repo: https://github.com/astral-sh/ruff-pre-commit
    # a comment between the repo and its rev
    rev: v0.14.14
    hooks:
      - id: ruff-check
      - id: ruff-format
"""


def _write_config(tmp_path: Path, body: str, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / ".pre-commit-config.yaml"
    path.write_text(body, encoding="utf-8")
    monkeypatch.setattr(gate, "PRE_COMMIT_CONFIG", path)
    return path


def test_the_committed_tree_is_in_parity() -> None:
    """The live invariant, exercised through the same entry point CI uses."""
    result = subprocess.run(
        [sys.executable, str(GATE_SCRIPT)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    assert result.returncode == 0, (
        "the pre-commit ruff pin and the lockfiles have drifted apart:\n"
        f"{result.stdout}\n{result.stderr}"
    )


@pytest.mark.parametrize(
    ("left", "right"),
    [("v0.14.14", "0.14.14"), ("0.14.14", "0.14.14"), ("v1.0.0", "v1.0.0")],
)
def test_the_v_prefix_is_not_a_difference(left: str, right: str) -> None:
    assert gate._normalize(left) == gate._normalize(right)


def test_the_rev_is_read_from_the_ruff_block_not_the_first_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_config(tmp_path, _CONFIG_TWO_REPOS, monkeypatch)
    assert gate.read_pinned_rev() == "v0.14.14"


def test_a_config_without_the_ruff_block_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_config(
        tmp_path,
        "repos:\n"
        "  - repo: https://github.com/pre-commit/pre-commit-hooks\n"
        "    rev: v4.6.0\n"
        "    hooks:\n"
        "      - id: check-yaml\n",
        monkeypatch,
    )
    assert gate.read_pinned_rev() is None
    assert gate.main() == gate.EXIT_VACUOUS


def test_drift_exits_one_and_names_the_token_to_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _write_config(
        tmp_path, _CONFIG_TWO_REPOS.replace("v0.14.14", "v0.14.0"), monkeypatch
    )
    monkeypatch.setattr(
        gate, "locked_ruff_versions", lambda: {"backend/poetry.lock": "0.14.14"}
    )

    assert gate.main() == gate.EXIT_VIOLATION

    captured = capsys.readouterr().err
    assert "backend/poetry.lock resolves ruff 0.14.14" in captured
    # The remedy is the exact line to write, not a description of it.
    assert "rev: v0.14.14" in captured


def test_lockfiles_disagreeing_with_each_other_get_their_own_verdict(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _write_config(tmp_path, _CONFIG_TWO_REPOS, monkeypatch)
    monkeypatch.setattr(
        gate,
        "locked_ruff_versions",
        lambda: {"poetry.lock": "0.14.0", "backend/poetry.lock": "0.15.1"},
    )

    assert gate.main() == gate.EXIT_VIOLATION

    captured = capsys.readouterr().err
    assert "do not agree with EACH OTHER" in captured
    # No single pin is advised, because there is no correct one to advise.
    assert "Fix: in" not in captured


def test_no_lockfile_resolving_ruff_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_config(tmp_path, _CONFIG_TWO_REPOS, monkeypatch)
    monkeypatch.setattr(gate, "locked_ruff_versions", dict)

    with pytest.raises(SystemExit) as exc:
        gate.main()
    assert exc.value.code == gate.EXIT_VACUOUS


def test_a_failed_lockfile_read_is_vacuous_not_clean(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_config(tmp_path, _CONFIG_TWO_REPOS, monkeypatch)
    monkeypatch.setattr(gate, "locked_ruff_versions", lambda: None)
    assert gate.main() == gate.EXIT_VACUOUS


# ---------------------------------------------------------------------------
# The lane roster. Not machinery — this is the invariant `a208240e2` broke.
#
# That commit added a FOURTH invocation of this script, a step in
# `backend-ci.yml`'s `lint` job, while three places in the tree enumerate the
# lanes and say there are three: the gate script's docstring, the
# `ruff-version-parity` pre-commit hook's comment, and
# `.github/workflows/ruff-version-parity.yml`'s header — whose next paragraph
# states outright that the gate is NOT a step in `backend-ci.yml`, and gives
# the reason. Nothing failed. The prose went quietly wrong, and the extra lane
# sat behind a `paths:` filter listing neither file that can create the drift,
# so it could not run on the change it was added to catch.
#
# The lane count is the whole "same committed script" shape `.qontinui/ci.toml`
# calls preferred ("the two lanes cannot drift because there is only one copy
# of the logic"). A roster nobody checks is a roster that rots, which is the
# same argument this gate makes about the ruff pin one level down.
# ---------------------------------------------------------------------------

# Repo-relative, exactly as the invoking lines spell it.
_SCRIPT_REF = "scripts/ci/check_ruff_version_parity.py"

# The three lanes, and the reason each one exists rather than the other two:
#   * the workflow — the GitHub Actions lane. Deliberately UNFILTERED (its own
#     header says why), so it reports on every candidate instead of hanging in
#     awaiting-ci on the ones that touch neither file;
#   * .qontinui/ci.toml — the runner-as-CI-node lane, which is why the script
#     is stdlib-only;
#   * the pre-commit hook — catches the drift before the push, since editing
#     either side is what creates it.
_DECLARED_LANES = frozenset(
    {
        ".github/workflows/ruff-version-parity.yml",
        ".pre-commit-config.yaml",
        ".qontinui/ci.toml",
    }
)

# The script and this test both NAME the path in prose. Excluded by identity
# rather than by a cleverer pattern: a regex that tried to tell an invocation
# from a mention inside a docstring would be the fragile half of this test.
# This file's own entry is derived, not spelled, so a rename cannot leave a
# stale literal here quietly re-admitting it to the roster.
_NOT_LANES = frozenset(
    {_SCRIPT_REF, Path(__file__).resolve().relative_to(REPO_ROOT).as_posix()}
)


def _invoking_files() -> set[str]:
    """Tracked files with a NON-COMMENT line naming the script.

    A plain grep would count mentions: ``backend-ci.yml`` names the script in
    the comment on its `paths:` filter (that filter is what makes THIS test run
    on a change to ``scripts/ci/**`` at all), and removing that entry to make a
    grep tidy would blind the gate's own tests to the gate's own edits.
    """
    listing = subprocess.run(
        ["git", "grep", "-In", "--fixed-strings", _SCRIPT_REF],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    # `git grep` exits 1 for "no matches", which here means the scan proved
    # nothing — this file alone guarantees at least one hit — so both non-zero
    # codes are failures rather than an empty set.
    assert listing.returncode == 0, (
        f"`git grep` for {_SCRIPT_REF} exited {listing.returncode}; the lane "
        f"roster was not scanned. stderr: {listing.stderr.strip()}"
    )

    found: set[str] = set()
    for line in listing.stdout.splitlines():
        path, _, rest = line.partition(":")
        _, _, content = rest.partition(":")
        if content.lstrip().startswith("#"):
            continue
        if path in _NOT_LANES:
            continue
        found.add(path)
    return found


def test_the_lane_roster_is_exactly_the_three_declared_lanes() -> None:
    found = _invoking_files()

    extra = found - _DECLARED_LANES
    assert not extra, (
        f"{sorted(extra)} invoke {_SCRIPT_REF}, but the tree documents three "
        "lanes. Either drop the invocation, or add the lane HERE and to all "
        "three enumerations of the roster: the docstring of "
        f"{_SCRIPT_REF}, the `ruff-version-parity` hook comment in "
        ".pre-commit-config.yaml, and the header of "
        ".github/workflows/ruff-version-parity.yml -- which says the gate is "
        "NOT a step in backend-ci.yml, and is exactly the sentence a fourth "
        "lane falsified once already, in `a208240e2`."
    )

    missing = _DECLARED_LANES - found
    assert not missing, (
        f"{sorted(missing)} no longer invoke {_SCRIPT_REF}. A lane that stops "
        "running is a gate that quietly narrowed; delete it from this roster "
        "in the same change that removes it, so the loss is deliberate."
    )


def test_the_scripts_docstring_names_every_lane() -> None:
    """The roster in prose must be the roster in the tree.

    ``check_ruff_version_parity.py`` opens by listing the lanes that invoke it.
    That list is what a reader trusts instead of grepping, so a lane added
    without touching it leaves the script confidently describing a shape the
    repo no longer has.
    """
    docstring = gate.__doc__ or ""
    for lane in sorted(_DECLARED_LANES):
        assert lane in docstring, (
            f"{lane} invokes the gate but is not named in "
            f"{_SCRIPT_REF}'s module docstring."
        )
