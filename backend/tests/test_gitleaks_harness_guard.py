"""Tests for `.github/scripts/harness-guarded.sh` and its gitleaks wiring.

`fetch-gitleaks.sh` prints `::error title=Gitleaks DID NOT RUN (not a verdict on
this PR)::` on every fetch failure, and coord reads that phrase as "re-run, not
the PR's fault". A PR that edits the fetch's own harness can cause that failure,
so `secret-scan.yml` runs the fetch through `harness-guarded.sh`, which keeps
the phrase only when a first-parent harness diff reads exactly `false` (plan
2026-11-17-gitleaks-not-a-verdict-title-has-no-harness-diff-guard).

The guard is exercised against real git repositories holding a real two-parent
merge commit, as `pull_request` checks out.

No assertion message here carries a raw output line: on CI pytest prints a
failure's message unprefixed, and a line opening with `::` would become a
workflow command annotating this shard with the very phrase under test. Messages
use `repr`, which keeps them on one line that opens with a quote.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
GUARD = REPO_ROOT / ".github" / "scripts" / "harness-guarded.sh"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "secret-scan.yml"
BACKEND_CI = REPO_ROOT / ".github" / "workflows" / "backend-ci.yml"
FETCH_STEP = "Fetch gitleaks (pinned, sha256-verified, host-cached)"

PHRASE = "(not a verdict on this PR)"
TITLE_LINE = f"::error title=Gitleaks DID NOT RUN {PHRASE}::the fetch failed."
HARNESS_PATHS = (
    ".github/workflows/secret-scan.yml",
    ".github/scripts/fetch-gitleaks.sh",
    ".github/scripts/harness-guarded.sh",
)

bash = shutil.which("bash")
git = shutil.which("git")
requires_bash_git = pytest.mark.skipif(
    not bash or not git or sys.platform == "win32",
    reason="harness-guarded.sh is a bash script run on Linux CI with git",
)


def _harness_re() -> str:
    step = _fetch_step()
    return step["env"]["HARNESS_PATHS_RE"]


def _fetch_step() -> dict:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = doc["jobs"]["gitleaks"]["steps"]
    return next(s for s in steps if s.get("name") == FETCH_STEP)


def _clean_env() -> dict[str, str]:
    """os.environ without GIT_* (a git hook's GIT_DIR would redirect every call)."""
    return {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def _git(repo: Path, *args: str) -> str:
    env = {
        **_clean_env(),
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
    }
    return subprocess.run(
        [git, "-C", str(repo), *args],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _merge_repo(tmp_path: Path, changed: str) -> tuple[Path, str]:
    """A repo whose HEAD is a pull_request-shaped merge commit.

    First parent: the base tip. Second parent: a PR commit changing `changed`.
    """
    repo = tmp_path / "ws"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    for rel in (*HARNESS_PATHS, "backend/app.py"):
        f = repo / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("base\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "base")
    _git(repo, "checkout", "-q", "-b", "pr")
    target = repo / changed
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("pr change\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "pr")
    _git(repo, "checkout", "-q", "main")
    # The base moves on too, so the first parent is not an ancestor of the PR.
    (repo / "backend" / "other.py").write_text("main moved\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-q", "-m", "main moves")
    _git(repo, "merge", "-q", "--no-ff", "-m", "merge pr", "pr")
    return repo, _git(repo, "rev-parse", "HEAD")


def _failing_fetch(tmp_path: Path, rc: int = 75) -> Path:
    stub = tmp_path / "fake-fetch.sh"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        "echo 'gitleaks: a progress line'\n"
        f"echo '{TITLE_LINE}'\n"
        f"echo 'stderr {PHRASE}' >&2\n"
        f"exit {rc}\n",
        encoding="utf-8",
    )
    stub.chmod(0o755)
    return stub


def _run(
    tmp_path: Path,
    repo: Path,
    sha: str,
    *,
    event: str = "pull_request",
    pattern: str | None = None,
    rc: int = 75,
) -> subprocess.CompletedProcess[str]:
    env = {
        **_clean_env(),
        "GITHUB_EVENT_NAME": event,
        "GITHUB_WORKSPACE": str(repo),
        "GITHUB_SHA": sha,
        "HARNESS_PATHS_RE": _harness_re() if pattern is None else pattern,
        "HARNESS_GUARD_FETCH_BOUND_SECS": "5",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
    }
    return subprocess.run(
        [bash, str(GUARD), bash, str(_failing_fetch(tmp_path, rc))],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _withheld(proc: subprocess.CompletedProcess[str], reason: str) -> None:
    out = proc.stdout + proc.stderr
    assert reason in proc.stdout, repr(out)
    assert PHRASE not in out, repr(out)
    assert "::notice title=Not-a-verdict claim withheld::" in proc.stdout, repr(out)
    assert "Gitleaks DID NOT RUN (counted as a verdict - " in proc.stdout, repr(out)
    # The failure is still reported, with its exit status.
    assert proc.returncode == 75, repr(out)


@requires_bash_git
def test_a_diff_outside_the_harness_keeps_the_claim(tmp_path: Path) -> None:
    repo, sha = _merge_repo(tmp_path, "backend/app.py")
    proc = _run(tmp_path, repo, sha)
    out = proc.stdout + proc.stderr
    assert proc.returncode == 75, repr(out)
    assert TITLE_LINE in proc.stdout.splitlines(), repr(out)
    assert "withheld" not in out, repr(out)


@requires_bash_git
@pytest.mark.parametrize("path", HARNESS_PATHS)
def test_a_diff_touching_the_harness_withholds_the_claim(
    tmp_path: Path, path: str
) -> None:
    repo, sha = _merge_repo(tmp_path, path)
    proc = _run(tmp_path, repo, sha)
    _withheld(proc, "touches this job's own harness ('" + path + "')")
    assert "this PR changes the harness of this step" in proc.stdout, repr(proc.stdout)


@requires_bash_git
def test_a_push_event_is_unknown_and_withholds(tmp_path: Path) -> None:
    repo, sha = _merge_repo(tmp_path, "backend/app.py")
    proc = _run(tmp_path, repo, sha, event="push")
    _withheld(proc, "the event is 'push', not pull_request")
    assert "the harness diff of this PR is unread" in proc.stdout, repr(proc.stdout)


@requires_bash_git
def test_a_one_parent_sha_is_unknown_and_withholds(tmp_path: Path) -> None:
    repo, _ = _merge_repo(tmp_path, "backend/app.py")
    pr_tip = _git(repo, "rev-parse", "pr")
    _withheld(_run(tmp_path, repo, pr_tip), "has 1 parent(s), not the two")


@requires_bash_git
@pytest.mark.parametrize(
    ("pattern", "reason"),
    [("", "HARNESS_PATHS_RE is empty"), ("(unclosed", "not a valid extended")],
    ids=["empty", "invalid"],
)
def test_a_bad_pattern_is_unknown_and_withholds(
    tmp_path: Path, pattern: str, reason: str
) -> None:
    repo, sha = _merge_repo(tmp_path, "backend/app.py")
    _withheld(_run(tmp_path, repo, sha, pattern=pattern), reason)


@requires_bash_git
def test_an_unfetchable_first_parent_is_unknown_and_withholds(
    tmp_path: Path,
) -> None:
    repo, sha = _merge_repo(tmp_path, "backend/app.py")
    # A shallow clone of the merge alone: the first parent is absent and the
    # clone's origin cannot serve it by sha (file:// with no uploadpack allow).
    shallow = tmp_path / "shallow"
    _git(tmp_path, "clone", "-q", "--depth=1", f"file://{repo}", str(shallow))
    _git(shallow, "remote", "set-url", "origin", str(tmp_path / "nowhere"))
    _withheld(_run(tmp_path, shallow, sha), "could not be fetched")


@requires_bash_git
def test_the_real_fetch_script_title_is_rewritten(tmp_path: Path) -> None:
    """The canonical fetch, failing offline on a malformed sha256, through the guard.

    Ties the rewrite to the title fetch-gitleaks.sh actually prints, not a stub's.
    """
    repo, sha = _merge_repo(tmp_path, ".github/scripts/fetch-gitleaks.sh")
    fetch = REPO_ROOT / ".github" / "scripts" / "fetch-gitleaks.sh"
    (tmp_path / "rt").mkdir()
    env = {
        **_clean_env(),
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_WORKSPACE": str(repo),
        "GITHUB_SHA": sha,
        "HARNESS_PATHS_RE": _harness_re(),
        "GITLEAKS_VERSION": "8.30.1",
        "GITLEAKS_SHA256": "not-a-sha",
        "RUNNER_TEMP": str(tmp_path / "rt"),
        "GITHUB_OUTPUT": str(tmp_path / "gho"),
    }
    plain = subprocess.run(
        [bash, str(fetch)], env=env, capture_output=True, text=True, timeout=60
    )
    assert plain.returncode == 75, repr(plain.stdout + plain.stderr)
    assert "Gitleaks DID NOT RUN " + PHRASE in plain.stdout, repr(plain.stdout)
    proc = subprocess.run(
        [bash, str(GUARD), bash, str(fetch)],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    _withheld(proc, "touches this job's own harness")


@requires_bash_git
def test_success_passes_through_with_status_zero(tmp_path: Path) -> None:
    repo, sha = _merge_repo(tmp_path, "backend/app.py")
    proc = _run(tmp_path, repo, sha, rc=0)
    assert proc.returncode == 0, repr(proc.stdout + proc.stderr)


def test_the_fetch_step_runs_the_fetch_through_the_guard() -> None:
    step = _fetch_step()
    assert (
        "bash .github/scripts/harness-guarded.sh bash .github/scripts/fetch-gitleaks.sh"
        in step["run"]
    )
    pattern = re.compile(_harness_re())
    for path in HARNESS_PATHS:
        assert pattern.search(path), path
    for path in ("backend/app.py", ".gitleaks.toml", ".github/workflows/ci.yml"):
        assert not pattern.search(path), path


def test_backend_ci_runs_on_changes_to_the_guard() -> None:
    workflow = yaml.safe_load(BACKEND_CI.read_text(encoding="utf-8"))
    triggers = workflow.get("on", workflow.get(True))
    for event in ("pull_request", "push"):
        assert ".github/scripts/harness-guarded.sh" in triggers[event]["paths"]
