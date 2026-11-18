"""Tests for `.github/scripts/fetch-pinned-binary.sh` and the steps that run it.

Plan 2026-11-08-ci-tool-binaries-survive-a-github-release-cdn-outage. On
2026-11-08 the GitHub release CDN answered 504 for every asset for over an hour
and the trivy, zizmor and actionlint installs failed without the scan running.
The script resolves the pinned tarball from the runner's tool cache first and
checks the pinned sha256 on every path.

Pinned here:
- cache hit with a good sha256: no network at all;
- cache hit with a bad sha256: the entry is rejected, re-downloaded, replaced,
  and the bad bytes are never extracted;
- cache miss and a CDN 504: exit 75 with ONE annotation naming both sources,
  and no coord not-a-verdict phrase (the setup-death declarer is its one
  writer, so a second writer would write it twice for one death);
- a download that fails its pin is rejected, never extracted;
- the workflow steps run the script, keep the SETUP-row names, are not named
  with a prefix in coord's INFRA_STEP_PREFIXES, and no longer use setup-trivy.

A FAILING test never writes the script's raw `::error` line into the shard log:
every message built from its output is `defang`-ed (tests/setup_death_git.py).
"""

from __future__ import annotations

import hashlib
import io
import os
import platform
import shutil
import subprocess
import tarfile
from pathlib import Path

import pytest
import yaml

from tests.setup_death_git import defang

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / ".github" / "scripts" / "fetch-pinned-binary.sh"
BACKEND_CI = REPO_ROOT / ".github" / "workflows" / "backend-ci.yml"
WORKFLOW_LINT = REPO_ROOT / ".github" / "workflows" / "workflow-lint.yml"

PHRASE = "(not a verdict on this PR)"
# coord's bypass_policy.rs INFRA_STEP_PREFIXES: a failed step with one of these
# names is bypass-landable on merge-candidate CI. A scan that did not run must block.
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
requires_bash = pytest.mark.skipif(
    not bash or platform.machine().lower() not in {"x86_64", "amd64"},
    reason="the fetch script is an x86_64 bash script; CI runs it on Linux x86_64",
)

VERSION = "9.9.9"
CACHE_SUBDIR = Path("qontinui-pinned-binary") / "faketool" / VERSION


def _posix(p: Path) -> str:
    r"""`p` as bash sees it. GNU tar reads `C:\...` as a remote host, so on a
    Windows dev box (never on CI) the script's paths must be MSYS-style."""
    if os.name != "nt":
        return str(p)
    cyg = shutil.which("cygpath")
    out = subprocess.run([cyg, "-u", str(p)], capture_output=True, text=True)
    return out.stdout.strip() if cyg and out.returncode == 0 else p.as_posix()


def _tarball(dest: Path, payload: bytes = b"#!/bin/sh\nexit 0\n") -> Path:
    path = dest / "good.tgz"
    with tarfile.open(path, "w:gz") as tf:
        info = tarfile.TarInfo(name="faketool")
        info.size = len(payload)
        info.mode = 0o755
        tf.addfile(info, io.BytesIO(payload))
    return path


class Scenario:
    """One run of the script against a stubbed `curl` and a private tool cache."""

    def __init__(self, tmp_path: Path, curl_body: str) -> None:
        self.tmp = tmp_path
        self.good = _tarball(tmp_path)
        self.sha = hashlib.sha256(self.good.read_bytes()).hexdigest()
        self.cache = tmp_path / "cache"
        self.entry = self.cache / CACHE_SUBDIR / f"{self.sha}.tar.gz"
        self.calls = tmp_path / "curl-calls"
        stub = tmp_path / "stub"
        stub.mkdir()
        curl = stub / "curl"
        curl.write_text(
            "#!/usr/bin/env bash\n"
            f'echo called >> "{self.calls.as_posix()}"\n'
            'out=""; prev=""\n'
            'for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done\n'
            + curl_body.replace("GOOD", self.good.as_posix())
            + "\n",
            encoding="utf-8",
        )
        curl.chmod(0o755)
        (tmp_path / "rt").mkdir()
        self.github_output = tmp_path / "gho"
        self.github_output.write_text("")
        self.stub = stub

    def seed_cache(self, data: bytes) -> None:
        self.entry.parent.mkdir(parents=True)
        self.entry.write_bytes(data)

    def run(self) -> subprocess.CompletedProcess[str]:
        env = {
            **os.environ,
            "PATH": f"{self.stub}{os.pathsep}{os.environ['PATH']}",
            "RUNNER_TEMP": _posix(self.tmp / "rt"),
            "RUNNER_TOOL_CACHE": _posix(self.cache),
            "GITHUB_OUTPUT": _posix(self.github_output),
            "FPB_TOOL": "faketool",
            "FPB_VERSION": VERSION,
            "FPB_SHA256": self.sha,
            "FPB_URL": "https://example.invalid/faketool.tar.gz",
            "FPB_MEMBER": "faketool",
        }
        return subprocess.run(
            [bash, str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60
        )

    def curl_calls(self) -> int:
        return len(self.calls.read_text().split()) if self.calls.exists() else 0


GOOD_CDN = 'cp "GOOD" "$out"; printf 200'
CDN_504 = "printf 504; exit 22"
CDN_HTML = 'printf "<html>504</html>" > "$out"; printf 200'
NO_NETWORK = "exit 99"


def _msg(proc: subprocess.CompletedProcess[str]) -> str:
    # Defanged: on CI a failure message's lines reach the shard log unprefixed.
    return defang(proc.stdout + proc.stderr)


@requires_bash
def test_a_cache_hit_with_a_good_sha_makes_no_network_call(tmp_path: Path) -> None:
    s = Scenario(tmp_path, NO_NETWORK)
    s.seed_cache(s.good.read_bytes())
    proc = s.run()
    assert proc.returncode == 0, _msg(proc)
    assert s.curl_calls() == 0, "a verified cache hit must not touch the network"
    assert "host-cache hit" in proc.stdout
    line = s.github_output.read_text().strip()
    assert line.startswith("bin=")
    # Asked of bash: the path is MSYS-style on a Windows dev box.
    assert subprocess.run([bash, "-c", 'test -x "$1"', "_", line[4:]]).returncode == 0


@requires_bash
def test_a_cache_hit_with_a_bad_sha_is_redownloaded_and_replaced(
    tmp_path: Path,
) -> None:
    s = Scenario(tmp_path, GOOD_CDN)
    s.seed_cache(b"tampered: not the pinned tarball")
    proc = s.run()
    assert proc.returncode == 0, _msg(proc)
    assert s.curl_calls() == 1, "a tampered entry must be re-downloaded"
    assert hashlib.sha256(s.entry.read_bytes()).hexdigest() == s.sha
    assert "cache entry unusable" in proc.stdout


@requires_bash
def test_a_miss_and_a_cdn_504_exits_75_naming_both_sources(tmp_path: Path) -> None:
    s = Scenario(tmp_path, CDN_504)
    proc = s.run()
    assert proc.returncode == 75, _msg(proc)
    assert "faketool DID NOT RUN" in proc.stdout
    assert "host cache miss" in proc.stdout
    assert "HTTP 504" in proc.stdout
    assert PHRASE not in proc.stdout, "the declarer is the one writer of the phrase"
    assert s.github_output.read_text() == ""


@requires_bash
def test_a_tampered_cache_and_a_cdn_504_fails_and_runs_nothing(tmp_path: Path) -> None:
    s = Scenario(tmp_path, CDN_504)
    s.seed_cache(b"tampered: not the pinned tarball")
    proc = s.run()
    assert proc.returncode == 75, _msg(proc)
    assert "failing its sha256" in proc.stdout
    assert s.github_output.read_text() == ""


@requires_bash
def test_a_download_that_fails_the_pin_is_rejected(tmp_path: Path) -> None:
    s = Scenario(tmp_path, CDN_HTML)
    proc = s.run()
    assert proc.returncode == 75, _msg(proc)
    assert "does not match the pinned sha256" in proc.stdout
    assert not s.entry.exists(), "a download failing its pin must not fill the cache"
    assert s.github_output.read_text() == ""


@requires_bash
def test_a_good_download_fills_the_cache_for_the_next_run(tmp_path: Path) -> None:
    s = Scenario(tmp_path, GOOD_CDN)
    first = s.run()
    assert first.returncode == 0, _msg(first)
    assert s.entry.is_file()
    second = s.run()
    assert second.returncode == 0, _msg(second)
    assert s.curl_calls() == 1, "the second run must be served from the cache"


# ── the workflow steps that run the script ───────────────────────────────────


def _steps(path: Path, job: str) -> dict[str, dict]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    return {s["name"]: s for s in doc["jobs"][job]["steps"] if "name" in s}


def test_the_trivy_step_runs_the_script_with_a_pinned_sha() -> None:
    steps = _steps(BACKEND_CI, "security-scan")
    step = steps["Install Trivy"]
    assert "uses" not in step, "setup-trivy downloads with no sha256 pin"
    assert step["run"].strip() == "bash .github/scripts/fetch-pinned-binary.sh"
    env = step["env"]
    assert len(env["FPB_SHA256"]) == 64 and set(env["FPB_SHA256"]) <= set(
        "0123456789abcdef"
    )
    assert env["FPB_URL"].endswith(
        f"v{env['FPB_VERSION']}/trivy_{env['FPB_VERSION']}_Linux-64bit.tar.gz"
    )
    # trivy-action must scan with the version this step installs
    scan = steps["Run Trivy vulnerability scanner"]["with"]
    assert scan["version"] == "v" + env["FPB_VERSION"]
    assert scan["skip-setup-trivy"] is True
    # The job default `./backend` has no .github/scripts.
    assert step["working-directory"] == "${{ github.workspace }}"
    assert not [
        n
        for n, st in steps.items()
        if str(st.get("uses", "")).startswith("aquasecurity/setup-trivy")
    ]


def test_the_lint_install_step_runs_the_script_for_both_tools() -> None:
    step = _steps(WORKFLOW_LINT, "workflow-lint")[
        "Install zizmor and actionlint (pinned, sha256-verified, host-cached)"
    ]
    run = step["run"]
    assert run.count("bash .github/scripts/fetch-pinned-binary.sh") == 2
    assert "curl " not in run, "the download belongs to the script"
    assert "FPB_VERIFY_ARGS=-version" in run, "actionlint has no --version"


@pytest.mark.parametrize(
    ("path", "job", "name"),
    [
        (BACKEND_CI, "security-scan", "Install Trivy"),
        (
            WORKFLOW_LINT,
            "workflow-lint",
            "Install zizmor and actionlint (pinned, sha256-verified, host-cached)",
        ),
    ],
)
def test_the_install_step_is_not_bypass_eligible(
    path: Path, job: str, name: str
) -> None:
    assert not name.startswith(INFRA_STEP_PREFIXES), name
    assert name in _steps(path, job)
