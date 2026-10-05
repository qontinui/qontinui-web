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
        # Whole seconds, rounded: GitHub stamps are second-resolution, and a
        # float `timedelta(minutes=4.9)` must not truncate to 293 s.
        "completed_at": _ts(T0 + timedelta(seconds=round(minutes * 60))),
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


# 7 and 23 are budgets where a float `budget * 0.70` (or float-minute
# `max * 100 > budget * 70`) misfires at exactly 70%; 45 is the real budget.
MARGIN_BUDGETS = [7, 23, 45, 46, 1, 13, 120]


@pytest.mark.parametrize("budget", MARGIN_BUDGETS)
def test_exactly_at_the_margin_is_not_over(budget):
    at_margin = budget * 0.7  # minutes; budget * 42 whole seconds
    # The job timeout is held at 120 so every budget in the list is a legal
    # (lowering) override and the timeout floor stays meaningful.
    result = headroom.evaluate(_run([at_margin] * 6), budget, job_timeout_min=120)
    assert result.verdict == "ok", headroom.format_line(result)


@pytest.mark.parametrize("budget", MARGIN_BUDGETS)
def test_one_second_past_the_margin_is_over(budget):
    rows = _run([budget * 0.7] * 6)
    rows[2] = _job(3, budget * 0.7 + 1 / 60)
    result = headroom.evaluate(rows, budget, job_timeout_min=120)
    assert result.verdict == "over_margin", headroom.format_line(result)


def test_fractional_budget_is_parsed_exactly():
    # 0.1 is not representable in binary; Fraction("4.5") and "0.1" are exact.
    budget = headroom.parse_budget("45", "4.5")
    assert budget == headroom.Fraction(9, 2)
    rows = _run([budget * 0.7] * 6)  # 189 s
    assert headroom.evaluate(rows, budget).verdict == "ok"


def test_over_margin_takes_precedence_over_skew():
    result = headroom.evaluate(_run([40, 10, 10, 10, 10, 10]), 45)
    assert result.verdict == "over_margin"


def test_skewed_when_slowest_over_twice_fastest():
    # 09-20 nightly shape: 29.9 / 9.6 = 3.1x, but 66% is inside the margin.
    result = headroom.evaluate(_run([29.9, 9.6, 15, 16, 17, 18]), 45)
    assert result.verdict == "skewed"
    assert result.exit_code != 0
    assert result.skew == pytest.approx(29.9 / 9.6)


def test_skewed_names_the_durations_refresh_as_its_remedy():
    """The alarm points at the artifact that fixes it, from the same run."""
    result = headroom.evaluate(_run([29.9, 9.6, 15, 16, 17, 18]), 45)
    assert result.verdict == "skewed"
    assert headroom.DURATIONS_REF in result.reason
    assert f"`{headroom.PROPOSAL_ARTIFACT}`" in result.reason


def test_the_named_remedy_exists_in_the_workflow_and_the_tree():
    """A remedy that names a renamed artifact or file would send people nowhere."""
    assert (REPO_ROOT / headroom.DURATIONS_REF).is_file()
    jobs = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]
    artifacts = {
        (step.get("with") or {}).get("name")
        for job in jobs.values()
        for step in job.get("steps") or []
        if str(step.get("uses", "")).startswith("actions/upload-artifact")
    }
    assert headroom.PROPOSAL_ARTIFACT in artifacts


def test_a_balanced_over_margin_names_the_matrix_as_the_lever():
    result = headroom.evaluate(_run([37.3, 30, 32, 33, 34, 35]), 45)
    assert result.verdict == "over_margin"
    assert "outgrown the matrix" in result.reason
    assert "not the budget" in result.reason


def test_a_skewed_over_margin_does_not_blame_the_matrix():
    result = headroom.evaluate(_run([40, 10, 10, 10, 10, 10]), 45)
    assert result.verdict == "over_margin"
    assert "outgrown the matrix" not in result.reason
    assert headroom.DURATIONS_REF in result.reason
    assert f"`{headroom.PROPOSAL_ARTIFACT}`" in result.reason


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


def test_a_counted_timeout_forces_over_margin_whatever_the_budget():
    # Six shards cancelled at 45.2 min against JOB_TIMEOUT_MINUTES=45: each
    # time is a lower bound. Even at a budget where 45.2 min is inside 70%,
    # a shard that hit its real budget is over the margin by definition.
    rows = [_job(i + 1, 45.2, conclusion="cancelled") for i in range(6)]
    result = headroom.evaluate(rows, 45, job_timeout_min=45)
    assert result.verdict == "over_margin"
    assert "lower bound" in result.reason
    # And a budget large enough to put 45.2 min under 70% (JOB_TIMEOUT 70,
    # override 70) still cannot turn a counted timeout into a pass.
    rows = [_job(i + 1, 68.5, conclusion="cancelled") for i in range(6)]
    rows[0] = _job(1, 30, conclusion="success")
    result = headroom.evaluate(rows, 70, job_timeout_min=70)
    assert result.verdict == "over_margin"


def test_an_override_above_the_real_budget_is_unknown():
    rows = [_job(i + 1, 45.2, conclusion="cancelled") for i in range(6)]
    result = headroom.evaluate(rows, 70, job_timeout_min=45)
    assert result.verdict == "unknown"
    assert result.exit_code != 0
    assert "may only lower" in result.reason


def test_cli_override_above_the_real_budget_is_unknown(tmp_path, monkeypatch, capsys):
    payload = [_job(i + 1, 45.2, conclusion="cancelled") for i in range(6)]
    code, line = _cli(
        tmp_path,
        monkeypatch,
        capsys,
        payload,
        {"JOB_TIMEOUT_MINUTES": "45", "HEADROOM_BUDGET_OVERRIDE": "70"},
    )
    assert code == 2 and line.endswith("verdict=unknown")


@pytest.mark.parametrize("timeout", [2, 1, 0.5])
def test_a_job_timeout_at_or_below_the_slack_is_unknown(timeout):
    budget = headroom.Fraction(str(timeout))
    result = headroom.evaluate(_run([0.2] * 6), budget, job_timeout_min=budget)
    assert result.verdict == "unknown"
    assert "timeout floor would be meaningless" in result.reason


@pytest.mark.parametrize("expected", [0, -1])
def test_a_nonsense_shard_count_is_unknown(expected):
    result = headroom.evaluate(_run([20] * 6), 45, expected)
    assert result.verdict == "unknown"
    assert result.exit_code == 2


def test_cli_a_nonsense_shard_count_keeps_the_one_line_contract(
    tmp_path, monkeypatch, capsys
):
    path = tmp_path / "jobs.json"
    path.write_text(json.dumps(_run([20] * 6)), encoding="utf-8")
    monkeypatch.setenv("JOB_TIMEOUT_MINUTES", "45")
    monkeypatch.delenv("HEADROOM_BUDGET_OVERRIDE", raising=False)
    code = headroom.main(["--jobs-json", str(path), "--expected-shards", "0"])
    out = capsys.readouterr().out.strip().splitlines()
    assert code == 2
    assert len(out) == 1 and out[0].endswith("verdict=unknown")


@pytest.mark.parametrize("entry", [None, 3, "Run Tests (shard 1/6)", ["x"]])
def test_a_non_object_job_entry_is_unknown(entry):
    rows = _run([20] * 6)
    rows.insert(2, entry)
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert "job entry 2" in result.reason


def test_cli_a_non_object_job_entry_keeps_the_one_line_contract(
    tmp_path, monkeypatch, capsys
):
    code, line = _cli(
        tmp_path,
        monkeypatch,
        capsys,
        {"jobs": [1, 2, 3]},
        {"JOB_TIMEOUT_MINUTES": "45"},
    )
    assert code == 2 and line.endswith("verdict=unknown")


def test_a_short_runner_side_cancel_is_unknown():
    # A manual or external cancel mid-shard: the runner ran, but its time
    # describes no full pass. Counting it would pass on a truncated run.
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[0] = _job(1, 19, conclusion="cancelled")
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert "shard 1 was cancelled after 19.0 min" in result.reason


def test_all_six_cancelled_mid_shard_is_unknown_not_ok():
    rows = [_job(i + 1, 12, conclusion="cancelled") for i in range(6)]
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "unknown"
    assert result.exit_code != 0


def test_a_cancel_at_the_timeout_floor_is_counted():
    # 44.0 >= 45 - 2: a budget timeout, measured, and over the margin.
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[0] = _job(1, 44.0, conclusion="cancelled")
    result = headroom.evaluate(rows, 45)
    assert result.verdict == "over_margin"
    assert result.max_min == pytest.approx(44.0)


def test_a_cancel_one_second_short_of_the_floor_is_unknown():
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[0] = _job(1, 43 - 1 / 60, conclusion="cancelled")
    assert headroom.evaluate(rows, 45).verdict == "unknown"


def test_the_timeout_floor_uses_the_real_budget_not_the_override():
    # A dispatch with override 10 must still recognise a real 45-min timeout
    # (floor 43), and must still refuse a 12-min cancel, which a floor derived
    # from the override (8) would have counted.
    rows = _run([20, 18, 22, 19, 21, 17])
    rows[0] = _job(1, 45.3, conclusion="cancelled")
    assert headroom.evaluate(rows, 10, job_timeout_min=45).verdict == "over_margin"
    rows[0] = _job(1, 12, conclusion="cancelled")
    assert headroom.evaluate(rows, 10, job_timeout_min=45).verdict == "unknown"


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


def test_cli_override_keeps_the_real_timeout_floor(tmp_path, monkeypatch, capsys):
    payload = json.loads(
        (FIXTURES / "run-36548570438.json").read_text(encoding="utf-8")
    )
    code, line = _cli(
        tmp_path,
        monkeypatch,
        capsys,
        payload,
        {"JOB_TIMEOUT_MINUTES": "45", "HEADROOM_BUDGET_OVERRIDE": "10"},
    )
    assert code != 0 and line.endswith(
        "budget_min=10 pct=453.2 skew=2.88 verdict=over_margin"
    )


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
