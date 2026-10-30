#!/usr/bin/env python3
"""Put the schemas commits this repo pins into a shallow sibling checkout.

One lane invokes this: ``.qontinui/ci.toml``, step
``fetch-pinned-schemas-commits``. It is the ci_node lane's half of what
``.github/actions/spawn-contract`` and ``.github/actions/fleet-nouns-vocab`` do
in GitHub Actions: it makes the pinned bytes available to the frontend suite.

WHY THE LANE NEEDS IT. ``spawnPathContract.test.ts`` and
``no-dev-stack-fallback.vocabulary.test.mjs`` read their schemas file at the
commit a ``*.pin.toml`` names, so that a schemas edit cannot redden a PR here.
Off Actions they read ``../qontinui-schemas``: the working file when its digest
matches, otherwise ``git show <ref>:<path>``. The ci_node executor materialises
that sibling with ``fetch --depth 1`` of one commit (``ci_node/sibling.rs``), so
the pinned commit is absent unless it happens to be the commit checked out. The
first schemas edit past a pin would then redden every web PR on this lane, which
is the exact state the pin exists to prevent.

WHY A STEP AND NOT A DECLARATION. ``[[siblings]]`` provisions one commit per
sibling, and that commit is chosen by the adaptation-pair rule for the backend's
path dependency. It cannot also be the pin. The manifest's objection to a clone
step is that it is unpinned and leaks; this one fetches an exact SHA named in a
reviewed file, checks the bytes against the pinned digest, and writes only into
the sibling, which sits inside the dispatch-scoped directory. It moves neither
HEAD nor the working tree, so the backend's path dependency is unaffected.

A working file already at the pinned digest needs nothing: the suite reads that
file first, so no fetch runs and a brief network failure cannot redden a dispatch
whose tests would pass.

Silence is never success: a commit that cannot be had, or whose file has another
digest, exits 1 and names it; a pin or sibling that cannot be read exits 2.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path

#: Every pin of a file in qontinui-schemas: (pin file, table, path in schemas).
PINS: tuple[tuple[str, str, str], ...] = (
    ("spawn-contract.pin.toml", "spawn_contract", "rust/src/spawn_authorization.json"),
    ("fleet-nouns.pin.toml", "fleet_nouns", "fleet-nouns.toml"),
)

FETCH_TIMEOUT_SECONDS = 600
EXIT_UNAVAILABLE = 1
EXIT_CANNOT_RUN = 2


class CannotRunError(Exception):
    """A pin or the sibling could not be read at all."""


class UnavailableError(Exception):
    """The pinned bytes could not be had."""


def read_pin(path: Path, table: str) -> tuple[str, str]:
    try:
        pin = tomllib.loads(path.read_text(encoding="utf-8")).get(table, {})
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise CannotRunError(f"{path} could not be read: {exc}") from exc
    ref, sha256 = pin.get("ref", ""), pin.get("sha256", "")
    if not (
        isinstance(ref, str)
        and re.fullmatch(r"[0-9a-f]{40}", ref)
        and isinstance(sha256, str)
        and re.fullmatch(r"[0-9a-f]{64}", sha256)
    ):
        raise CannotRunError(
            f"{path} must carry [{table}] ref (40 hex) and sha256 (64 hex)"
        )
    return ref, sha256


def git(sibling: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", "-C", str(sibling), *args],
        capture_output=True,
        timeout=FETCH_TIMEOUT_SECONDS,
        # A public repository: a credential prompt could only hang the step.
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        check=False,
    )


def fetch(sibling: Path, ref: str) -> None:
    shallow = git(sibling, "rev-parse", "--is-shallow-repository")
    # --depth on a full clone would cut its history at this commit.
    depth = ["--depth", "1"] if shallow.stdout.strip() == b"true" else []
    try:
        done = git(sibling, "fetch", *depth, "--no-tags", "origin", ref)
    except subprocess.TimeoutExpired as exc:
        raise UnavailableError(
            f"fetching {ref} into {sibling} timed out after {FETCH_TIMEOUT_SECONDS}s"
        ) from exc
    if done.returncode != 0:
        err = done.stderr.decode("utf-8", "replace").strip()
        raise UnavailableError(f"fetching {ref} into {sibling} failed: {err}")


def working_file_is_pinned(sibling: Path, path: str, sha256: str) -> bool:
    """Whether the checked-out file already holds the pinned bytes."""
    try:
        return hashlib.sha256((sibling / path).read_bytes()).hexdigest() == sha256
    except OSError:
        return False


def ensure_pinned(sibling: Path, ref: str, path: str, sha256: str) -> str:
    """Make the pinned bytes readable in ``sibling``; say how they were had."""
    if working_file_is_pinned(sibling, path, sha256):
        return "in the working tree"
    blob = f"{ref}:{path}"
    shown = git(sibling, "show", blob)
    fetched = shown.returncode != 0
    if fetched:
        fetch(sibling, ref)
        shown = git(sibling, "show", blob)
    if shown.returncode != 0:
        err = shown.stderr.decode("utf-8", "replace").strip()
        raise UnavailableError(f"{blob} is not readable in {sibling}: {err}")
    got = hashlib.sha256(shown.stdout).hexdigest()
    if got != sha256:
        raise UnavailableError(f"{blob} has sha256 {got}; the pin says {sha256}")
    return "fetched" if fetched else "already present"


def run(repo_root: Path, sibling: Path) -> None:
    if not (sibling / ".git").exists():
        raise CannotRunError(f"{sibling} is not a git checkout")
    for pin_file, table, path in PINS:
        ref, sha256 = read_pin(repo_root / pin_file, table)
        how = ensure_pinned(sibling, ref, path, sha256)
        print(f"{pin_file}: {ref}:{path} {how}, sha256 {sha256} verified.")


def main(argv: list[str] | None = None) -> int:
    default_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo-root", type=Path, default=default_root)
    parser.add_argument(
        "--sibling",
        type=Path,
        help="the qontinui-schemas checkout (default: beside the repo root)",
    )
    args = parser.parse_args(argv)
    sibling = args.sibling or args.repo_root.parent / "qontinui-schemas"
    try:
        run(args.repo_root, sibling)
    except CannotRunError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return EXIT_CANNOT_RUN
    except UnavailableError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return EXIT_UNAVAILABLE
    return 0


if __name__ == "__main__":
    sys.exit(main())
