"""The Codecov upload is coverage telemetry: it must never fail a `Run Tests` shard.

`fail_ci_if_error: false` only covers an upload the uploader itself reports as
failed. A crash before the upload (the 2026-10-05 nightly: a TLS handshake
refusal from Codecov's endpoint) still concluded every shard `failure` with
every test passing, which reds the `Run Tests` aggregate and makes the
`shard-headroom` alarm read `unknown`. `continue-on-error: true` is what
contains it.
"""

from pathlib import Path

import yaml

WORKFLOW = (
    Path(__file__).resolve().parents[2] / ".github" / "workflows" / "backend-ci.yml"
)
STEP_NAME = "Upload coverage to Codecov"


def _codecov_steps() -> list[dict]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    return [
        step
        for job in doc["jobs"].values()
        for step in job.get("steps", [])
        if step.get("name") == STEP_NAME
    ]


def test_the_codecov_step_exists() -> None:
    # Guards the test below against passing vacuously after a rename.
    assert _codecov_steps(), f"no step named {STEP_NAME!r} in {WORKFLOW}"


def test_a_codecov_failure_cannot_fail_the_job() -> None:
    for step in _codecov_steps():
        assert step.get("continue-on-error") is True, (
            f"{STEP_NAME!r} must carry `continue-on-error: true`: "
            "`fail_ci_if_error: false` does not contain an action crash"
        )
        assert step.get("with", {}).get("fail_ci_if_error") is False
