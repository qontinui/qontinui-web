"""Tests for the DRIFT test of ``.github/workflows/workflow-lint.yml``.

Plan ``2026-10-24-workflow-lint-drift-judged-against-stale-pr-base``. The
workflow's ``zizmor`` step reports a ``ref-version-mismatch`` finding as DRIFT
(non-blocking) only when the flagged line already exists in the BASE copy of
the file. That base used to be ``github.event.pull_request.base.sha``, which on
a PR that is behind its base is the stale merge base, while the checkout is the
merge ref onto the CURRENT base. So a pin main had gained since the branch point
read as introduced by the PR, and the required check went red the moment
upstream moved a tag (qontinui-web#1689, ``style-gate.yml:284``,
dtolnay/rust-toolchain ``v1``). The base is now ``HEAD^1`` of the checked-out
merge commit -- the exact tree the PR was merged onto.

What is pinned here:

* **The wiring**: the step never names the event's base sha, the checkout
  fetches the merge commit's parents, and Backend CI runs this module on a PR
  that edits only ``workflow-lint.yml``.
* **The shipped ``run:`` body, executed** under ``bash -e`` against a real
  throwaway git repository, a fake ``zizmor`` on ``PATH`` and a fake contents
  API on loopback (``GITHUB_API_URL``):
  - the #1689 shape -- main gained the pin after the PR branched -- is DRIFT,
    read at ``HEAD^1`` and not at the stale merge base;
  - a pin the PR itself brought is FINDINGS;
  - a checkout that is not the PR's merge commit has no base (FINDINGS) even
    when its own first parent carries the line -- the fail-open shape;
  - an unreadable base, an audit outside ``DRIFT_AUDITS``, and a finding whose
    offset is not on a line carrying its feature text are FINDINGS;
  - off a PR the base is the default branch, by name, URL-quoted.

Mutation check, run when this module was written: restoring the pre-fix
``base.sha`` expression, dropping the merge-commit verification, or making an
unreadable base pass each fail tests here [policy: a-test-must-be-able-to-fail].

No network beyond a loopback server this module starts, no database.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import threading
import urllib.parse
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, NamedTuple

import pytest
import yaml  # type: ignore[import-untyped]

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
WORKFLOW = WORKFLOWS / "workflow-lint.yml"
BACKEND_CI = WORKFLOWS / "backend-ci.yml"
WORKFLOW_REF = ".github/workflows/workflow-lint.yml"

REPO = "qontinui/qontinui-web"
FLAGGED_PATH = ".github/workflows/style-gate.yml"
PIN_LINE = (
    "      - uses: dtolnay/rust-toolchain@e2a55d2ffb04f378e9626c28d38b36d230d1e12f # v1"
)
STEPS_HEAD = "name: Style gate\njobs:\n  x:\n    runs-on: x\n    steps:\n"
STALE_FILE = (STEPS_HEAD + "      - run: true\n").encode()
PINNED_FILE = (STEPS_HEAD + "      - run: true\n" + PIN_LINE + "\n").encode()

_SHELL_OK = sys.platform != "win32" and shutil.which("bash") and shutil.which("git")
needs_shell = pytest.mark.skipif(
    not _SHELL_OK, reason="executes the step body: needs bash 4+ and git"
)


# ---------------------------------------------------------------------------
# The workflow, parsed
# ---------------------------------------------------------------------------


def _job() -> dict[str, Any]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job: dict[str, Any] = doc["jobs"]["workflow-lint"]
    return job


def _step(step_id: str) -> dict[str, Any]:
    matches = [s for s in _job()["steps"] if s.get("id") == step_id]
    assert len(matches) == 1, (
        f"workflow-lint has {len(matches)} steps with id {step_id}"
    )
    step: dict[str, Any] = matches[0]
    return step


def test_the_step_never_names_the_event_base_sha() -> None:
    step = _step("zizmor")
    assert not any("base.sha" in str(v) for v in step["env"].values()), step["env"]
    assert "base.sha" not in step["run"]


def test_the_step_reads_the_event_name_and_pr_head() -> None:
    env = _step("zizmor")["env"]
    assert env["EVENT_NAME"] == "${{ github.event_name }}"
    assert env["PR_HEAD_SHA"] == "${{ github.event.pull_request.head.sha }}"
    assert env["DEFAULT_BRANCH"] == "${{ github.event.repository.default_branch }}"


def test_the_checkout_fetches_the_merge_commits_parents() -> None:
    assert int(_step("checkout")["with"]["fetch-depth"]) >= 2


def test_backend_ci_runs_this_module_on_a_workflow_lint_only_change() -> None:
    """A PR touching only ``workflow-lint.yml`` must still run this guard."""
    workflow = yaml.safe_load(BACKEND_CI.read_text(encoding="utf-8"))
    triggers = workflow.get("on", workflow.get(True))
    for trigger in ("pull_request", "push"):
        assert WORKFLOW_REF in triggers[trigger]["paths"], (
            f"{WORKFLOW_REF} is not in backend-ci.yml `on.{trigger}.paths`, so an "
            "edit to it alone never runs the test that guards its DRIFT base"
        )


# ---------------------------------------------------------------------------
# A throwaway repository shaped like a pull_request checkout
# ---------------------------------------------------------------------------


_GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.invalid",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": os.devnull,
}


def _git(work: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=work,
        env={**_GIT_ENV, "PATH": os.environ.get("PATH", ""), "HOME": str(work)},
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout.strip()


def _commit(work: Path, files: dict[str, bytes], message: str) -> str:
    for rel, body in files.items():
        (work / rel).parent.mkdir(parents=True, exist_ok=True)
        (work / rel).write_bytes(body)
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", message)
    return _git(work, "rev-parse", "HEAD")


class Checkout(NamedTuple):
    work: Path
    stale_base: str  # the PR's merge base -- what base.sha reads when behind
    tip: str  # main when the merge ref was made = HEAD^1 of the merge
    pr_head: str  # = HEAD^2 of the merge
    pr_parent: str  # the PR's first commit (pr_head's parent)


def _make_checkout(tmp_path: Path, pin_on: str) -> Checkout:
    """S (stale base) -> main T, and S -> PR P1 -> P2; HEAD = merge(T, P2).

    ``pin_on="main"`` is #1689: main adds the pin in T after the PR branched.
    ``pin_on="pr"`` puts the pin in P1, so the PR brought it.
    """
    work = tmp_path / "checkout"
    work.mkdir()
    _git(work, "init", "-q", "-b", "main")
    stale = _commit(
        work,
        {
            FLAGGED_PATH: STALE_FILE,
            ".github/dependabot.yml": b"version: 2\n",
            ".github/zizmor.yml": b"rules: {}\n",
            "README.md": b"base\n",
        },
        "stale base",
    )
    tip = _commit(
        work,
        {FLAGGED_PATH: PINNED_FILE} if pin_on == "main" else {"MAIN.md": b"main\n"},
        "main moves",
    )
    _git(work, "checkout", "-q", "-b", "pr", stale)
    pr_parent = _commit(
        work,
        {FLAGGED_PATH: PINNED_FILE} if pin_on == "pr" else {"PR1.md": b"pr 1\n"},
        "pr 1",
    )
    pr_head = _commit(work, {"PR2.md": b"pr 2\n"}, "pr 2")
    _git(work, "checkout", "-q", "--detach", tip)
    _git(work, "merge", "-q", "--no-ff", "-m", "merge", pr_head)
    assert _git(work, "rev-parse", "HEAD^1") == tip
    assert _git(work, "rev-parse", "HEAD^2") == pr_head
    assert (work / FLAGGED_PATH).read_bytes() == PINNED_FILE
    (work / ".github" / "actions").mkdir()
    return Checkout(work, stale, tip, pr_head, pr_parent)


# ---------------------------------------------------------------------------
# The fake contents API and the step runner
# ---------------------------------------------------------------------------


class FakeContents:
    """A loopback stand-in for ``GET /repos/{repo}/contents/{path}?ref=``."""

    def __init__(self) -> None:
        self.files: dict[tuple[str, str], bytes] = {}
        self.requests: list[tuple[str, str]] = []
        self.fail_with: int | None = None
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802 -- http.server's name
                parsed = urllib.parse.urlsplit(self.path)
                prefix = f"/repos/{REPO}/contents/"
                # Decode the ref ourselves, so a ref the step forgot to quote
                # (an `&` in a branch name) arrives split and is not found.
                raw_ref = next(
                    (q[4:] for q in parsed.query.split("&") if q.startswith("ref=")), ""
                )
                ref = urllib.parse.unquote(raw_ref)
                path = urllib.parse.unquote(parsed.path[len(prefix) :])
                outer.requests.append((path, ref))
                body = outer.files.get((path, ref))
                if (
                    outer.fail_with is not None
                    or not parsed.path.startswith(prefix)
                    or self.headers.get("Authorization") != "Bearer test-token"
                    or body is None
                ):
                    self.send_response(outer.fail_with or 404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def contents() -> Iterator[FakeContents]:
    fake = FakeContents()
    try:
        yield fake
    finally:
        fake.close()


class Run(NamedTuple):
    code: int
    stdout: str
    stderr: str
    verdict: str


def _finding(
    ident: str, raw: bytes = PINNED_FILE, at: bytes = b"# v1"
) -> dict[str, Any]:
    """A zizmor 1.30.1 ``--format json`` finding whose span starts at ``at``."""
    offset = raw.index(at)
    row = raw[:offset].count(b"\n")
    column = offset - (raw.rfind(b"\n", 0, offset) + 1)
    return {
        "ident": ident,
        "desc": "action's hash pin has mismatched or missing version comment",
        "ignored": False,
        "locations": [
            {
                "symbolic": {
                    "kind": "Primary",
                    "key": {"Local": {"verbatim_path": FLAGGED_PATH}},
                    "annotation": "tag points to commit 683b588c487a",
                },
                "concrete": {
                    "location": {
                        "start_point": {"row": row, "column": column},
                        "offset_span": {"start": offset, "end": offset + len(at)},
                    },
                    "feature": "# v1",
                },
            }
        ],
    }


def _run_step(
    tmp_path: Path,
    work: Path,
    contents: FakeContents,
    findings: list[dict[str, Any]],
    *,
    event: str = "pull_request",
    pr_head: str = "",
    default_branch: str = "main",
) -> Run:
    bindir = tmp_path / "bin"
    bindir.mkdir()
    payload = tmp_path / "zizmor.json"
    payload.write_text(json.dumps(findings))
    fake = bindir / "zizmor"
    # Exit 13 = findings (zizmor 1.30.1 docs/usage.md), 0 = clean.
    fake.write_text(f"#!/bin/sh\ncat '{payload}'\nexit {13 if findings else 0}\n")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)

    step = _step("zizmor")
    script = tmp_path / "step.sh"
    script.write_text(step["run"])
    output = tmp_path / "github_output"
    output.write_text("")
    runner_temp = tmp_path / "runner_temp"
    runner_temp.mkdir()
    env = {
        **_GIT_ENV,
        "PATH": f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}",
        "HOME": str(tmp_path),
        "GITHUB_API_URL": contents.url,
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_OUTPUT": str(output),
        "RUNNER_TEMP": str(runner_temp),
        "GH_TOKEN": "test-token",
        "DRIFT_AUDITS": _job()["env"]["DRIFT_AUDITS"],
        "EVENT_NAME": event,
        "PR_HEAD_SHA": pr_head,
        "DEFAULT_BRANCH": default_branch,
    }
    # A step with no `shell:` key runs as `bash -e {0}`.
    proc = subprocess.run(
        ["bash", "-e", str(script)],
        cwd=work,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    verdicts = [
        line[len("verdict=") :]
        for line in output.read_text().splitlines()
        if line.startswith("verdict=")
    ]
    assert len(verdicts) == 1, f"expected one verdict, got {verdicts!r}\n{proc.stderr}"
    return Run(proc.returncode, proc.stdout, proc.stderr, verdicts[0])


def _serve_history(contents: FakeContents, c: Checkout) -> None:
    """Serve the flagged file at every commit of the throwaway repository."""
    for sha in (c.stale_base, c.tip, c.pr_parent, c.pr_head):
        contents.files[(FLAGGED_PATH, sha)] = subprocess.run(
            ["git", "show", f"{sha}:{FLAGGED_PATH}"],
            cwd=c.work,
            capture_output=True,
            check=True,
        ).stdout


# ---------------------------------------------------------------------------
# pull_request runs
# ---------------------------------------------------------------------------


@needs_shell
def test_a_pin_main_gained_after_the_branch_point_is_drift(
    tmp_path: Path, contents: FakeContents
) -> None:
    """The #1689 shape: at HEAD^1, absent at the stale merge base."""
    c = _make_checkout(tmp_path, pin_on="main")
    _serve_history(contents, c)
    run = _run_step(
        tmp_path,
        c.work,
        contents,
        [_finding("ref-version-mismatch")],
        pr_head=c.pr_head,
    )
    assert run.verdict == "DRIFT(1)", run
    assert run.code == 0, run
    assert contents.requests == [(FLAGGED_PATH, c.tip)]
    assert (FLAGGED_PATH, c.stale_base) not in contents.requests
    assert "::warning file=.github/workflows/style-gate.yml" in run.stdout
    assert "DRIFT (non-blocking, upstream moved)" in run.stdout
    assert "::error" not in run.stdout


@needs_shell
def test_a_pin_the_pr_brought_is_findings(
    tmp_path: Path, contents: FakeContents
) -> None:
    c = _make_checkout(tmp_path, pin_on="pr")
    _serve_history(contents, c)
    run = _run_step(
        tmp_path,
        c.work,
        contents,
        [_finding("ref-version-mismatch")],
        pr_head=c.pr_head,
    )
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run
    assert contents.requests == [(FLAGGED_PATH, c.tip)]
    assert "::error file=.github/workflows/style-gate.yml" in run.stdout


@needs_shell
def test_a_checkout_that_is_not_the_prs_merge_commit_has_no_base(
    tmp_path: Path, contents: FakeContents
) -> None:
    """Fail-open shape: the PR head checked out bare. Its HEAD^1 is the PR's
    own earlier commit, which carries the pin the PR brought -- reading it as
    the base would wave the PR's own pin through as DRIFT."""
    c = _make_checkout(tmp_path, pin_on="pr")
    _git(c.work, "checkout", "-q", "--detach", c.pr_head)
    _serve_history(contents, c)
    run = _run_step(
        tmp_path,
        c.work,
        contents,
        [_finding("ref-version-mismatch")],
        pr_head=c.pr_head,
    )
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run
    assert contents.requests == []
    assert "is not the PR's merge commit" in run.stdout


@needs_shell
def test_a_merge_whose_second_parent_is_not_the_pr_head_has_no_base(
    tmp_path: Path, contents: FakeContents
) -> None:
    c = _make_checkout(tmp_path, pin_on="main")
    _serve_history(contents, c)
    run = _run_step(
        tmp_path, c.work, contents, [_finding("ref-version-mismatch")], pr_head="f" * 40
    )
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run
    assert contents.requests == []


@needs_shell
@pytest.mark.parametrize("status", [404, 500])
def test_an_unreadable_base_is_findings(
    tmp_path: Path, contents: FakeContents, status: int
) -> None:
    c = _make_checkout(tmp_path, pin_on="main")
    _serve_history(contents, c)
    contents.fail_with = status
    run = _run_step(
        tmp_path,
        c.work,
        contents,
        [_finding("ref-version-mismatch")],
        pr_head=c.pr_head,
    )
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run


@needs_shell
def test_an_audit_outside_drift_audits_is_findings_on_an_unchanged_line(
    tmp_path: Path, contents: FakeContents
) -> None:
    c = _make_checkout(tmp_path, pin_on="main")
    _serve_history(contents, c)
    assert "unpinned-uses" not in _job()["env"]["DRIFT_AUDITS"].split()
    run = _run_step(
        tmp_path, c.work, contents, [_finding("unpinned-uses")], pr_head=c.pr_head
    )
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run


@needs_shell
def test_a_finding_whose_offset_misses_its_feature_text_is_findings(
    tmp_path: Path, contents: FakeContents
) -> None:
    """The span starts on `- run: true`, a line present at the base, but that
    line does not carry the finding's feature text (`# v1`)."""
    c = _make_checkout(tmp_path, pin_on="main")
    _serve_history(contents, c)
    finding = _finding("ref-version-mismatch", at=b"- run: true")
    run = _run_step(tmp_path, c.work, contents, [finding], pr_head=c.pr_head)
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run


@needs_shell
def test_a_clean_run_passes_without_reading_the_base(
    tmp_path: Path, contents: FakeContents
) -> None:
    c = _make_checkout(tmp_path, pin_on="main")
    run = _run_step(tmp_path, c.work, contents, [], pr_head=c.pr_head)
    assert run.verdict == "PASS", run
    assert run.code == 0, run
    assert contents.requests == []


# ---------------------------------------------------------------------------
# merge-candidate push / workflow_dispatch runs
# ---------------------------------------------------------------------------


@needs_shell
@pytest.mark.parametrize("event", ["push", "workflow_dispatch"])
def test_off_a_pr_the_base_is_the_default_branch_by_name(
    tmp_path: Path, contents: FakeContents, event: str
) -> None:
    """A `&` in the branch name must reach the API URL-quoted, or it splits the query."""
    c = _make_checkout(tmp_path, pin_on="main")
    contents.files[(FLAGGED_PATH, "release/x&y")] = PINNED_FILE
    run = _run_step(
        tmp_path,
        c.work,
        contents,
        [_finding("ref-version-mismatch")],
        event=event,
        default_branch="release/x&y",
    )
    assert run.verdict == "DRIFT(1)", run
    assert run.code == 0, run
    assert contents.requests == [(FLAGGED_PATH, "release/x&y")]
