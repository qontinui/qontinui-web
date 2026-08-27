"""Arm-by-arm tests for the CI infrastructure-timeout marker.

The marker is the `Explain infrastructure timeout vs external cancellation` step
carried, byte-identically, by six of this repo's workflows. It exists to tell an
author whether a red check was their diff or CI infrastructure -- so a wrong
verdict from it is worse than no verdict, because it teaches readers to discard
the right ones too.

It shipped exactly that. Arm 3 asserted "It was cancelled from outside" for ANY
cancelled job, having interpolated the run's elapsed minutes into its own message
without ever TESTING them. The only arm that performed the budget test (arm 2)
was guarded on an apt step being mid-flight, which is unreachable on a job whose
apt steps are `command -v psql`-guarded to 0s. Result, on qontinui-web run
33114825687: "This job was cancelled after 45 min against a 45-minute budget ...
It was cancelled from outside" -- for a job that had plainly exhausted its own
budget. Nine of fifteen main-push runs of the Backend Coverage Producer died that
way, each one pre-labelled benign.

These tests run the SHIPPED `run:` body -- extracted from the workflow YAML, not
a copy pasted in here -- through each arm with a stubbed `gh`, and assert on the
literal annotation titles. `test_all_six_marker_bodies_are_identical` pins the
six copies together so a fix applied to one and not the others is a test failure
rather than a discovery six months later.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"

MARKER_STEP_NAME = "Explain infrastructure timeout vs external cancellation"

# Every workflow that carries the marker. A new carrier must be added here --
# that is the point: the identity test below is what stops the six copies
# drifting, and it can only see the files it is told about.
MARKER_WORKFLOWS = [
    "backend-ci.yml",
    "backend-coverage-producer.yml",
    "cross-browser-survey.yml",
    "e2e-tests.yml",
    "migration-reversal.yml",
    "spec-ci.yml",
]

EXTERNAL_CANCEL_NOTE = (
    "this workflow declares `concurrency: cancel-in-progress: true`, so a newer "
    "push to the same ref supersedes the run - that or a manual cancel are the "
    "external causes"
)

# Annotation titles, spelled out as literals. Asserting against a constant the
# marker itself defines would pin nothing.
TITLE_JOB_TIMEOUT = "Job budget exhausted - a TIMEOUT, not an external cancel"
TITLE_EXTERNAL_CANCEL = "Run cancelled externally - NOT a verdict on this diff"
TITLE_UNKNOWN_ELAPSED = "Cancelled - a timeout cannot be told from an external cancel"
TITLE_APT_INFRA = "CI infrastructure timeout - NOT your diff"
TITLE_SOFT_FAILED_CANCELLED = (
    "Cancelled, and a soft-failed apt step may have red this job downstream"
)
GENUINE_RED = "This job's failure is a real one"


def _extract_marker_body(workflow: str) -> str:
    """Return the marker step's `run:` body from a workflow, or fail loudly."""
    doc = yaml.safe_load((WORKFLOWS / workflow).read_text(encoding="utf-8"))
    for job in doc["jobs"].values():
        for step in job.get("steps") or []:
            if step.get("name") == MARKER_STEP_NAME:
                return step["run"]
    raise AssertionError(f"{workflow} has no step named {MARKER_STEP_NAME!r}")


# --- the identity pin -------------------------------------------------------


def test_all_six_marker_bodies_are_identical():
    """The six copies must not drift.

    A fix applied to one carrier and not the rest is the failure mode this
    repo has already paid for once: commit 2ee1ac21 exists because an earlier
    guard "shipped at ONE of seven sites".
    """
    bodies = {wf: _extract_marker_body(wf) for wf in MARKER_WORKFLOWS}
    distinct = set(bodies.values())
    assert len(distinct) == 1, (
        "the marker body has drifted across carriers; "
        f"{len(distinct)} distinct versions across {sorted(bodies)}"
    )


def test_every_marker_carrier_declares_a_matching_job_timeout():
    """`JOB_TIMEOUT_MINUTES` must equal the job's own `timeout-minutes`.

    GitHub exposes no expression for a job's own timeout (`env` is not an
    available context for `jobs.<job_id>.timeout-minutes`), so the value is
    hand-copied. If the two drift, `budget_floor` is computed from the wrong
    number and the job-timeout arm misfires or fails to fire.
    """
    for workflow in MARKER_WORKFLOWS:
        doc = yaml.safe_load((WORKFLOWS / workflow).read_text(encoding="utf-8"))
        for job_id, job in doc["jobs"].items():
            for step in job.get("steps") or []:
                if step.get("name") != MARKER_STEP_NAME:
                    continue
                declared = str(step.get("env", {}).get("JOB_TIMEOUT_MINUTES", ""))
                actual = str(job.get("timeout-minutes", ""))
                assert declared == actual, (
                    f"{workflow} job {job_id!r}: marker declares "
                    f"JOB_TIMEOUT_MINUTES={declared!r} but the job's "
                    f"timeout-minutes is {actual!r}"
                )


# --- the arm matrix ---------------------------------------------------------

bash = shutil.which("bash")


def _gnu_date_available() -> bool:
    if not bash:
        return False
    probe = subprocess.run(
        [bash, "-c", 'date -u -d "2026-01-01T00:00:00Z" +%s'],
        capture_output=True,
        text=True,
    )
    return probe.returncode == 0 and probe.stdout.strip().isdigit()


requires_bash = pytest.mark.skipif(
    not _gnu_date_available(),
    reason=(
        "the marker needs `bash` and GNU `date -u -d`; one of them is missing "
        "here, so the arm matrix cannot be executed (it always runs on the "
        "ubuntu CI runner)"
    ),
)


def _run_marker(
    tmp_path: Path,
    *,
    job_status: str,
    apt_outcomes: str,
    started_minutes_ago: int | None,
    job_timeout_minutes: str = "90",
) -> str:
    """Execute the shipped marker body under a stubbed `gh`.

    `started_minutes_ago=None` makes the stub `gh` FAIL, which is how the
    UNKNOWN-elapsed path is driven.
    """
    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir(exist_ok=True)
    gh = stub_dir / "gh"
    if started_minutes_ago is None:
        gh.write_text("#!/usr/bin/env bash\nexit 1\n", encoding="utf-8", newline="\n")
    else:
        started = time.gmtime(time.time() - started_minutes_ago * 60)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", started)
        gh.write_text(
            f"#!/usr/bin/env bash\necho '{stamp}'\n", encoding="utf-8", newline="\n"
        )
    gh.chmod(0o755)

    body = _extract_marker_body("backend-coverage-producer.yml")

    env = {
        "PATH": f"{stub_dir}:/usr/bin:/bin",
        "JOB_STATUS": job_status,
        "JOB_TIMEOUT_MINUTES": job_timeout_minutes,
        "EXTERNAL_CANCEL_NOTE": EXTERNAL_CANCEL_NOTE,
        "APT_STEP_OUTCOMES": apt_outcomes,
        "GITHUB_REPOSITORY": "qontinui/qontinui-web",
        "GITHUB_RUN_ID": "1234567890",
        "GH_TOKEN": "stub",
    }
    proc = subprocess.run(
        [bash, "-s"], input=body, env=env, capture_output=True, text=True
    )
    assert proc.returncode == 0, (
        f"the marker must never exit non-zero (it would red a lane it only "
        f"reports on); got {proc.returncode}\nstderr:\n{proc.stderr}"
    )
    return proc.stdout


APT_CLEAN = "Install postgresql-client|success|success\n"
APT_FAILED = "Install postgresql-client|failure|failure\n"
APT_SOFT_FAILED = "Install postgresql-client|failure|success\n"
APT_MID_FLIGHT = "Install postgresql-client|cancelled|cancelled\n"


@requires_bash
def test_job_budget_timeout_is_reported_as_a_timeout_not_an_external_cancel(tmp_path):
    """THE REGRESSION CASE.

    Cancelled, at the budget, with no apt step implicated -- exactly run
    33114825687. This must name a job-budget timeout, and must NOT claim an
    external cancel.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        started_minutes_ago=90,
    )
    assert TITLE_JOB_TIMEOUT in out
    assert TITLE_EXTERNAL_CANCEL not in out
    assert "cancelled from outside" not in out


@requires_bash
def test_a_genuinely_external_cancel_still_reads_as_external(tmp_path):
    """The narrowed arm 3 must keep working for what it is actually for.

    A supersede lands at an arbitrary, far earlier elapsed. That is still an
    external cancel and must still be named as one.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        started_minutes_ago=5,
    )
    assert TITLE_EXTERNAL_CANCEL in out
    assert "cancelled from outside" in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_unreadable_elapsed_says_unknown_and_never_asserts_an_external_cancel(tmp_path):
    """The negative path.

    When `gh` cannot supply the run's start time the budget test cannot be
    performed. That is UNKNOWN -- and specifically NOT evidence of an external
    cancel, which is the inversion the old arm 3 shipped.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        started_minutes_ago=None,
    )
    assert TITLE_UNKNOWN_ELAPSED in out
    assert "UNKNOWN" in out
    assert TITLE_EXTERNAL_CANCEL not in out
    assert "cancelled from outside" not in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_apt_step_that_failed_outright_is_still_blamed_on_infrastructure(tmp_path):
    """Arm 1 is untouched by this change and must stay untouched."""
    out = _run_marker(
        tmp_path,
        job_status="failure",
        apt_outcomes=APT_FAILED,
        started_minutes_ago=10,
    )
    assert TITLE_APT_INFRA in out
    assert "Install postgresql-client" in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_apt_step_mid_flight_at_the_budget_is_blamed_on_apt_not_on_the_budget(tmp_path):
    """Arm 2 must still win over the new arm 2d.

    When an apt step was genuinely mid-flight at the budget, the apt-mirror
    stall is the specific diagnosis and it beats the generic one.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_MID_FLIGHT,
        started_minutes_ago=90,
    )
    assert TITLE_APT_INFRA in out
    assert "STILL RUNNING" in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_soft_failed_apt_at_the_budget_hedges_instead_of_ruling(tmp_path):
    """Arm 2d must NOT claim a clean job timeout over a soft-failed apt step.

    A `continue-on-error` apt step can have red the job through the cascade, so
    the cause is genuinely ambiguous and the marker must say so rather than
    assert either diagnosis.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_SOFT_FAILED,
        started_minutes_ago=90,
    )
    assert TITLE_SOFT_FAILED_CANCELLED in out
    assert TITLE_JOB_TIMEOUT not in out
    assert TITLE_EXTERNAL_CANCEL not in out


@requires_bash
def test_a_real_failure_is_left_alone(tmp_path):
    """A genuine red must still get no marker.

    The marker explains infrastructure timeouts; editorialising real test
    failures is how a diagnostic loses its readers.
    """
    out = _run_marker(
        tmp_path,
        job_status="failure",
        apt_outcomes=APT_CLEAN,
        started_minutes_ago=10,
    )
    assert GENUINE_RED in out
    assert TITLE_JOB_TIMEOUT not in out
    assert TITLE_APT_INFRA not in out
