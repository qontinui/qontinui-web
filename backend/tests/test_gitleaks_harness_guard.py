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
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from tests.setup_death_git import PrRepo, shallow_clone, stub_git, stub_timeout

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
    ".github/scripts/harness-diff-guard.sh",
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
    path_prefix: Path | None = None,
    env_override: dict[str, str | None] | None = None,
    script: Path = GUARD,
) -> subprocess.CompletedProcess[str]:
    """Run the shipped wrapper around a stub fetch that fails with ``rc``.

    ``path_prefix`` puts a stub ``git`` / ``timeout`` first on PATH.
    ``env_override`` sets a variable, or REMOVES it when its value is None, so
    a test can run with the fetch lever unset (the shipped 20 s bound) or set
    to any value. ``script`` runs a copy of the wrapper instead.
    """
    env: dict[str, str] = {
        **_clean_env(),
        "GITHUB_EVENT_NAME": event,
        "GITHUB_WORKSPACE": str(repo),
        "GITHUB_SHA": sha,
        "HARNESS_PATHS_RE": _harness_re() if pattern is None else pattern,
        "HARNESS_GUARD_FETCH_BOUND_SECS": "5",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
    }
    for key, value in (env_override or {}).items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    if path_prefix is not None:
        env["PATH"] = f"{path_prefix}:{env['PATH']}"
    return subprocess.run(
        [bash, str(script), bash, str(_failing_fetch(tmp_path, rc))],
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


def _shallow_clean_pr(tmp_path: Path) -> tuple[Path, str]:
    """A depth-1 clone of a clean PR's merge commit: the first parent is absent.

    Its origin serves any sha, so the guard's first-parent fetch can succeed.
    """
    home = tmp_path / "home"
    home.mkdir()
    pr = PrRepo(
        tmp_path / "origin", home, changes={"backend/app/main.py": "print('pr')\n"}
    )
    return shallow_clone(pr, tmp_path / "checkout"), pr.merge


@requires_bash_git
def test_every_git_call_of_the_guard_is_bounded_and_never_a_lazy_fetch(
    tmp_path: Path,
) -> None:
    """Each git call runs under `timeout -k 5 <bound>`, lazy fetch and prompts off.

    The lever is UNSET, so the bounds are the shipped ones: 20 s for the
    first-parent fetch, 10 s for every other call. A stub `git` records each
    call's environment and a stub `timeout` each call's bound, in a depth-1
    clone, so every call runs: the merge commit read, the first-parent check,
    the fetch, its re-check and the diff.
    """
    clone, sha = _shallow_clean_pr(tmp_path)
    git_log = tmp_path / "git-calls.log"
    timeout_log = tmp_path / "timeout-calls.log"
    record = 'echo "${GIT_NO_LAZY_FETCH-unset} ${GIT_TERMINAL_PROMPT-unset} $*" >> '
    stub = stub_git(tmp_path, on_every=record + shlex.quote(str(git_log)))
    stub_timeout(stub, timeout_log)
    proc = _run(
        tmp_path,
        clone,
        sha,
        path_prefix=stub,
        env_override={"HARNESS_GUARD_FETCH_BOUND_SECS": None},
    )
    out = proc.stdout + proc.stderr
    # The guard read `false`: the claim passes through unchanged.
    assert proc.returncode == 75, repr(out)
    assert TITLE_LINE in proc.stdout.splitlines(), repr(out)
    assert "withheld" not in out, repr(out)
    # Each git call: `<lazy fetch> <prompt> -C <workspace> <verb> ...`.
    calls = [line.split() for line in git_log.read_text(encoding="utf-8").splitlines()]
    assert [call[4] for call in calls] == [
        "cat-file",
        "cat-file",
        "fetch",
        "cat-file",
        "diff",
    ]
    assert [call[:2] for call in calls] == [["1", "0"]] * 5
    # Each timeout call: `-k 5 <bound> git -C <workspace> <verb> ...`, and
    # exactly one per git call, so no git call ran outside a bound.
    bounded = [
        line.split() for line in timeout_log.read_text(encoding="utf-8").splitlines()
    ]
    assert [row[4:] for row in bounded] == [call[2:] for call in calls]
    assert [row[:4] for row in bounded] == [
        ["-k", "5", "10", "git"],
        ["-k", "5", "10", "git"],
        ["-k", "5", "20", "git"],
        ["-k", "5", "10", "git"],
        ["-k", "5", "10", "git"],
    ]


@requires_bash_git
@pytest.mark.parametrize("lever", ["", "0", "21", "600", "abc", "-1"])
def test_the_fetch_lever_can_only_lower_the_bound(tmp_path: Path, lever: str) -> None:
    """Anything that is not 1..20 reads as the 20 s default."""
    clone, sha = _shallow_clean_pr(tmp_path)
    stub = stub_git(tmp_path, "exit 128")
    proc = _run(
        tmp_path,
        clone,
        sha,
        path_prefix=stub,
        env_override={"HARNESS_GUARD_FETCH_BOUND_SECS": lever},
    )
    _withheld(proc, "could not be fetched (git fetch exited 128")
    assert "is the 20s bound" in proc.stdout, repr(proc.stdout)


@requires_bash_git
@pytest.mark.parametrize("lever", ["5", "1", "20", "007"])
def test_a_valid_fetch_lever_lowers_the_bound(tmp_path: Path, lever: str) -> None:
    """A lever in 1..20 is the fetch bound the wrapper hands the helper."""
    clone, sha = _shallow_clean_pr(tmp_path)
    stub = stub_git(tmp_path, "exit 128")
    proc = _run(
        tmp_path,
        clone,
        sha,
        path_prefix=stub,
        env_override={"HARNESS_GUARD_FETCH_BOUND_SECS": lever},
    )
    _withheld(proc, "could not be fetched (git fetch exited 128")
    expected = f"is the {int(lever, 10)}s bound"
    assert expected in proc.stdout, repr(proc.stdout)


@requires_bash_git
def test_an_absent_guard_helper_is_unknown_and_withholds(tmp_path: Path) -> None:
    """The wrapper alone, without harness-diff-guard.sh beside it.

    A clean PR, so the helper would read `false`. Absent, the guard reads
    UNKNOWN: the phrase is rewritten, the notice names the helper, the command
    still runs and keeps its exit status, and no undefined function is called.
    """
    repo, sha = _merge_repo(tmp_path, "backend/app.py")
    alone = tmp_path / "alone"
    alone.mkdir()
    copy = alone / "harness-guarded.sh"
    copy.write_bytes(GUARD.read_bytes())
    proc = _run(tmp_path, repo, sha, script=copy)
    _withheld(proc, "harness-diff-guard.sh is absent or did not load")
    assert "The harness-diff guard read UNKNOWN" in proc.stdout, repr(proc.stdout)
    assert "the harness diff of this PR is unread" in proc.stdout, repr(proc.stdout)
    assert "command not found" not in proc.stdout + proc.stderr, repr(proc.stderr)


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
    for path in (
        "backend/app.py",
        ".gitleaks.toml",
        ".github/workflows/ci.yml",
        ".github/scripts/harness-diff-guard.sh.bak",
    ):
        assert not pattern.search(path), path


def test_backend_ci_runs_on_changes_to_the_guard() -> None:
    workflow = yaml.safe_load(BACKEND_CI.read_text(encoding="utf-8"))
    triggers = workflow.get("on", workflow.get(True))
    for event in ("pull_request", "push"):
        assert ".github/scripts/harness-guarded.sh" in triggers[event]["paths"]
        assert ".github/scripts/harness-diff-guard.sh" in triggers[event]["paths"]
