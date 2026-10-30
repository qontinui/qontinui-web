"""The ci_node lane's step that makes the pinned schemas commits readable.

``scripts/ci/fetch_pinned_schemas_commits.py`` exists because that lane's sibling
is a depth-1 clone: the frontend suite's ``git show <ref>:<path>`` fallback finds
nothing there, so the first schemas edit past a pin would redden every web PR.
These tests build the same shape from local repositories, with no network.

What they pin:

1. The commit is absent from a shallow sibling before the step and readable after
   it, with HEAD and the working tree where they were.
2. A commit already present costs no fetch.
3. A file at another digest, a commit the remote will not serve, a missing sibling
   and a malformed pin each exit non-zero and name what was wrong.
4. The live manifest runs the step before both frontend test steps, the script's
   table covers every pin file at the repo root, and the live pins are well formed.
5. The lane roster.
"""

from __future__ import annotations

import ast
import hashlib
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT_REF = "scripts/ci/fetch_pinned_schemas_commits.py"
SCRIPT = REPO_ROOT / _SCRIPT_REF
_DECLARED_LANES = frozenset({".qontinui/ci.toml"})

CONTRACT = "rust/src/spawn_authorization.json"
NOUNS = "fleet-nouns.toml"

sys.path.insert(0, str(SCRIPT.parent))
import fetch_pinned_schemas_commits as step  # noqa: E402


def _git(cwd: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )
    return done.stdout.strip()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


class _Layout:
    """A schemas origin with two commits, a shallow clone of its tip, a repo root."""

    def __init__(self, tmp: Path) -> None:
        self.origin = tmp / "origin"
        self.root = tmp / "dispatch" / "qontinui-web"
        self.sibling = tmp / "dispatch" / "qontinui-schemas"
        self.root.mkdir(parents=True)
        self.origin.mkdir()
        _git(self.origin, "init", "-q", "-b", "main")
        _git(self.origin, "config", "uploadpack.allowAnySHA1InWant", "true")
        (self.origin / "rust" / "src").mkdir(parents=True)
        self.old_contract = '{"pinned":true}\n'
        self.old_nouns = "pinned = true\n"
        self._commit('{"pinned":true}\n', "pinned = true\n")
        self.pinned = _git(self.origin, "rev-parse", "HEAD")
        self._commit('{"pinned":false}\n', "pinned = false\n")
        self.tip = _git(self.origin, "rev-parse", "HEAD")
        _git(
            tmp,
            "clone",
            "-q",
            "--depth",
            "1",
            self.origin.as_uri(),
            str(self.sibling),
        )
        self.pin()

    def _commit(self, contract: str, nouns: str) -> None:
        (self.origin / CONTRACT).write_text(contract)
        (self.origin / NOUNS).write_text(nouns)
        _git(self.origin, "add", "-A")
        _git(self.origin, "commit", "-q", "-m", "edit")

    def pin(self, *, ref: str | None = None, sha256: str | None = None) -> None:
        ref = ref or self.pinned
        (self.root / "spawn-contract.pin.toml").write_text(
            f'[spawn_contract]\nref = "{ref}"\n'
            f'sha256 = "{sha256 or _sha256(self.old_contract)}"\n'
        )
        (self.root / "fleet-nouns.pin.toml").write_text(
            f'[fleet_nouns]\nref = "{ref}"\nsha256 = "{_sha256(self.old_nouns)}"\n'
        )

    def has_pinned_file(self) -> bool:
        done = subprocess.run(
            ["git", "cat-file", "-e", f"{self.pinned}:{CONTRACT}"],
            cwd=self.sibling,
            capture_output=True,
            check=False,
        )
        return done.returncode == 0

    def run(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--repo-root", str(self.root)],
            capture_output=True,
            text=True,
            check=False,
        )


@pytest.fixture
def layout(tmp_path: Path) -> _Layout:
    return _Layout(tmp_path)


def test_it_fetches_the_pinned_commit_into_a_shallow_sibling(layout: _Layout) -> None:
    assert layout.tip != layout.pinned
    assert _git(layout.sibling, "rev-parse", "--is-shallow-repository") == "true"
    assert not layout.has_pinned_file(), "the fixture must start in the failing shape"

    done = layout.run()

    assert done.returncode == 0, done.stderr
    assert layout.has_pinned_file()
    assert _git(layout.sibling, "show", f"{layout.pinned}:{CONTRACT}") == (
        layout.old_contract.strip()
    )
    assert "fetched" in done.stdout
    assert "spawn-contract.pin.toml" in done.stdout
    assert "fleet-nouns.pin.toml" in done.stdout


def test_it_moves_neither_head_nor_the_working_tree(layout: _Layout) -> None:
    assert layout.run().returncode == 0
    assert _git(layout.sibling, "rev-parse", "HEAD") == layout.tip
    assert _git(layout.sibling, "status", "--porcelain") == ""
    assert (layout.sibling / CONTRACT).read_text() == '{"pinned":false}\n'


def test_a_commit_already_present_costs_no_fetch(layout: _Layout) -> None:
    assert layout.run().returncode == 0
    _git(layout.sibling, "remote", "remove", "origin")

    done = layout.run()

    assert done.returncode == 0, done.stderr
    assert "already present" in done.stdout


def test_it_leaves_a_full_clone_unshallowed(layout: _Layout, tmp_path: Path) -> None:
    full = layout.sibling
    shutil.rmtree(full)
    _git(tmp_path, "clone", "-q", layout.origin.as_uri(), str(full))
    # A commit the clone has not seen: what a developer's stale checkout meets.
    layout._commit('{"pinned":"newer"}\n', "pinned = 'newer'\n")
    newer = _git(layout.origin, "rev-parse", "HEAD")
    layout.old_contract = '{"pinned":"newer"}\n'
    layout.old_nouns = "pinned = 'newer'\n"
    layout.pin(ref=newer)

    assert layout.run().returncode == 0
    assert _git(full, "rev-parse", "--is-shallow-repository") == "false"


def test_a_file_at_another_digest_is_refused_naming_both(layout: _Layout) -> None:
    wrong = "0" * 64
    layout.pin(sha256=wrong)

    done = layout.run()

    assert done.returncode == step.EXIT_UNAVAILABLE
    assert wrong in done.stderr
    assert _sha256(layout.old_contract) in done.stderr


def test_a_commit_the_remote_will_not_serve_is_refused_naming_it(
    layout: _Layout,
) -> None:
    missing = "1" * 40
    layout.pin(ref=missing)

    done = layout.run()

    assert done.returncode == step.EXIT_UNAVAILABLE
    assert missing in done.stderr


def test_a_missing_sibling_is_not_a_pass(layout: _Layout) -> None:
    shutil.rmtree(layout.sibling)

    done = layout.run()

    assert done.returncode == step.EXIT_CANNOT_RUN
    assert str(layout.sibling) in done.stderr


def test_a_malformed_pin_is_not_a_pass(layout: _Layout) -> None:
    (layout.root / "spawn-contract.pin.toml").write_text(
        '[spawn_contract]\nref = "x"\n'
    )

    done = layout.run()

    assert done.returncode == step.EXIT_CANNOT_RUN
    assert "spawn-contract.pin.toml" in done.stderr


def _manifest_steps() -> list[dict[str, object]]:
    manifest = tomllib.loads((REPO_ROOT / ".qontinui" / "ci.toml").read_text("utf-8"))
    return manifest["steps"]


def test_the_lane_runs_the_step_before_both_frontend_test_steps() -> None:
    names = [s["name"] for s in _manifest_steps()]
    fetch_at = names.index("fetch-pinned-schemas-commits")
    assert fetch_at < names.index("frontend-test")
    assert fetch_at < names.index("composed-test")


def test_the_steps_table_covers_every_pin_file_at_the_repo_root() -> None:
    on_disk = {p.name for p in REPO_ROOT.glob("*.pin.toml")}
    assert on_disk == {pin_file for pin_file, _, _ in step.PINS}


@pytest.mark.parametrize(("pin_file", "table", "path"), step.PINS)
def test_the_live_pins_are_well_formed(pin_file: str, table: str, path: str) -> None:
    ref, sha256 = step.read_pin(REPO_ROOT / pin_file, table)
    assert len(ref) == 40
    assert len(sha256) == 64
    assert path


def test_the_lane_roster_is_exactly_the_declared_lanes() -> None:
    assert_lane_roster(_SCRIPT_REF, _DECLARED_LANES)


def test_the_scripts_docstring_names_every_lane() -> None:
    docstring = ast.get_docstring(ast.parse(SCRIPT.read_text(encoding="utf-8")))
    assert_docstring_names_every_lane(docstring, _SCRIPT_REF, _DECLARED_LANES)
