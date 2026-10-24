"""A Codecov upload is coverage telemetry: it must never fail the job it runs in.

`fail_ci_if_error: false` only covers an upload the uploader itself reports as
failed. A crash before the upload (the 2026-10-05 nightly: a TLS handshake
refusal from Codecov's endpoint) still concluded every `Run Tests` shard
`failure` with every test passing, which reds the `Run Tests` aggregate and
makes the `shard-headroom` alarm read `unknown`. `continue-on-error: true` is
what contains it, on every workflow step that runs the Codecov action.
"""

from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
ACTION = "codecov/codecov-action@"


def _codecov_steps() -> list[tuple[str, dict]]:
    found = []
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for job in (doc.get("jobs") or {}).values():
            for step in job.get("steps", []) or []:
                if str(step.get("uses", "")).startswith(ACTION):
                    found.append((f"{path.name}: {step.get('name')}", step))
    return found


def test_the_codecov_steps_exist() -> None:
    # Guards the test below against passing vacuously after a rename or a move.
    names = [name for name, _ in _codecov_steps()]
    assert "backend-ci.yml: Upload coverage to Codecov" in names, names


def test_a_codecov_failure_cannot_fail_its_job() -> None:
    for name, step in _codecov_steps():
        assert step.get("continue-on-error") is True, (
            f"{name} must carry `continue-on-error: true`: "
            "`fail_ci_if_error: false` does not contain an action crash"
        )
