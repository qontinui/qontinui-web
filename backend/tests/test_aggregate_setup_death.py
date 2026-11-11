"""The aggregate setup-death declarer: ``scripts/ci/aggregate_setup_death.py``.

Plan ``2026-11-11-web-setup-step-deaths-declare-not-a-verdict``, Phases 3-4. An
aggregate check (``Run Tests``, ``Test Summary``, ``Migration Reversal Gate``)
is red only because a member job was, and coord never lets a declared member
outvote the undeclared, red aggregate beside it. The script titles the
aggregate ``<check> SETUP FAILED in every failed <noun> (not a verdict on this
PR)`` only when the members' OWN annotations declare every failed member's
setup death. This module pins:

1. **The decision**, arm by arm, with the HTTP client stubbed at
   ``urllib.request.urlopen`` to serve the RECORDED jobs listings in
   ``fixtures/shard_headroom/run-*.json`` and annotation JSON, so the real
   ``shard_headroom.fetch_jobs`` / ``get_json`` code paths run.
2. **The wiring**: each aggregate's step against a literal table, its job-level
   ``checks: read``, and the lane roster.

Every assertion compares against literal strings spelled out here. NOTHING HERE
PRINTS SCRIPT OUTPUT: this module runs in a ``Run Tests`` shard, where a printed
``::error title=`` line would itself be a declaration on that shard. Outputs are
returned as strings or captured, and ``_defang`` keeps ``::`` out of failure
messages.
"""

from __future__ import annotations

import ast
import contextlib
import copy
import importlib.util
import io
import itertools
import json
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
SCRIPT_REF = "scripts/ci/aggregate_setup_death.py"
SCRIPT_PATH = REPO_ROOT / SCRIPT_REF
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
FIXTURES = Path(__file__).parent / "fixtures" / "shard_headroom"
DECLARED_LANES = frozenset(
    {".github/workflows/backend-ci.yml", ".github/workflows/e2e-tests.yml"}
)


def _load():
    spec = importlib.util.spec_from_file_location("aggregate_setup_death", SCRIPT_PATH)
    assert spec and spec.loader, f"cannot load {SCRIPT_PATH}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


aggregate = _load()

RUN_ID = "36548570438"
REPO = "qontinui/qontinui-web"
API = "https://api.github.com"
RUN_TESTS_TITLE = (
    "Run Tests SETUP FAILED in every failed shard (not a verdict on this PR)"
)
WITHHELD_TITLE = "Setup-death declaration withheld"
PHRASE = "(not a verdict on this PR)"


# --- the stubbed HTTP client --------------------------------------------------


class _Response:
    def __init__(self, payload: Any):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class FakeGitHub:
    """Serves one jobs listing and per-check-run annotation pages, by URL."""

    def __init__(self, jobs: list[dict[str, Any]]):
        self.jobs = jobs
        self.annotations: dict[int, list[list[dict[str, Any]]]] = {}
        self.urls: list[str] = []
        self.timeouts: list[float] = []
        self.fail_jobs = False
        self.fail_annotations = False

    def declare(self, job_id: int, *titles: str) -> None:
        """Every read of this check run serves these titles."""
        self.annotations[job_id] = [[_annotation(t) for t in titles]]

    def serve_in_turn(self, job_id: int, *pages: list[str]) -> None:
        """Successive reads serve successive pages (annotation lag)."""
        self.annotations[job_id] = [[_annotation(t) for t in page] for page in pages]

    def urlopen(self, request, timeout):
        url = request.full_url
        self.urls.append(url)
        self.timeouts.append(timeout)
        if "/jobs?" in url:
            if self.fail_jobs:
                raise urllib.error.URLError("rate limited")
            return _Response({"total_count": len(self.jobs), "jobs": self.jobs})
        if "/annotations?" in url:
            if self.fail_annotations:
                raise urllib.error.HTTPError(url, 403, "Forbidden", {}, None)  # type: ignore[arg-type]
            job_id = int(url.split("/check-runs/")[1].split("/")[0])
            pages = self.annotations.get(job_id, [[]])
            page = pages.pop(0) if len(pages) > 1 else pages[0]
            return _Response(page)
        raise AssertionError(f"unexpected URL {url}")


def _annotation(title: str) -> dict[str, Any]:
    return {
        "path": ".github",
        "start_line": 1,
        "end_line": 1,
        "annotation_level": "failure",
        "title": title,
        "message": "m",
        "raw_details": None,
    }


def _recorded_jobs(run_id: str = RUN_ID) -> list[dict[str, Any]]:
    payload = json.loads((FIXTURES / f"run-{run_id}.json").read_text(encoding="utf-8"))
    return copy.deepcopy(payload["jobs"])


def _shard(jobs: list[dict[str, Any]], n: int) -> dict[str, Any]:
    return next(j for j in jobs if j["name"] == f"Run Tests (shard {n}/6)")


def _with_conclusions(**by_shard: str) -> list[dict[str, Any]]:
    """The recorded run with each named shard's conclusion set; the rest success."""
    jobs = _recorded_jobs()
    for n in range(1, 7):
        _shard(jobs, n)["conclusion"] = by_shard.get(f"s{n}", "success")
    return jobs


def _shard_title(n: int) -> str:
    return f"Run Tests (shard {n}/6) SETUP FAILED (not a verdict on this PR)"


def _env(**overrides: str) -> dict[str, str]:
    env = {
        "DECLARE_JOB": "Run Tests",
        "MEMBER_NEED": "test",
        "NEEDS_JSON": json.dumps({"test": {"result": "failure", "outputs": {}}}),
        "EXPECTED_MEMBERS": "6",
        "GITHUB_TOKEN": "t",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_RUN_ID": RUN_ID,
        "GITHUB_RUN_ATTEMPT": "2",
        "GITHUB_API_URL": API,
    }
    env.update(overrides)
    return env


@pytest.fixture
def github(monkeypatch):
    holder: dict[str, FakeGitHub] = {}

    def install(jobs: list[dict[str, Any]]) -> FakeGitHub:
        fake = FakeGitHub(jobs)
        # Both scripts call `urllib.request.urlopen` through the module, so one
        # patch serves the real fetch_jobs AND get_json code paths.
        monkeypatch.setattr(urllib.request, "urlopen", fake.urlopen)
        holder["fake"] = fake
        return fake

    return install


class _Sleeps:
    def __init__(self) -> None:
        self.calls: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


def _decide(env: dict[str, str], sleeps: _Sleeps | None = None, monotonic=None):
    return aggregate.decide(
        env,
        sleep=sleeps if sleeps is not None else _Sleeps(),
        monotonic=monotonic or (lambda: 0.0),
    )


def _line(outcome) -> str:
    return aggregate.render(outcome)


def _defang(text: str) -> str:
    return text.replace("::", ": :")


def _parse(line: str) -> tuple[str, str, str]:
    """``(command, title, message)`` of one workflow-command line, decoded."""
    assert line.startswith("::"), _defang(line)
    end = line.index("::", 2)
    info, data = line[2:end], line[end + 2 :]
    name, _, props = info.partition(" ")
    title = ""
    for prop in props.split(","):
        key, _, value = prop.partition("=")
        if key == "title":
            title = (
                value.replace("%0D", "\r")
                .replace("%0A", "\n")
                .replace("%3A", ":")
                .replace("%2C", ",")
                .replace("%25", "%")
            )
    message = data.replace("%0D", "\r").replace("%0A", "\n").replace("%25", "%")
    return name, title, message


def _assert_withheld(outcome) -> str:
    line = _line(outcome)
    assert PHRASE not in line, _defang(line)
    name, title, message = _parse(line)
    assert (name, title) == ("notice", WITHHELD_TITLE), _defang(line)
    return message


def _assert_declined(outcome) -> str:
    line = _line(outcome)
    assert PHRASE not in line, _defang(line)
    assert line.startswith("aggregate-setup-death: no declaration: "), _defang(line)
    return line


# --- the declaration ----------------------------------------------------------


def test_every_failed_shard_declared_titles_the_aggregate(github):
    fake = github(_with_conclusions(s1="failure", s3="failure"))
    jobs = fake.jobs
    fake.declare(_shard(jobs, 1)["id"], "", _shard_title(1))
    fake.declare(_shard(jobs, 3)["id"], _shard_title(3))
    line = _line(_decide(_env()))
    assert _parse(line) == (
        "error",
        RUN_TESTS_TITLE,
        "Run Tests (shard 1/6), Run Tests (shard 3/6) each declared a setup death; "
        "no member reached a verdict on this PR. Re-run the failed members.",
    )


def test_the_reads_are_the_attempt_listing_and_coords_annotation_page(github):
    fake = github(_with_conclusions(s2="failure"))
    shard2 = _shard(fake.jobs, 2)["id"]
    fake.declare(shard2, _shard_title(2))
    _decide(_env())
    assert fake.urls == [
        f"{API}/repos/{REPO}/actions/runs/{RUN_ID}/attempts/2/jobs?per_page=100&page=1",
        f"{API}/repos/{REPO}/check-runs/{shard2}/annotations?per_page=50",
    ]
    assert all(t <= 20 for t in fake.timeouts), fake.timeouts


def test_an_annotation_that_lags_is_re_read(github):
    fake = github(_with_conclusions(s4="failure"))
    shard4 = _shard(fake.jobs, 4)["id"]
    fake.serve_in_turn(shard4, [], [""], [_shard_title(4)])
    sleeps = _Sleeps()
    line = _line(_decide(_env(), sleeps))
    assert _parse(line)[1] == RUN_TESTS_TITLE, _defang(line)
    assert sleeps.calls == [10, 10]


def test_a_member_noun_names_a_non_shard_member(github):
    jobs = [
        {
            "id": 7,
            "name": "Backend E2E Tests (3.12)",
            "status": "completed",
            "conclusion": "failure",
        },
        {"id": 8, "name": "Test Summary", "status": "in_progress", "conclusion": None},
    ]
    fake = github(jobs)
    fake.declare(7, "Backend E2E Tests (3.12) SETUP FAILED (not a verdict on this PR)")
    env = _env(
        DECLARE_JOB="Test Summary",
        MEMBER_NEED="backend-tests",
        MEMBER_NAME_RE=r"^Backend E2E Tests \(3\.12\)$",
        MEMBER_NOUN="job",
        EXPECTED_MEMBERS="1",
        NEEDS_JSON=json.dumps(
            {
                "backend-tests": {"result": "failure"},
                "frontend-tests": {"result": "skipped"},
            }
        ),
    )
    assert _parse(_line(_decide(env)))[:2] == (
        "error",
        "Test Summary SETUP FAILED in every failed job (not a verdict on this PR)",
    )


# --- no declaration -------------------------------------------------------------


def test_one_undeclared_shard_withholds_after_three_re_reads(github):
    fake = github(_with_conclusions(s1="failure", s5="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], _shard_title(1))
    fake.declare(_shard(fake.jobs, 5)["id"], "", "")
    sleeps = _Sleeps()
    line = _assert_declined(_decide(_env(), sleeps))
    assert (
        "member 'Run Tests (shard 5/6)' carries no setup-death declaration after 4 reads"
    ) in line
    assert sleeps.calls == [10, 10, 10]


RECORDED_2144_RUN = "42466217222"
RECORDED_2144_SHARD1 = 128686240645


def _recorded_annotations(check_run: int) -> list[dict[str, Any]]:
    payload = json.loads(
        (FIXTURES / f"annotations-{check_run}.json").read_text(encoding="utf-8")
    )
    return copy.deepcopy(payload["annotations"])


def _recorded_2144(attempt: int) -> list[dict[str, Any]]:
    return _recorded_jobs(f"{RECORDED_2144_RUN}-attempt-{attempt}")


def test_the_recorded_2144_setup_death_is_not_declared_without_a_shard_title(github):
    """The real run: shard 1 died in Install Poetry, all five titles ''.

    That is today's state: no shard wrote the phrase, so the aggregate must
    not either -- after re-reading for the lag, it declines.
    """
    jobs = _recorded_2144(1)
    shard1 = _shard(jobs, 1)
    assert shard1["id"] == RECORDED_2144_SHARD1
    assert [s["name"] for s in shard1["steps"] if s["conclusion"] == "failure"] == [
        "Install Poetry"
    ]
    fake = github(jobs)
    fake.annotations[RECORDED_2144_SHARD1] = [
        _recorded_annotations(RECORDED_2144_SHARD1)
    ]
    sleeps = _Sleeps()
    env = _env(GITHUB_RUN_ID=RECORDED_2144_RUN, GITHUB_RUN_ATTEMPT="1")
    line = _assert_declined(_decide(env, sleeps))
    assert "member 'Run Tests (shard 1/6)' carries no setup-death declaration" in line
    assert sleeps.calls == [10, 10, 10]
    assert fake.urls[0] == (
        f"{API}/repos/{REPO}/actions/runs/{RECORDED_2144_RUN}/attempts/1/jobs"
        "?per_page=100&page=1"
    )


def test_the_recorded_2144_setup_death_declares_once_its_shard_titled_it(github):
    """The same real run, with the title Phase 2's declarer writes on shard 1."""
    jobs = _recorded_2144(1)
    fake = github(jobs)
    titled = _recorded_annotations(RECORDED_2144_SHARD1) + [
        _annotation(_shard_title(1))
    ]
    fake.annotations[RECORDED_2144_SHARD1] = [titled]
    env = _env(GITHUB_RUN_ID=RECORDED_2144_RUN, GITHUB_RUN_ATTEMPT="1")
    assert _parse(_line(_decide(env))) == (
        "error",
        RUN_TESTS_TITLE,
        "Run Tests (shard 1/6) each declared a setup death; no member reached a "
        "verdict on this PR. Re-run the failed members.",
    )


def test_the_recorded_attempt_listing_carries_every_shard_of_the_attempt(monkeypatch):
    """D4: a `--failed` re-run's attempt listing still lists all six shards.

    Recorded on run 42466217222 attempt 2, where only shard 1 was re-run: every
    shard appears with an attempt-2 job id, so a per-attempt listing is
    complete for the aggregate.
    """
    rows = _recorded_2144(2)
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda request, timeout: _Response({"total_count": len(rows), "jobs": rows}),
    )
    jobs = aggregate.fetch_jobs(REPO, RECORDED_2144_RUN, "t", API, attempt=2)
    shards = [j for j in jobs if aggregate.SHARD_NAME.fullmatch(j["name"])]
    assert sorted(j["name"] for j in shards) == [
        f"Run Tests (shard {n}/6)" for n in range(1, 7)
    ]
    assert {j["run_attempt"] for j in shards} == {2}
    attempt_one_ids = {j["id"] for j in _recorded_2144(1)}
    assert not attempt_one_ids & {j["id"] for j in shards}


def test_a_different_not_a_verdict_title_is_not_a_setup_declaration(github):
    """The aggregate's title says SETUP FAILED; a TIMED OUT member is not that."""
    fake = github(_with_conclusions(s2="failure"))
    fake.declare(
        _shard(fake.jobs, 2)["id"],
        "Run Tests (shard 2/6) TIMED OUT (not a verdict on this PR)",
    )
    _assert_declined(_decide(_env()))


def test_a_cancelled_shard_is_not_a_declaration(github):
    """The RECORDED run 36548570438: shard 6 concluded `cancelled` at its budget."""
    jobs = _recorded_jobs()
    assert _shard(jobs, 6)["conclusion"] == "cancelled"
    _shard(jobs, 1)["conclusion"] = "failure"
    fake = github(jobs)
    fake.declare(_shard(jobs, 1)["id"], _shard_title(1))
    fake.declare(_shard(jobs, 6)["id"], _shard_title(6))
    line = _assert_declined(_decide(_env()))
    assert "Run Tests (shard 6/6)=cancelled" in line


@pytest.mark.parametrize("conclusion", ["timed_out", "skipped", "neutral", None])
def test_any_other_member_conclusion_is_not_a_declaration(github, conclusion):
    jobs = _with_conclusions(s1="failure")
    _shard(jobs, 2)["conclusion"] = conclusion
    fake = github(jobs)
    fake.declare(_shard(jobs, 1)["id"], _shard_title(1))
    _assert_declined(_decide(_env()))


@pytest.mark.parametrize("result", ["cancelled", "success", "skipped"])
def test_a_member_need_that_did_not_fail_is_not_a_declaration(github, result):
    github(_with_conclusions(s1="failure"))
    env = _env(NEEDS_JSON=json.dumps({"test": {"result": result}}))
    line = _assert_declined(_decide(env))
    assert f"test concluded '{result}'" in line


@pytest.mark.parametrize("other", ["failure", "cancelled"])
def test_another_red_need_is_not_laundered(github, other):
    fake = github(
        [
            {
                "id": 7,
                "name": "Backend E2E Tests (3.12)",
                "status": "completed",
                "conclusion": "failure",
            }
        ]
    )
    fake.declare(7, "Backend E2E Tests (3.12) SETUP FAILED (not a verdict on this PR)")
    env = _env(
        DECLARE_JOB="Test Summary",
        MEMBER_NEED="backend-tests",
        MEMBER_NAME_RE=r"^Backend E2E Tests \(3\.12\)$",
        EXPECTED_MEMBERS="1",
        NEEDS_JSON=json.dumps(
            {
                "backend-tests": {"result": "failure"},
                "frontend-tests": {"result": other},
            }
        ),
    )
    line = _assert_declined(_decide(env))
    assert f"frontend-tests={other}" in line
    assert fake.urls == [], "a declined need must not spend a read"


# --- UNKNOWN withholds -------------------------------------------------------------


def test_a_member_count_of_five_is_unknown(github):
    jobs = _with_conclusions(s1="failure")
    jobs.remove(_shard(jobs, 4))
    fake = github(jobs)
    fake.declare(_shard(jobs, 1)["id"], _shard_title(1))
    message = _assert_withheld(_decide(_env()))
    assert "lists 5 job(s) named like" in message
    assert "not the 6 expected" in message


def test_a_jobs_read_error_is_unknown(github):
    github(_with_conclusions(s1="failure")).fail_jobs = True
    assert "a GitHub read failed" in _assert_withheld(_decide(_env()))


def test_an_annotations_read_error_is_unknown(github):
    github(_with_conclusions(s1="failure")).fail_annotations = True
    assert "a GitHub read failed" in _assert_withheld(_decide(_env()))


def test_an_unfinished_member_is_unknown(github):
    jobs = _with_conclusions(s1="failure")
    _shard(jobs, 3)["status"] = "in_progress"
    github(jobs)
    assert "have not completed" in _assert_withheld(_decide(_env()))


def test_a_failed_need_with_no_failed_member_is_unknown(github):
    github(_with_conclusions())
    assert "no member job did" in _assert_withheld(_decide(_env()))


def test_the_time_budget_withholds(github):
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], "")
    clock = iter([0.0, 0.0, 115.0, 115.0, 115.0])
    message = _assert_withheld(_decide(_env(), monotonic=lambda: next(clock)))
    assert "time budget ran out" in message


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"DECLARE_JOB": ""}, "DECLARE_JOB is empty"),
        ({"MEMBER_NEED": ""}, "MEMBER_NEED is empty"),
        ({"NEEDS_JSON": "not json"}, "NEEDS_JSON is not JSON"),
        ({"NEEDS_JSON": "{}"}, "NEEDS_JSON is not a non-empty object"),
        ({"NEEDS_JSON": '{"test": {}}'}, "need 'test' carries no result"),
        ({"MEMBER_NEED": "lint"}, "MEMBER_NEED 'lint' is not one of the needs"),
        (
            {"EXPECTED_MEMBERS": "six"},
            "EXPECTED_MEMBERS='six' is not a positive integer",
        ),
        ({"EXPECTED_MEMBERS": "0"}, "EXPECTED_MEMBERS='0' is not a positive integer"),
        ({"GITHUB_RUN_ATTEMPT": ""}, "GITHUB_RUN_ATTEMPT='' is not a positive integer"),
        (
            {"MEMBER_NAME_RE": "(unclosed"},
            "MEMBER_NAME_RE='(unclosed' does not compile",
        ),
        ({"MEMBER_NOUN": "Shard!"}, "MEMBER_NOUN='Shard!' is not a lowercase word"),
        ({"GITHUB_TOKEN": ""}, "GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_TOKEN"),
    ],
    ids=lambda v: v if isinstance(v, str) else next(iter(v)),
)
def test_a_malformed_input_withholds(github, overrides, expected):
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], _shard_title(1))
    assert expected in _assert_withheld(_decide(_env(**overrides)))


def test_a_marker_changing_declare_job_is_withheld(github):
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], _shard_title(1))
    message = _assert_withheld(
        _decide(_env(DECLARE_JOB="Run Tests killed IN THE BUILD"))
    )
    assert "marker-changing phrase" in message


def test_no_title_it_writes_changes_coords_marker_class(github):
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], _shard_title(1))
    titles = [
        _parse(_line(_decide(_env())))[1],
        _parse(_line(_decide(_env(EXPECTED_MEMBERS="5"))))[1],
    ]
    assert titles == [RUN_TESTS_TITLE, WITHHELD_TITLE]
    for title in titles:
        for marker in (
            "TIMED OUT (not a verdict on this PR)",
            "OUT OF MEMORY (not a verdict on this PR)",
            "killed IN THE BUILD",
        ):
            assert marker not in title


# --- the entry point: always exit 0, one line -----------------------------------


def test_main_exits_zero_and_withholds_when_decide_crashes(monkeypatch):
    def boom(_env, **_kw):
        raise RuntimeError("unexpected")

    monkeypatch.setattr(aggregate, "decide", boom)
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = aggregate.main()
    assert code == 0
    name, title, message = _parse(buffer.getvalue().strip())
    assert (name, title) == ("notice", WITHHELD_TITLE)
    assert "crashed" in message


@pytest.mark.skipif(shutil.which("python3") is None, reason="no python3 on PATH")
def test_the_script_runs_standalone_and_exits_zero_without_a_token():
    """`python3 scripts/ci/aggregate_setup_death.py`, as the step runs it."""
    proc = subprocess.run(
        ["python3", str(SCRIPT_PATH)],
        env={
            "PATH": "/usr/bin:/bin",
            "DECLARE_JOB": "Run Tests",
            "MEMBER_NEED": "test",
            "NEEDS_JSON": json.dumps({"test": {"result": "failure"}}),
            "EXPECTED_MEMBERS": "6",
            "GITHUB_RUN_ATTEMPT": "1",
        },
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert proc.returncode == 0
    name, title, message = _parse(proc.stdout.strip())
    assert (name, title) == ("notice", WITHHELD_TITLE), _defang(proc.stdout)
    assert "GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_TOKEN" in message


def test_this_module_never_prints_script_output():
    tree = ast.parse(Path(__file__).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id != "print", f"print() at line {node.lineno}"
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "run"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "subprocess"
        ):
            keywords = {kw.arg: kw.value for kw in node.keywords}
            captured = keywords.get("capture_output")
            assert isinstance(captured, ast.Constant) and captured.value is True


# --- the wiring --------------------------------------------------------------------

DECLARER_STEP = "Declare a setup death"
CHECKOUT_STEP = "Check out the declarer"

AGGREGATES: dict[tuple[str, str], dict[str, str]] = {
    ("backend-ci.yml", "test-gate"): {
        "DECLARE_JOB": "Run Tests",
        "MEMBER_NEED": "test",
        "EXPECTED_MEMBERS": "${{ env.EXPECTED_SHARDS }}",
    },
    ("e2e-tests.yml", "test-summary"): {
        "DECLARE_JOB": "Test Summary",
        "MEMBER_NEED": "backend-tests",
        "MEMBER_NAME_RE": r"^Backend E2E Tests \(3\.12\)$",
        "MEMBER_NOUN": "job",
        "EXPECTED_MEMBERS": "1",
    },
}
AGGREGATE_IDS = [f"{w}:{j}" for w, j in AGGREGATES]


def _workflow(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


def _aggregate_jobs() -> list[tuple[str, str]]:
    """Every ``(workflow, job id)`` whose steps run the script, by glob."""
    found = []
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        for job_id, job in (doc.get("jobs") or {}).items():
            if any(
                SCRIPT_REF in str(s.get("run", ""))
                for s in (job or {}).get("steps") or []
            ):
                found.append((path.name, job_id))
    return found


def test_lane_roster_matches_the_tree():
    assert_lane_roster(SCRIPT_REF, DECLARED_LANES)


def test_docstring_names_every_lane():
    assert_docstring_names_every_lane(aggregate.__doc__, SCRIPT_REF, DECLARED_LANES)


def test_the_aggregates_are_exactly_the_literal_table():
    assert sorted(_aggregate_jobs()) == sorted(AGGREGATES)


@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_the_aggregate_job_reads_checks_with_its_own_permissions(workflow, job_id):
    """`checks: read` is this job's only widening (security-surface item 3)."""
    job = _workflow(workflow)["jobs"][job_id]
    assert job["permissions"] == {
        "contents": "read",
        "actions": "read",
        "checks": "read",
    }


@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_the_two_steps_add_no_failure_mode_to_a_green_aggregate(workflow, job_id):
    steps = _workflow(workflow)["jobs"][job_id]["steps"]
    names = [s.get("name") for s in steps]
    assert names[-2:] == [CHECKOUT_STEP, DECLARER_STEP]
    checkout, declarer = steps[-2], steps[-1]
    assert checkout["if"] == "failure()"
    assert checkout["continue-on-error"] is True
    assert str(checkout["uses"]).startswith("actions/checkout@")
    assert checkout["with"]["persist-credentials"] is False
    assert checkout["with"]["sparse-checkout"] == "scripts/ci"
    assert declarer["if"] == "failure()"
    assert declarer["timeout-minutes"] == 3
    assert "continue-on-error" not in declarer
    run = declarer["run"]
    assert "if [ ! -f scripts/ci/aggregate_setup_death.py ]; then" in run
    assert "python3 scripts/ci/aggregate_setup_death.py || echo" in run


@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_the_declarer_env_is_the_literal_table(workflow, job_id):
    env = {
        k: str(v)
        for k, v in _workflow(workflow)["jobs"][job_id]["steps"][-1]["env"].items()
    }
    expected = {
        **AGGREGATES[(workflow, job_id)],
        "NEEDS_JSON": "${{ toJSON(needs) }}",
        "GITHUB_TOKEN": "${{ github.token }}",
    }
    assert env == expected


_MATRIX_EXPR = re.compile(r"\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}")


def _served_names(job_id: str, job: dict) -> list[str]:
    """The check name GitHub serves for each matrix leg of a job.

    A name that references no matrix value gets the leg's values appended in
    parentheses (`Backend E2E Tests (3.12)`); one that does is rendered. A
    dynamic (`fromJson`) matrix has no static legs and yields the bare name.
    """
    name = str(job.get("name", job_id))
    matrix = (job.get("strategy") or {}).get("matrix") or {}
    if not isinstance(matrix, dict):
        return [name]
    dims = {
        key: values
        for key, values in matrix.items()
        if key not in ("include", "exclude") and isinstance(values, list)
    }
    combos = [
        dict(zip(dims, combo, strict=True))
        for combo in itertools.product(*dims.values())
    ] or [{}]
    served = []
    for combo in combos:
        rendered = _MATRIX_EXPR.sub(lambda m, c=combo: str(c[m.group(1)]), name)
        if combo and not _MATRIX_EXPR.search(name):
            rendered += " (" + ", ".join(str(v) for v in combo.values()) + ")"
        served.append(rendered)
    return served


@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_the_member_pattern_matches_exactly_the_member_jobs(workflow, job_id):
    """Every matrix leg of the member need, the expected count, and nothing else."""
    doc = _workflow(workflow)
    job = doc["jobs"][job_id]
    table = AGGREGATES[(workflow, job_id)]
    member_need = table["MEMBER_NEED"]
    needs = job["needs"] if isinstance(job["needs"], list) else [job["needs"]]
    assert member_need in needs
    pattern = aggregate._member_pattern(table)
    members = _served_names(member_need, doc["jobs"][member_need])
    assert all(pattern.fullmatch(name) for name in members), members
    expected = table["EXPECTED_MEMBERS"]
    if expected == "${{ env.EXPECTED_SHARDS }}":
        expected = str(job["env"]["EXPECTED_SHARDS"])
    assert int(expected) == len(members)
    for other_id, other in doc["jobs"].items():
        if other_id == member_need:
            continue
        for name in _served_names(other_id, other):
            assert not pattern.fullmatch(name), f"{name!r} would count as a member"
