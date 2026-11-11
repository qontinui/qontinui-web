"""Real git repositories for the setup-death declarers' harness-diff guard.

Plan ``2026-11-11-web-setup-step-deaths-declare-not-a-verdict``. Two declarers
read a pull_request's own diff before they write the not-a-verdict phrase: the
per-job ``.github/scripts/declare-setup-death.sh`` (its ``compute_guard``) and
the aggregate ``scripts/ci/aggregate_setup_death.py`` (rule 5, a port of it).
Both read the same thing -- the FIRST parent of the merge commit
``GITHUB_SHA`` names, fetched when a depth-1 checkout lacks it, and
``git diff --no-renames`` from it -- so both are tested here against the same
real two-parent merge commits, depth-1 clones and stub ``git``:
``tests/test_declare_setup_death.py`` and ``tests/test_aggregate_setup_death.py``.

Nothing here prints, and every subprocess's output is captured: both modules
run inside a ``Run Tests`` shard, where a stdout line starting ``::`` is a
workflow command. ``assert_prints_nothing`` is the AST guard both modules run
over themselves and over this file.
"""

from __future__ import annotations

import ast
import shutil
import subprocess
from pathlib import Path

GIT = shutil.which("git")

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


def defang(text: str) -> str:
    """``text`` made safe for a failure message: no line can start a command."""
    return text.replace("::", ": :")


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


def stub_git(tmp_path: Path, on_fetch: str = "", *, on_diff: str = "") -> Path:
    """A dir holding a ``git`` that runs the real one, except for two verbs.

    ``on_fetch`` runs first when the arguments include ``fetch``, ``on_diff``
    when they include ``diff`` (``exit 128``, say, or ``exec sleep 30``).
    """
    assert GIT is not None
    stub_dir = tmp_path / "stub-bin"
    stub_dir.mkdir(exist_ok=True)
    stub = stub_dir / "git"
    stub.write_text(
        "#!/usr/bin/env bash\n"
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


def has_commit(workspace: Path, sha: str, home: Path) -> bool:
    assert GIT is not None
    proc = subprocess.run(
        [GIT, "-C", str(workspace), "cat-file", "-e", f"{sha}^{{commit}}"],
        env=base_env(home),
        capture_output=True,
        check=False,
    )
    return proc.returncode == 0


def assert_prints_nothing(source: Path) -> None:
    """No ``print()`` in ``source``, and every subprocess call captures its output.

    A declaration line echoed into a ``Run Tests`` shard's log would itself
    declare that shard's red not a verdict.
    """
    tree = ast.parse(source.read_text(encoding="utf-8"))
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
