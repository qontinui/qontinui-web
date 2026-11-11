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

import itertools
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest
import yaml

from tests.setup_death_git import (
    GIT,
    PrRepo,
    assert_prints_nothing,
    base_env,
    has_commit,
    shallow_clone,
    stub_git,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_REF = ".github/scripts/declare-setup-death.sh"
SCRIPT = REPO_ROOT / SCRIPT_REF
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
BACKEND_CI = WORKFLOWS / "backend-ci.yml"

BASH = shutil.which("bash")

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
        **base_env(repo.home),
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
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    assert not has_commit(clone, clean_pr.base, clean_pr.home)
    code, out, _ = _run(_pr_env(clean_pr, workspace=clone))
    assert code == 0
    assert _titles(out) == [LINT_TITLE], _defang(out)
    assert has_commit(clone, clean_pr.base, clean_pr.home)


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
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    stub = stub_git(tmp_path, "exit 128")
    code, out, _ = _run(_pr_env(clean_pr, workspace=clone), path_prefix=stub)
    assert code == 0
    reason = _assert_withheld(out)
    assert "could not be fetched (git fetch exited 128" in reason, _defang(out)


@requires_bash_and_git
def test_a_fetch_that_hangs_is_bounded_and_unknown(tmp_path, clean_pr):
    """A hang must never hold the runner: the bound fires and reads UNKNOWN."""
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    stub = stub_git(tmp_path, "exec sleep 30")
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
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    stub = stub_git(tmp_path, "exit 128")
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
    code, out, _ = _run(base_env(home))
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


# --- the wiring: every carrier job, against LITERAL tables ---------------------
#
# SETUP = a tool download or install that reads none of the PR's files, after
# the job's own checkout (the script lives in the checkout). VERDICT = the
# job's scan/test steps, `!`-marked when their `if:` has a status function.
# Everything else ("Other": the PR's lockfile installs, builds, uploads, the
# explainers) is never a row and is never declared. Changing a classification
# is an edit to these tables, so it is reviewed.

DECLARER_STEP = "Declare a setup death"
EXPLAINER_STEP = "Explain infrastructure timeout vs external cancellation"
SIBLINGS = "Checkout sibling repos (qontinui-schemas, qontinui, qontinui-cloud-control)"


def _harness_literal(workflow: str) -> str:
    """The plan's pattern: own workflow file, local actions, the declarer."""
    escaped = workflow.replace(".", "\\.")
    return (
        f"^\\.github/workflows/{escaped}$|^\\.github/actions/"
        "|^\\.github/scripts/declare-setup-death\\.sh$"
    )


CARRIERS: dict[tuple[str, str], dict[str, object]] = {
    ("backend-ci.yml", "lint"): {
        "declare_job": "Lint & Format Check",
        "setup": [SIBLINGS, "Set up Python", "Install Poetry"],
        "verdict": [
            "Run ruff (linting)",
            "Run ruff format (formatting)",
            "Run mypy (type checking)",
        ],
    },
    ("backend-ci.yml", "test"): {
        "declare_job": "Run Tests (shard ${{ matrix.shard }}/6)",
        "setup": [
            "Self-hosted: host provisioned",
            "Free disk space",
            SIBLINGS,
            "Set up Python",
            "Install Poetry",
            "Install postgresql-client",
        ],
        "verdict": [
            "Check OpenAPI snapshot is up to date",
            "Create test schemas and extensions",
            "Collect the test suite",
            "Select this shard's test files",
            "Run tests with coverage",
        ],
    },
    ("backend-ci.yml", "security-scan"): {
        "declare_job": "Security Scanning",
        "setup": [
            "Install Trivy",
            "Free disk space",
            SIBLINGS,
            "Set up Python",
            "Install Poetry",
            "Install safety",
        ],
        # Neither reds on a FINDING (trivy-action sets no `exit-code`; the
        # safety check ends `|| true`), but a Trivy or safety ERROR is still
        # read as a verdict: the conservative arm.
        "verdict": [
            "Run Trivy vulnerability scanner",
            "Run safety check (dependency vulnerabilities)",
        ],
    },
    ("memory-recall-eval.yml", "recall-eval"): {
        "declare_job": "Recall eval (report only)",
        "setup": [
            "Self-hosted: host provisioned",
            "Free disk space",
            "Checkout sibling repos",
            "Set up Python",
            "Install Poetry",
        ],
        "verdict": ["Run the recall harness", "Assert the harness actually ran"],
    },
    ("workflow-lint.yml", "workflow-lint"): {
        "declare_job": "workflow-lint",
        "setup": [
            "Check host architecture (release tarballs below are x86_64)",
            "Install zizmor and actionlint (pinned, sha256-verified, host-cached)",
        ],
        "verdict": ["!zizmor", "!actionlint"],
    },
    ("e2e-tests.yml", "backend-tests"): {
        "declare_job": "Backend E2E Tests (${{ matrix.python-version }})",
        "setup": [
            "Clone backend Python sibling deps",
            "Set up Python ${{ matrix.python-version }}",
            "Create a job venv",
        ],
        "verdict": ["Run backend E2E tests"],
    },
    # Phase 4: the explainer carriers that run on pull_request. Their SETUP sets
    # must hold the explainer's non-soft APT_STEP_OUTCOMES rows (same ids);
    # `test_every_non_soft_apt_row_of_the_explainer_is_a_setup_row` checks it.
    ("e2e-playwright-stack.yml", "playwright"): {
        # Called from e2e-tests.yml, so GitHub serves `<caller> / Playwright
        # (chromium)`; DECLARE_JOB names this job.
        "declare_job": "Playwright (chromium)",
        "setup": [
            "Self-hosted: host provisioned",
            "Clone sibling dependencies",
            "Set up Python",
            "Set up Node.js 20",
            "Install Playwright browser system deps (apt)",
            "Install postgresql-client",
        ],
        "verdict": [
            "Create runner schema",
            "Run database migrations",
            "Run frontend E2E tests",
        ],
    },
    ("migration-reversal.yml", "reverse"): {
        "declare_job": "reverse",
        "setup": [
            "Self-hosted: host provisioned",
            "Free disk space",
            SIBLINGS,
            "Set up Python",
            "Install postgresql-client",
        ],
        "verdict": [
            "Create named schemas + extension",
            "Reversibility test (upgrade \u2192 downgrade -1 \u2192 upgrade)",
        ],
    },
    ("migration-reversal.yml", "tested"): {
        # The qualify step detaches HEAD at the base tip, which is why the
        # guard measures GITHUB_SHA rather than HEAD.
        "declare_job": "Migration Reversal Tested",
        "setup": [
            "Self-hosted: host provisioned",
            "Set up Python",
            "Free disk space",
            SIBLINGS,
            "Install postgresql-client",
        ],
        "verdict": [
            "Qualify the PR's migration and switch to the base tree",
            "Base revision set (pure base tree, before the overlay)",
            "Overlay the PR's migration onto the base tree",
            "Create named schemas + extension",
            "Head identity (one head, it is the overlaid file, not a merge)",
            "Reversibility test (upgrade \u2192 downgrade -1 \u2192 upgrade, schema "
            "compared)",
            "Non-executable edits only (no migration to exercise)",
        ],
    },
    ("spec-ci.yml", "spec-ci"): {
        "declare_job": "Spec CI",
        "setup": [
            "Self-hosted: host provisioned",
            "Clone backend Python sibling deps",
            "Set up Python",
            "Install postgresql-client",
            "Setup Node",
            "Install Playwright Chromium system deps (apt)",
        ],
        "verdict": [
            "Create runner schema",
            "Run database migrations",
            "Run Spec CI",
        ],
    },
    ("style-gate.yml", "style-gate"): {
        # The sibling clone and `Install postgresql-client` are
        # `continue-on-error` SHADOW steps here, so they cannot be SETUP; their
        # soft failures cascade into a red `assert` that is never declared.
        # `Set up Rust toolchain` is a pure download of the workflow-pinned
        # `stable` toolchain, so it is SETUP.
        "declare_job": "Style Gate (shadow)",
        "setup": [
            "Self-hosted: host provisioned",
            "Set up Rust toolchain",
            "Setup Node",
            "Install Playwright Chromium system deps (apt)",
            "Set up Python",
        ],
        "verdict": ["!Run vision-audit (analyze + assert) per route + summarize"],
    },
}

_MATRIX_EXPR = re.compile(r"\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}")
_ROW = re.compile(
    r"^(?P<mark>!?)(?P<name>.+)"
    r"\|\$\{\{ steps\.(?P<id>[A-Za-z0-9_-]+)\.outcome \}\}"
    r"\|\$\{\{ steps\.(?P=id)\.conclusion \}\}$"
)


def _workflow(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


def _job(workflow: str, job_id: str) -> dict:
    return _workflow(workflow)["jobs"][job_id]


def _matrix_combos(job: dict) -> list[dict[str, object]]:
    matrix = (job.get("strategy") or {}).get("matrix") or {}
    dims = {
        key: values
        for key, values in matrix.items()
        if key not in ("include", "exclude") and isinstance(values, list)
    }
    if not dims:
        return [{}]
    return [
        dict(zip(dims, combo, strict=True))
        for combo in itertools.product(*dims.values())
    ]


def _render_matrix(text: str, combo: dict[str, object]) -> str:
    return _MATRIX_EXPR.sub(lambda m: str(combo[m.group(1)]), text)


def _served_names(job_id: str, job: dict) -> list[str]:
    """The check-run name GitHub serves for each matrix leg of a job.

    A name that references no matrix value gets the leg's values appended in
    parentheses (`Backend E2E Tests (3.12)`); one that does is rendered.
    """
    name = str(job.get("name", job_id))
    served = []
    for combo in _matrix_combos(job):
        rendered = _render_matrix(name, combo)
        if combo and not _MATRIX_EXPR.search(name):
            rendered += " (" + ", ".join(str(v) for v in combo.values()) + ")"
        served.append(rendered)
    return served


def _declarer(job: dict) -> dict:
    found = [s for s in job.get("steps") or [] if s.get("name") == DECLARER_STEP]
    assert len(found) == 1, f"{len(found)} `{DECLARER_STEP}` steps"
    return found[0]


def _rows(step: dict, key: str) -> list[re.Match[str]]:
    text = str((step.get("env") or {}).get(key, ""))
    rows = []
    for line in text.splitlines():
        if not line.strip():
            continue
        match = _ROW.match(line.strip())
        assert match, f"{key} row {line!r} is not <name>|outcome|conclusion of ONE id"
        rows.append(match)
    return rows


def _steps_by_id(job: dict) -> dict[str, tuple[int, dict]]:
    return {
        str(step["id"]): (index, step)
        for index, step in enumerate(job.get("steps") or [])
        if "id" in step
    }


def _has_status_function(step: dict) -> bool:
    condition = str(step.get("if", ""))
    return any(f in condition for f in ("always()", "failure()", "cancelled()"))


def _own_checkout_index(job: dict) -> int:
    """The job's checkout of THIS repo (a sibling checkout names `repository:`)."""
    for index, step in enumerate(job.get("steps") or []):
        uses = str(step.get("uses", ""))
        if uses.startswith("actions/checkout@") and "repository" not in (
            step.get("with") or {}
        ):
            return index
    raise AssertionError("the job has no checkout of this repository")


def _apt_ids(job: dict) -> dict[str, str]:
    """`{id: step name}` of the explainer's APT_STEP_OUTCOMES rows in this job."""
    explainers = [s for s in job.get("steps") or [] if s.get("name") == EXPLAINER_STEP]
    if not explainers:
        return {}
    ids = {}
    for line in str(explainers[0]["env"]["APT_STEP_OUTCOMES"]).splitlines():
        match = _ROW.match(line.strip())
        if match:
            ids[match.group("id")] = match.group("name")
    return ids


CARRIER_IDS = [f"{workflow}:{job_id}" for workflow, job_id in CARRIERS]


def test_the_carriers_are_exactly_the_literal_table():
    """Derived by glob, never trusted from a hand list: see `_carrier_jobs`."""
    assert sorted(_carrier_jobs()) == sorted(CARRIERS)


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_the_declarer_is_the_jobs_last_step_and_never_red(workflow, job_id):
    job = _job(workflow, job_id)
    step = _declarer(job)
    assert job["steps"][-1] is step, "the declarer must be the job's LAST step"
    assert step["if"] == "failure()"
    assert step["working-directory"] == "${{ github.workspace }}"
    assert step["timeout-minutes"] == 3
    assert "continue-on-error" not in step
    run = step["run"]
    assert "if [ ! -f .github/scripts/declare-setup-death.sh ]; then" in run
    assert "exit 0" in run
    assert (
        "bash .github/scripts/declare-setup-death.sh || echo "
        '"declare-setup-death.sh exited $?; nothing was declared."'
    ) in run


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_declare_job_is_the_check_name_github_serves(workflow, job_id):
    job = _job(workflow, job_id)
    declared = str(_declarer(job)["env"]["DECLARE_JOB"])
    assert declared == CARRIERS[(workflow, job_id)]["declare_job"]
    triggers = _workflow(workflow).get("on", _workflow(workflow).get(True)) or {}
    combos = _matrix_combos(job)
    rendered = [_render_matrix(declared, combo) for combo in combos]
    if set(triggers) == {"workflow_call"}:
        # A called workflow's check is served as `<caller job> / <this job>`,
        # and the caller's name is not known here: DECLARE_JOB names this job.
        assert rendered == [str(job.get("name", job_id))]
    else:
        assert rendered == _served_names(job_id, job)


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_every_row_names_a_real_step_by_its_exact_name(workflow, job_id):
    """Replaces runner#2607's hand-matched names with a test."""
    job = _job(workflow, job_id)
    step = _declarer(job)
    by_id = _steps_by_id(job)
    for key in ("SETUP_STEPS", "VERDICT_STEPS"):
        positions = []
        for row in _rows(step, key):
            assert row.group("id") in by_id, f"{key}: no step has id {row['id']!r}"
            index, target = by_id[row.group("id")]
            assert target.get("name") == row.group("name"), (
                f"{key}: id {row['id']!r} is step {target.get('name')!r}, "
                f"but the row calls it {row['name']!r}"
            )
            positions.append(index)
        assert positions == sorted(positions), f"{key} rows are not in step order"


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_the_setup_and_verdict_sets_are_the_literal_table(workflow, job_id):
    step = _declarer(_job(workflow, job_id))
    setup = [
        row.group("mark") + row.group("name") for row in _rows(step, "SETUP_STEPS")
    ]
    verdict = [
        row.group("mark") + row.group("name") for row in _rows(step, "VERDICT_STEPS")
    ]
    assert setup == CARRIERS[(workflow, job_id)]["setup"]
    assert verdict == CARRIERS[(workflow, job_id)]["verdict"]


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_a_setup_step_failing_is_the_jobs_first_failure(workflow, job_id):
    """No status-function `if:` and no `continue-on-error` on a SETUP step.

    With the implicit `success()`, a setup step runs only while nothing has
    failed, so its concluding `failure` means it was the job's first failure.
    """
    job = _job(workflow, job_id)
    by_id = _steps_by_id(job)
    for row in _rows(_declarer(job), "SETUP_STEPS"):
        target = by_id[row.group("id")][1]
        assert not _has_status_function(target), f"{row['name']!r}: {target['if']!r}"
        assert "continue-on-error" not in target, f"{row['name']!r} can soft-fail"


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_a_verdict_step_is_marked_iff_its_if_has_a_status_function(workflow, job_id):
    job = _job(workflow, job_id)
    by_id = _steps_by_id(job)
    for row in _rows(_declarer(job), "VERDICT_STEPS"):
        target = by_id[row.group("id")][1]
        assert bool(row.group("mark")) == _has_status_function(target), (
            f"{row['name']!r} has `if: {target.get('if')}`; the `!` mark must follow it"
        )


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_every_setup_step_comes_after_the_jobs_checkout(workflow, job_id):
    job = _job(workflow, job_id)
    checkout = _own_checkout_index(job)
    by_id = _steps_by_id(job)
    for row in _rows(_declarer(job), "SETUP_STEPS"):
        assert by_id[row.group("id")][0] > checkout, f"{row['name']!r} precedes it"


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_no_apt_step_outcome_id_is_a_verdict_row(workflow, job_id):
    """An APT_STEP_OUTCOMES step runs apt-get and nothing else: never a verdict."""
    job = _job(workflow, job_id)
    verdict_ids = {row.group("id") for row in _rows(_declarer(job), "VERDICT_STEPS")}
    assert not verdict_ids & set(_apt_ids(job))


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_every_non_soft_apt_row_of_the_explainer_is_a_setup_row(workflow, job_id):
    job = _job(workflow, job_id)
    by_id = _steps_by_id(job)
    setup_ids = {row.group("id") for row in _rows(_declarer(job), "SETUP_STEPS")}
    for apt_id, name in _apt_ids(job).items():
        if "continue-on-error" in by_id[apt_id][1]:
            assert apt_id not in setup_ids, f"{name!r} soft-fails; it cannot be SETUP"
        else:
            assert apt_id in setup_ids, f"{name!r} ({apt_id}) is not a SETUP row"


@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_the_harness_pattern_covers_the_jobs_own_harness(workflow, job_id):
    pattern = str(_declarer(_job(workflow, job_id))["env"]["HARNESS_PATHS_RE"])
    assert pattern == _harness_literal(workflow)
    compiled = re.compile(pattern)
    for path in (
        f".github/workflows/{workflow}",
        ".github/actions/self-hosted-host-provisioned/action.yml",
        SCRIPT_REF,
    ):
        assert compiled.search(path), path
    for path in (
        "backend/app/main.py",
        f".github/workflows/{workflow}.orig",
        "frontend/.github/actions/x.yml",
        ".github/scripts/declare-setup-death.sh.bak",
    ):
        assert not compiled.search(path), path


def test_create_test_schemas_carries_its_id_only_for_the_declarer():
    """It used to be id-less so it never reached APT_STEP_OUTCOMES; it still must not."""
    job = _job("backend-ci.yml", "test")
    assert _steps_by_id(job)["test_schemas"][1]["name"] == (
        "Create test schemas and extensions"
    )
    assert "test_schemas" not in _apt_ids(job)


def _render_rows(text: str, failing: str | None, default: str) -> str:
    """Rows with every `${{ steps.X.* }}` rendered: `failing` fails, the rest `default`."""
    lines = []
    for line in text.splitlines():
        match = _ROW.match(line.strip())
        if not match:
            continue
        value = "failure" if match.group("id") == failing else default
        lines.append(f"{match.group('mark')}{match.group('name')}|{value}|{value}")
    return "\n".join(lines) + "\n"


@requires_bash_and_git
@pytest.mark.parametrize(("workflow", "job_id"), list(CARRIERS), ids=CARRIER_IDS)
def test_each_carriers_own_env_declares_its_first_setup_death(
    tmp_path, home, workflow, job_id
):
    """The YAML's own env block, rendered as Actions would, drives the script."""
    job = _job(workflow, job_id)
    step = _declarer(job)
    env = step["env"]
    combo = _matrix_combos(job)[0]
    first_setup = _rows(step, "SETUP_STEPS")[0]
    rendered_env = {
        "DECLARE_JOB": _render_matrix(str(env["DECLARE_JOB"]), combo),
        "SETUP_STEPS": _render_matrix(
            _render_rows(str(env["SETUP_STEPS"]), first_setup.group("id"), "skipped"),
            combo,
        ),
        "VERDICT_STEPS": _render_rows(str(env["VERDICT_STEPS"]), None, "skipped"),
        "HARNESS_PATHS_RE": str(env["HARNESS_PATHS_RE"]),
    }
    clean = PrRepo(tmp_path / "clean", home, changes={"backend/app/main.py": "x\n"})
    _, out, _ = _run({**_pr_env(clean), **rendered_env})
    assert _titles(out) == [
        f"{rendered_env['DECLARE_JOB']} SETUP FAILED (not a verdict on this PR)"
    ], _defang(out)
    # The same rows on a PR that edits this job's own workflow: withheld.
    touched = PrRepo(
        tmp_path / "touched", home, changes={f".github/workflows/{workflow}": "x\n"}
    )
    _, out, _ = _run({**_pr_env(touched), **rendered_env})
    assert "harness-diff guard read true" in _assert_withheld(out), _defang(out)


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


def test_backend_ci_triggers_on_the_recall_eval_workflow():
    """The one carrier no earlier backend-ci filter entry covered (plan Phase 2)."""
    for trigger in ("pull_request", "push"):
        assert ".github/workflows/memory-recall-eval.yml" in _backend_ci_paths(trigger)


# --- this module itself --------------------------------------------------------


def test_this_module_never_prints_script_output():
    """A printed declaration line in the shard log would itself be a declaration."""
    for source in (Path(__file__), REPO_ROOT / "backend/tests/setup_death_git.py"):
        assert_prints_nothing(source)


def test_the_script_is_executable_and_strict():
    text = SCRIPT.read_text(encoding="utf-8")
    assert text.startswith("#!/usr/bin/env bash\n")
    assert "\nset -uo pipefail\n" in text
    assert "\nset -e" not in text, "-e would let a failing command skip the verdict"
    assert "eval " not in text
    assert os.access(SCRIPT, os.X_OK)
