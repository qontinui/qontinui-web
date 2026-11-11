"""Real git repositories, and the shard-log hazard, for the setup-death tests.

Plan ``2026-11-11-web-setup-step-deaths-declare-not-a-verdict``. Two declarers
read a pull_request's own diff before they write the not-a-verdict phrase: the
per-job ``.github/scripts/declare-setup-death.sh`` (its ``compute_guard``) and
the aggregate ``scripts/ci/aggregate_setup_death.py`` (rule 5, a port of it).
Both read the same thing -- the FIRST parent of the merge commit
``GITHUB_SHA`` names, fetched when a depth-1 checkout lacks it, and
``git diff --no-renames`` from it -- so both are tested here against the same
real two-parent merge commits, depth-1 clones (``shallow_clone``), the
``blob:none`` sparse partial clone actions/checkout makes for the aggregate
(``partial_clone``) and stub ``git``:
``tests/test_declare_setup_death.py`` and ``tests/test_aggregate_setup_death.py``.

THE SHARD-LOG HAZARD. Both modules run inside a ``Run Tests`` shard, where the
Actions runner reads a workflow command in two forms (actions/runner
``ActionCommand``): ``TryParseV2`` reads a line that starts with ``::`` after
its leading whitespace is trimmed, and the legacy ``TryParse`` finds
``LEGACY_PREFIX`` (two ``#`` and a ``[``) at ANY column (``IndexOf``) and
reads the command up to the next ``]``. A printed
``::error title=... (not a verdict on this PR)::`` would itself declare that
shard's red not a verdict, and so would the legacy spelling anywhere in a
line, a repr or a ``--showlocals`` local included. So nothing here prints,
every subprocess's output is captured (``assert_prints_nothing`` is the AST
guard both modules run over themselves and over this file), every failure
message is ``defang``-ed, and ``run_pytest_probe`` / ``command_lines`` let a
module prove that even its FAILING run writes no workflow command.
"""

from __future__ import annotations

import ast
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

GIT = shutil.which("git")

#: backend/pytest.ini: the addopts every CI pytest run carries.
PYTEST_INI = Path(__file__).resolve().parents[1] / "pytest.ini"

#: The tree every PrRepo's base commit holds: each declarer's harness files,
#: plus application code and the frontend lockfile a PR may touch instead.
BASE_FILES = {
    ".github/workflows/backend-ci.yml": "name: Backend CI\n",
    ".github/workflows/e2e-tests.yml": "name: E2E Tests\n",
    ".github/workflows/migration-reversal.yml": "name: Migration Reversal\n",
    ".github/actions/self-hosted-host-provisioned/action.yml": "name: host\n",
    ".github/scripts/declare-setup-death.sh": "#!/usr/bin/env bash\n",
    "scripts/ci/aggregate_setup_death.py": "# the aggregate declarer\n",
    "scripts/ci/shard_headroom.py": "# the shard listing it imports\n",
    "backend/app/main.py": "print('base')\n",
    "frontend/package.json": "{}\n",
    "frontend/package-lock.json": "{}\n",
}


#: The legacy workflow-command prefix, which the runner's ``TryParse`` finds at
#: any column of a line. Spelled in two parts, so no source line here holds it
#: (``assert_prints_nothing`` refuses one that does).
LEGACY_PREFIX = "#" * 2 + "["


def defang(text: str) -> str:
    """``text`` made safe for a failure message: no line holds a command.

    Every ``::`` gains a space, so after leading whitespace no line can begin
    with ``::``; every ``LEGACY_PREFIX`` gains one between its two ``#``, so
    no column holds it. A needle holding no ``:`` and no ``#`` (a lone space
    aside) is in the defanged text exactly when it is in ``text``.
    """
    return text.replace("::", ": :").replace(LEGACY_PREFIX, "# #[")


def command_lines(text: str) -> list[str]:
    """Every line of ``text`` the Actions runner could parse as a workflow command.

    Both forms: a line that starts with ``::`` once the runner has trimmed
    its leading whitespace (``TrimStart``), and a line holding
    ``LEGACY_PREFIX`` at any column (``IndexOf``), whatever follows it.
    ``str.splitlines`` and ``str.lstrip`` split and strip a superset of what
    the runner does, and the prefix holds no line break, so this never misses
    one.
    """
    return [
        line
        for line in text.splitlines()
        if line.lstrip().startswith("::") or LEGACY_PREFIX in line
    ]


def base_env(home: Path) -> dict[str, str]:
    """A clean environment: nothing inherited from the CI job running the tests.

    A shard runs with GITHUB_EVENT_NAME, GITHUB_SHA and GITHUB_WORKSPACE of its
    OWN run in its environment; inheriting them would point a guard at the
    real checkout.
    """
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "LC_ALL": "C",
    }


def run_git(cwd: Path, *args: str, home: Path) -> str:
    """``git <args>`` in ``cwd``, which must succeed; returns its stdout."""
    assert GIT is not None
    proc = subprocess.run(
        [GIT, *args],
        cwd=cwd,
        env={
            **base_env(home),
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@example.invalid",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@example.invalid",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, defang(f"git {args}: {proc.stdout}{proc.stderr}")
    return proc.stdout.strip()


def git_version() -> tuple[int, ...]:
    """The local git's version, ``(2, 47, 3)`` say; ``()`` when unreadable."""
    if GIT is None:
        return ()
    proc = subprocess.run(
        [GIT, "--version"], capture_output=True, text=True, check=False
    )
    found = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", proc.stdout)
    if proc.returncode != 0 or not found:
        return ()
    return tuple(int(part) for part in found.groups() if part is not None)


class PrRepo:
    """A repo whose ``merge`` commit has ``base`` and a PR head as parents.

    ``changes`` maps a path to its new body, or to ``None`` to delete it.
    """

    def __init__(
        self,
        root: Path,
        home: Path,
        *,
        changes: dict[str, str | None],
        message: str = "Merge pr into main",
    ):
        self.root = root
        self.home = home
        root.mkdir(parents=True)
        run_git(root, "init", "-q", "-b", "main", ".", home=home)
        for rel, body in BASE_FILES.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8")
        run_git(root, "add", "-A", home=home)
        run_git(root, "commit", "-q", "-m", "base", home=home)
        self.base = run_git(root, "rev-parse", "HEAD", home=home)
        run_git(root, "checkout", "-q", "-b", "pr", home=home)
        for rel, change in changes.items():
            path = root / rel
            if change is None:
                run_git(root, "rm", "-q", rel, home=home)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(change, encoding="utf-8")
        run_git(root, "add", "-A", home=home)
        run_git(root, "commit", "-q", "--allow-empty", "-m", "pr", home=home)
        self.head = run_git(root, "rev-parse", "HEAD", home=home)
        # The PR head is based on main, so the merge commit's tree is the head's.
        self.merge = run_git(
            root,
            "commit-tree",
            f"{self.head}^{{tree}}",
            "-p",
            self.base,
            "-p",
            self.head,
            "-m",
            message,
            home=home,
        )
        run_git(root, "update-ref", "refs/heads/pr-merge", self.merge, home=home)


def stub_git(
    tmp_path: Path, on_fetch: str = "", *, on_diff: str = "", on_every: str = ""
) -> Path:
    """A dir holding a ``git`` that runs the real one, except for two verbs.

    ``on_fetch`` runs first when the arguments include ``fetch``, ``on_diff``
    when they include ``diff`` (``exit 128``, say, or ``exec sleep 30``), and
    ``on_every`` before either, on every call (a line that records the call).
    A LAZY fetch is not one of these calls: git runs it through its own exec
    path, never this stub.
    """
    assert GIT is not None
    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir(exist_ok=True)
    stub = stub_dir / "git"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        f"{on_every or ':'}\n"
        'for arg in "$@"; do\n'
        '  case "$arg" in\n'
        f"    fetch) {on_fetch or ':'} ;;\n"
        f"    diff) {on_diff or ':'} ;;\n"
        "  esac\n"
        "done\n"
        f'exec {GIT} "$@"\n',
        encoding="utf-8",
        newline="\n",
    )
    stub.chmod(0o755)
    return stub_dir


def shallow_clone(repo: PrRepo, dest: Path) -> Path:
    """A depth-1 clone of the merge commit: its parents are NOT present.

    That is the shape of an actions/checkout on ``pull_request``.
    """
    run_git(
        repo.root, "config", "uploadpack.allowAnySHA1InWant", "true", home=repo.home
    )
    run_git(
        repo.root.parent,
        "clone",
        "-q",
        "--depth",
        "1",
        "--branch",
        "pr-merge",
        f"file://{repo.root}",
        str(dest),
        home=repo.home,
    )
    return dest


def partial_clone(repo: PrRepo, dest: Path) -> Path:
    """actions/checkout's ``sparse-checkout: scripts/ci`` shape, of the merge commit.

    With ``sparse-checkout`` set and no ``filter``, actions/checkout fetches
    ``--filter=blob:none --depth=1`` and runs ``git sparse-checkout set``: a
    depth-1 PARTIAL clone whose ``origin`` is a promisor remote, holding the
    merge commit and its trees but no parent, and no blob outside the cone.
    That is the ``Check out the declarer`` step every aggregate runs from.
    ``origin`` is a ``file://`` remote serving filters and any sha, so the
    guard's by-sha first-parent fetch works as it does against GitHub.
    """
    for key in ("uploadpack.allowFilter", "uploadpack.allowAnySHA1InWant"):
        run_git(repo.root, "config", key, "true", home=repo.home)
    run_git(
        repo.root.parent,
        "clone",
        "-q",
        "--filter=blob:none",
        "--depth",
        "1",
        "--sparse",
        "--branch",
        "pr-merge",
        f"file://{repo.root}",
        str(dest),
        home=repo.home,
    )
    run_git(dest, "sparse-checkout", "set", "scripts/ci", home=repo.home)
    return dest


def local_objects(workspace: Path, home: Path) -> dict[str, str]:
    """``{object id: type}`` of every object in ``workspace``'s LOCAL store.

    Enumerated, never looked up: in a partial clone, looking up an absent
    object lazily fetches it from the promisor remote (``GIT_NO_LAZY_FETCH``
    stops that only on git 2.45 and later), so a lookup would answer "yes" by
    fetching the very object it was asked about.
    """
    assert GIT is not None
    proc = subprocess.run(
        [
            GIT,
            "-C",
            str(workspace),
            "cat-file",
            "--batch-all-objects",
            "--batch-check=%(objectname) %(objecttype)",
        ],
        env=base_env(home),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, defang(proc.stderr)
    return dict(line.split(" ", 1) for line in proc.stdout.splitlines() if line)


def has_commit(workspace: Path, sha: str, home: Path) -> bool:
    """Is commit ``sha`` in ``workspace``'s local store? Never fetches it."""
    return local_objects(workspace, home).get(sha) == "commit"


def run_pytest_probe(tmp_path: Path, source: str, *extra: str) -> tuple[int, str]:
    """Run ``source`` as a test module the way a CI shard runs this suite.

    ``-c backend/pytest.ini`` applies the repo's own addopts (``-v -ra
    --showlocals`` and coverage); ``extra`` adds flags (the shard adds a
    second ``-v``). ``CI=true`` is what the Actions runner sets, and it makes
    pytest print each failure's WHOLE message in the ``-ra`` summary, the
    one place its lines are not ``E``-prefixed. The probe runs in ``tmp_path``
    with ``--noconftest``, so no database fixture is involved, and in a fresh
    environment, so no coverage hook of the outer run follows it.

    Returns ``(exit code, stdout + stderr)``: captured, never printed.
    """
    probe = tmp_path / "test_shard_log_probe.py"
    probe.write_text(source, encoding="utf-8")
    home = tmp_path / "probe-home"
    home.mkdir(exist_ok=True)
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-c",
            str(PYTEST_INI),
            "--rootdir",
            str(tmp_path),
            "--noconftest",
            "-p",
            "no:cacheprovider",
            *extra,
            str(probe),
        ],
        cwd=tmp_path,
        env={
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(home),
            "CI": "true",
            "GITHUB_ACTIONS": "true",
            "PYTHONDONTWRITEBYTECODE": "1",
        },
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    return proc.returncode, proc.stdout + proc.stderr


def assert_prints_nothing(source: Path) -> None:
    """No ``print()`` in ``source``, and every subprocess call captures its output.

    A declaration line echoed into a ``Run Tests`` shard's log would itself
    declare that shard's red not a verdict. Nor may a SOURCE line be one
    ``command_lines`` reports (one that opens with ``::``, a line of a
    multi-line string literal say, or one holding ``LEGACY_PREFIX`` anywhere):
    a failing test's traceback prints its function's source lines.
    """
    text = source.read_text(encoding="utf-8")
    shaped = [
        number
        for number, line in enumerate(text.splitlines(), start=1)
        if command_lines(line)
    ]
    assert not shaped, (
        f"{source.name}: source line(s) {shaped} open with `::` or hold the "
        "legacy prefix, which a failing test's traceback would print as a "
        "workflow command"
    )
    tree = ast.parse(text)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name):
            assert func.id != "print", f"{source.name}: print() at line {node.lineno}"
        if isinstance(func, ast.Attribute) and func.attr in ("run", "Popen", "call"):
            if isinstance(func.value, ast.Name) and func.value.id == "subprocess":
                keywords = {kw.arg: kw.value for kw in node.keywords}
                captured = keywords.get("capture_output")
                assert isinstance(captured, ast.Constant) and captured.value is True, (
                    f"{source.name}: subprocess.{func.attr} at line {node.lineno} "
                    "does not capture its output, so its lines would reach the "
                    "shard log"
                )
