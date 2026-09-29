"""The nightly ``Run Tests`` shard headroom alarm, and the workflow wiring around it.

``scripts/ci/shard_headroom.py`` turns one run's shard job rows into a verdict
(``ok`` / ``over_margin`` / ``skewed`` / ``unknown``). This module pins:

1. **The pure function** — every verdict arm, the queued-cancelled rows it must
   ignore, the unknown arms that must never read as a pass, and the budget
   override.
2. **The workflow wiring** — the ``shard-headroom`` job's hand-copied budget and
   shard count equal the ``test`` job's ``timeout-minutes`` and matrix length,
   it runs only on ``schedule`` / ``workflow_dispatch``, reads jobs with an
   explicit ``actions: read``, and is NOT in the ``Run Tests`` aggregate's
   ``needs`` — so it can never hold a PR.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import urllib.error
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.gate_lane_roster import (
    assert_docstring_names_every_lane,
    assert_lane_roster,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_REF = "scripts/ci/shard_headroom.py"
SCRIPT_PATH = REPO_ROOT / SCRIPT_REF
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "backend-ci.yml"
DECLARED_LANES = frozenset({".github/workflows/backend-ci.yml"})


def _load():
    spec = importlib.util.spec_from_file_location("shard_headroom", SCRIPT_PATH)
    assert spec and spec.loader, f"cannot load {SCRIPT_PATH}"
    module = importlib.util.module_from_spec(spec)
    # Registered before exec: a dataclass resolves its string annotations
    # through sys.modules[cls.__module__].
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


headroom = _load()

T0 = datetime(2026, 9, 29, 7, 20, tzinfo=UTC)


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _job(
    shard: int, minutes: float, *, total: int = 6, **overrides: Any
) -> dict[str, Any]:
    job: dict[str, Any] = {
        "name": f"Run Tests (shard {shard}/{total})",
        "status": "completed",
        "conclusion": "success",
        "runner_id": 1000320000 + shard,
        "steps": [
            {"name": "Run tests", "status": "completed", "conclusion": "success"}
        ],
        "created_at": _ts(T0),
        "started_at": _ts(T0),
        "completed_at": _ts(T0 + timedelta(minutes=minutes)),
    }
    job.update(overrides)
    return job


def _run(minutes: list[float]) -> list[dict[str, Any]]:
    rows = [_job(i + 1, m) for i, m in enumerate(minutes)]
    # Non-shard jobs of the same run must be ignored, not miscounted.
    rows.append(
        {
            "name": "Run Tests",
            "started_at": _ts(T0),
            "completed_at": _ts(T0 + timedelta(seconds=20)),
        }
    )
    rows.append(
        {
            "name": "Lint and Type Check",
            "started_at": _ts(T0),
            "completed_at": _ts(T0 + timedelta(minutes=3)),
        }
    )
    return rows


# --- the lane roster -------------------------------------------------------


def test_lane_roster_matches_the_tree():
    assert_lane_roster(SCRIPT_REF, DECLARED_LANES)


def test_docstring_names_every_lane():
    assert_docstring_names_every_lane(headroom.__doc__, SCRIPT_REF, DECLARED_LANES)


# --- the pure function -----------------------------------------------------


def test_ok_when_within_margin_and_balanced():
    result = headroom.evaluate(_run([20, 18, 22, 19, 21, 17]), 45)
    assert result.verdict == "ok"
    assert result.exit_code == 0
    assert result.max_min == pytest.approx(22)
    assert result.min_min == pytest.approx(17)
    assert result.slowest_shard == 3


def test_over_margin_when_slowest_exceeds_seventy_percent():
    # 09-21 nightly shape: 37.3 min = 83% of 45.
    result = headroom.evaluate(_run([20, 37.3, 22, 19, 21, 20]), 45)
    assert result.verdict == "over_margin"
    assert result.exit_code != 0
    assert result.pct == pytest.approx(37.3 / 45 * 100)


def test_exactly_at_the_margin_is_not_over():
    result = headroom.evaluate(_run([31.5, 30, 30, 30, 30, 30]), 45)
    assert result.verdict == "ok"


def test_over_margin_takes_precedence_over_skew():
    result = headroom.evaluate(_run([40, 10, 10, 10, 10, 10]), 45)
    assert result.verdict == "over_margin"


def test_skewed_when_slowest_over_twice_fastest():
    # 09-20 nightly shape: 29.9 / 9.6 = 3.1x, but 66% is inside the margin.
    result = headroom.evaluate(_run([29.9, 9.6, 15, 16, 17, 18]), 45)
    assert result.verdict == "skewed"
    assert result.exit_code != 0
    assert result.skew == pytest.approx(29.9 / 9.6)


def test_one_second_over_the_margin_is_over():
    # 31.5 min + 1 s. The compare is exact, so neither float rounding of
    # 45 * 0.70 nor the display rounding of pct can move the boundary.
    result = headroom.evaluate(_run([31.5 + 1 / 60, 30, 30, 30, 30, 30]), 45)
    assert result.verdict == "over_margin"


def test_skew_of_exactly_two_is_not_skewed():
    result = headroom.evaluate(_run([20, 10, 15, 15, 15, 15]), 45)
    assert result.verdict == "ok"


def test_unknown_when_a_shard_is_missing():
    result = headroom.evaluate(_run([20, 18, 22, 19, 21]), 45)
    assert result.verdict == "unknown"
    assert result.exit_code != 0
    assert "shard 6 has no row" in result.reason


def test_unknown_on_no_jobs_at_all():
    result = headroom.evaluate([], 45)
    assert result.verdict == "unknown"
    assert result.exit_code != 0


@pytest.mark.parametrize(
    "field,value",
    [
        ("started_at", "not-a-time"),
        ("completed_at", "2026-13-40T99:00:00Z"),
        ("completed_at", "2026-09-29T07:50:00"),  # no timezone
        ("started_at", 12345),
    ],
)
def test_unknown_on_unparseable_timestamps(field, value):
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[2][field] = value
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert result.exit_code != 0


def test_unknown_when_a_started_shard_never_completed():
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[0]["completed_at"] = None
    rows[0]["status"] = "in_progress"
    assert headroom.evaluate(rows, 45).verdict == "unknown"


def test_unknown_when_the_matrix_length_disagrees():
    rows = [_job(i + 1, 20, total=5) for i in range(5)]
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert "5 shards" in result.reason


def _queue_cancelled(shard: int) -> dict[str, Any]:
    """The REAL shape of a job cancelled while queued (run 36515758971).

    GitHub does NOT null ``started_at``: it stamps ``started_at = created_at``
    and ``completed_at`` at the cancel, a POSITIVE gap of pure queue time, with
    ``runner_id: 0`` and ``steps: []``.
    """
    return _job(
        shard,
        3.6,
        conclusion="cancelled",
        runner_id=0,
        steps=[],
        created_at=_ts(T0),
    )


def test_all_six_queue_cancelled_is_unknown_not_ok():
    rows = [_queue_cancelled(i + 1) for i in range(6)]
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert result.exit_code != 0
    assert "never executed by a runner" in result.reason


def test_one_queue_cancelled_shard_is_unknown_not_skewed():
    # 3.6 min of queue time against ~20 min shards would read as skew 5.8x if
    # it were timed. It must not be: the shard is missing, not fast.
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[1] = _queue_cancelled(2)
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert "shard 2 was never executed by a runner" in result.reason


@pytest.mark.parametrize(
    "overrides",
    [
        {"runner_id": None},
        {"runner_id": 0},
        {"steps": []},
        {"steps": None},
        {"started_at": None, "completed_at": None},
        {"completed_at": _ts(T0)},  # zero duration
        {"completed_at": _ts(T0 - timedelta(minutes=1))},  # negative
    ],
)
def test_every_unmeasured_shape_leaves_the_shard_missing(overrides):
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[5] = _job(6, 17, conclusion="cancelled", **overrides)
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert "shard 6" in result.reason


def test_a_duplicate_shard_row_is_unknown():
    # filter=latest yields one row per job; a second row is a malformed read.
    rows = _run([20, 18, 22, 19, 21, 17])
    rows.append(_job(3, 21))
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert "two rows name shard 3" in result.reason


@pytest.mark.parametrize(
    "conclusion", ["failure", "skipped", "timed_out", "neutral", None]
)
def test_a_measured_shard_with_another_conclusion_is_unknown(conclusion):
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[4] = _job(5, 21, conclusion=conclusion)
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert "shard 5" in result.reason
    assert repr(conclusion) in result.reason


def test_a_runner_side_cancel_counts():
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[0] = _job(1, 19, conclusion="cancelled")
    assert headroom.evaluate(rows, 45).verdict == "ok"


# --- real runs --------------------------------------------------------------

FIXTURES = Path(__file__).parent / "fixtures" / "shard_headroom"


def _fixture(run_id: int) -> list[dict[str, Any]]:
    payload = json.loads((FIXTURES / f"run-{run_id}.json").read_text(encoding="utf-8"))
    jobs = payload["jobs"]
    assert isinstance(jobs, list)
    return jobs


def test_real_run_with_every_shard_cancelled_in_the_queue_is_unknown():
    """Run 36515758971: the reviewer's false-pass case; it used to read ``ok``."""
    result = headroom.evaluate(_fixture(36515758971), 45)
    assert result.verdict == "unknown"
    assert result.exit_code != 0


def test_real_run_with_a_shard_timed_out_at_its_budget_is_over_margin():
    """Run 36548570438: shard 6 ran 09:20:52 -> 10:06:11 and was cancelled at 45 min.

    A shard cancelled at its timeout measures slightly OVER the budget, so a
    ``pct`` just above 100 is expected.
    """
    result = headroom.evaluate(_fixture(36548570438), 45)
    assert result.verdict == "over_margin"
    assert result.slowest_shard == 6
    assert result.max_min == pytest.approx((45 * 60 + 19) / 60)
    assert result.pct is not None and 100 < result.pct < 101


def test_a_shard_cancelled_at_its_budget_is_over_margin():
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[3] = _job(4, 45, conclusion="cancelled")
    assert headroom.evaluate(rows, 45).verdict == "over_margin"


# --- the budget and the override -------------------------------------------


def test_budget_defaults_to_job_timeout():
    assert headroom.parse_budget("45", "") == 45
    assert headroom.parse_budget("45", None) == 45
    assert headroom.parse_budget("45", "   ") == 45


def test_override_is_honored_and_turns_a_green_run_red():
    rows = _run([20, 18, 22, 19, 21, 17])
    assert headroom.evaluate(rows, headroom.parse_budget("45", "")).verdict == "ok"
    budget = headroom.parse_budget("45", "10")
    assert budget == 10
    result = headroom.evaluate(rows, budget)
    assert result.verdict == "over_margin"
    assert "budget_min=10 " in headroom.format_line(result)


@pytest.mark.parametrize(
    "base,override",
    [("", ""), ("abc", ""), ("45", "-3"), ("45", "0"), ("45", "nan"), ("45", "x")],
)
def test_bad_budget_is_a_measurement_error(base, override):
    with pytest.raises(headroom.MeasurementError):
        headroom.parse_budget(base, override)


# --- the line and the CLI --------------------------------------------------


def test_line_format():
    result = headroom.evaluate(_run([29.9, 9.6, 15, 16, 17, 18]), 45)
    assert headroom.format_line(result) == (
        "shard-headroom: max_min=29.9 min_min=9.6 budget_min=45 pct=66.4 skew=3.11 verdict=skewed"
    )


def test_unknown_line_says_na_rather_than_zero():
    line = headroom.format_line(headroom.evaluate([], 45))
    assert (
        line
        == "shard-headroom: max_min=na min_min=na budget_min=45 pct=na skew=na verdict=unknown"
    )


def _cli(tmp_path, monkeypatch, capsys, payload, env):
    path = tmp_path / "jobs.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    for key in ("JOB_TIMEOUT_MINUTES", "HEADROOM_BUDGET_OVERRIDE"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    code = headroom.main(["--jobs-json", str(path)])
    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 1 and out[0].startswith("shard-headroom: "), out
    return code, out[0]


def test_cli_ok_and_override(tmp_path, monkeypatch, capsys):
    payload = {"total_count": 8, "jobs": _run([20, 18, 22, 19, 21, 17])}
    code, line = _cli(
        tmp_path, monkeypatch, capsys, payload, {"JOB_TIMEOUT_MINUTES": "45"}
    )
    assert code == 0 and line.endswith("verdict=ok")
    code, line = _cli(
        tmp_path,
        monkeypatch,
        capsys,
        payload,
        {"JOB_TIMEOUT_MINUTES": "45", "HEADROOM_BUDGET_OVERRIDE": "15"},
    )
    assert code != 0 and line.endswith("verdict=over_margin")


def test_cli_missing_budget_is_unknown(tmp_path, monkeypatch, capsys):
    code, line = _cli(tmp_path, monkeypatch, capsys, _run([20] * 6), {})
    assert code != 0 and line.endswith("verdict=unknown")


def test_cli_api_failure_is_unknown(monkeypatch, capsys):
    def _boom(*_args, **_kwargs):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(headroom.urllib.request, "urlopen", _boom)
    for key, value in {
        "JOB_TIMEOUT_MINUTES": "45",
        "GITHUB_REPOSITORY": "qontinui/qontinui-web",
        "GITHUB_RUN_ID": "1",
        "GITHUB_TOKEN": "t",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("HEADROOM_BUDGET_OVERRIDE", raising=False)
    code = headroom.main([])
    out = capsys.readouterr().out.strip().splitlines()
    assert code != 0
    assert out == [
        "shard-headroom: max_min=na min_min=na budget_min=45 pct=na skew=na verdict=unknown"
    ]


def test_fetch_requires_credentials():
    with pytest.raises(headroom.MeasurementError):
        headroom.fetch_jobs("qontinui/qontinui-web", "1", "")


class _Response:
    def __init__(self, body: Any) -> None:
        self._body = json.dumps(body).encode()

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def test_fetch_pages_until_total_count(monkeypatch):
    rows = _run([20, 18, 22, 19, 21, 17])
    pages = {1: rows[:5], 2: rows[5:]}
    seen: list[str] = []

    def _urlopen(request, timeout):
        seen.append(request.full_url)
        page = int(request.full_url.rsplit("page=", 1)[1])
        return _Response({"total_count": len(rows), "jobs": pages.get(page, [])})

    monkeypatch.setattr(headroom.urllib.request, "urlopen", _urlopen)
    jobs = headroom.fetch_jobs("qontinui/qontinui-web", "42", "t")
    assert jobs == rows
    assert len(seen) == 2
    assert "/actions/runs/42/jobs?filter=latest&per_page=100&page=1" in seen[0]


def test_fetch_refuses_a_body_without_jobs(monkeypatch):
    monkeypatch.setattr(
        headroom.urllib.request,
        "urlopen",
        lambda *_a, **_k: _Response({"message": "Not Found"}),
    )
    with pytest.raises(headroom.MeasurementError):
        headroom.fetch_jobs("qontinui/qontinui-web", "42", "t")


# --- the workflow wiring ---------------------------------------------------


def _doc() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _headroom_job() -> dict:
    jobs = _doc()["jobs"]
    assert "shard-headroom" in jobs, "backend-ci.yml has no `shard-headroom` job"
    return jobs["shard-headroom"]


def test_budget_is_in_lockstep_with_the_test_job_timeout():
    """GitHub exposes no expression for another job's timeout, so it is copied."""
    test_timeout = str(_doc()["jobs"]["test"]["timeout-minutes"])
    declared = str(_headroom_job()["env"]["JOB_TIMEOUT_MINUTES"])
    assert declared == test_timeout, (
        f"shard-headroom measures against JOB_TIMEOUT_MINUTES={declared!r} but the "
        f"`test` job's timeout-minutes is {test_timeout!r}; raise both together"
    )


def test_expected_shards_is_in_lockstep_with_the_matrix():
    matrix = _doc()["jobs"]["test"]["strategy"]["matrix"]["shard"]
    assert str(_headroom_job()["env"]["EXPECTED_SHARDS"]) == str(len(matrix))
    assert headroom.DEFAULT_EXPECTED_SHARDS == len(matrix)


def _needs_closure(jobs: dict, job_id: str) -> set[str]:
    """Every job ``job_id`` waits on, directly or through another job's ``needs``."""
    closure: set[str] = set()
    pending = [job_id]
    while pending:
        needs = jobs[pending.pop()].get("needs") or []
        for need in [needs] if isinstance(needs, str) else needs:
            if need not in closure:
                closure.add(need)
                pending.append(need)
    return closure


def test_needs_closure_is_transitive():
    jobs = {"a": {"needs": ["b"]}, "b": {"needs": "c"}, "c": {}}
    assert _needs_closure(jobs, "a") == {"b", "c"}


def test_the_job_never_holds_a_pr():
    doc = _doc()
    job = _headroom_job()
    assert "shard-headroom" not in _needs_closure(doc["jobs"], "test-gate")
    condition = job["if"]
    assert "always()" in condition
    assert "github.event_name == 'schedule'" in condition
    assert "github.event_name == 'workflow_dispatch'" in condition
    assert "pull_request" not in condition
    assert job["needs"] in (["test"], "test")


def test_the_job_declares_its_own_actions_read():
    assert _headroom_job()["permissions"]["actions"] == "read"


def test_the_checkout_does_not_persist_the_token():
    checkouts = [
        s
        for s in _headroom_job()["steps"]
        if str(s.get("uses", "")).startswith("actions/checkout")
    ]
    assert checkouts and all(
        s["with"]["persist-credentials"] is False for s in checkouts
    )


def test_the_override_input_exists_and_reaches_the_step():
    doc = _doc()
    triggers = doc.get("on", doc.get(True))
    inputs = triggers["workflow_dispatch"]["inputs"]
    assert inputs["headroom_budget_override"]["default"] == ""
    steps = [s for s in _headroom_job()["steps"] if SCRIPT_REF in s.get("run", "")]
    assert len(steps) == 1
    assert (
        steps[0]["env"]["HEADROOM_BUDGET_OVERRIDE"]
        == "${{ inputs.headroom_budget_override }}"
    )
    assert "pipefail" in steps[0]["run"], "the tee must not swallow a red exit"
