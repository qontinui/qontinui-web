"""Tests for secret-scan.yml's gitleaks fetch and its outcome mapping.

The secret scan used to download gitleaks inside its scan step. A GitHub
release-CDN failure then read as a red secret gate (coord dossier
gitleaks-red-not-a-leak). The download now lives in
`.github/scripts/fetch-gitleaks.sh`, a byte-identical copy of the canonical,
tested script in qontinui-coord (plan
2026-11-09-gitleaks-release-cdn-504-reds-prs-and-blocks-the-merge-train). It
verifies the pinned sha256, keeps a per-runner cache, and on any failure prints
`::error title=Gitleaks DID NOT RUN (not a verdict on this PR)::` and exits 75.

These tests pin the shape this repo depends on:
- the workflow's fetch step checks the script against a sha256 pinned in the
  YAML, and that pin matches the script on disk, so a change to the script is
  also a change to the workflow file;
- the fetch step is not named with a prefix coord's INFRA_STEP_PREFIXES lists,
  which would make a failed fetch bypass-landable;
- the scan step runs with `--exit-code 3` and titles both of its outcomes;
- the script, run against a stubbed `curl`, exits 75 with the titled line on a
  refused download and on a served error page, and yields an executable binary
  on a good tarball.
"""

from __future__ import annotations

import hashlib
import io
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "secret-scan.yml"
SCRIPT = REPO_ROOT / ".github" / "scripts" / "fetch-gitleaks.sh"

FETCH_STEP = "Fetch gitleaks (pinned, sha256-verified, host-cached)"
RUN_STEP = "Run gitleaks"
TITLE = "::error title=Gitleaks DID NOT RUN (not a verdict on this PR)::"
# coord's bypass_policy.rs INFRA_STEP_PREFIXES: a failed step with one of these
# names is bypass-landable on merge-candidate CI. A secret scan must block.
INFRA_STEP_PREFIXES = (
    "Set up job",
    "Checkout",
    "Clone",
    "Configure AWS credentials",
    "Login to Amazon ECR",
    "Cache",
    "Set up ",
    "Setup ",
)

bash = shutil.which("bash")
requires_linux_bash = pytest.mark.skipif(
    not bash or sys.platform != "linux" or platform.machine() != "x86_64",
    reason="the fetch script is a linux_x64 bash script; CI runs it on Linux x86_64",
)


def _steps() -> dict[str, dict]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    return {s.get("name", ""): s for s in doc["jobs"]["gitleaks"]["steps"]}


def test_fetch_step_pins_the_script_it_runs() -> None:
    body = _steps()[FETCH_STEP]["run"]
    pinned = re.search(
        r'echo "([0-9a-f]{64})  \.github/scripts/fetch-gitleaks\.sh"', body
    )
    assert pinned, "the fetch step no longer pins fetch-gitleaks.sh by sha256"
    actual = hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
    assert pinned.group(1) == actual, (
        "fetch-gitleaks.sh changed without updating the pin in secret-scan.yml "
        f"(pinned {pinned.group(1)}, on disk {actual})"
    )
    assert "bash .github/scripts/fetch-gitleaks.sh" in body


def test_backend_ci_runs_on_changes_to_what_this_module_reads() -> None:
    """This module is a gate only on the changes that trigger backend-ci."""
    workflow = yaml.safe_load(
        (REPO_ROOT / ".github" / "workflows" / "backend-ci.yml").read_text(
            encoding="utf-8"
        )
    )
    triggers = workflow.get("on", workflow.get(True))
    for event in ("pull_request", "push"):
        paths = triggers[event]["paths"]
        for needed in (
            ".github/workflows/secret-scan.yml",
            ".github/scripts/fetch-gitleaks.sh",
        ):
            assert needed in paths, f"backend-ci {event} paths miss {needed}"


def test_no_gitleaks_step_is_bypass_eligible() -> None:
    for name in _steps():
        if "gitleaks" in name.lower():
            assert not name.startswith(INFRA_STEP_PREFIXES), name


def test_scan_step_uses_exit_code_3_and_titles_its_outcomes() -> None:
    step = _steps()[RUN_STEP]
    assert step["env"]["GITLEAKS"] == "${{ steps.gitleaks.outputs.bin }}"
    body = step["run"]
    assert "--exit-code 3" in body
    assert "::error title=Gitleaks found leaks::" in body
    assert "::error title=Gitleaks errored (exit $rc)::" in body
    assert "(not a verdict on this PR)" not in body, "a scan outcome IS a verdict"


def _tarball(dest: Path) -> Path:
    payload = b"#!/bin/sh\nexit 0\n"
    path = dest / "good.tgz"
    with tarfile.open(path, "w:gz") as tf:
        info = tarfile.TarInfo(name="gitleaks")
        info.size = len(payload)
        info.mode = 0o755
        tf.addfile(info, io.BytesIO(payload))
    return path


def _run(tmp_path: Path, scenario: str, sha: str) -> subprocess.CompletedProcess[str]:
    stub = tmp_path / "stub"
    stub.mkdir()
    curl = stub / "curl"
    body = {
        "refused": "exit 7",
        "html": 'printf "<html>504</html>" > "$out"',
        "ok": f'cp "{(tmp_path / "good.tgz").as_posix()}" "$out"',
    }[scenario]
    curl.write_text(
        "#!/usr/bin/env bash\n"
        'out=""; prev=""\n'
        'for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done\n'
        f"{body}\n",
        encoding="utf-8",
    )
    curl.chmod(0o755)
    (tmp_path / "rt").mkdir()
    out = tmp_path / "gho"
    out.write_text("")
    env = {
        **os.environ,
        "PATH": f"{stub}:{os.environ['PATH']}",
        "RUNNER_TEMP": str(tmp_path / "rt"),
        "RUNNER_TOOL_CACHE": str(tmp_path / "cache"),
        "GITHUB_OUTPUT": str(out),
        "GITLEAKS_VERSION": "8.30.1",
        "GITLEAKS_SHA256": sha,
    }
    return subprocess.run(
        [bash, str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
    )


@requires_linux_bash
@pytest.mark.parametrize("scenario", ["refused", "html"])
def test_a_failed_fetch_exits_75_with_the_no_verdict_title(
    tmp_path: Path, scenario: str
) -> None:
    sha = hashlib.sha256(_tarball(tmp_path).read_bytes()).hexdigest()
    proc = _run(tmp_path, scenario, sha)
    assert proc.returncode == 75, proc.stdout + proc.stderr
    assert TITLE in proc.stdout
    assert (tmp_path / "gho").read_text() == ""


@requires_linux_bash
def test_a_good_tarball_yields_an_executable_binary(tmp_path: Path) -> None:
    sha = hashlib.sha256(_tarball(tmp_path).read_bytes()).hexdigest()
    proc = _run(tmp_path, "ok", sha)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    line = (tmp_path / "gho").read_text().strip()
    assert line.startswith("bin=")
    assert os.access(line[len("bin=") :], os.X_OK)
