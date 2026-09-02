"""Arm-by-arm tests for the CI infrastructure-timeout marker and budget tripwire.

The marker is the `Explain infrastructure timeout vs external cancellation` step
carried, byte-identically, by eight of this repo's workflows. It exists to tell
an author whether a red check was their diff or CI infrastructure -- so a wrong
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

These tests run the SHIPPED `run:` bodies -- extracted from the workflow YAML,
not copies pasted in here -- through each arm with a stubbed `gh`, and assert on
the literal annotation titles.

`test_marker_carriers_are_exactly_the_expected_set` derives the carrier list by
GLOB rather than trusting a hand-maintained literal. That is deliberate: the
first round of this very fix shipped to 6 of the 8 carriers because the census
that found them was a shell loop that hit its timeout and was read as complete.
A hand-maintained list cannot catch that; a glob can.

Everything above tests what each step SAYS once it runs. A second, quieter
class of pin covers whether it runs at all: the `if:` condition, and -- for
both steps, which measure job wall-clock -- the `JOB_START_EPOCH` stamp their
job must write in its FIRST step. Neither is reachable from a body executed
directly by this harness, so both were unpinned while every arm inside them
was covered. A marker that never fires on `cancelled`, or a tripwire whose job
never stamps its start, is worse than a wrong verdict: a wrong verdict at
least leaves a sentence to disagree with, while silence leaves the bare
zero-failing-step `fail` these steps exist to explain -- under a full suite of
green tests attesting to a body that never executed.
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
STAMP_STEP_NAME = "Record job start time"

# Every workflow expected to carry the marker. This list is ASSERTED against a
# glob of the workflows directory, so adding a carrier without updating it -- or
# updating it without adding the carrier -- is a test failure either way.
MARKER_WORKFLOWS = [
    "backend-ci.yml",
    "backend-coverage-producer.yml",
    "cross-browser-survey.yml",
    "e2e-tests.yml",
    "migration-reversal.yml",
    "spec-ci.yml",
    "style-gate.yml",
    "verify-frontend-deploy.yml",
]

TRIPWIRE_STEP_NAME = "Warn if the job is approaching its budget"

# The tripwire is carried by every job on the 90-minute backend-suite budget:
# the non-gating producer it was written for, and `backend-ci`'s `test` job,
# which runs the byte-identical suite as the GATING lane. Asserted against a
# glob, exactly like MARKER_WORKFLOWS.
TRIPWIRE_WORKFLOWS = [
    "backend-ci.yml",
    "backend-coverage-producer.yml",
]

EXTERNAL_CANCEL_NOTE = "a newer push to the same ref supersedes the run"

# Annotation titles, spelled out as literals. Asserting against a constant the
# marker itself defines would pin nothing.
TITLE_JOB_TIMEOUT = "Job budget exhausted - a TIMEOUT, not an external cancel"
TITLE_EXTERNAL_CANCEL = "Run cancelled externally - NOT a verdict on this diff"
TITLE_UNKNOWN_ELAPSED = "Cancelled - a timeout cannot be told from an external cancel"
TITLE_APT_INFRA = "CI infrastructure timeout - NOT your diff"
TITLE_SOFT_FAILED_CANCELLED = (
    "Cancelled, and a soft-failed apt step may have red this job downstream"
)
TITLE_SOFT_FAILED_CONTEXT = "Soft-failed apt step - possible upstream cause"
TITLE_SOFT_FAILED_DOWNSTREAM = "A soft-failed apt step may have red this job downstream"
TITLE_APT_MID_FLIGHT_SHORT = "Cancelled with an apt step mid-flight"
TITLE_APT_CANNOT_RULE = "Cannot rule the apt stall in or out"
TITLE_TRIPWIRE_UNKNOWN = "Job duration UNKNOWN - budget tripwire did not run"
# The warn title now carries each site's own `JOB_LABEL`, so the invariant tail
# is what can be asserted against any carrier; `_tripwire_warn_title` builds the
# full per-site string where a test needs it.
TITLE_TRIPWIRE_WARN_TAIL = "is approaching its job budget"
GENUINE_RED = "This job's failure is a real one"


def _steps(workflow: str, job_id: str | None = None):
    doc = yaml.safe_load((WORKFLOWS / workflow).read_text(encoding="utf-8"))
    for jid, job in doc["jobs"].items():
        if job_id is None or jid == job_id:
            yield jid, job, (job.get("steps") or [])


def _find_step(workflow: str, step_name: str):
    """Return (job_id, job, step) for a named step, or fail loudly."""
    for jid, job, steps in _steps(workflow):
        for step in steps:
            if step.get("name") == step_name:
                return jid, job, step
    raise AssertionError(f"{workflow} has no step named {step_name!r}")


def _marker_body(workflow: str) -> str:
    return _find_step(workflow, MARKER_STEP_NAME)[2]["run"]


def _steps_named(workflows: list[str], step_name: str):
    """Every step with this name in every listed workflow -- not just the first.

    `_find_step` stops at the first match, so a SECOND copy added to another
    job of an already-listed carrier is invisible to it: the carrier set still
    matches, and the body it compares is the original. That copy would then be
    exempt from every per-step pin below -- the same "one site out of N" drift
    the identity tests exist to catch, wearing a shape the file-level census
    cannot see.

    Both duplicated steps in this file need that treatment, so the traversal
    is shared rather than written twice: a helper that existed for the marker
    alone is how the tripwire came to be pinned one site per file.

    Yields (workflow, job_id, job, step).
    """
    for workflow in workflows:
        for job_id, job, steps in _steps(workflow):
            for step in steps:
                if step.get("name") == step_name:
                    yield workflow, job_id, job, step


def _marker_steps():
    """Every marker step in every carrier. See `_steps_named`."""
    yield from _steps_named(MARKER_WORKFLOWS, MARKER_STEP_NAME)


def _tripwire_steps():
    """Every tripwire step in every carrier. See `_steps_named`."""
    yield from _steps_named(TRIPWIRE_WORKFLOWS, TRIPWIRE_STEP_NAME)


def _step_env(step: dict) -> dict[str, str]:
    return {k: str(v) for k, v in (step.get("env") or {}).items()}


def _step_condition(step: dict) -> str:
    """The `if:` that decides whether this step runs AT ALL.

    A step with no `if:` key defaults to `success()`, so absence is normalised
    to that rather than treated as a third state -- for the tripwire the two
    are genuinely equivalent, and for the marker the normalised value is what
    makes an omitted `if:` fail the `cancelled()` assertion on its merits.
    """
    raw = step.get("if")
    return "success()" if raw is None else " ".join(str(raw).split())


def _assert_job_stamps_its_start_first(workflow: str, job_id: str, job: dict) -> None:
    """The job's FIRST step must write `JOB_START_EPOCH`.

    Both the marker and the tripwire measure JOB wall-clock from that stamp.
    Anything later than step 1 measures a suffix of the job and understates
    elapsed by the setup prefix.
    """
    steps = job["steps"]
    assert steps[0].get("name") == STAMP_STEP_NAME, (
        f"{workflow} job {job_id!r}: first step is "
        f"{steps[0].get('name') or steps[0].get('uses')!r}, "
        f"expected {STAMP_STEP_NAME!r}"
    )
    assert "JOB_START_EPOCH" in steps[0]["run"], (
        f"{workflow} job {job_id!r}: the first step does not write JOB_START_EPOCH"
    )


def _cancel_in_progress(workflow: str, job: dict):
    """Resolve the `cancel-in-progress` that actually governs this job.

    A job-level `concurrency:` block overrides the workflow-level one. Returns
    the bool, or None when no block applies -- and the string itself when it is
    an unevaluated `${{ }}` expression, which is neither.
    """
    doc = yaml.safe_load((WORKFLOWS / workflow).read_text(encoding="utf-8"))
    conc = job.get("concurrency")
    if conc is None:
        conc = doc.get("concurrency")
    if not isinstance(conc, dict):
        return None
    return conc.get("cancel-in-progress")


# --- structural pins --------------------------------------------------------


def test_marker_carriers_are_exactly_the_expected_set():
    """The carrier list must be derived, not remembered.

    Round 1 of this fix shipped to 6 of 8 carriers because the census that
    found them was truncated. A glob is what makes that class of miss visible.
    """
    # `*.y*ml`, not `*.yml`: GitHub Actions reads `.yaml` and `.yml` alike, so
    # a carrier added under the other extension would be a real carrier that
    # this census cannot see -- reintroducing, through a spelling, exactly the
    # invisible-miss this test was written to prevent.
    found = sorted(
        p.name
        for p in WORKFLOWS.glob("*.y*ml")
        if MARKER_STEP_NAME in p.read_text(encoding="utf-8")
    )
    assert found == sorted(MARKER_WORKFLOWS), (
        "the set of workflows carrying the marker has changed; "
        f"glob found {found}, list expects {sorted(MARKER_WORKFLOWS)}"
    )


def test_all_marker_bodies_are_identical():
    """The copies must not drift.

    A fix applied to one carrier and not the rest is the failure mode this
    repo has already paid for twice: commit 2ee1ac21 exists because an earlier
    guard "shipped at ONE of seven sites", and round 1 of this fix reached 6
    of 8.

    Compared per marker STEP rather than per carrier file: a second copy in
    another job of an already-listed workflow is still a copy, and comparing
    only the first one per file would exempt it.
    """
    bodies = {f"{wf}:{jid}": step["run"] for wf, jid, _, step in _marker_steps()}
    assert len(bodies) >= len(MARKER_WORKFLOWS), (
        f"found only {len(bodies)} marker steps across "
        f"{len(MARKER_WORKFLOWS)} carriers; the scan missed some"
    )
    distinct = set(bodies.values())
    assert len(distinct) == 1, (
        "the marker body has drifted across carriers; "
        f"{len(distinct)} distinct versions across {sorted(bodies)}"
    )


def test_every_carrier_stamps_its_job_start_as_the_first_step():
    """The marker's elapsed measurement depends on this stamp existing first.

    If it is absent the marker silently falls back to `run_started_at`, which
    on a `needs:`-gated job overstates elapsed by the upstream job plus queue
    time -- enough to report a late external cancel as a timeout.
    """
    checked = 0
    for workflow, job_id, job, _ in _marker_steps():
        _assert_job_stamps_its_start_first(workflow, job_id, job)
        checked += 1
    assert checked >= len(MARKER_WORKFLOWS), (
        f"only {checked} marker steps scanned across "
        f"{len(MARKER_WORKFLOWS)} carriers; the scan would have passed vacuously"
    )


def test_the_marker_is_reached_on_a_cancelled_job():
    """The condition that decides whether the marker RUNS is itself pinned.

    Every arm below is exercised against the shipped body -- but all of that
    is downstream of `if:`, and nothing pinned it. A marker narrowed to
    `if: failure()` (or losing its `if:` altogether, which defaults to
    `success()`) would be byte-identical at all eight carriers, budget-matched,
    note-matched, and would never run on the one conclusion it was written for:
    a job-budget timeout concludes `cancelled`.

    That is the worst shape this defect can take. The original bug printed a
    wrong verdict, which at least left a sentence in the log to disagree with;
    an unreached marker prints nothing, and a reader sees the same bare
    zero-failing-step `fail` the whole step exists to explain -- with 40-odd
    green tests attesting to a body that never executed.
    """
    conditions = {}
    for workflow, job_id, _, step in _marker_steps():
        cond = _step_condition(step)
        assert "cancelled()" in cond, (
            f"{workflow} job {job_id!r}: the marker's condition is {cond!r}, "
            "which does not include `cancelled()`. A job-budget timeout and a "
            "merge-train reap both conclude `cancelled`, so the step would "
            "never run on the states it exists to explain"
        )
        conditions[f"{workflow}:{job_id}"] = cond

    assert len(conditions) >= len(MARKER_WORKFLOWS), (
        f"only {len(conditions)} marker conditions checked across "
        f"{len(MARKER_WORKFLOWS)} carriers; the scan would have passed vacuously"
    )
    distinct = set(conditions.values())
    assert len(distinct) == 1, (
        "the marker's `if:` has drifted across carriers; "
        f"{len(distinct)} distinct conditions across {sorted(conditions)}: "
        f"{sorted(distinct)}"
    )


def test_the_tripwire_is_reached_on_a_green_job():
    """The tripwire's whole point is warning while the lane is still GREEN.

    Gate it on `failure()` or `cancelled()` and it inverts into a second
    marker: it would only ever speak about jobs that had already gone red,
    which is exactly the too-late signal it was added to replace. Every
    tripwire test below drives the body directly, so none of them would
    notice.
    """
    conditions = {}
    for workflow, job_id, _, step in _tripwire_steps():
        cond = _step_condition(step)
        assert "success()" in cond, (
            f"{workflow} job {job_id!r}: the tripwire's condition is {cond!r}, "
            "which does not include `success()`; it must warn on a run that "
            "PASSED, while there is still budget in hand"
        )
        for forbidden in ("cancelled()", "failure()"):
            assert forbidden not in cond, (
                f"{workflow} job {job_id!r}: the tripwire's condition is "
                f"{cond!r}, which brings in {forbidden}. A budget-creep warning "
                "on an already-red lane is the late signal this step replaces"
            )
        conditions[f"{workflow}:{job_id}"] = cond

    assert len(conditions) >= len(TRIPWIRE_WORKFLOWS), (
        f"only {len(conditions)} tripwire conditions checked across "
        f"{len(TRIPWIRE_WORKFLOWS)} carriers; the scan would have passed vacuously"
    )
    distinct = set(conditions.values())
    assert len(distinct) == 1, (
        "the tripwire's `if:` has drifted across carriers; "
        f"{len(distinct)} distinct conditions across {sorted(conditions)}: "
        f"{sorted(distinct)}"
    )


def test_the_stamp_step_does_not_inherit_a_repo_relative_working_directory():
    """A pre-checkout step must not run inside a directory that does not exist.

    The stamp step is step 1, so it runs BEFORE `actions/checkout`. A job whose
    `defaults.run.working-directory` points into the repo (`./backend`) has no
    such directory at that moment: the step fails on a missing cwd, and because
    it is first, the entire job dies with every later step skipped.

    This is not hypothetical -- it took down `backend-ci`'s `Run Tests` on the
    first CI run of this change. The job's own default is the hazard, so the
    invariant is: whenever the job declares a repo-relative default, the stamp
    step must override it.
    """
    for workflow, job_id, job, _ in _marker_steps():
        stamp = job["steps"][0]
        job_default = ((job.get("defaults") or {}).get("run") or {}).get(
            "working-directory"
        )
        wd = stamp.get("working-directory")
        assert wd, (
            f"{workflow} job {job_id!r}: the stamp step declares no "
            f"working-directory; it runs before checkout, and the job default "
            f"is {job_default!r}"
        )
        assert "github.workspace" in wd, (
            f"{workflow} job {job_id!r}: the stamp step's working-directory is "
            f"{wd!r}; it must anchor to the workspace root, which exists "
            "before any step runs"
        )


def test_every_declared_job_timeout_matches_its_job():
    """`JOB_TIMEOUT_MINUTES` must equal the job's own `timeout-minutes`.

    GitHub exposes no expression for a job's own timeout (`env` is not an
    available context for `jobs.<job_id>.timeout-minutes`), so the value is
    hand-copied -- in the producer, into THREE places. If they drift,
    `budget_floor` is computed from the wrong number and the job-timeout arm
    misfires or fails to fire.

    Checks EVERY step declaring the name, not just the marker's copy, and
    asserts at least one was found so the test cannot pass vacuously.
    """
    checked = 0
    for workflow in MARKER_WORKFLOWS:
        for job_id, job, steps in _steps(workflow):
            for step in steps:
                declared = (step.get("env") or {}).get("JOB_TIMEOUT_MINUTES")
                if declared is None:
                    continue
                actual = str(job.get("timeout-minutes", ""))
                assert str(declared) == actual, (
                    f"{workflow} job {job_id!r} step "
                    f"{step.get('name')!r}: declares "
                    f"JOB_TIMEOUT_MINUTES={declared!r} but the job's "
                    f"timeout-minutes is {actual!r}"
                )
                checked += 1
    assert checked >= len(MARKER_WORKFLOWS), (
        f"only {checked} JOB_TIMEOUT_MINUTES declarations found across "
        f"{len(MARKER_WORKFLOWS)} carriers; the scan matched nothing and "
        "would have passed vacuously"
    )


def test_every_external_cancel_note_matches_its_workflow_concurrency():
    """`EXTERNAL_CANCEL_NOTE` must describe the concurrency this job ACTUALLY has.

    The note is the second hand-copied fact in this step, and it is copied for
    the same reason as the first: GitHub exposes no expression for a workflow's
    own `concurrency:` config, so each carrier states it in prose. The budget
    number is already pinned to its job by
    `test_every_declared_job_timeout_matches_its_job`; nothing pinned this one.

    Drift here is not cosmetic. The note is interpolated into the arm that
    RULES an external cancel, so a workflow that gains
    `cancel-in-progress: true` while its note still reads "declares NO
    `concurrency:` block, so GitHub never auto-supersedes it" would tell every
    reader to go find the human who cancelled their job -- when GitHub had
    superseded it automatically. That is the same misattribution class this
    whole marker exists to remove: a diagnostic confidently naming the wrong
    cause, which teaches readers to discard the right ones too.
    """
    checked = 0
    for workflow, job_id, job, step in _marker_steps():
        note = " ".join(
            str((step.get("env") or {}).get("EXTERNAL_CANCEL_NOTE", "")).split()
        )
        assert note, f"{workflow} job {job_id!r}: declares no EXTERNAL_CANCEL_NOTE"
        cip = _cancel_in_progress(workflow, job)

        if cip is None:
            expected = "declares NO `concurrency:` block"
        elif cip is True:
            expected = "declares `concurrency: cancel-in-progress: true`"
        elif cip is False:
            expected = "declares `concurrency: cancel-in-progress: false`"
        else:
            # An unevaluated `${{ }}` expression: the value is decided at run
            # time, so no static prose can be true of every run. Asserting
            # either branch would be a guess stated as fact -- the failure mode
            # this marker exists to remove -- so require the note to claim
            # NEITHER rather than silently accepting a coin flip.
            for forbidden in (
                "cancel-in-progress: true",
                "cancel-in-progress: false",
                "NO `concurrency:` block",
            ):
                assert forbidden not in note, (
                    f"{workflow} job {job_id!r}: cancel-in-progress is the "
                    f"expression {cip!r}, decided per run, but the note "
                    f"asserts {forbidden!r} as though it were fixed"
                )
            checked += 1
            continue

        assert expected in note, (
            f"{workflow} job {job_id!r}: EXTERNAL_CANCEL_NOTE has drifted from "
            f"the workflow's real concurrency config. Expected the note to say "
            f"{expected!r}, got: {note!r}"
        )
        checked += 1

    assert checked >= len(MARKER_WORKFLOWS), (
        f"only {checked} notes checked across {len(MARKER_WORKFLOWS)} carriers; "
        "the scan matched nothing and would have passed vacuously"
    )


def test_soft_budget_is_below_the_job_budget():
    """A soft budget at or above the hard one could never warn in time."""
    checked = 0
    for workflow, job_id, job, step in _tripwire_steps():
        env = _step_env(step)
        soft = int(env["SOFT_BUDGET_MINUTES"])
        hard = int(job["timeout-minutes"])
        assert 0 < soft < hard, (
            f"{workflow} job {job_id!r}: soft budget {soft} must sit strictly "
            f"inside {hard}"
        )
        assert env["JOB_TIMEOUT_MINUTES"] == str(hard), (
            f"{workflow} job {job_id!r}: the tripwire's JOB_TIMEOUT_MINUTES has "
            f"drifted from the job's own timeout-minutes ({hard})"
        )
        checked += 1
    assert checked >= len(TRIPWIRE_WORKFLOWS), (
        f"only {checked} tripwire steps scanned across "
        f"{len(TRIPWIRE_WORKFLOWS)} carriers; the scan would have passed vacuously"
    )


def test_every_tripwire_job_stamps_its_job_start_as_the_first_step():
    """The tripwire's ONLY input is `JOB_START_EPOCH`, and nothing pinned it.

    The marker's carriers are pinned by
    `test_every_carrier_stamps_its_job_start_as_the_first_step`, and today the
    two tripwires happen to sit in marker-carrying jobs -- so this holds
    transitively, by coincidence rather than by assertion. Put a tripwire in a
    job with no stamp step and it degrades to its own UNKNOWN arm on every run:
    "budget tripwire did not run", forever, on a GREEN lane nobody is reading
    closely, with every test in this file still passing.

    That is the failure this file exists to make impossible -- a guard that is
    perfectly correct and never actually measures anything -- so it is asserted
    for the tripwire's own jobs rather than inherited from the marker's.
    """
    checked = 0
    for workflow, job_id, job, _ in _tripwire_steps():
        _assert_job_stamps_its_start_first(workflow, job_id, job)
        checked += 1
    assert checked >= len(TRIPWIRE_WORKFLOWS), (
        f"only {checked} tripwire steps scanned across "
        f"{len(TRIPWIRE_WORKFLOWS)} carriers; the scan would have passed vacuously"
    )


# --- execution harness ------------------------------------------------------

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
        "the marker is bash and needs GNU `date -u -d`; one of them is missing "
        "here, so the execution matrix cannot run (it always runs on the "
        "ubuntu CI runner)"
    ),
)


def _exec(script: str, env: dict[str, str], tmp_path: Path) -> str:
    """Run a workflow `run:` body under GitHub's ACTUAL shell flags.

    GitHub invokes `run:` as `bash --noprofile --norc -eo pipefail {0}`. The
    `-e` matters: the bodies only `set -uo pipefail` themselves, so a harness
    without `-e` runs them under strictly WEAKER semantics than production and
    cannot see an abort. That is the exact axis the leading-zero arithmetic bug
    fails on -- `08` exits 1 under `-e` and 0 without it -- so a harness missing
    the flag would pass a body that reds the lane.
    """
    proc = subprocess.run(
        [bash, "--noprofile", "--norc", "-eo", "pipefail", "-s"],
        input=script,
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        "this step must never exit non-zero -- it only reports, and a non-zero "
        f"exit would red the lane and skip the export step. got "
        f"{proc.returncode}\nstderr:\n{proc.stderr}"
    )
    return proc.stdout


def _run_marker(
    tmp_path: Path,
    *,
    job_status: str,
    apt_outcomes: str,
    elapsed_minutes: int | None,
    basis: str = "job",
    job_timeout_minutes: str = "90",
    workflow: str = "backend-coverage-producer.yml",
    job_start_override: str | None = None,
) -> str:
    """Execute the shipped marker body.

    `basis="job"` drives elapsed through `JOB_START_EPOCH` (the normal path);
    `basis="run"` leaves it unset so the `gh api` fallback is exercised.
    `elapsed_minutes=None` makes BOTH sources fail, driving the UNKNOWN path.
    """
    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir(exist_ok=True)
    gh = stub_dir / "gh"
    if elapsed_minutes is None or basis == "job":
        gh.write_text("#!/usr/bin/env bash\nexit 1\n", encoding="utf-8", newline="\n")
    else:
        stamp = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - elapsed_minutes * 60)
        )
        gh.write_text(
            f"#!/usr/bin/env bash\necho '{stamp}'\n", encoding="utf-8", newline="\n"
        )
    gh.chmod(0o755)

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
    if job_start_override is not None:
        env["JOB_START_EPOCH"] = job_start_override
    elif basis == "job" and elapsed_minutes is not None:
        env["JOB_START_EPOCH"] = str(int(time.time()) - elapsed_minutes * 60)

    return _exec(_marker_body(workflow), env, tmp_path)


APT_CLEAN = "Install postgresql-client|success|success\n"
APT_FAILED = "Install postgresql-client|failure|failure\n"
APT_SOFT_FAILED = "Install postgresql-client|failure|success\n"
APT_MID_FLIGHT = "Install postgresql-client|cancelled|cancelled\n"


# --- the arm matrix ---------------------------------------------------------


@requires_bash
@pytest.mark.parametrize("basis", ["job", "run"])
def test_job_budget_timeout_is_reported_as_a_timeout_not_an_external_cancel(
    tmp_path, basis
):
    """THE REGRESSION CASE.

    Cancelled, at the budget, with no apt step implicated -- exactly run
    33114825687. Must name a job-budget timeout and must NOT claim an external
    cancel, on either measurement basis.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        elapsed_minutes=90,
        basis=basis,
    )
    assert TITLE_JOB_TIMEOUT in out
    assert TITLE_EXTERNAL_CANCEL not in out
    assert "cancelled from outside" not in out


@requires_bash
def test_run_basis_fallback_discloses_that_it_measured_the_run(tmp_path):
    """When the job stamp is missing the verdict must say what it measured.

    The run-level figure includes upstream `needs:` jobs and queue time, so a
    reader has to know that is the basis before trusting the number.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        elapsed_minutes=90,
        basis="run",
    )
    assert TITLE_JOB_TIMEOUT in out
    assert "RUN's start" in out
    job_out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        elapsed_minutes=90,
        basis="job",
    )
    assert "this job's own start" in job_out


@requires_bash
@pytest.mark.parametrize(
    ("elapsed", "expected_timeout"),
    [(90, True), (89, True), (88, True), (87, False), (5, False)],
)
def test_the_budget_boundary_is_where_it_is_declared(
    tmp_path, elapsed, expected_timeout
):
    """Pin the slack itself.

    `budget_floor = JOB_TIMEOUT_MINUTES - 2`, so with a 90-minute budget the
    verdict must flip between 88 and 87. Without these two cases the slack
    could be changed to anything from 0 to 84 with every other test still green.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        elapsed_minutes=elapsed,
    )
    if expected_timeout:
        assert TITLE_JOB_TIMEOUT in out
        assert TITLE_EXTERNAL_CANCEL not in out
    else:
        assert TITLE_EXTERNAL_CANCEL in out
        assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_unreadable_elapsed_says_unknown_and_never_asserts_an_external_cancel(tmp_path):
    """The negative path.

    With neither the job stamp nor the API the budget test cannot run. That is
    UNKNOWN -- and specifically NOT evidence of an external cancel, which is
    the inversion the old arm 3 shipped.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        elapsed_minutes=None,
    )
    assert TITLE_UNKNOWN_ELAPSED in out
    assert "UNKNOWN" in out
    assert TITLE_EXTERNAL_CANCEL not in out
    assert "cancelled from outside" not in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
@pytest.mark.parametrize("bad", ["", "abc", "08", "0" * 20 + "1", "9" * 25, "-100"])
def test_a_malformed_job_stamp_degrades_to_unknown_rather_than_aborting(tmp_path, bad):
    """A bad stamp must never abort the marker.

    `-e` is on, so an unguarded `$(( ))` on `08` (octal, a hard error) or on an
    over-long value (int64 overflow -> a negative "measurement") would kill the
    step. `_exec` asserts rc == 0, so reaching an assertion here at all means
    the guards held.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        elapsed_minutes=None,
        job_start_override=bad,
    )
    assert TITLE_UNKNOWN_ELAPSED in out
    assert TITLE_JOB_TIMEOUT not in out
    assert "cancelled from outside" not in out


@requires_bash
def test_apt_step_that_failed_outright_is_still_blamed_on_infrastructure(tmp_path):
    """Arm 1 is untouched by this change and must stay untouched."""
    out = _run_marker(
        tmp_path,
        job_status="failure",
        apt_outcomes=APT_FAILED,
        elapsed_minutes=10,
    )
    assert TITLE_APT_INFRA in out
    assert "Install postgresql-client" in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_soft_failed_apt_on_a_failed_job_warns_without_ruling(tmp_path):
    """Arm 1b: a soft-failed apt step can have red the job through the cascade."""
    out = _run_marker(
        tmp_path,
        job_status="failure",
        apt_outcomes=APT_SOFT_FAILED,
        elapsed_minutes=10,
    )
    assert TITLE_SOFT_FAILED_CONTEXT in out
    assert TITLE_SOFT_FAILED_DOWNSTREAM in out
    assert GENUINE_RED not in out


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
        elapsed_minutes=90,
    )
    assert TITLE_APT_INFRA in out
    assert "STILL RUNNING" in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_apt_mid_flight_on_a_failed_job(tmp_path):
    """Arm 2b: step-level expiry under `failure` semantics."""
    out = _run_marker(
        tmp_path,
        job_status="failure",
        apt_outcomes=APT_MID_FLIGHT,
        elapsed_minutes=10,
    )
    assert TITLE_APT_INFRA in out
    assert "mid-flight" in out


@requires_bash
def test_apt_mid_flight_short_of_the_budget_hedges(tmp_path):
    """Arm 2c, known-elapsed branch: points at an external cancel but does not
    rule the stall out, because an apt step genuinely was running."""
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_MID_FLIGHT,
        elapsed_minutes=3,
    )
    assert TITLE_APT_MID_FLIGHT_SHORT in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
def test_apt_mid_flight_with_unknown_elapsed_rules_nothing_out(tmp_path):
    """Arm 2c, UNKNOWN branch."""
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_MID_FLIGHT,
        elapsed_minutes=None,
    )
    assert TITLE_APT_CANNOT_RULE in out
    assert TITLE_JOB_TIMEOUT not in out


@requires_bash
@pytest.mark.parametrize("elapsed", [90, 3, None])
def test_soft_failed_apt_when_cancelled_hedges_instead_of_ruling(tmp_path, elapsed):
    """Arm 3a, at all three budget readings.

    Arm 2d must NOT claim a clean job timeout over a soft-failed apt step: a
    `continue-on-error` step can have red the job through the cascade, so the
    cause is genuinely ambiguous and the marker must say so.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_SOFT_FAILED,
        elapsed_minutes=elapsed,
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
        elapsed_minutes=10,
    )
    assert GENUINE_RED in out
    assert TITLE_JOB_TIMEOUT not in out
    assert TITLE_APT_INFRA not in out


@requires_bash
def test_every_carrier_routes_identically_against_its_own_budget(tmp_path):
    """The eight copies must behave the same, each against its own budget.

    Textual identity is necessary but not sufficient -- each carrier supplies
    its own `JOB_TIMEOUT_MINUTES`, and that value is what the arms compare
    against.
    """
    for workflow in MARKER_WORKFLOWS:
        _, job, step = _find_step(workflow, MARKER_STEP_NAME)
        budget = str(job["timeout-minutes"])
        assert step["env"]["JOB_TIMEOUT_MINUTES"] == budget

        at_budget = _run_marker(
            tmp_path,
            job_status="cancelled",
            apt_outcomes=APT_CLEAN,
            elapsed_minutes=int(budget),
            job_timeout_minutes=budget,
            workflow=workflow,
        )
        short = _run_marker(
            tmp_path,
            job_status="cancelled",
            apt_outcomes=APT_CLEAN,
            elapsed_minutes=1,
            job_timeout_minutes=budget,
            workflow=workflow,
        )
        assert TITLE_JOB_TIMEOUT in at_budget, workflow
        assert TITLE_EXTERNAL_CANCEL in short, workflow


# --- the budget tripwire ----------------------------------------------------


def _tripwire_body(
    workflow: str = "backend-coverage-producer.yml",
) -> tuple[str, dict[str, str]]:
    _, _, step = _find_step(workflow, TRIPWIRE_STEP_NAME)
    return step["run"], {k: str(v) for k, v in step["env"].items()}


def _tripwire_warn_title(workflow: str) -> str:
    """The warn title is per-site: the body interpolates `$JOB_LABEL`."""
    _, env = _tripwire_body(workflow)
    return f"{env['JOB_LABEL']} {TITLE_TRIPWIRE_WARN_TAIL}"


def test_tripwire_carriers_are_exactly_the_expected_set():
    """Derived by glob, for the same reason the marker's carrier set is.

    The tripwire started at one site and now has two; the next person adding a
    90-minute job to this repo is the one this census is for.
    """
    found = sorted(
        p.name
        for p in WORKFLOWS.glob("*.y*ml")
        if TRIPWIRE_STEP_NAME in p.read_text(encoding="utf-8")
    )
    assert found == sorted(TRIPWIRE_WORKFLOWS), (
        "the set of workflows carrying the budget tripwire has changed; "
        f"glob found {found}, list expects {sorted(TRIPWIRE_WORKFLOWS)}"
    )


def test_all_tripwire_bodies_are_identical():
    """Two copies drift exactly like eight do, only quieter.

    Everything site-specific -- the label, the stakes sentence, both budgets --
    is in `env:`, so the `run:` body itself has nothing legitimate to differ
    about.
    """
    bodies = {f"{wf}:{jid}": step["run"] for wf, jid, _, step in _tripwire_steps()}
    assert len(bodies) >= len(TRIPWIRE_WORKFLOWS), (
        f"found only {len(bodies)} tripwire steps across "
        f"{len(TRIPWIRE_WORKFLOWS)} carriers; the scan missed some"
    )
    distinct = set(bodies.values())
    assert len(distinct) == 1, (
        "the tripwire body has drifted across carriers; "
        f"{len(distinct)} distinct versions across {sorted(bodies)}"
    )


def test_every_tripwire_carrier_declares_its_own_site_text():
    """`JOB_LABEL` and `BUDGET_STAKES` are what make one body serve two sites.

    If a copy-paste leaves both carriers with the same label, the annotation
    stops naming which job is creeping -- which is the only thing it is for.
    """
    labels = {}
    for workflow, job_id, _, step in _tripwire_steps():
        env = _step_env(step)
        for key in ("JOB_LABEL", "BUDGET_STAKES"):
            assert env.get(key), (
                f"{workflow} job {job_id!r}: tripwire declares no {key}"
            )
        labels[f"{workflow}:{job_id}"] = env["JOB_LABEL"]
    assert len(labels) >= len(TRIPWIRE_WORKFLOWS), (
        f"only {len(labels)} tripwire steps scanned across "
        f"{len(TRIPWIRE_WORKFLOWS)} carriers; the scan would have passed vacuously"
    )
    assert len(set(labels.values())) == len(labels), (
        f"tripwire carriers must not share a JOB_LABEL, got {labels}"
    )


@requires_bash
@pytest.mark.parametrize(
    "bad", [None, "", "abc", "08", "09", "12345 ", "0" * 20 + "1", "9" * 25, "-100"]
)
def test_tripwire_reports_unknown_and_never_fails_the_job(tmp_path, bad):
    """The tripwire runs on GREEN lanes, so it is the only new code that can
    newly red a passing job. It must survive every malformed input.

    `08`/`09` are the sharp ones: all-digit, so a naive `[!0-9]` guard passes
    them straight into `$(( ))`, where bash reads the leading zero as octal and
    errors out. Under `-e` that fails the step -- and the export step after it
    defaults to `success()`, so the workflow's entire purpose would be skipped.
    """
    body, env = _tripwire_body()
    env["PATH"] = "/usr/bin:/bin"
    if bad is not None:
        env["JOB_START_EPOCH"] = bad
    out = _exec(body, env, tmp_path)
    assert TITLE_TRIPWIRE_UNKNOWN in out
    assert "UNKNOWN" in out
    assert TITLE_TRIPWIRE_WARN_TAIL not in out


@requires_bash
def test_tripwire_is_quiet_on_a_fast_job(tmp_path):
    body, env = _tripwire_body()
    env["PATH"] = "/usr/bin:/bin"
    env["JOB_START_EPOCH"] = str(int(time.time()) - 10 * 60)
    out = _exec(body, env, tmp_path)
    assert TITLE_TRIPWIRE_WARN_TAIL not in out
    assert TITLE_TRIPWIRE_UNKNOWN not in out
    assert "Job wall-clock: 10 min" in out


@requires_bash
@pytest.mark.parametrize("minutes", [60, 75])
def test_tripwire_warns_at_and_past_the_soft_budget(tmp_path, minutes):
    """Boundary included: the soft budget is inclusive (`-ge`)."""
    body, env = _tripwire_body()
    env["PATH"] = "/usr/bin:/bin"
    env["JOB_START_EPOCH"] = str(int(time.time()) - minutes * 60)
    out = _exec(body, env, tmp_path)
    assert _tripwire_warn_title("backend-coverage-producer.yml") in out
    assert f"took {minutes} min" in out


@requires_bash
def test_every_tripwire_carrier_warns_against_its_own_soft_budget(tmp_path):
    """The shared body must route per-site, not just parse per-site.

    Byte-identity is necessary but not sufficient: each carrier supplies its own
    soft budget, label and stakes sentence, and those are what the warn arm
    interpolates. This is the tripwire's counterpart to
    `test_every_carrier_routes_identically_against_its_own_budget`.
    """
    checked = 0
    for workflow, job_id, _, step in _tripwire_steps():
        body = step["run"]
        env = _step_env(step)
        soft = int(env["SOFT_BUDGET_MINUTES"])
        env["PATH"] = "/usr/bin:/bin"

        env["JOB_START_EPOCH"] = str(int(time.time()) - soft * 60)
        at_soft = _exec(body, env, tmp_path)
        # Five minutes below, not one: the body measures against `date` at the
        # moment it runs, so a slow runner can burn a whole minute between the
        # stamp being computed here and the comparison happening there, and a
        # one-minute margin would flip. The inclusive boundary itself is pinned
        # exactly by `test_tripwire_warns_at_and_past_the_soft_budget`; what
        # this test is for is that each carrier routes on its OWN budget.
        env["JOB_START_EPOCH"] = str(int(time.time()) - (soft - 5) * 60)
        below = _exec(body, env, tmp_path)

        site = f"{workflow}:{job_id}"
        title = f"{env['JOB_LABEL']} {TITLE_TRIPWIRE_WARN_TAIL}"
        assert title in at_soft, site
        assert env["BUDGET_STAKES"].strip() in at_soft, site
        assert title not in below, site
        checked += 1

    assert checked >= len(TRIPWIRE_WORKFLOWS), (
        f"only {checked} tripwire steps executed across "
        f"{len(TRIPWIRE_WORKFLOWS)} carriers; the scan would have passed vacuously"
    )


@requires_bash
def test_empty_apt_telemetry_is_not_read_as_a_clean_run(tmp_path):
    """An empty `APT_STEP_OUTCOMES` is absent DATA, not observed health.

    A renamed or deleted step id makes the `steps.<id>.outcome` expression
    render empty, which leaves every bucket empty exactly as a clean run does.
    Arm 2d is the first arm to make a POSITIVE claim on those buckets, so it
    must refuse to rule rather than assert "no apt step failed" from nothing.
    """
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes="",
        elapsed_minutes=90,
    )
    assert "the apt telemetry was EMPTY" in out
    assert TITLE_JOB_TIMEOUT not in out
    assert "can NOT be ruled out" in out


@requires_bash
def test_the_budget_arms_cite_the_budget_plan_not_the_apt_plan(tmp_path):
    """Arm 2d exists to say this was NOT the apt stall, so citing the apt-stall
    plan as its only reference points the reader at the wrong investigation."""
    out = _run_marker(
        tmp_path,
        job_status="cancelled",
        apt_outcomes=APT_CLEAN,
        elapsed_minutes=90,
    )
    assert "2026-08-27-web-backend-coverage-producer-timeout" in out
    assert "2026-08-19-ci-apt-hang" not in out


# ---------------------------------------------------------------------------
# The guard's own trigger — a path-scoped gate does not guard a file it never
# runs on.
# ---------------------------------------------------------------------------

BACKEND_CI = WORKFLOWS / "backend-ci.yml"


def _backend_ci_paths(workflow: dict, trigger: str) -> list[str]:
    """The ``paths:`` filter of one backend-ci trigger, failing closed.

    Mirrors ``tests/test_coord_down_envelope_contract.py::_ci_paths``, which
    closes the identical hole for the files THAT guard reads. Duplicated rather
    than imported: a test module importing a helper out of a sibling test
    module couples two guards' lifetimes for four lines.
    """
    # PyYAML (YAML 1.1) parses the bare key `on` as the boolean True.
    triggers = workflow.get("on", workflow.get(True))
    assert isinstance(triggers, dict), (
        f"Could not read the `on:` block of {BACKEND_CI}. This guard cannot "
        "verify its own trigger, so it fails rather than passing vacuously."
    )
    block = triggers.get(trigger)
    assert isinstance(block, dict), (
        f"backend-ci.yml has no `on.{trigger}` mapping. If the trigger was "
        "restructured, retarget this guard — do not delete it."
    )
    paths = block.get("paths")
    assert isinstance(paths, list) and paths, (
        f"`on.{trigger}.paths` is missing or empty in {BACKEND_CI}. An "
        "unfiltered trigger would actually be safe here, but it is far more "
        "likely the filter moved; assert loudly instead of guessing."
    )
    return [str(entry) for entry in paths]


def test_backend_ci_triggers_on_every_workflow_this_module_reads():
    """Every marker workflow must be able to run the guard that asserts on it.

    This module reads the workflow FILES and asserts things about them, so it
    is only a gate on the changes that trigger it. For most of this module's
    life only `backend-ci.yml` was in backend-ci's `paths:` filter, which meant
    an edit to any of the other seven markers ran no Backend CI at all.

    That is the hole `62ffe43ee` fell through. It changed `e2e-tests.yml`'s
    `cancel-in-progress` to an expression and left four prose copies of the old
    fixed value behind; its own PR triggered no Backend CI, so
    `test_every_external_cancel_note_matches_its_workflow_concurrency` first
    failed AFTER the merge — on `main`, and on every unrelated PR opened behind
    it, where it reads as someone else's diff being broken.

    Both triggers are checked: a filter added to one and forgotten on the other
    is exactly the asymmetry that makes a gate look armed while half of it is
    not.
    """
    if not BACKEND_CI.is_file():
        pytest.fail(
            f"Workflow not found: {BACKEND_CI}. This guard asserts on workflow "
            "files and can only fire if backend-ci is triggered by them; a "
            "missing workflow fails rather than passes."
        )
    workflow = yaml.safe_load(BACKEND_CI.read_text(encoding="utf-8"))
    assert isinstance(workflow, dict), f"{BACKEND_CI} did not parse as a mapping."

    for trigger in ("pull_request", "push"):
        filters = _backend_ci_paths(workflow, trigger)
        for name in MARKER_WORKFLOWS + TRIPWIRE_WORKFLOWS:
            relative = f".github/workflows/{name}"
            assert relative in filters, (
                f"`{relative}` is asserted on by this module but is not in "
                f"backend-ci.yml's `on.{trigger}.paths`. A commit touching only "
                "that workflow would not run this guard, so a budget or a "
                "cancel note could drift out of agreement with its own job and "
                "reach `main` unchallenged. Add it to BOTH the pull_request "
                "and push filters."
            )
