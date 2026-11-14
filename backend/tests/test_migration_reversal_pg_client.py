"""Pins how `migration-reversal.yml` provides the PostgreSQL client its jobs need.

`Migration Reversal Tested` (job `tested`) snapshots the schema with the
pg_dump of the job's `PG_MAJOR`, which must equal the major of the job's
`pgvector/pgvector:pg<N>` service; the reversibility step refuses any other
pg_dump. Its `Install postgresql-client` step (`id: apt_psql`) skipped apt
whenever the hosted image already carried that client, and the ubuntu-24.04
image does. `ubuntu-latest` is moving to Ubuntu 26.04 'resolute' (a rollout
begun 2026-10-19), which ships PostgreSQL 18 only, and resolute's own archive
has no postgresql-client-16. So a PR adding a migration read red on a resolute
runner -- the step found no install candidate and the reversibility step had no
pg_dump (qontinui-web run 43045724287, PR #2207) -- while its head-identity
conditions passed; the reversal never ran. The step now uses a live PGDG entry
for the image's codename, or else writes one signed by the key resolute's
`postgresql-client-common` ships, and installs the versioned client from it
(plan 2026-11-11-migration-reversal-pgdg-client-for-resolute).

Two kinds of pin, both read from the SHIPPED workflow rather than a copy:

* structural (T1-T3): each postgres-service job names its major once, equal to
  its service tag, and feeds it to the self-hosted provisioning check; the
  `tested` step keeps its bound, takes its PGDG suite from the image's
  codename, writes that source before the update that precedes the versioned
  install, and installs no unversioned client; and no `apt_psql` step reaches
  the network except through apt;
* behavioural (T4): the `tested` body itself runs through every arm under
  GitHub's own shell invocation, with its absolute paths rewritten into a temp
  root and `sudo`, `apt-get`, `apt-cache` and `psql` stubbed. That the real
  hosted image takes the PGDG arm is proven by the plan's Phase 2 probe PR
  run, not here.

Every expected value below is spelled as a literal here: asserting against a
value the workflow itself defines would pin nothing.

This module reads only `migration-reversal.yml`, which is in Backend CI's
`paths:` filter (asserted by `test_ci_timeout_marker.py`
`test_backend_ci_triggers_on_every_workflow_this_module_reads`), so an edit to
that workflow alone still runs these tests.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "migration-reversal.yml"

PROVISIONED_STEP_NAME = "Self-hosted: host provisioned"
PG_SERVICE_IMAGE = re.compile(r"pgvector/pgvector:pg(\d+)")
ENV_PG_MAJOR = re.compile(r"\$\{\{\s*env\.PG_MAJOR\s*\}\}")
PGDG_KEY = "/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc"
PGDG_SOURCES = "/etc/apt/sources.list.d/pgdg.sources"
UNAVAILABLE_TITLE = "Migration Reversal Tested - client package unavailable"

# Tools that fetch from the network by a route other than apt's own.
NON_APT_NETWORK = re.compile(r"\b(?:curl|wget|gpg\d*|pip\d*|pipx|poetry)\b")
# Anchored to a command position: the step's own `::error` text says "after a
# successful 'apt-get update'", and an unanchored match counted that echo as the
# last update -- so a body that updated BEFORE writing the PGDG source passed.
APT_UPDATE = re.compile(r"^(?:sudo\s+)?apt-get\b.*\bupdate\b")
APT_INSTALL = re.compile(r"^(?:sudo\s+)?apt-get\b.*\binstall\b")
# `postgresql-client` as a whole package name: not `-common`, not `-16`.
UNVERSIONED_CLIENT = re.compile(r"(?<![\w-])postgresql-client(?![\w-])")


def _workflow() -> dict[str, Any]:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    assert isinstance(doc, dict) and isinstance(doc.get("jobs"), dict), (
        f"{WORKFLOW} did not parse as a workflow with a `jobs` mapping"
    )
    return doc


def _apt_psql_steps(doc: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Every `id: apt_psql` step in every job, as (job_id, step)."""
    return [
        (job_id, step)
        for job_id, job in doc["jobs"].items()
        for step in job.get("steps") or []
        if step.get("id") == "apt_psql"
    ]


def _tested_step() -> dict[str, Any]:
    steps = [
        step for job_id, step in _apt_psql_steps(_workflow()) if job_id == "tested"
    ]
    assert len(steps) == 1, (
        f"job `tested` carries {len(steps)} `id: apt_psql` steps; expected exactly "
        "one -- 'Name an unavailable postgresql client' reads that id's output"
    )
    return steps[0]


def _logical_lines(body: str) -> list[str]:
    """The body's shell lines, backslash continuations joined, stripped."""
    joined = body.replace("\\\n", " ")
    return [line.strip() for line in joined.splitlines() if line.strip()]


def _service_majors(job: dict[str, Any]) -> set[str]:
    majors = set()
    for service in (job.get("services") or {}).values():
        match = PG_SERVICE_IMAGE.fullmatch(str(service.get("image", "")))
        if match:
            majors.add(match.group(1))
    return majors


# --- structural pins ---------------------------------------------------------


def test_each_postgres_service_job_names_its_major_once_and_feeds_it_to_the_self_hosted_check():
    """T1. One named major per job, equal to its service tag, read by the self-hosted check.

    `services.*.image` cannot read the `env` context, so the tag is spelled
    literally and `PG_MAJOR` is spelled beside it; this keeps the two in step.
    `reverse` used to declare no `PG_MAJOR` and pass a literal `16` to the
    provisioning input, so a tag bump there could leave the self-hosted check
    requiring the old major.
    """
    checked = []
    for job_id, job in _workflow()["jobs"].items():
        majors = _service_majors(job)
        if not majors:
            continue
        assert len(majors) == 1, (
            f"job {job_id!r} runs pgvector services of majors {sorted(majors)}; "
            "one PG_MAJOR cannot name both"
        )
        (major,) = majors
        declared = (job.get("env") or {}).get("PG_MAJOR")
        assert declared is not None and str(declared) == major, (
            f"job {job_id!r} runs pgvector/pgvector:pg{major} but declares "
            f"env.PG_MAJOR={declared!r}. Declare `PG_MAJOR: '{major}'` in the "
            "job's `env:` -- the one place the job names its postgres major."
        )
        provisioned = [
            step
            for step in job.get("steps") or []
            if step.get("name") == PROVISIONED_STEP_NAME
        ]
        assert len(provisioned) == 1, (
            f"job {job_id!r} has {len(provisioned)} {PROVISIONED_STEP_NAME!r} "
            "steps; expected exactly one"
        )
        pg_major_input = str((provisioned[0].get("with") or {}).get("pg-major", ""))
        assert ENV_PG_MAJOR.fullmatch(pg_major_input.strip()), (
            f"job {job_id!r}: {PROVISIONED_STEP_NAME!r} passes pg-major "
            f"{pg_major_input!r}; it must read '${{{{ env.PG_MAJOR }}}}' so the "
            "self-hosted check requires the same major as the service"
        )
        checked.append(job_id)
    assert {"reverse", "tested"} <= set(checked), (
        f"only {checked} matched a pgvector/pgvector:pg<N> service; `reverse` and "
        "`tested` both run one, so the scan would have passed vacuously"
    )


def test_tested_install_step_installs_the_versioned_client_from_pgdg_for_the_image_codename():
    """T2. `tested`'s `apt_psql` adds PGDG for the image's codename, then installs the versioned client.

    On a resolute runner the guard misses, so this is the path such a run
    takes: the PGDG source has to be configured before the `apt-get update`
    that the versioned install relies on, or the install has no candidate --
    exactly the red this step used to produce.
    """
    step = _tested_step()
    timeout = step.get("timeout-minutes")
    assert isinstance(timeout, int) and not isinstance(timeout, bool), (
        f"`tested` apt_psql timeout-minutes is {timeout!r}; it must stay an integer "
        "bound -- the step reaches external mirrors at job time"
    )
    assert 0 < timeout <= 10, (
        f"`tested` apt_psql timeout-minutes is {timeout}; it must stay within 10"
    )

    body = step["run"]
    assert "/etc/os-release" in body and "VERSION_CODENAME" in body, (
        "the PGDG suite must come from the image's own VERSION_CODENAME in "
        "/etc/os-release, not from a hard-coded codename"
    )
    lines = _logical_lines(body)
    assert f"key={PGDG_KEY}" in lines, (
        f"the PGDG signing key must be {PGDG_KEY} (shipped by "
        "postgresql-client-common), so no fetch beyond apt is needed"
    )
    assert 'pkg="postgresql-client-$PG_MAJOR"' in lines, (
        "the package installed must be the versioned client of the job's PG_MAJOR"
    )

    writes = [i for i, line in enumerate(lines) if f"tee {PGDG_SOURCES}" in line]
    assert len(writes) == 1, (
        f"expected exactly one write of {PGDG_SOURCES}, found {len(writes)}"
    )
    source = lines[writes[0]]
    assert "Suites: ${codename}-pgdg" in source, (
        f"the {PGDG_SOURCES} write must name the suite `${{codename}}-pgdg`: {source}"
    )
    assert "Signed-By: $key" in source, (
        f"the {PGDG_SOURCES} write must be `Signed-By: $key`: {source}"
    )

    updates = [i for i, line in enumerate(lines) if APT_UPDATE.search(line)]
    installs = [
        i
        for i, line in enumerate(lines)
        if APT_INSTALL.search(line)
        and ('"$pkg"' in line or "postgresql-client-$PG_MAJOR" in line)
    ]
    assert updates and len(installs) == 1, (
        f"expected an `apt-get update` and one versioned install; found update "
        f"lines {updates} and versioned-install lines {installs}"
    )
    assert writes[0] < updates[-1] < installs[0], (
        f"order must be: write {PGDG_SOURCES} (line {writes[0]}), then the last "
        f"`apt-get update` (line {updates[-1]}), then the versioned install "
        f"(line {installs[0]}). Otherwise the install sees an index without PGDG."
    )

    unversioned = [
        line
        for line in lines
        if APT_INSTALL.search(line) and UNVERSIONED_CLIENT.search(line)
    ]
    assert not unversioned, (
        "`tested` must install the client of its PG_MAJOR, never the "
        f"distro-default unversioned `postgresql-client`: {unversioned}"
    )


def test_no_apt_psql_step_reaches_the_network_except_through_apt():
    """T3. Only apt reaches the network from an `apt_psql` step.

    The PGDG key is the file resolute's `postgresql-client-common` ships, so no
    step needs curl, wget, gpg or a Python installer. The step's bound and the
    timeout explainer's "a failure here is the apt mirror" both rest on that.
    """
    steps = _apt_psql_steps(_workflow())
    assert {job_id for job_id, _ in steps} >= {"reverse", "tested"}, (
        f"expected `id: apt_psql` steps in `reverse` and `tested`, found "
        f"{[job_id for job_id, _ in steps]}; the scan would pass vacuously"
    )
    for job_id, step in steps:
        found = sorted(set(NON_APT_NETWORK.findall(step["run"])))
        assert not found, (
            f"job {job_id!r} apt_psql calls {found}: only apt may reach the "
            "network from this step"
        )


# --- behavioural pins: the shipped `tested` body, run through each arm --------

BASH = shutil.which("bash")

requires_bash = pytest.mark.skipif(
    BASH is None,
    reason=(
        "the step is bash and there is no bash here, so the arm matrix cannot "
        "run (it always runs on the ubuntu CI runner)"
    ),
)

# The absolute paths the body reads or writes, each rewritten into a per-test
# root. Any other absolute path in the body (bar /dev/null) fails the harness
# closed, so a new system path can never reach the real filesystem unrooted.
ROOTED_PREFIXES = (
    "/etc/os-release",
    "/etc/apt/",
    "/usr/share/postgresql-common/pgdg/",
    "/usr/lib/postgresql/",
)
_PATH_START = r"(?<![\w./-])"
ABSOLUTE_PATH = re.compile(_PATH_START + r"/[\w.+-]+(?:/[\w.+$-]*)*")
ROOTED_PATH = re.compile(
    _PATH_START + "(" + "|".join(re.escape(p) for p in ROOTED_PREFIXES) + ")"
)

RESOLUTE_OS_RELEASE = (
    'NAME="Ubuntu"\nVERSION_ID="26.04"\nVERSION_CODENAME=resolute\nID=ubuntu\n'
)
# The image's own archive, as a deb822 source -- present on every run, and
# deliberately NOT a PGDG source.
UBUNTU_SOURCES = (
    "Types: deb\n"
    "URIs: http://azure.archive.ubuntu.com/ubuntu/\n"
    "Suites: resolute resolute-updates resolute-backports\n"
    "Components: main universe restricted multiverse\n"
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
)
PGDG_CANDIDATE = "16.15-1.pgdg26.04+2"

# Each stub appends one line per call to $STUB_LOG and never reads stdin.
# `sudo` runs its command unprivileged, so `sudo tee` writes into the root.
STUBS = {
    "sudo": r"""#!/usr/bin/env bash
printf 'sudo %s\n' "$*" >> "$STUB_LOG"
exec "$@"
""",
    # Records whether pgdg.sources existed when it ran, so the order of the
    # source write and each `update` is observed rather than inferred.
    # Installing postgresql-client-common drops the key, as resolute's
    # 290ubuntu1 does -- unless STUB_COMMON_DROPS_KEY=0, as noble's 257build1
    # (which ships no pgdg/ directory at all).
    "apt-get": r"""#!/usr/bin/env bash
sources="$STUB_ROOT/etc/apt/sources.list.d/pgdg.sources"
if [ -e "$sources" ]; then state=present; else state=absent; fi
printf 'apt-get %s | pgdg.sources %s\n' "$*" "$state" >> "$STUB_LOG"
case "${1:-}" in
  update) exit "${STUB_UPDATE_EXIT:-0}" ;;
  install)
    for arg in "$@"; do
      if [ "$arg" = postgresql-client-common ] && [ "${STUB_COMMON_DROPS_KEY:-1}" = 1 ]; then
        mkdir -p "$STUB_ROOT/usr/share/postgresql-common/pgdg"
        printf 'stub key\n' > "$STUB_ROOT/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc"
      fi
    done
    ;;
esac
exit 0
""",
    # Unset STUB_CANDIDATE: a package apt has never heard of (no output).
    "apt-cache": r"""#!/usr/bin/env bash
printf 'apt-cache %s\n' "$*" >> "$STUB_LOG"
if [ "${1:-}" = policy ] && [ "${STUB_CANDIDATE+set}" = set ]; then
  printf '%s:\n  Installed: (none)\n  Candidate: %s\n  Version table:\n' "${2:-}" "$STUB_CANDIDATE"
fi
exit 0
""",
    # Present, as on the resolute image, which ships psql 18.
    "psql": r"""#!/usr/bin/env bash
printf 'psql %s\n' "$*" >> "$STUB_LOG"
exit 0
""",
}


def _rooted(body: str, root: Path) -> str:
    """The body with every absolute path it touches moved under `root`."""
    stray = sorted(
        {
            path
            for path in ABSOLUTE_PATH.findall(body)
            if path != "/dev/null" and not path.startswith(ROOTED_PREFIXES)
        }
    )
    assert not stray, (
        f"the `tested` apt_psql body names absolute paths this harness does not "
        f"root: {stray}. Add them to ROOTED_PREFIXES -- run unrooted, they would "
        "touch the real filesystem."
    )
    return ROOTED_PATH.sub(lambda match: f"{root}{match.group(1)}", body)


@dataclass
class AptPsqlRun:
    returncode: int
    stdout: str
    stderr: str
    calls: list[str]
    output: str
    root: Path

    @property
    def pgdg_sources(self) -> Path:
        return self.root / PGDG_SOURCES.lstrip("/")

    @property
    def key(self) -> Path:
        return self.root / PGDG_KEY.lstrip("/")

    def explain(self) -> str:
        return (
            f"exit {self.returncode}\ncalls:\n"
            + "\n".join(self.calls)
            + f"\nstdout:\n{self.stdout}\nstderr:\n{self.stderr}"
        )


def _shell_overrides() -> list[str]:
    """Every `shell:` that would change how GitHub runs the `tested` apt_psql body."""
    doc = _workflow()
    job = doc["jobs"]["tested"]
    scopes = (
        ("workflow defaults.run", (doc.get("defaults") or {}).get("run") or {}),
        ("job `tested` defaults.run", (job.get("defaults") or {}).get("run") or {}),
        ("step apt_psql", _tested_step()),
    )
    return [
        f"{where}: shell={block['shell']!r}"
        for where, block in scopes
        if "shell" in block
    ]


def _run_apt_psql(
    tmp_path: Path,
    *,
    os_release: str | None = RESOLUTE_OS_RELEASE,
    key_present: bool = True,
    common_drops_key: bool = True,
    pg_dump_present: bool = False,
    existing_source: tuple[str, str] | None = None,
    candidate: str | None = PGDG_CANDIDATE,
    update_exit: int = 0,
) -> AptPsqlRun:
    """Run the shipped `tested` apt_psql body, the way GitHub runs this `run:` step.

    This workflow sets no `shell:`, so GitHub runs `bash -e {0}`, `{0}` being
    a script FILE; the body sets `-euo pipefail` itself. Modelled on
    `test_ci_timeout_marker.py`'s `_exec`, with one deliberate difference: the
    script is a file here, not stdin (`-s`), because this body pipes into
    `sudo tee`, and a stub that read stdin under `-s` would silently eat the
    rest of the script.
    """
    assert BASH is not None
    overrides = _shell_overrides()
    assert not overrides, (
        "this harness runs the body as GitHub runs a step with no `shell:` "
        f"(`bash -e {{0}}`), but the workflow now sets one: {overrides}. Match "
        "the invocation below to it."
    )
    root = tmp_path / "root"
    # The rewritten body names the root unquoted (`. <root>/etc/os-release`, a
    # `for` over `<root>/etc/apt/...` globs), so a root that needs quoting
    # would test word-splitting instead of the step.
    assert re.fullmatch(r"[\w./-]+", str(root)), (
        f"temp root {root} needs shell quoting; run pytest with a plain --basetemp"
    )
    (root / "etc/apt/sources.list.d").mkdir(parents=True)
    (root / "etc/apt/sources.list.d/ubuntu.sources").write_text(
        UBUNTU_SOURCES, encoding="utf-8"
    )
    if os_release is not None:
        (root / "etc/os-release").write_text(os_release, encoding="utf-8")
    if key_present:
        key = root / PGDG_KEY.lstrip("/")
        key.parent.mkdir(parents=True)
        key.write_text("stub key\n", encoding="utf-8")
    if pg_dump_present:
        pg_dump = root / "usr/lib/postgresql/16/bin/pg_dump"
        pg_dump.parent.mkdir(parents=True)
        pg_dump.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        pg_dump.chmod(0o755)
    if existing_source is not None:
        relative, content = existing_source
        (root / relative).write_text(content, encoding="utf-8")

    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir()
    for name, text in STUBS.items():
        stub = stub_dir / name
        stub.write_text(text, encoding="utf-8", newline="\n")
        stub.chmod(0o755)

    log = tmp_path / "calls.log"
    log.touch()
    github_output = tmp_path / "github_output"
    script = tmp_path / "apt_psql.sh"
    script.write_text(
        _rooted(_tested_step()["run"], root), encoding="utf-8", newline="\n"
    )
    env = {
        "PATH": f"{stub_dir}:/usr/bin:/bin",
        "PG_MAJOR": "16",
        "GITHUB_OUTPUT": str(github_output),
        "STUB_LOG": str(log),
        "STUB_ROOT": str(root),
        "STUB_UPDATE_EXIT": str(update_exit),
        "STUB_COMMON_DROPS_KEY": "1" if common_drops_key else "0",
    }
    if candidate is not None:
        env["STUB_CANDIDATE"] = candidate
    proc = subprocess.run(
        [BASH, "-e", str(script)],
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    return AptPsqlRun(
        returncode=proc.returncode,
        stdout=proc.stdout,
        stderr=proc.stderr,
        calls=log.read_text(encoding="utf-8").splitlines(),
        output=github_output.read_text(encoding="utf-8")
        if github_output.exists()
        else "",
        root=root,
    )


def _pgdg_source_text(run: AptPsqlRun) -> str:
    return (
        "Types: deb\n"
        "URIs: https://apt.postgresql.org/pub/repos/apt\n"
        "Suites: resolute-pgdg\n"
        "Components: main\n"
        f"Signed-By: {run.root}/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc\n"
    )


@requires_bash
def test_apt_psql_with_the_client_already_present_runs_no_apt(tmp_path):
    """T4, guard hit: psql and the major-16 pg_dump are there (the 24.04 image)."""
    run = _run_apt_psql(tmp_path, pg_dump_present=True)
    assert run.returncode == 0, run.explain()
    assert "no apt needed" in run.stdout, run.explain()
    assert run.calls == [], run.explain()
    assert not run.pgdg_sources.exists(), run.explain()
    assert "unavailable" not in run.output, run.explain()


@requires_bash
def test_apt_psql_installs_the_versioned_client_from_pgdg_after_the_last_update(
    tmp_path,
):
    """T4, success: the resolute image, key present, no PGDG source yet.

    Writes the deb822 source for `resolute-pgdg` signed by the shipped key, and
    installs postgresql-client-16 only after an update that saw that source.
    Every apt-get runs under sudo, and nothing installs postgresql-client-common
    when its key is already there (an inverted key test would).
    """
    run = _run_apt_psql(tmp_path)
    assert run.returncode == 0, run.explain()
    assert run.pgdg_sources.read_text(encoding="utf-8") == _pgdg_source_text(run)
    assert run.calls == [
        f"sudo tee {run.root}/etc/apt/sources.list.d/pgdg.sources",
        "sudo apt-get update",
        "apt-get update | pgdg.sources present",
        "apt-cache policy postgresql-client-16",
        "sudo apt-get install -y postgresql-client-16",
        "apt-get install -y postgresql-client-16 | pgdg.sources present",
    ], run.explain()
    assert "unavailable" not in run.output, run.explain()


@requires_bash
def test_apt_psql_without_the_key_installs_postgresql_client_common_first(tmp_path):
    """T4, key absent: an image with no psql at all.

    The key comes from postgresql-client-common out of the runner's own
    sources (resolute's 290ubuntu1 ships it), BEFORE the PGDG source that
    names it is written; otherwise that source's Signed-By names a file that
    does not exist.
    """
    run = _run_apt_psql(tmp_path, key_present=False)
    assert run.returncode == 0, run.explain()
    assert run.calls == [
        "sudo apt-get update",
        "apt-get update | pgdg.sources absent",
        "sudo apt-get install -y postgresql-client-common",
        "apt-get install -y postgresql-client-common | pgdg.sources absent",
        f"sudo tee {run.root}/etc/apt/sources.list.d/pgdg.sources",
        "sudo apt-get update",
        "apt-get update | pgdg.sources present",
        "apt-cache policy postgresql-client-16",
        "sudo apt-get install -y postgresql-client-16",
        "apt-get install -y postgresql-client-16 | pgdg.sources present",
    ], run.explain()
    assert run.key.is_file(), run.explain()
    assert run.pgdg_sources.read_text(encoding="utf-8") == _pgdg_source_text(run)


def _pgdg_one_line(suite: str) -> str:
    return (
        "deb [signed-by=/usr/share/keyrings/postgresql.gpg] "
        f"https://apt.postgresql.org/pub/repos/apt {suite} main\n"
    )


def _pgdg_deb822(suite: str) -> str:
    return (
        "Types: deb\n"
        "URIs: https://apt.postgresql.org/pub/repos/apt\n"
        f"Suites: {suite}\n"
        "Components: main\n"
        "Signed-By: /usr/share/keyrings/postgresql.gpg\n"
    )


@requires_bash
@pytest.mark.parametrize(
    ("relative", "content"),
    [
        ("etc/apt/sources.list", _pgdg_one_line("resolute-pgdg")),
        ("etc/apt/sources.list.d/postgresql.list", _pgdg_one_line("resolute-pgdg")),
        ("etc/apt/sources.list.d/postgresql.sources", _pgdg_deb822("resolute-pgdg")),
        (
            "etc/apt/sources.list.d/postgresql.sources",
            _pgdg_deb822("resolute-pgdg") + "Enabled: yes\n",
        ),
    ],
    ids=[
        "one-line-in-sources-list",
        "one-line-in-sources-list-d",
        "deb822",
        "deb822-enabled-yes",
    ],
)
def test_apt_psql_uses_a_live_pgdg_entry_for_the_codename_suite_as_configured(
    tmp_path, relative, content
):
    """T4, a live PGDG entry for `resolute-pgdg` already exists: write nothing.

    A second entry for the same suite with another Signed-By breaks every
    `apt-get update`, so the step adds nothing and installs from what is there.
    In deb822 the suite sits on its own `Suites:` line, so the match is per
    file, not per line. An explicit `Enabled: yes` is still live.
    """
    run = _run_apt_psql(tmp_path, existing_source=(relative, content))
    assert run.returncode == 0, run.explain()
    assert (
        f"{run.root}/{relative} already names apt.postgresql.org and "
        "'resolute-pgdg'; using it as configured." in run.stdout
    ), run.explain()
    assert not run.pgdg_sources.exists(), run.explain()
    assert (run.root / relative).read_text(encoding="utf-8") == content
    assert run.calls == [
        "sudo apt-get update",
        "apt-get update | pgdg.sources absent",
        "apt-cache policy postgresql-client-16",
        "sudo apt-get install -y postgresql-client-16",
        "apt-get install -y postgresql-client-16 | pgdg.sources absent",
    ], run.explain()


@requires_bash
@pytest.mark.parametrize(
    ("relative", "content"),
    [
        ("etc/apt/sources.list", "# " + _pgdg_one_line("resolute-pgdg")),
        (
            "etc/apt/sources.list.d/postgresql.list",
            "# " + _pgdg_one_line("resolute-pgdg"),
        ),
        ("etc/apt/sources.list.d/postgresql.list", _pgdg_one_line("noble-pgdg")),
        ("etc/apt/sources.list.d/postgresql.sources", _pgdg_deb822("noble-pgdg")),
        # apt reads only *.list and *.sources under sources.list.d.
        (
            "etc/apt/sources.list.d/postgresql.list.save",
            _pgdg_one_line("resolute-pgdg"),
        ),
    ],
    ids=[
        "commented-out-in-sources-list",
        "commented-out-in-sources-list-d",
        "other-suite",
        "deb822-other-suite",
        "not-a-source-file",
    ],
)
def test_apt_psql_writes_its_own_source_when_no_live_entry_names_the_codename_suite(
    tmp_path, relative, content
):
    """T4, apt.postgresql.org appears, but not as a live entry for `resolute-pgdg`.

    A commented-out line, another codename's suite, or a file apt never reads
    configures nothing for this image, so the step writes its own pgdg.sources
    and leaves that file alone.
    """
    run = _run_apt_psql(tmp_path, existing_source=(relative, content))
    assert run.returncode == 0, run.explain()
    assert "already names apt.postgresql.org" not in run.stdout, run.explain()
    assert run.pgdg_sources.read_text(encoding="utf-8") == _pgdg_source_text(run)
    assert (run.root / relative).read_text(encoding="utf-8") == content
    assert run.calls == [
        f"sudo tee {run.root}/etc/apt/sources.list.d/pgdg.sources",
        "sudo apt-get update",
        "apt-get update | pgdg.sources present",
        "apt-cache policy postgresql-client-16",
        "sudo apt-get install -y postgresql-client-16",
        "apt-get install -y postgresql-client-16 | pgdg.sources present",
    ], run.explain()


@requires_bash
def test_apt_psql_uses_a_live_entry_without_acquiring_the_pgdg_key(tmp_path):
    """T4, a live `resolute-pgdg` entry, no key, and a package that ships none.

    The key signs only the source this step writes, so it is acquired only on
    that branch. An image that already carries a live PGDG entry -- signed by
    its own keyring -- must install from it even where postgresql-client-common
    ships no key (noble's 257build1), not report the client unavailable.
    """
    relative = "etc/apt/sources.list.d/postgresql.list"
    content = _pgdg_one_line("resolute-pgdg")
    run = _run_apt_psql(
        tmp_path,
        key_present=False,
        common_drops_key=False,
        existing_source=(relative, content),
    )
    assert run.returncode == 0, run.explain()
    assert "unavailable" not in run.output, run.explain()
    assert (
        f"{run.root}/{relative} already names apt.postgresql.org and "
        "'resolute-pgdg'; using it as configured." in run.stdout
    ), run.explain()
    assert not run.pgdg_sources.exists(), run.explain()
    assert not run.key.exists(), run.explain()
    assert run.calls == [
        "sudo apt-get update",
        "apt-get update | pgdg.sources absent",
        "apt-cache policy postgresql-client-16",
        "sudo apt-get install -y postgresql-client-16",
        "apt-get install -y postgresql-client-16 | pgdg.sources absent",
    ], run.explain()


@requires_bash
@pytest.mark.parametrize(
    "enabled", ["Enabled: no", "enabled: False"], ids=["no", "false-any-case"]
)
def test_apt_psql_does_not_count_a_disabled_deb822_stanza_as_configured(
    tmp_path, enabled
):
    """T4, a deb822 `resolute-pgdg` stanza that says `Enabled: no|false`.

    apt skips a disabled stanza (field name and boolean are case-insensitive),
    so it configures nothing for this image: the step writes its own
    pgdg.sources and leaves the disabled file alone.
    """
    relative = "etc/apt/sources.list.d/postgresql.sources"
    content = _pgdg_deb822("resolute-pgdg") + enabled + "\n"
    run = _run_apt_psql(tmp_path, existing_source=(relative, content))
    assert run.returncode == 0, run.explain()
    assert "already names apt.postgresql.org" not in run.stdout, run.explain()
    assert run.pgdg_sources.read_text(encoding="utf-8") == _pgdg_source_text(run)
    assert (run.root / relative).read_text(encoding="utf-8") == content
    assert run.calls == [
        f"sudo tee {run.root}/etc/apt/sources.list.d/pgdg.sources",
        "sudo apt-get update",
        "apt-get update | pgdg.sources present",
        "apt-cache policy postgresql-client-16",
        "sudo apt-get install -y postgresql-client-16",
        "apt-get install -y postgresql-client-16 | pgdg.sources present",
    ], run.explain()


@requires_bash
def test_apt_psql_reports_the_client_unavailable_when_no_package_ships_the_key(
    tmp_path,
):
    """T4, the step must write its own source, and no package ships the key.

    noble's 257build1 ships no PGDG key, so the key is still missing after
    installing postgresql-client-common. A source whose Signed-By names a
    missing file fails `apt-get update`, which would read as a mirror stall, so
    the step names the missing key, sets `unavailable=1` and exits 0 instead.
    """
    run = _run_apt_psql(tmp_path, key_present=False, common_drops_key=False)
    assert run.returncode == 0, run.explain()
    assert "unavailable=1" in run.output.splitlines(), run.explain()
    errors = [
        line
        for line in run.stdout.splitlines()
        if line.startswith(f"::error title={UNAVAILABLE_TITLE}::")
    ]
    assert len(errors) == 1, run.explain()
    assert PGDG_KEY in errors[0], errors[0]
    assert "NOT an apt-mirror stall" in errors[0], errors[0]
    assert run.calls == [
        "sudo apt-get update",
        "apt-get update | pgdg.sources absent",
        "sudo apt-get install -y postgresql-client-common",
        "apt-get install -y postgresql-client-common | pgdg.sources absent",
    ], run.explain()
    assert not run.pgdg_sources.exists(), run.explain()


@requires_bash
@pytest.mark.parametrize(
    "candidate", ["(none)", None], ids=["candidate-none", "package-unknown"]
)
def test_apt_psql_with_no_candidate_names_the_package_and_exits_0(tmp_path, candidate):
    """T4, no candidate even with PGDG configured: `unavailable=1`, exit 0.

    Deterministic, not the mirror, so it must not conclude `failure`: the
    explainer would call it an apt stall, and a setup failure that is re-run
    would loop on it. "Name an unavailable postgresql client" reads the output.
    """
    run = _run_apt_psql(tmp_path, candidate=candidate)
    assert run.returncode == 0, run.explain()
    assert "unavailable=1" in run.output.splitlines(), run.explain()
    errors = [
        line
        for line in run.stdout.splitlines()
        if line.startswith(f"::error title={UNAVAILABLE_TITLE}::")
    ]
    assert len(errors) == 1, run.explain()
    assert "postgresql-client-16" in errors[0], errors[0]
    assert "resolute-pgdg" in errors[0], errors[0]
    assert "NOT an apt-mirror stall" in errors[0], errors[0]
    assert run.pgdg_sources.exists(), "PGDG must have been consulted first"
    assert not [call for call in run.calls if "install -y postgresql-client-16" in call]


@requires_bash
@pytest.mark.parametrize(
    "os_release",
    [
        None,
        'NAME="Ubuntu"\nID=ubuntu\n',
        'NAME="Ubuntu"\nVERSION_CODENAME=\nID=ubuntu\n',
    ],
    ids=["no-os-release", "no-codename-key", "empty-codename"],
)
def test_apt_psql_with_no_codename_names_the_cause_and_exits_0(tmp_path, os_release):
    """T4, no VERSION_CODENAME: no PGDG suite can be named; `unavailable=1`, exit 0, no apt."""
    run = _run_apt_psql(tmp_path, os_release=os_release)
    assert run.returncode == 0, run.explain()
    assert "unavailable=1" in run.output.splitlines(), run.explain()
    errors = [
        line
        for line in run.stdout.splitlines()
        if line.startswith(f"::error title={UNAVAILABLE_TITLE}::")
    ]
    assert len(errors) == 1, run.explain()
    assert "VERSION_CODENAME" in errors[0], errors[0]
    assert run.calls == [], run.explain()
    assert not run.pgdg_sources.exists(), run.explain()


@requires_bash
def test_apt_psql_update_failure_fails_the_step_and_is_not_reported_unavailable(
    tmp_path,
):
    """T4, `apt-get update` fails: the step fails, so the explainer's apt arm owns it.

    The step only reports `unavailable` for a cause it observed itself. A
    mirror or PGDG failure stays a `failure` of this step -- and so does one
    deterministic cause: a codename PGDG does not serve, whose missing Release
    file makes `apt-get update` exit 100.
    """
    run = _run_apt_psql(tmp_path, update_exit=100)
    assert run.returncode != 0, run.explain()
    assert "unavailable" not in run.output, run.explain()
    assert not [call for call in run.calls if "install -y postgresql-client-16" in call]
