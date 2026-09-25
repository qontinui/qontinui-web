"""Arm-by-arm tests for secret-scan.yml's gitleaks download guard.

The "Run gitleaks" step downloads a pinned gitleaks release, extracts it, and
scans the diff. Before this guard existed, `curl ... | tar -xz gitleaks`
reported TAR's exit status, so a failed download surfaced as
"gzip: stdin: unexpected end of file" -- indistinguishable from a corrupt
release. The fix (see the step's own comments) downloads to a file with `-f`,
checks curl's own exit code, checks tar's extraction separately, and checks
the extracted binary is executable -- each with a distinct `::error::` so the
red check says which infrastructure failure it was, never "secrets found".

The PR that shipped this ("ci(secret-scan): make a failed gitleaks download
say so, instead of dying at tar") verified all four arms by hand, against the
block extracted from the workflow file itself, under `bash -e` -- but that
verification left no trace after merge. Per this repo's own stated philosophy
(see pre-commit-hook-tests.yml: "a test that never runs cannot fail"), an
edit that quietly reintroduces the unguarded pipe, or drops one of the three
checks, would go green with nothing to catch it. These tests run the SHIPPED
`run:` body -- extracted from the workflow YAML, not a copy pasted in here --
against a stubbed `curl`, covering all three guarded failure modes plus the
control, and add a fourth failure mode (extracted-but-not-executable) that
the PR's own four-arm table did not enumerate even though the step guards it.
"""

from __future__ import annotations

import io
import re
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"

STEP_NAME = "Run gitleaks (binary — the marketplace action requires a paid org license)"

GL_VERSION = "8.30.1"

ERR_DOWNLOAD_FAILED = f"Could not download gitleaks v{GL_VERSION}"
ERR_BAD_TARBALL = (
    f"The file served for gitleaks v{GL_VERSION} is not a usable gitleaks tarball"
)
ERR_NOT_EXECUTABLE = f"Extracted gitleaks v{GL_VERSION} but it is not executable"

bash = shutil.which("bash")

requires_bash = pytest.mark.skipif(
    not bash,
    reason="the guard is a bash `run:` body; this always runs on the ubuntu CI runner",
)


def _gitleaks_step_body() -> str:
    doc = yaml.safe_load((WORKFLOWS / "secret-scan.yml").read_text(encoding="utf-8"))
    for step in doc["jobs"]["gitleaks"]["steps"]:
        if step.get("name") == STEP_NAME:
            return step["run"]
    raise AssertionError(
        f"secret-scan.yml has no step named {STEP_NAME!r} -- did it get renamed?"
    )


def _detemplate(script: str) -> str:
    """Stand in for GitHub's own `${{ }}` substitution.

    GitHub replaces every `${{ ... }}` expression with its literal value
    BEFORE handing the body to bash -- `${{ ... }}` is not valid bash syntax
    (bash would raise "bad substitution" trying to parse it as a parameter
    expansion). This step inlines `github.token` and the base/head SHA range
    directly rather than routing them through `env:`, so the harness has to
    do the same substitution GitHub would, or the body under test would not
    parse at all -- not even on the arms these tokens are irrelevant to.
    """
    return re.sub(r"\$\{\{[^}]*\}\}", "TEST_TEMPLATE_VALUE", script)


def _build_tarball(dest: Path, *, executable: bool) -> Path:
    """A real gzip tarball with one member named `gitleaks`.

    `tar -xzf ... gitleaks` extracts that specific member, so the fixture
    must be a genuine tar.gz -- a fake bash `curl` can fake the network, but
    it cannot fake tar's own decoding.
    """
    payload = b"#!/bin/sh\nexit 0\n"
    tarball = dest / "gitleaks.tar.gz"
    with tarfile.open(tarball, "w:gz") as tf:
        info = tarfile.TarInfo(name="gitleaks")
        info.size = len(payload)
        info.mode = 0o755 if executable else 0o644
        tf.addfile(info, io.BytesIO(payload))
    return tarball


def _exec_bit_is_honored() -> bool:
    """Whether extracting a 0o644 tar member yields a file `[ -x ]` rejects.

    This has to replicate the ACTUAL extraction path -- `tar -xzf` via
    whatever `tar` this shell resolves -- not just a plain `chmod`. Measured
    on Windows/git-bash: a plain `chmod 0o644` file correctly reads as
    non-executable, but the SAME mode carried on a tar member does not
    survive that `tar`'s extraction, so probing chmod alone would give a
    false "honored" and let `test_extracted_but_not_executable...` fail here
    for a platform reason unrelated to the guard it is testing. Real CI runs
    on ubuntu-latest, where the mode always survives extraction; only the
    local dev-box arm needs this gate.
    """
    if not bash:
        return False
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        workdir = tmp / "work"
        workdir.mkdir()
        # Built directly in workdir and referenced by its RELATIVE name below:
        # MSYS tar parses an absolute `C:\...` path's drive-letter colon as an
        # `rsh`-style "host:path" remote-archive spec ("Cannot connect to C:
        # resolve failed"), which the real harness never hits because its
        # tarball is likewise always a same-directory relative filename.
        _build_tarball(workdir, executable=False)
        proc = subprocess.run(
            [bash, "-c", "tar -xzf gitleaks.tar.gz gitleaks && [ -x ./gitleaks ]"],
            cwd=workdir,
        )
        return proc.returncode != 0


requires_honored_exec_bit = pytest.mark.skipif(
    not _exec_bit_is_honored(),
    reason=(
        "this platform's `tar` does not preserve a non-executable mode bit "
        "through extraction (seen on MSYS/git-bash tar on Windows); ubuntu "
        "CI always preserves it"
    ),
)


def _write_curl_stub(bin_dir: Path, scenario: str, tarball: Path | None) -> None:
    """A fake `curl` that answers both calls this step makes.

    The version-resolution call (to api.github.com) always succeeds, pinned
    to GL_VERSION, so every scenario exercises the same download URL. The
    download call's behaviour is baked in per scenario -- mirroring
    test_ci_timeout_marker.py's stubbed `gh`, rather than reading an env var
    inside a generic script, so each scenario's fixture is self-contained.
    """
    curl = bin_dir / "curl"
    lines = [
        "#!/usr/bin/env bash",
        'for a in "$@"; do',
        '  case "$a" in',
        f'    *api.github.com*) echo \'{{"tag_name": "v{GL_VERSION}"}}\'; exit 0 ;;',
        "  esac",
        "done",
        'out=""',
        'prev=""',
        'for a in "$@"; do',
        '  if [ "$prev" = "-o" ]; then out="$a"; fi',
        '  prev="$a"',
        "done",
    ]
    if scenario == "download_refused":
        # curl's own connection-refused exit code; no file is written, so this
        # arm also proves the guard does not depend on a file existing.
        lines.append("exit 7")
    elif scenario == "html_error_page":
        # HTTP 200 with an error PAGE body -- curl -f does not treat this as
        # a failure, since the status line was 2xx.
        lines.append("printf '<html><body>502 Bad Gateway</body></html>' > \"$out\"")
        lines.append("exit 0")
    elif scenario == "zero_byte":
        lines.append(': > "$out"')
        lines.append("exit 0")
    elif scenario in ("ok", "not_executable"):
        assert tarball is not None
        lines.append(f'cp "{tarball.as_posix()}" "$out"')
        lines.append("exit 0")
    else:
        raise ValueError(f"unknown scenario {scenario!r}")
    curl.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    curl.chmod(0o755)


def _run_step(tmp_path: Path, scenario: str) -> subprocess.CompletedProcess[str]:
    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir(exist_ok=True)
    workdir = tmp_path / "work"
    workdir.mkdir(exist_ok=True)

    tarball = None
    if scenario in ("ok", "not_executable"):
        tarball = _build_tarball(tmp_path, executable=(scenario == "ok"))
    _write_curl_stub(stub_dir, scenario, tarball)

    script = _detemplate(_gitleaks_step_body())
    return subprocess.run(
        # GitHub invokes multi-line `run:` bodies as
        # `bash --noprofile --norc -eo pipefail {0}` on ubuntu runners.
        [bash, "--noprofile", "--norc", "-eo", "pipefail", "-s"],
        input=script,
        cwd=workdir,
        env={"PATH": f"{stub_dir}:/usr/bin:/bin"},
        capture_output=True,
        text=True,
    )


@requires_bash
def test_step_exists_with_the_expected_name():
    """Fail loudly, not vacuously, if the step is ever renamed."""
    assert _gitleaks_step_body().strip()


@requires_bash
def test_control_a_real_tarball_reaches_the_scan(tmp_path):
    proc = _run_step(tmp_path, "ok")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert f"gitleaks v{GL_VERSION}" in proc.stdout
    assert "::error::" not in proc.stdout


@requires_bash
def test_download_refused_names_the_infrastructure_failure(tmp_path):
    proc = _run_step(tmp_path, "download_refused")
    assert proc.returncode == 1
    assert ERR_DOWNLOAD_FAILED in proc.stdout
    assert "NOT a leak finding" in proc.stdout
    assert ERR_BAD_TARBALL not in proc.stdout
    assert ERR_NOT_EXECUTABLE not in proc.stdout


@requires_bash
def test_html_error_page_is_reported_as_a_bad_tarball_not_a_download_failure(tmp_path):
    """THE REGRESSION CASE.

    curl exits 0 on this arm (HTTP 200), so only the extraction guard can
    catch it. Getting this wrong either regresses to the pre-fix silence
    (tar's own cryptic failure) or misattributes it as a download failure,
    which the step's own comments call out as a misdescription: nothing
    resembling gitleaks was ever downloaded.
    """
    proc = _run_step(tmp_path, "html_error_page")
    assert proc.returncode == 1
    assert ERR_BAD_TARBALL in proc.stdout
    assert ERR_DOWNLOAD_FAILED not in proc.stdout
    assert ERR_NOT_EXECUTABLE not in proc.stdout


@requires_bash
def test_zero_byte_body_is_reported_as_a_bad_tarball(tmp_path):
    proc = _run_step(tmp_path, "zero_byte")
    assert proc.returncode == 1
    assert ERR_BAD_TARBALL in proc.stdout
    assert ERR_DOWNLOAD_FAILED not in proc.stdout


@requires_bash
@requires_honored_exec_bit
def test_extracted_but_not_executable_is_its_own_distinct_failure(tmp_path):
    """The third guard, uncovered by the PR's own stated four-arm table.

    A tarball can extract cleanly and still not be usable -- e.g. a release
    asset built without the executable bit. That must not be folded into
    "not a usable tarball" (tar succeeded) or "download failed" (curl
    succeeded); it is a third, distinct infrastructure failure.
    """
    proc = _run_step(tmp_path, "not_executable")
    assert proc.returncode == 1
    assert ERR_NOT_EXECUTABLE in proc.stdout
    assert ERR_BAD_TARBALL not in proc.stdout
    assert ERR_DOWNLOAD_FAILED not in proc.stdout
