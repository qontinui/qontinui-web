"""The setup-death declarer: ``.github/scripts/declare-setup-death.sh``.

Plan ``2026-11-11-web-setup-step-deaths-declare-not-a-verdict``. coord's repair
classifier re-runs a red check instead of calling it ``intrinsic`` when one of
its annotation TITLES contains the byte-exact phrase
``(not a verdict on this PR)``. The script writes that title only when a SETUP
step (a tool download or install) concluded ``failure``, no scan/test step did,
and the PR's own diff touches none of the job's harness. This module pins:

1. **The decision**, arm by arm, by executing the SHIPPED script against literal
   rows, real two-parent merge commits in temporary git repos, and a stub
   ``git`` where a fetch has to fail or hang.
2. **The wiring** (Phase 2 and 4): every job that invokes the script, its rows
   against each step's real ``id:`` and ``name:``, and its SETUP and VERDICT
   sets against LITERAL tables, so a classification change is a reviewed edit
   to this file.
3. **The trigger**: backend-ci runs this module on every file it reads.

Every assertion compares against strings spelled out HERE, never a constant the
script defines; a test that reads its expectation from the code under test
cannot fail.

NOTHING HERE PRINTS SCRIPT OUTPUT. This module runs inside a ``Run Tests``
shard, and the Actions runner turns any stdout line that starts with ``::``
(after trimming leading space) into a workflow command. A declaration line
echoed into the shard's log would itself declare that shard's red not a verdict.
The script's output is captured into a string and only ever parsed;
``test_this_module_never_prints_script_output`` holds that by reading this
module's own source, and ``_defang`` keeps ``::`` out of every failure message.
"""

from __future__ import annotations

import ast
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_REF = ".github/scripts/declare-setup-death.sh"
SCRIPT = REPO_ROOT / SCRIPT_REF
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
BACKEND_CI = WORKFLOWS / "backend-ci.yml"

BASH = shutil.which("bash")
GIT = shutil.which("git")

requires_bash_and_git = pytest.mark.skipif(
    BASH is None or GIT is None,
    reason=(
        "the declarer is bash and reads git objects; one of them is missing "
        "here, so the execution arms cannot run (they always run on the ubuntu "
        "CI runner)"
    ),
)

# --- the literals the script must produce ----------------------------------

PHRASE = "(not a verdict on this PR)"
WITHHELD_TITLE = "Setup-death declaration withheld"
MARKER_CHANGING = (
    "TIMED OUT (not a verdict on this PR)",
    "OUT OF MEMORY (not a verdict on this PR)",
    "killed IN THE BUILD",
)
LINT_JOB = "Lint & Format Check"
LINT_TITLE = "Lint & Format Check SETUP FAILED (not a verdict on this PR)"
BACKEND_CI_HARNESS = (
    r"^\.github/workflows/backend-ci\.yml$|^\.github/actions/"
    r"|^\.github/scripts/declare-setup-death\.sh$"
)

SETUP_POETRY_DIED = (
    "Checkout sibling repos (qontinui-schemas, qontinui, qontinui-cloud-control)"
    "|success|success\n"
    "Set up Python|success|success\n"
    "Install Poetry|failure|failure\n"
)
VERDICT_NOT_RUN = (
    "Run ruff (linting)|skipped|skipped\n"
    "Run ruff format (formatting)|skipped|skipped\n"
    "Run mypy (type checking)|skipped|skipped\n"
)
POETRY_DIED_MESSAGE = (
    "step 'Install Poetry' failed, and no scan/test step in this job concluded "
    "failure (passed: none; did not run: Run ruff (linting), Run ruff format "
    "(formatting), Run mypy (type checking)). Re-run the job. Failed setup "
    "step(s): Install Poetry."
)


# --- workflow-command parsing (what the Actions runner reads) ---------------


def _unescape_property(value: str) -> str:
    """actions/runner ``ActionCommand.UnescapeProperty``, in its order."""
    return (
        value.replace("%0D", "\r")
        .replace("%0A", "\n")
        .replace("%3A", ":")
        .replace("%2C", ",")
        .replace("%25", "%")
    )


def _unescape_data(value: str) -> str:
    """actions/runner ``ActionCommand.UnescapeData``, in its order."""
    return value.replace("%0D", "\r").replace("%0A", "\n").replace("%25", "%")


def _commands(output: str) -> list[tuple[str, dict[str, str], str]]:
    """Every workflow command in ``output``, decoded as the runner decodes it.

    Mirrors ``ActionCommand.TryParseV2``: a line is trimmed, must start with
    ``::``, the command info ends at the NEXT ``::``, the name ends at the first
    space, properties split on ``,`` and each on its first ``=``.
    """
    found: list[tuple[str, dict[str, str], str]] = []
    for raw in output.split("\n"):
        line = raw.strip()
        if not line.startswith("::"):
            continue
        end = line.find("::", 2)
        if end < 0:
            continue
        info, data = line[2:end], line[end + 2 :]
        name, _, props_text = info.partition(" ")
        props: dict[str, str] = {}
        for prop in props_text.split(","):
            key, sep, value = prop.partition("=")
            if sep and key.strip():
                props[key.strip()] = _unescape_property(value)
        found.append((name, props, _unescape_data(data)))
    return found


def _defang(text: str) -> str:
    """``text`` made safe for a failure message: no line can start a command."""
    return text.replace("::", ": :")


def _titles(output: str) -> list[str]:
    return [props.get("title", "") for _, props, _ in _commands(output)]


def _declarations(output: str) -> list[tuple[str, str]]:
    """``(title, message)`` of every annotation whose title carries the phrase."""
    return [
        (props.get("title", ""), data)
        for _, props, data in _commands(output)
        if PHRASE in props.get("title", "")
    ]


def _assert_no_phrase(out: str) -> None:
    assert PHRASE not in out, _defang(out)


def _assert_withheld(out: str) -> str:
    """Exactly one withheld notice and no phrase; returns the notice's reason."""
    _assert_no_phrase(out)
    notices = [
        data
        for name, props, data in _commands(out)
        if name == "notice" and props.get("title") == WITHHELD_TITLE
    ]
    assert len(notices) == 1, _defang(out)
    return notices[0]


# --- running the shipped script ----------------------------------------------


def _base_env(home: Path) -> dict[str, str]:
    """A clean environment: nothing inherited from the CI job running this module.

    A shard runs with GITHUB_EVENT_NAME, GITHUB_SHA and GITHUB_WORKSPACE of its
    OWN run in its environment; inheriting them would point the guard at the
    real checkout.
    """
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "LC_ALL": "C",
    }


def _run(
    env: dict[str, str], *, path_prefix: Path | None = None, timeout: float = 60
) -> tuple[int, str, float]:
    """Run the shipped script. Returns ``(exit code, stdout+stderr, seconds)``.

    Output is CAPTURED, never inherited: see the module docstring.
    """
    assert BASH is not None
    if path_prefix is not None:
        env = {**env, "PATH": f"{path_prefix}:{env['PATH']}"}
    started = time.monotonic()
    proc = subprocess.run(
        [BASH, str(SCRIPT)],
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    return proc.returncode, proc.stdout + proc.stderr, time.monotonic() - started


def _git(cwd: Path, *args: str, home: Path) -> str:
    assert GIT is not None
    proc = subprocess.run(
        [GIT, *args],
        cwd=cwd,
        env={
            **_base_env(home),
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@example.invalid",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@example.invalid",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, _defang(f"git {args}: {proc.stdout}{proc.stderr}")
    return proc.stdout.strip()


BASE_FILES = {
    ".github/workflows/backend-ci.yml": "name: Backend CI\n",
    ".github/actions/self-hosted-host-provisioned/action.yml": "name: host\n",
    ".github/scripts/declare-setup-death.sh": "#!/usr/bin/env bash\n",
    "backend/app/main.py": "print('base')\n",
}


class PrRepo:
    """A repo whose ``merge`` commit has ``base`` and a PR head as parents."""

    def __init__(
        self,
        root: Path,
        home: Path,
        *,
        changes: dict[str, str | None],
        message: str = "Merge pr into main",
    ):
        self.root = root
        self.home = home
        root.mkdir(parents=True)
        _git(root, "init", "-q", "-b", "main", ".", home=home)
        for rel, body in BASE_FILES.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        _git(root, "add", "-A", home=home)
        _git(root, "commit", "-q", "-m", "base", home=home)
        self.base = _git(root, "rev-parse", "HEAD", home=home)
        _git(root, "checkout", "-q", "-b", "pr", home=home)
        for rel, change in changes.items():
            path = root / rel
            if change is None:
                _git(root, "rm", "-q", rel, home=home)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(change, encoding="utf-8")
        _git(root, "add", "-A", home=home)
        _git(root, "commit", "-q", "--allow-empty", "-m", "pr", home=home)
        self.head = _git(root, "rev-parse", "HEAD", home=home)
        # The PR head is based on main, so the merge commit's tree is the head's.
        self.merge = _git(
            root,
            "commit-tree",
            f"{self.head}^{{tree}}",
            "-p",
            self.base,
            "-p",
            self.head,
            "-m",
            message,
            home=home,
        )
        _git(root, "update-ref", "refs/heads/pr-merge", self.merge, home=home)


def _pr_env(
    repo: PrRepo,
    *,
    setup: str = SETUP_POETRY_DIED,
    verdict: str = VERDICT_NOT_RUN,
    job: str = LINT_JOB,
    event: str = "pull_request",
    sha: str | None = None,
    harness: str = BACKEND_CI_HARNESS,
    workspace: Path | None = None,
) -> dict[str, str]:
    return {
        **_base_env(repo.home),
        "DECLARE_JOB": job,
        "SETUP_STEPS": setup,
        "VERDICT_STEPS": verdict,
        "HARNESS_PATHS_RE": harness,
        "GITHUB_EVENT_NAME": event,
        "GITHUB_WORKSPACE": str(workspace or repo.root),
        "GITHUB_SHA": sha or repo.merge,
    }


@pytest.fixture
def home(tmp_path: Path) -> Path:
    path = tmp_path / "home"
    path.mkdir()
    return path


@pytest.fixture
def clean_pr(tmp_path: Path, home: Path) -> PrRepo:
    """A PR that touches only application code: the guard reads ``false``."""
    return PrRepo(
        tmp_path / "repo", home, changes={"backend/app/main.py": "print('pr')\n"}
    )


def _stub_git(tmp_path: Path, on_fetch: str) -> Path:
    """A ``git`` that runs the real one except for ``fetch``, which runs ``on_fetch``."""
    assert GIT is not None
    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir(exist_ok=True)
    stub = stub_dir / "git"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        'for arg in "$@"; do\n'
        '  if [ "$arg" = fetch ]; then\n'
        f"    {on_fetch}\n"
        "  fi\n"
        "done\n"
        f'exec {GIT} "$@"\n',
        encoding="utf-8",
        newline="\n",
    )
    stub.chmod(0o755)
    return stub_dir


def _shallow_clone(repo: PrRepo, dest: Path) -> Path:
    """A depth-1 clone of the merge commit: its parents are NOT present.

    That is the shape of an actions/checkout on ``pull_request``.
    """
    _git(repo.root, "config", "uploadpack.allowAnySHA1InWant", "true", home=repo.home)
    _git(
        repo.root.parent,
        "clone",
        "-q",
        "--depth",
        "1",
        "--branch",
        "pr-merge",
        f"file://{repo.root}",
        str(dest),
        home=repo.home,
    )
    return dest


def _has_commit(workspace: Path, sha: str, home: Path) -> bool:
    assert GIT is not None
    proc = subprocess.run(
        [GIT, "-C", str(workspace), "cat-file", "-e", f"{sha}^{{commit}}"],
        env=_base_env(home),
        capture_output=True,
        check=False,
    )
    return proc.returncode == 0


# --- the declaration ----------------------------------------------------------


@requires_bash_and_git
def test_a_setup_death_with_an_untouched_harness_declares_exactly_once(clean_pr):
    code, out, _ = _run(_pr_env(clean_pr))
    assert code == 0
    commands = _commands(out)
    assert len(commands) == 1, _defang(out)
    name, props, message = commands[0]
    assert name == "error"
    assert props == {"title": LINT_TITLE}
    assert message == POETRY_DIED_MESSAGE


@requires_bash_and_git
def test_the_first_parent_is_fetched_when_the_checkout_is_shallow(tmp_path, clean_pr):
    """actions/checkout on `pull_request` is depth 1, so the base is absent."""
    clone = _shallow_clone(clean_pr, tmp_path / "checkout")
    assert not _has_commit(clone, clean_pr.base, clean_pr.home)
    code, out, _ = _run(_pr_env(clean_pr, workspace=clone))
    assert code == 0
    assert _titles(out) == [LINT_TITLE], _defang(out)
    assert _has_commit(clone, clean_pr.base, clean_pr.home)


@requires_bash_and_git
def test_two_failed_setup_rows_name_the_first_in_row_order(clean_pr):
    setup = (
        "Checkout sibling repos (qontinui-schemas, qontinui, qontinui-cloud-control)"
        "|failure|failure\n"
        "Set up Python|success|success\n"
        "Install Poetry|failure|failure\n"
    )
    _, out, _ = _run(_pr_env(clean_pr, setup=setup))
    assert _declarations(out) == [
        (
            LINT_TITLE,
            "step 'Checkout sibling repos (qontinui-schemas, qontinui, "
            "qontinui-cloud-control)' failed, and no scan/test step in this job "
            "concluded failure (passed: none; did not run: Run ruff (linting), "
            "Run ruff format (formatting), Run mypy (type checking)). Re-run the "
            "job. Failed setup step(s): Checkout sibling repos (qontinui-schemas, "
            "qontinui, qontinui-cloud-control), Install Poetry.",
        )
    ], _defang(out)


@requires_bash_and_git
def test_a_verdict_step_that_passed_before_the_setup_death_is_listed(clean_pr):
    """security-scan runs `Run Trivy` BEFORE its setup steps (plan, at vet)."""
    setup = (
        "Install Trivy|success|success\n"
        "Set up Python|success|success\n"
        "Install safety|failure|failure\n"
    )
    verdict = (
        "Run Trivy vulnerability scanner|success|success\n"
        "Run safety check (dependency vulnerabilities)|skipped|skipped\n"
    )
    _, out, _ = _run(
        _pr_env(clean_pr, setup=setup, verdict=verdict, job="Security Scanning")
    )
    assert _declarations(out) == [
        (
            "Security Scanning SETUP FAILED (not a verdict on this PR)",
            "step 'Install safety' failed, and no scan/test step in this job "
            "concluded failure (passed: Run Trivy vulnerability scanner; did not "
            "run: Run safety check (dependency vulnerabilities)). Re-run the job. "
            "Failed setup step(s): Install safety.",
        )
    ], _defang(out)


@requires_bash_and_git
def test_a_marked_verdict_failure_after_a_setup_death_is_its_cascade(clean_pr):
    """style-gate's `assert` (`if: always()`) exits 1 when nothing was captured."""
    setup = (
        "Setup Node|success|success\n"
        "Install Playwright Chromium system deps (apt)|failure|failure\n"
    )
    verdict = (
        "!Run vision-audit (analyze + assert) per route + summarize|failure|failure\n"
    )
    _, out, _ = _run(
        _pr_env(clean_pr, setup=setup, verdict=verdict, job="Style Gate (shadow)")
    )
    assert _declarations(out) == [
        (
            "Style Gate (shadow) SETUP FAILED (not a verdict on this PR)",
            "step 'Install Playwright Chromium system deps (apt)' failed, and no "
            "scan/test step in this job concluded failure before it; step(s) 'Run "
            "vision-audit (analyze + assert) per route + summarize' failed after "
            "it, as its cascade (passed: none; did not run: none). Re-run the job. "
            "Failed setup step(s): Install Playwright Chromium system deps (apt).",
        )
    ], _defang(out)


@requires_bash_and_git
def test_a_job_name_with_a_comma_and_a_colon_keeps_the_phrase(clean_pr):
    """An unescaped `,` would split the property and `::` would end it."""
    job = "Check: a, b :: c 100%"
    _, out, _ = _run(_pr_env(clean_pr, job=job))
    assert "title=Check%3A a%2C b %3A%3A c 100%25 SETUP FAILED" in out, _defang(out)
    assert _titles(out) == [
        "Check: a, b :: c 100% SETUP FAILED (not a verdict on this PR)"
    ], _defang(out)


@requires_bash_and_git
def test_a_step_name_with_a_pipe_is_still_one_row(clean_pr):
    setup = "Install a|b tool|failure|failure\n"
    _, out, _ = _run(_pr_env(clean_pr, setup=setup))
    declared = _declarations(out)
    assert len(declared) == 1, _defang(out)
    assert declared[0][1].startswith("step 'Install a|b tool' failed"), _defang(out)


@requires_bash_and_git
def test_a_parent_line_in_the_commit_message_is_not_a_parent(tmp_path, home):
    """Only the header is read: a merge message can quote `parent <sha>`."""
    repo = PrRepo(
        tmp_path / "repo",
        home,
        changes={"backend/app/main.py": "print('pr')\n"},
        message="Merge pr\n\nparent 0123456789abcdef0123456789abcdef01234567\n",
    )
    _, out, _ = _run(_pr_env(repo))
    assert _titles(out) == [LINT_TITLE], _defang(out)


# --- no declaration: the red is a verdict, or not a setup death ---------------


@requires_bash_and_git
def test_a_failed_verdict_step_beside_a_failed_setup_row_never_declares(clean_pr):
    verdict = (
        "Run ruff (linting)|failure|failure\n"
        "Run ruff format (formatting)|skipped|skipped\n"
        "Run mypy (type checking)|skipped|skipped\n"
    )
    code, out, _ = _run(_pr_env(clean_pr, verdict=verdict))
    assert code == 0
    _assert_no_phrase(out)
    assert _commands(out) == [], _defang(out)
    assert (
        "declare-setup-death: no declaration: scan/test step(s) 'Run ruff "
        "(linting)' concluded failure, so this red is a verdict on the change."
    ) in out, _defang(out)


@requires_bash_and_git
def test_a_marked_verdict_failure_with_no_setup_death_is_a_verdict(clean_pr):
    setup = "Setup Node|success|success\n"
    verdict = (
        "!Run vision-audit (analyze + assert) per route + summarize|failure|failure\n"
    )
    _, out, _ = _run(_pr_env(clean_pr, setup=setup, verdict=verdict))
    _assert_no_phrase(out)
    assert "concluded failure, so this red is a verdict on the change." in out


@requires_bash_and_git
def test_only_an_other_step_failed_so_nothing_is_declared(clean_pr):
    """`Install dependencies` (the PR's lockfile) is never a row: no setup failed."""
    setup = (
        "Checkout sibling repos (qontinui-schemas, qontinui, qontinui-cloud-control)"
        "|success|success\n"
        "Set up Python|success|success\n"
        "Install Poetry|success|success\n"
    )
    _, out, _ = _run(_pr_env(clean_pr, setup=setup))
    _assert_no_phrase(out)
    assert _commands(out) == [], _defang(out)
    assert (
        "declare-setup-death: no declaration: no setup step concluded failure"
    ) in out, _defang(out)


@requires_bash_and_git
def test_a_soft_failed_setup_step_never_declares(clean_pr):
    """`continue-on-error`: outcome `failure`, conclusion `success`."""
    setup = "Set up Python|success|success\nInstall Poetry|failure|success\n"
    _, out, _ = _run(_pr_env(clean_pr, setup=setup))
    _assert_no_phrase(out)
    assert "no setup step concluded failure" in out, _defang(out)


# --- UNKNOWN withholds: an unrendered row --------------------------------------


@requires_bash_and_git
@pytest.mark.parametrize(
    "row",
    ["Install Poetry||", "Install Poetry|failure|", "Install Poetry||failure"],
    ids=["both-empty", "conclusion-empty", "outcome-empty"],
)
def test_an_empty_row_is_unknown_and_withholds(clean_pr, row):
    """A renamed or deleted `id:` renders the expression EMPTY."""
    setup = f"Set up Python|success|success\n{row}\n"
    _, out, _ = _run(_pr_env(clean_pr, setup=setup))
    reason = _assert_withheld(out)
    assert "rendered an empty outcome or conclusion" in reason, _defang(out)


@requires_bash_and_git
def test_an_empty_row_list_is_unknown_and_withholds(clean_pr):
    _, out, _ = _run(_pr_env(clean_pr, verdict=""))
    reason = _assert_withheld(out)
    assert "the verdict row list is empty" in reason, _defang(out)


# --- the harness-diff guard ------------------------------------------------------


@requires_bash_and_git
@pytest.mark.parametrize(
    "touched",
    [
        ".github/workflows/backend-ci.yml",
        ".github/actions/self-hosted-host-provisioned/action.yml",
        ".github/scripts/declare-setup-death.sh",
    ],
    ids=["own-workflow", "local-action", "the-declarer"],
)
def test_a_pr_that_touches_the_harness_is_never_declared(tmp_path, home, touched):
    repo = PrRepo(tmp_path / "repo", home, changes={touched: "edited\n"})
    code, out, _ = _run(_pr_env(repo))
    assert code == 0
    reason = _assert_withheld(out)
    assert "harness-diff guard read true" in reason, _defang(out)
    assert touched in reason, _defang(out)


@requires_bash_and_git
def test_moving_a_harness_file_out_of_the_harness_reads_true(tmp_path, home):
    """`--no-renames`: a rename would otherwise list only its NEW path."""
    repo = PrRepo(
        tmp_path / "repo",
        home,
        changes={
            ".github/actions/self-hosted-host-provisioned/action.yml": None,
            "elsewhere/action.yml": "name: host\n",
        },
    )
    _, out, _ = _run(_pr_env(repo))
    reason = _assert_withheld(out)
    assert "harness-diff guard read true" in reason, _defang(out)


@requires_bash_and_git
def test_off_pull_request_the_guard_is_unknown(clean_pr):
    _, out, _ = _run(_pr_env(clean_pr, event="push"))
    reason = _assert_withheld(out)
    assert "harness-diff guard read UNKNOWN" in reason, _defang(out)
    assert "the event is 'push', not pull_request" in reason, _defang(out)


@requires_bash_and_git
def test_a_one_parent_commit_is_unknown(clean_pr):
    _, out, _ = _run(_pr_env(clean_pr, sha=clean_pr.head))
    reason = _assert_withheld(out)
    assert "has 1 parent(s), not the two of a pull_request merge commit" in reason


@requires_bash_and_git
def test_a_first_parent_that_cannot_be_fetched_is_unknown(tmp_path, clean_pr):
    clone = _shallow_clone(clean_pr, tmp_path / "checkout")
    stub = _stub_git(tmp_path, "exit 128")
    code, out, _ = _run(_pr_env(clean_pr, workspace=clone), path_prefix=stub)
    assert code == 0
    reason = _assert_withheld(out)
    assert "could not be fetched (git fetch exited 128" in reason, _defang(out)


@requires_bash_and_git
def test_a_fetch_that_hangs_is_bounded_and_unknown(tmp_path, clean_pr):
    """A hang must never hold the runner: the bound fires and reads UNKNOWN."""
    clone = _shallow_clone(clean_pr, tmp_path / "checkout")
    stub = _stub_git(tmp_path, "exec sleep 30")
    env = {**_pr_env(clean_pr, workspace=clone), "DECLARE_FETCH_BOUND_SECS": "2"}
    code, out, seconds = _run(env, path_prefix=stub, timeout=25)
    assert code == 0
    assert seconds < 15, f"the 2 s bound took {seconds:.1f} s"
    reason = _assert_withheld(out)
    assert "could not be fetched (git fetch exited 124" in reason, _defang(out)
    assert "is the 2s bound" in reason, _defang(out)


@requires_bash_and_git
@pytest.mark.parametrize("lever", ["", "0", "61", "600", "abc", "-1"])
def test_the_fetch_lever_can_only_lower_the_bound(tmp_path, clean_pr, lever):
    """Anything that is not 1..60 reads as the 60 s default."""
    clone = _shallow_clone(clean_pr, tmp_path / "checkout")
    stub = _stub_git(tmp_path, "exit 128")
    env = {**_pr_env(clean_pr, workspace=clone), "DECLARE_FETCH_BOUND_SECS": lever}
    _, out, _ = _run(env, path_prefix=stub)
    assert "is the 60s bound" in _assert_withheld(out), _defang(out)


@requires_bash_and_git
@pytest.mark.parametrize(
    ("harness", "expected"),
    [
        ("", "HARNESS_PATHS_RE is empty"),
        ("^(unclosed", "HARNESS_PATHS_RE is not a valid extended regular expression"),
    ],
    ids=["empty", "invalid"],
)
def test_an_unusable_harness_pattern_is_unknown(clean_pr, harness, expected):
    _, out, _ = _run(_pr_env(clean_pr, harness=harness))
    assert expected in _assert_withheld(out), _defang(out)


@requires_bash_and_git
def test_a_merge_commit_absent_from_the_checkout_is_unknown(clean_pr):
    _, out, _ = _run(_pr_env(clean_pr, sha="0" * 40))
    assert "is not readable in this checkout" in _assert_withheld(out)


# --- malformed input: always exit 0, never a phrase ------------------------------


@requires_bash_and_git
def test_unset_inputs_exit_zero_without_a_phrase(home):
    code, out, _ = _run(_base_env(home))
    assert code == 0
    assert "DECLARE_JOB is empty" in _assert_withheld(out), _defang(out)


@requires_bash_and_git
@pytest.mark.parametrize(
    "setup",
    [
        "garbage",
        "Install Poetry|failure",
        "|failure|failure",
        "Install Poetry|exploded|failure",
        "!Install Poetry|failure|failure",
        "\x01\x02|\x03|\x04",
    ],
    ids=["no-pipes", "one-pipe", "no-name", "bad-value", "marked-setup", "binary"],
)
def test_garbage_rows_exit_zero_and_withhold(clean_pr, setup):
    code, out, _ = _run(_pr_env(clean_pr, setup=setup))
    assert code == 0
    _assert_withheld(out)


@requires_bash_and_git
def test_a_declare_job_carrying_a_marker_changing_phrase_is_withheld(clean_pr):
    _, out, _ = _run(_pr_env(clean_pr, job="Shard killed IN THE BUILD"))
    assert "marker-changing phrase" in _assert_withheld(out), _defang(out)


@requires_bash_and_git
def test_no_title_the_script_writes_changes_coords_marker_class(tmp_path, home):
    """A setup death must map to `no_verdict` (coord `no_verdict_marker_for_title`)."""
    repo = PrRepo(tmp_path / "repo", home, changes={"backend/x.py": "x\n"})
    outputs = [
        _run(_pr_env(repo))[1],
        _run(_pr_env(repo, job="Run Tests (shard 1/6)"))[1],
        _run(_pr_env(repo, event="push"))[1],
        _run(_pr_env(repo, setup="Install Poetry||"))[1],
    ]
    titles = [title for out in outputs for title in _titles(out)]
    assert len(titles) == 4
    for title in titles:
        for marker in MARKER_CHANGING:
            assert marker not in title, title


# --- the trigger: backend-ci must run this module on every file it reads -------


def _invokes_script(run: object) -> bool:
    return isinstance(run, str) and SCRIPT_REF in run


def _carrier_jobs() -> list[tuple[str, str]]:
    """Every ``(workflow, job id)`` whose steps run the script, by GLOB.

    `*.y*ml`: GitHub reads `.yaml` and `.yml` alike, and a carrier under the
    other spelling would be a real carrier this census could not see.
    """
    found: list[tuple[str, str]] = []
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        for job_id, job in (doc.get("jobs") or {}).items():
            steps = (job or {}).get("steps") or []
            if any(_invokes_script(step.get("run")) for step in steps):
                found.append((path.name, job_id))
    return found


def _backend_ci_paths(trigger: str) -> list[str]:
    """One backend-ci trigger's `paths:` filter, failing closed."""
    doc = yaml.safe_load(BACKEND_CI.read_text(encoding="utf-8"))
    # PyYAML (YAML 1.1) parses the bare key `on` as the boolean True.
    triggers = doc.get("on", doc.get(True))
    assert isinstance(triggers, dict), "backend-ci.yml has no readable `on:` block"
    block = triggers.get(trigger)
    assert isinstance(block, dict), f"backend-ci.yml has no `on.{trigger}` mapping"
    paths = block.get("paths")
    assert isinstance(paths, list) and paths, f"`on.{trigger}.paths` is missing"
    return [str(entry) for entry in paths]


def test_backend_ci_triggers_on_every_file_this_module_reads():
    """A path-scoped gate does not guard a file it never runs on.

    Mirrors `test_ci_timeout_marker.py`'s
    `test_backend_ci_triggers_on_every_workflow_this_module_reads`: without the
    script in both filters, a PR that edits ONLY the script would not run the
    tests that pin it. Both triggers, so a filter added to one and forgotten on
    the other is a failure.
    """
    read = [SCRIPT_REF] + sorted(
        {f".github/workflows/{workflow}" for workflow, _ in _carrier_jobs()}
    )
    for trigger in ("pull_request", "push"):
        filters = _backend_ci_paths(trigger)
        for relative in read:
            assert relative in filters, (
                f"`{relative}` is read by this module but is not in "
                f"backend-ci.yml's `on.{trigger}.paths`; add it to BOTH filters"
            )


# --- this module itself --------------------------------------------------------


def test_this_module_never_prints_script_output():
    """A printed declaration line in the shard log would itself be a declaration."""
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name):
            assert func.id != "print", f"print() at line {node.lineno}"
        if isinstance(func, ast.Attribute) and func.attr in ("run", "Popen", "call"):
            if isinstance(func.value, ast.Name) and func.value.id == "subprocess":
                keywords = {kw.arg: kw.value for kw in node.keywords}
                captured = keywords.get("capture_output")
                assert isinstance(captured, ast.Constant) and captured.value is True, (
                    f"subprocess.{func.attr} at line {node.lineno} does not capture "
                    "its output, so the script's lines would reach the shard log"
                )


def test_the_script_is_executable_and_strict():
    text = SCRIPT.read_text(encoding="utf-8")
    assert text.startswith("#!/usr/bin/env bash\n")
    assert "\nset -uo pipefail\n" in text
    assert "\nset -e" not in text, "-e would let a failing command skip the verdict"
    assert "eval " not in text
    assert os.access(SCRIPT, os.X_OK)
