"""Tests for the DRIFT test of ``.github/workflows/workflow-lint.yml``.

Plan ``2026-10-24-workflow-lint-drift-judged-against-stale-pr-base``. The
workflow's ``zizmor`` step reports a ``ref-version-mismatch`` finding as DRIFT
(non-blocking) only when the flagged line already exists in the BASE copy of
the file. That base used to be ``github.event.pull_request.base.sha``, which on
a PR that is behind its base is the stale merge base, while the checkout is the
merge ref onto the CURRENT base. So a pin main had gained since the branch point
read as introduced by the PR, and the required check went red the moment
upstream moved a tag (qontinui-web#1689, ``style-gate.yml:284``,
dtolnay/rust-toolchain ``v1``).

What is pinned here:

* **The base expression** resolves to the base branch NAME on a
  ``pull_request`` run (the contents API resolves a name to the branch's
  current tip) and to the default branch otherwise, and never names the
  event's base sha.
* **The shipped ``run:`` body, executed**, with a fake ``zizmor`` on ``PATH``
  and a fake contents API on loopback (``GITHUB_API_URL``):
  - the #1689 shape -- the line is at the base TIP but not at the stale merge
    base -- is DRIFT and passes the step;
  - the same inputs fed the pre-fix expression's value are FINDINGS, so the
    test fails against the old workflow [policy: a-test-must-be-able-to-fail];
  - a line absent from the tip (the PR introduced it) is FINDINGS;
  - an unreadable base is FINDINGS (fail closed);
  - an audit outside ``DRIFT_AUDITS`` is FINDINGS even on an unchanged line.

No network beyond a loopback server this module starts, no database.
"""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import threading
import urllib.parse
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, NamedTuple

import pytest
import yaml  # type: ignore[import-untyped]

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "workflow-lint.yml"

REPO = "qontinui/qontinui-web"
BASE_BRANCH = "main"
STALE_BASE_SHA = "bc3f44d0" + "0" * 32
FLAGGED_PATH = ".github/workflows/style-gate.yml"
PIN_LINE = (
    "      - uses: dtolnay/rust-toolchain@e2a55d2ffb04f378e9626c28d38b36d230d1e12f # v1"
)
# What the expression read before the fix; evaluated below to prove the
# behavioural tests fail against it.
PRE_FIX_EXPR = (
    "${{ github.event.pull_request.base.sha || "
    "github.event.repository.default_branch }}"
)


# ---------------------------------------------------------------------------
# The workflow, parsed
# ---------------------------------------------------------------------------


def _zizmor_step() -> dict[str, Any]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = doc["jobs"]["workflow-lint"]["steps"]
    matches = [s for s in steps if s.get("id") == "zizmor"]
    assert len(matches) == 1, f"workflow-lint has {len(matches)} steps with id zizmor"
    step: dict[str, Any] = matches[0]
    return step


def _drift_audits() -> str:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    value: str = doc["jobs"]["workflow-lint"]["env"]["DRIFT_AUDITS"]
    return value


_DOTTED = re.compile(r"^[a-z_]+(?:\.[a-z_]+)*$")


def _evaluate(expr: str, context: dict[str, str]) -> str:
    """Evaluate a ``${{ a || b || ... }}`` expression of dotted context paths.

    Only that grammar is accepted -- anything else fails the test rather than
    being evaluated approximately. ``||`` returns the first truthy operand,
    and an absent path is falsy, as in GitHub's expression language.
    """
    m = re.fullmatch(r"\$\{\{\s*(.*?)\s*\}\}", expr.strip())
    assert m, f"not a single expression: {expr!r}"
    operands = [o.strip() for o in m.group(1).split("||")]
    for operand in operands:
        assert _DOTTED.match(operand), f"unsupported operand {operand!r} in {expr!r}"
    for operand in operands:
        value = context.get(operand, "")
        if value:
            return value
    return ""


def _pull_request_context() -> dict[str, str]:
    """A behind PR: the event's base sha is the stale merge base."""
    return {
        "github.event_name": "pull_request",
        "github.base_ref": BASE_BRANCH,
        "github.event.pull_request.base.sha": STALE_BASE_SHA,
        "github.event.pull_request.base.ref": BASE_BRANCH,
        "github.event.repository.default_branch": BASE_BRANCH,
    }


def _push_context() -> dict[str, str]:
    """A merge-candidate push or workflow_dispatch: no base_ref."""
    return {
        "github.event_name": "push",
        "github.base_ref": "",
        "github.event.repository.default_branch": BASE_BRANCH,
    }


def _shipped_expr() -> str:
    expr: str = _zizmor_step()["env"]["DRIFT_BASE_REF"]
    return expr


def test_drift_base_never_names_the_event_base_sha() -> None:
    assert "base.sha" not in _shipped_expr()
    # The run body reads the base only through DRIFT_BASE_REF.
    assert "base.sha" not in _zizmor_step()["run"]


def test_drift_base_is_the_base_branch_on_a_pull_request() -> None:
    assert _evaluate(_shipped_expr(), _pull_request_context()) == BASE_BRANCH


def test_drift_base_is_the_default_branch_off_a_pull_request() -> None:
    assert _evaluate(_shipped_expr(), _push_context()) == BASE_BRANCH


def test_pre_fix_expression_resolved_to_the_stale_base() -> None:
    # Guards the harness: the old value is what the mutation case feeds.
    assert _evaluate(PRE_FIX_EXPR, _pull_request_context()) == STALE_BASE_SHA


# ---------------------------------------------------------------------------
# The shipped run body, executed
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
                ref = urllib.parse.parse_qs(parsed.query).get("ref", [""])[0]
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


def _file_with_pin(before: list[str]) -> bytes:
    return (
        "\n".join([*before, PIN_LINE, "        with:", "          toolchain: stable"])
        + "\n"
    ).encode()


HEAD_FILE = _file_with_pin(["name: Style gate", "jobs:", "  x:", "    steps:"])
# The stale merge base predates the pin; the tip carries it unchanged.
STALE_BASE_FILE = b"name: Style gate\njobs:\n  x:\n    steps:\n      - run: true\n"
TIP_FILE = HEAD_FILE


def _finding(ident: str, raw: bytes = HEAD_FILE) -> dict[str, Any]:
    """A zizmor 1.30.1 ``--format json`` finding on PIN_LINE's version comment."""
    offset = raw.index(b"# v1")
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
                        "offset_span": {"start": offset, "end": offset + 4},
                    },
                    "feature": "# v1",
                },
            }
        ],
    }


def _run_step(
    tmp_path: Path,
    contents: FakeContents,
    findings: list[dict[str, Any]],
    drift_base_ref: str,
) -> Run:
    work = tmp_path / "checkout"
    (work / ".github" / "workflows").mkdir(parents=True)
    (work / ".github" / "actions").mkdir()
    (work / FLAGGED_PATH).write_bytes(HEAD_FILE)
    (work / ".github" / "dependabot.yml").write_text("version: 2\n")
    (work / ".github" / "zizmor.yml").write_text("rules: {}\n")

    bindir = tmp_path / "bin"
    bindir.mkdir()
    payload = tmp_path / "zizmor.json"
    payload.write_text(json.dumps(findings))
    fake = bindir / "zizmor"
    # Exit 13 = findings (zizmor 1.30.1 docs/usage.md), 0 = clean.
    fake.write_text(f"#!/bin/sh\ncat '{payload}'\nexit {13 if findings else 0}\n")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)

    script = tmp_path / "step.sh"
    script.write_text(_zizmor_step()["run"])
    output = tmp_path / "github_output"
    output.write_text("")
    runner_temp = tmp_path / "runner_temp"
    runner_temp.mkdir()
    env = {
        "PATH": f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}",
        "HOME": str(tmp_path),
        "GITHUB_API_URL": contents.url,
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_OUTPUT": str(output),
        "RUNNER_TEMP": str(runner_temp),
        "GH_TOKEN": "test-token",
        "DRIFT_AUDITS": _drift_audits(),
        "DRIFT_BASE_REF": drift_base_ref,
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


def _serve_behind_pr(contents: FakeContents) -> None:
    contents.files[(FLAGGED_PATH, STALE_BASE_SHA)] = STALE_BASE_FILE
    contents.files[(FLAGGED_PATH, BASE_BRANCH)] = TIP_FILE


def test_line_already_at_the_base_tip_is_drift(
    tmp_path: Path, contents: FakeContents
) -> None:
    """The #1689 shape: present at the tip, absent at the stale merge base."""
    _serve_behind_pr(contents)
    base = _evaluate(_shipped_expr(), _pull_request_context())
    run = _run_step(tmp_path, contents, [_finding("ref-version-mismatch")], base)
    assert run.verdict == "DRIFT(1)", run
    assert run.code == 0, run
    assert contents.requests == [(FLAGGED_PATH, BASE_BRANCH)]
    assert "::warning file=.github/workflows/style-gate.yml" in run.stdout
    assert "DRIFT (non-blocking, upstream moved)" in run.stdout
    assert "::error" not in run.stdout


def test_pre_fix_expression_reads_the_same_line_as_findings(
    tmp_path: Path, contents: FakeContents
) -> None:
    """Mutation check: the old base expression fails the #1689 shape."""
    _serve_behind_pr(contents)
    base = _evaluate(PRE_FIX_EXPR, _pull_request_context())
    run = _run_step(tmp_path, contents, [_finding("ref-version-mismatch")], base)
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run
    assert contents.requests == [(FLAGGED_PATH, STALE_BASE_SHA)]


def test_line_absent_from_the_base_tip_is_findings(
    tmp_path: Path, contents: FakeContents
) -> None:
    """A pin the PR itself added or edited is still blocking."""
    contents.files[(FLAGGED_PATH, BASE_BRANCH)] = STALE_BASE_FILE
    base = _evaluate(_shipped_expr(), _pull_request_context())
    run = _run_step(tmp_path, contents, [_finding("ref-version-mismatch")], base)
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run
    assert "::error file=.github/workflows/style-gate.yml" in run.stdout


@pytest.mark.parametrize("status", [404, 500])
def test_unreadable_base_is_findings(
    tmp_path: Path, contents: FakeContents, status: int
) -> None:
    _serve_behind_pr(contents)
    contents.fail_with = status
    base = _evaluate(_shipped_expr(), _pull_request_context())
    run = _run_step(tmp_path, contents, [_finding("ref-version-mismatch")], base)
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run


def test_an_audit_outside_drift_audits_is_findings_on_an_unchanged_line(
    tmp_path: Path, contents: FakeContents
) -> None:
    _serve_behind_pr(contents)
    assert "unpinned-uses" not in _drift_audits().split()
    base = _evaluate(_shipped_expr(), _pull_request_context())
    run = _run_step(tmp_path, contents, [_finding("unpinned-uses")], base)
    assert run.verdict == "FINDINGS(1)", run
    assert run.code == 1, run


def test_a_clean_run_passes_without_reading_the_base(
    tmp_path: Path, contents: FakeContents
) -> None:
    base = _evaluate(_shipped_expr(), _pull_request_context())
    run = _run_step(tmp_path, contents, [], base)
    assert run.verdict == "PASS", run
    assert run.code == 0, run
    assert contents.requests == []
