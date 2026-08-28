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
