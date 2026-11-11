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
2. **The harness-diff guard** (rule 5), against REAL two-parent merge commits
   in temporary repositories, depth-1 clones and a stub ``git`` whose fetch
   fails or hangs (``tests/setup_death_git.py``, shared with the per-job
   declarer's tests), and read against the per-job guard for the same PRs.
   Every decision arm runs it too: ``_env()`` points it at one PR whose diff
   touches no harness.
3. **The wiring**: each aggregate's step against a literal table, its job-level
   ``checks: read``, and the lane roster.

Every assertion compares against literal strings spelled out here. NOTHING HERE
PRINTS SCRIPT OUTPUT: this module runs in a ``Run Tests`` shard, where a printed
``::error title=`` line would itself be a declaration on that shard. Outputs are
returned as strings or captured, and ``_defang`` keeps ``::`` out of failure
messages.
"""

from __future__ import annotations

import atexit
import contextlib
import copy
import functools
import importlib.util
import io
import itertools
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)
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
SCRIPTS_CI = REPO_ROOT / "scripts" / "ci"
SCRIPT_REF = "scripts/ci/aggregate_setup_death.py"
SCRIPT_PATH = REPO_ROOT / SCRIPT_REF
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
FIXTURES = Path(__file__).parent / "fixtures" / "shard_headroom"
DECLARED_LANES = frozenset(
    {
        ".github/workflows/backend-ci.yml",
        ".github/workflows/e2e-tests.yml",
        ".github/workflows/migration-reversal.yml",
    }
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
        #: Split the jobs listing into pages of this many rows (None: one page).
        self.jobs_per_page: int | None = None
        #: Called with every URL before it is served: a slow read, say.
        self.on_read: Callable[[str], None] = lambda url: None

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
        self.on_read(url)
        if "/jobs?" in url:
            if self.fail_jobs:
                raise urllib.error.URLError("rate limited")
            page = int(url.rsplit("page=", 1)[1])
            size = self.jobs_per_page or max(len(self.jobs), 1)
            served = self.jobs[(page - 1) * size : page * size]
            return _Response({"total_count": len(self.jobs), "jobs": served})
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


#: test-gate's HARNESS_PATHS_RE, spelled out: the shards' own per-job harness
#: plus the aggregate's code (the wiring table pins the YAML to it).
RUN_TESTS_HARNESS = (
    r"^\.github/workflows/backend-ci\.yml$|^\.github/actions/"
    r"|^\.github/scripts/declare-setup-death\.sh$"
    r"|^scripts/ci/aggregate_setup_death\.py$|^scripts/ci/shard_headroom\.py$"
)
BASH = shutil.which("bash")
requires_git = pytest.mark.skipif(
    GIT is None,
    reason="the harness-diff guard reads git objects; git is missing here (it "
    "is always present on the ubuntu CI runner)",
)


@functools.cache
def _clean_pr() -> PrRepo:
    """One PR whose diff touches no harness: ``_env()``'s default guard target.

    Built once per process and only READ: its first parent is in the repo, so
    the guard never fetches into it.
    """
    if GIT is None:
        pytest.skip("the harness-diff guard reads git objects; git is missing here")
    root = Path(tempfile.mkdtemp(prefix="aggregate-guard-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    home = root / "home"
    home.mkdir()
    return PrRepo(root / "repo", home, changes={"backend/app/main.py": "print('pr')\n"})


def _env(**overrides: str) -> dict[str, str]:
    """A ``Run Tests`` aggregate whose inputs all hold and whose guard reads false."""
    clean = _clean_pr()
    env = {
        **base_env(clean.home),
        "DECLARE_JOB": "Run Tests",
        "MEMBER_NEED": "test",
        "NEEDS_JSON": json.dumps({"test": {"result": "failure", "outputs": {}}}),
        "EXPECTED_MEMBERS": "6",
        "GITHUB_TOKEN": "t",
        "GITHUB_REPOSITORY": REPO,
        "GITHUB_RUN_ID": RUN_ID,
        "GITHUB_RUN_ATTEMPT": "2",
        "GITHUB_API_URL": API,
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_WORKSPACE": str(clean.root),
        "GITHUB_SHA": clean.merge,
        "HARNESS_PATHS_RE": RUN_TESTS_HARNESS,
    }
    env.update(overrides)
    return env


def _pr_env(repo: PrRepo, **overrides: str) -> dict[str, str]:
    """``_env()`` with the guard pointed at ``repo``'s merge commit."""
    return _env(
        **{
            "HOME": str(repo.home),
            "GITHUB_WORKSPACE": str(repo.root),
            "GITHUB_SHA": repo.merge,
            **overrides,
        }
    )


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
    """A re-read that would outlast the run's 120 s budget is not started."""
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], "")
    now = [0.0]
    fake.on_read = (
        lambda url: now.__setitem__(0, 115.0) if "/annotations?" in url else None
    )
    message = _assert_withheld(_decide(_env(), monotonic=lambda: now[0]))
    assert "the 120 s time budget ran out re-reading 'Run Tests (shard 1/6)'" in message


def test_the_jobs_listing_re_reads_the_clock_before_every_page(github):
    """A slow first page shrinks the second page's bound (shard_headroom deadline)."""
    fake = github(_with_conclusions(s2="failure"))
    fake.declare(_shard(fake.jobs, 2)["id"], _shard_title(2))
    fake.jobs_per_page = 4
    now = [0.0]
    fake.on_read = (
        lambda url: now.__setitem__(0, 110.0) if url.endswith("&page=1") else None
    )
    _decide(_env(), monotonic=lambda: now[0])
    reads = zip(fake.urls, fake.timeouts, strict=True)
    jobs_reads = [t for u, t in reads if "/jobs?" in u]
    # Page 1 starts with the full budget (bound 20 s); page 2 with 10 s left.
    assert jobs_reads[:2] == [20, 10.0], fake.timeouts


def test_a_jobs_page_past_the_deadline_withholds(github):
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], _shard_title(1))
    fake.jobs_per_page = 4
    now = [0.0]
    fake.on_read = (
        lambda url: now.__setitem__(0, 119.5) if url.endswith("&page=1") else None
    )
    message = _assert_withheld(_decide(_env(), monotonic=lambda: now[0]))
    assert "the deadline passed before GET" in message
    assert "page=2 could start (0.5 s left)" in message
    assert not [u for u in fake.urls if "/annotations?" in u]


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


@pytest.mark.parametrize(
    "job",
    [
        "Run Tests killed IN THE BUILD",
        "Run Tests TIMED OUT (not a verdict on this PR)",
        "Run Tests OUT OF MEMORY (not a verdict on this PR)",
    ],
    ids=["build-kill", "timed-out", "out-of-memory"],
)
def test_a_declare_job_carrying_a_reserved_phrase_is_withheld(github, job):
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], _shard_title(1))
    message = _assert_withheld(_decide(_env(DECLARE_JOB=job)))
    assert (
        "DECLARE_JOB would put a reserved phrase (TIMED OUT, OUT OF MEMORY or "
        "killed IN THE BUILD) into the title"
    ) in message


def test_no_title_it_writes_carries_a_reserved_phrase(github):
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


# --- rule 5: the harness-diff guard, against real merge commits ---------------


@pytest.fixture
def home(tmp_path: Path) -> Path:
    path = tmp_path / "home"
    path.mkdir()
    return path


@pytest.fixture
def clean_pr(tmp_path: Path, home: Path) -> PrRepo:
    """A PR touching application code and the frontend lockfile: no harness."""
    return PrRepo(
        tmp_path / "repo",
        home,
        changes={
            "backend/app/main.py": "print('pr')\n",
            "frontend/package-lock.json": '{"lockfileVersion": 3}\n',
        },
    )


def _declared_failure(github) -> FakeGitHub:
    """Rules 1-4 hold: shard 1 failed and titled its own setup death."""
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], _shard_title(1))
    return fake


def _guard_reason(outcome, reading: str) -> str:
    """The withheld notice's reason, asserting the guard read ``reading``."""
    message = _assert_withheld(outcome)
    lead = (
        "every failed shard declared a setup death, but the harness-diff guard "
        f"read {reading}: "
    )
    assert message.startswith(lead), _defang(message)
    return message[len(lead) :]


def _stubbed(stub: Path) -> str:
    return f"{stub}:/usr/bin:/bin"


@requires_git
def test_a_pr_whose_diff_misses_the_harness_is_declared(github, clean_pr):
    _declared_failure(github)
    assert _parse(_line(_decide(_pr_env(clean_pr))))[:2] == ("error", RUN_TESTS_TITLE)


@requires_git
@pytest.mark.parametrize(
    "touched",
    [
        ".github/workflows/backend-ci.yml",
        ".github/actions/self-hosted-host-provisioned/action.yml",
        ".github/scripts/declare-setup-death.sh",
        "scripts/ci/aggregate_setup_death.py",
        "scripts/ci/shard_headroom.py",
    ],
    ids=["own-workflow", "local-action", "per-job-declarer", "itself", "headroom"],
)
def test_a_pr_that_touches_the_aggregates_harness_is_withheld(
    github, tmp_path, home, touched
):
    _declared_failure(github)
    repo = PrRepo(tmp_path / "repo", home, changes={touched: "edited\n"})
    reason = _guard_reason(_decide(_pr_env(repo)), "true")
    assert reason.startswith(
        f"this PR's diff touches this aggregate's harness ('{touched}')"
    ), _defang(reason)


@requires_git
def test_moving_a_harness_file_out_of_the_harness_reads_true(github, tmp_path, home):
    """`--no-renames`: a rename would otherwise list only its NEW path."""
    _declared_failure(github)
    repo = PrRepo(
        tmp_path / "repo",
        home,
        changes={
            "scripts/ci/shard_headroom.py": None,
            "elsewhere/shard_headroom.py": "# the shard listing it imports\n",
        },
    )
    reason = _guard_reason(_decide(_pr_env(repo)), "true")
    assert "('scripts/ci/shard_headroom.py')" in reason, _defang(reason)


@requires_git
def test_off_pull_request_the_guard_is_unknown(github, clean_pr):
    _declared_failure(github)
    outcome = _decide(_pr_env(clean_pr, GITHUB_EVENT_NAME="push"))
    reason = _guard_reason(outcome, "UNKNOWN")
    assert reason.startswith("the event is 'push', not pull_request"), _defang(reason)


@requires_git
@pytest.mark.parametrize(
    ("sha_of", "expected"),
    [
        ("head", "has 1 parent(s), not the two of a pull_request merge commit"),
        ("absent", "is not readable in this checkout"),
        ("ref-name", "GITHUB_SHA ('HEAD') is not a commit id"),
    ],
    ids=["one-parent", "absent", "ref-name"],
)
def test_a_github_sha_that_is_not_a_merge_commit_is_unknown(
    github, clean_pr, sha_of, expected
):
    _declared_failure(github)
    sha = {"head": clean_pr.head, "absent": "0" * 40, "ref-name": "HEAD"}[sha_of]
    reason = _guard_reason(_decide(_pr_env(clean_pr, GITHUB_SHA=sha)), "UNKNOWN")
    assert expected in reason, _defang(reason)


@requires_git
def test_a_parent_line_in_the_commit_message_is_not_a_parent(github, tmp_path, home):
    """Only the header is read: a merge message can quote `parent <sha>`."""
    _declared_failure(github)
    repo = PrRepo(
        tmp_path / "repo",
        home,
        changes={"backend/app/main.py": "print('pr')\n"},
        message="Merge pr\n\nparent 0123456789abcdef0123456789abcdef01234567\n",
    )
    assert _parse(_line(_decide(_pr_env(repo))))[1] == RUN_TESTS_TITLE


@requires_git
@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"HARNESS_PATHS_RE": ""}, "HARNESS_PATHS_RE is empty"),
        (
            {"HARNESS_PATHS_RE": "^(unclosed"},
            "HARNESS_PATHS_RE is not a valid regular expression",
        ),
        (
            {"GITHUB_WORKSPACE": "/nonexistent/checkout"},
            "GITHUB_WORKSPACE ('/nonexistent/checkout') is not a directory",
        ),
    ],
    ids=["empty-pattern", "invalid-pattern", "no-checkout"],
)
def test_an_unusable_guard_input_is_unknown(github, clean_pr, overrides, expected):
    _declared_failure(github)
    reason = _guard_reason(_decide(_pr_env(clean_pr, **overrides)), "UNKNOWN")
    assert reason.startswith(expected), _defang(reason)


@requires_git
def test_the_first_parent_is_fetched_when_the_checkout_is_shallow(
    github, tmp_path, clean_pr
):
    """actions/checkout on `pull_request` is depth 1, so the base is absent."""
    _declared_failure(github)
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    assert not has_commit(clone, clean_pr.base, clean_pr.home)
    outcome = _decide(_pr_env(clean_pr, GITHUB_WORKSPACE=str(clone)))
    assert _parse(_line(outcome))[1] == RUN_TESTS_TITLE, _defang(_line(outcome))
    assert has_commit(clone, clean_pr.base, clean_pr.home)


@requires_git
def test_a_first_parent_that_cannot_be_fetched_is_unknown(github, tmp_path, clean_pr):
    _declared_failure(github)
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    env = _pr_env(
        clean_pr,
        GITHUB_WORKSPACE=str(clone),
        PATH=_stubbed(stub_git(tmp_path, "exit 128")),
    )
    reason = _guard_reason(_decide(env), "UNKNOWN")
    assert (
        f"the merge commit's first parent {clean_pr.base} could not be fetched (git "
        "fetch exited 128; 124 or 137 is the 60s bound)"
    ) in reason, _defang(reason)


@requires_git
def test_a_fetch_that_hangs_is_bounded_and_unknown(github, tmp_path, clean_pr):
    """A hang never holds the runner: `timeout -k 5` ends it, and that is UNKNOWN."""
    _declared_failure(github)
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    env = _pr_env(
        clean_pr,
        GITHUB_WORKSPACE=str(clone),
        PATH=_stubbed(stub_git(tmp_path, "exec sleep 30")),
        DECLARE_FETCH_BOUND_SECS="2",
    )
    started = time.monotonic()
    outcome = _decide(env)
    seconds = time.monotonic() - started
    assert seconds < 15, f"the 2 s bound took {seconds:.1f} s"
    reason = _guard_reason(outcome, "UNKNOWN")
    assert "(git fetch exited 124; 124 or 137 is the 2s bound)" in reason


@requires_git
@pytest.mark.parametrize("lever", ["", "0", "61", "600", "abc", "-1", " 2"])
def test_the_fetch_lever_can_only_lower_the_bound(github, tmp_path, clean_pr, lever):
    """Anything that is not 1..60 reads as the 60 s default."""
    _declared_failure(github)
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    env = _pr_env(
        clean_pr,
        GITHUB_WORKSPACE=str(clone),
        PATH=_stubbed(stub_git(tmp_path, "exit 128")),
        DECLARE_FETCH_BOUND_SECS=lever,
    )
    assert "is the 60s bound" in _guard_reason(_decide(env), "UNKNOWN")


@requires_git
def test_the_runs_deadline_lowers_the_fetch_bound(github, tmp_path, clean_pr):
    """A fetch never starts with a bound longer than what is left of the run."""
    fake = _declared_failure(github)
    now = [0.0]
    fake.on_read = lambda url: (
        now.__setitem__(0, 117.0) if "/annotations?" in url else None
    )
    clone = shallow_clone(clean_pr, tmp_path / "checkout")
    env = _pr_env(
        clean_pr,
        GITHUB_WORKSPACE=str(clone),
        PATH=_stubbed(stub_git(tmp_path, "exec sleep 30")),
    )
    started = time.monotonic()
    outcome = _decide(env, monotonic=lambda: now[0])
    seconds = time.monotonic() - started
    assert seconds < 15, f"a 3 s bound took {seconds:.1f} s"
    reason = _guard_reason(outcome, "UNKNOWN")
    assert "(git fetch exited 124; 124 or 137 is the 3s bound)" in reason


@requires_git
def test_no_time_left_for_the_guard_withholds(github, clean_pr):
    fake = _declared_failure(github)
    now = [0.0]
    fake.on_read = lambda url: (
        now.__setitem__(0, 119.5) if "/annotations?" in url else None
    )
    outcome = _decide(_pr_env(clean_pr), monotonic=lambda: now[0])
    reason = _guard_reason(outcome, "UNKNOWN")
    assert reason.startswith(
        "the 120 s time budget ran out before reading the merge commit"
    ), _defang(reason)


@requires_git
def test_a_failed_diff_is_unknown(github, tmp_path, clean_pr):
    _declared_failure(github)
    env = _pr_env(clean_pr, PATH=_stubbed(stub_git(tmp_path, on_diff="exit 3")))
    reason = _guard_reason(_decide(env), "UNKNOWN")
    assert (
        f"git diff {clean_pr.base} {clean_pr.merge} exited 3, so this PR's diff is "
        "unread"
    ) in reason, _defang(reason)


@requires_git
def test_the_guard_is_read_only_after_every_member_rule_held(github):
    """Rule 5 is last: an undeclared member declines before any git call."""
    fake = github(_with_conclusions(s1="failure"))
    fake.declare(_shard(fake.jobs, 1)["id"], "")
    outcome = _decide(_env(GITHUB_WORKSPACE="/nonexistent/checkout"))
    assert "carries no setup-death declaration" in _assert_declined(outcome)


DECLARER = REPO_ROOT / ".github" / "scripts" / "declare-setup-death.sh"


def _per_job_reading(env: dict[str, str]) -> str:
    """What the PER-JOB declarer's guard reads for the same PR and pattern."""
    assert BASH is not None
    proc = subprocess.run(
        [BASH, str(DECLARER)],
        env={
            **env,
            "DECLARE_JOB": "Lint & Format Check",
            "SETUP_STEPS": "Install Poetry|failure|failure\n",
            "VERDICT_STEPS": "Run ruff (linting)|skipped|skipped\n",
        },
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    out = proc.stdout + proc.stderr
    if "SETUP FAILED (not a verdict on this PR)" in out:
        return "false"
    found = re.search(r"harness-diff guard read (true|UNKNOWN)", out)
    assert found, _defang(out)
    return found.group(1)


def _aggregate_reading(outcome) -> str:
    line = _line(outcome)
    if _parse(line)[0] == "error":
        return "false"
    found = re.search(r"harness-diff guard read (true|UNKNOWN)", line)
    assert found, _defang(line)
    return found.group(1)


@pytest.mark.skipif(
    BASH is None or GIT is None, reason="the per-job declarer is bash over git"
)
@pytest.mark.parametrize(
    ("scenario", "reading"),
    [
        ("clean", "false"),
        ("touched", "true"),
        ("renamed-out", "true"),
        ("push", "UNKNOWN"),
        ("one-parent", "UNKNOWN"),
        ("shallow", "false"),
        ("unfetchable", "UNKNOWN"),
    ],
)
def test_the_aggregate_guard_reads_what_the_per_job_guard_reads(
    github, tmp_path, home, scenario, reading
):
    """The port must not drift from `compute_guard`: same PR, same reading."""
    _declared_failure(github)
    changes: dict[str, str | None] = {
        "clean": {"backend/app/main.py": "x\n"},
        "touched": {"scripts/ci/shard_headroom.py": "x\n"},
        "renamed-out": {
            ".github/actions/self-hosted-host-provisioned/action.yml": None,
            "elsewhere/action.yml": "name: host\n",
        },
    }.get(scenario, {"backend/app/main.py": "x\n"})
    repo = PrRepo(tmp_path / "repo", home, changes=changes)
    overrides = {
        "push": {"GITHUB_EVENT_NAME": "push"},
        "one-parent": {"GITHUB_SHA": repo.head},
    }.get(scenario, {})
    if scenario in ("shallow", "unfetchable"):
        overrides["GITHUB_WORKSPACE"] = str(shallow_clone(repo, tmp_path / "checkout"))
    if scenario == "unfetchable":
        overrides["PATH"] = _stubbed(stub_git(tmp_path, "exit 128"))
    env = _pr_env(repo, **overrides)
    assert _aggregate_reading(_decide(env)) == reading
    if scenario == "shallow":
        # The aggregate fetched the parent into the clone; start the per-job
        # guard from a fresh depth-1 clone so it walks the same fetch.
        env["GITHUB_WORKSPACE"] = str(shallow_clone(repo, tmp_path / "checkout-2"))
    assert _per_job_reading(env) == reading


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
    for source in (Path(__file__), REPO_ROOT / "backend/tests/setup_death_git.py"):
        assert_prints_nothing(source)


# --- the wiring --------------------------------------------------------------------

DECLARER_STEP = "Declare a setup death"
CHECKOUT_STEP = "Check out the declarer"

#: The aggregate's own code, which every aggregate's harness adds to its
#: members' per-job harness (rule 5).
AGGREGATE_CODE = (
    r"|^scripts/ci/aggregate_setup_death\.py$|^scripts/ci/shard_headroom\.py$"
)

AGGREGATES: dict[tuple[str, str], dict[str, str]] = {
    ("backend-ci.yml", "test-gate"): {
        "DECLARE_JOB": "Run Tests",
        "MEMBER_NEED": "test",
        "EXPECTED_MEMBERS": "${{ env.EXPECTED_SHARDS }}",
        "HARNESS_PATHS_RE": RUN_TESTS_HARNESS,
    },
    ("e2e-tests.yml", "test-summary"): {
        "DECLARE_JOB": "Test Summary",
        "MEMBER_NEED": "backend-tests",
        "MEMBER_NAME_RE": r"^Backend E2E Tests \(3\.12\)$",
        "MEMBER_NOUN": "job",
        "EXPECTED_MEMBERS": "1",
        "HARNESS_PATHS_RE": (
            r"^\.github/workflows/e2e-tests\.yml$|^\.github/actions/"
            r"|^\.github/scripts/declare-setup-death\.sh$" + AGGREGATE_CODE
        ),
    },
    ("migration-reversal.yml", "gate"): {
        "DECLARE_JOB": "Migration Reversal Gate",
        "MEMBER_NEED": "reverse",
        "MEMBER_NAME_RE": "^reverse$",
        "MEMBER_NOUN": "job",
        "EXPECTED_MEMBERS": "1",
        "HARNESS_PATHS_RE": (
            r"^\.github/workflows/migration-reversal\.yml$|^\.github/actions/"
            r"|^\.github/scripts/declare-setup-death\.sh$" + AGGREGATE_CODE
        ),
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
    assert declarer["timeout-minutes"] == 3
    assert "continue-on-error" not in declarer
    run = declarer["run"]
    assert "if [ ! -f scripts/ci/aggregate_setup_death.py ]; then" in run
    assert "python3 scripts/ci/aggregate_setup_death.py || echo" in run


@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_the_declarer_runs_only_from_a_checkout_that_succeeded(workflow, job_id):
    """A failed checkout is `continue-on-error`, so the job reaches the next step,
    and on a self-hosted workspace the tree it left can be an EARLIER run's
    scripts/ci, whose script must not run. So the step keys on the checkout's
    own outcome, which reads `failure` for a failed or timed-out checkout.
    """
    steps = _workflow(workflow)["jobs"][job_id]["steps"]
    checkout, declarer = steps[-2], steps[-1]
    assert checkout["id"] == "declarer_checkout"
    assert declarer["if"] == (
        "failure() && steps.declarer_checkout.outcome == 'success'"
    )


@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_the_declarer_checkout_is_bounded_to_one_minute(workflow, job_id):
    """A sparse fetch of scripts/ci takes seconds; the job's own cap is not its bound."""
    checkout = _workflow(workflow)["jobs"][job_id]["steps"][-2]
    assert checkout["name"] == CHECKOUT_STEP
    assert checkout["timeout-minutes"] == 1


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


@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_each_aggregates_harness_is_its_members_harness_plus_its_own_code(
    workflow, job_id
):
    """Rule 5 withholds wherever a member's guard would, and on the aggregate's code.

    The per-job declarer wrote the member titles the aggregate trusts; when a
    PR edits it, the members' guard runs inside the edit and this one does not.
    """
    doc = _workflow(workflow)
    table = AGGREGATES[(workflow, job_id)]
    member_steps = doc["jobs"][table["MEMBER_NEED"]]["steps"]
    declarers = [s for s in member_steps if s.get("name") == DECLARER_STEP]
    assert len(declarers) == 1, f"{table['MEMBER_NEED']} carries no per-job declarer"
    member_harness = str(declarers[0]["env"]["HARNESS_PATHS_RE"])
    assert table["HARNESS_PATHS_RE"] == member_harness + AGGREGATE_CODE
    pattern = re.compile(table["HARNESS_PATHS_RE"])
    for path in (
        f".github/workflows/{workflow}",
        ".github/actions/self-hosted-host-provisioned/action.yml",
        ".github/scripts/declare-setup-death.sh",
        SCRIPT_REF,
        "scripts/ci/shard_headroom.py",
    ):
        assert pattern.search(path), path
    for path in (
        "backend/app/main.py",
        "scripts/ci/split_pytest_shards.py",
        f"{SCRIPT_REF}.bak",
        "frontend/package-lock.json",
        f"x/.github/workflows/{workflow}",
        ".github/workflows/spec-ci.yml",
    ):
        assert not pattern.search(path), path


@requires_git
@pytest.mark.parametrize(("workflow", "job_id"), list(AGGREGATES), ids=AGGREGATE_IDS)
def test_each_aggregates_own_env_withholds_on_its_own_workflow(
    github, tmp_path, home, workflow, job_id
):
    """The YAML's own static env drives the script against real merge commits."""
    doc = _workflow(workflow)
    job = doc["jobs"][job_id]
    yaml_env = {k: str(v) for k, v in job["steps"][-1]["env"].items()}
    static = {k: v for k, v in yaml_env.items() if "${{" not in v}
    member_need = static["MEMBER_NEED"]
    members = _served_names(member_need, doc["jobs"][member_need])
    fake = github(
        [
            {
                "id": 100 + i,
                "name": name,
                "status": "completed",
                "conclusion": "failure" if i == 0 else "success",
            }
            for i, name in enumerate(members)
        ]
    )
    fake.declare(100, f"{members[0]} SETUP FAILED (not a verdict on this PR)")
    needs = job["needs"] if isinstance(job["needs"], list) else [job["needs"]]
    needs_json = json.dumps(
        {n: {"result": "failure" if n == member_need else "success"} for n in needs}
    )

    def env_for(repo: PrRepo) -> dict[str, str]:
        rendered = {"EXPECTED_MEMBERS": str(len(members)), **static}
        return _pr_env(repo, **rendered, NEEDS_JSON=needs_json)

    clean = PrRepo(tmp_path / "clean", home, changes={"backend/app/main.py": "x\n"})
    noun = static.get("MEMBER_NOUN", "shard")
    assert _parse(_line(_decide(env_for(clean))))[:2] == (
        "error",
        f"{static['DECLARE_JOB']} SETUP FAILED in every failed {noun} (not a "
        "verdict on this PR)",
    )
    touched = PrRepo(
        tmp_path / "touched", home, changes={f".github/workflows/{workflow}": "x\n"}
    )
    message = _assert_withheld(_decide(env_for(touched)))
    assert "the harness-diff guard read true" in message, _defang(message)
