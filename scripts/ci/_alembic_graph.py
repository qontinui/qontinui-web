"""Shared alembic revision-graph parsing for the gates in ``scripts/ci/``.

Extracted from ``count_alembic_heads.py`` so that the head computation has
exactly ONE home even though three different callers now need it:

  * ``count_alembic_heads.py`` — the blocking PR gate and its three mirror
    lanes (``.qontinui/ci.toml``, ``.pre-commit-config.yaml``, and
    ``alembic-graph-check.yml``'s post-land companion).
  * ``notify_forked_open_prs.py`` — the post-land notifier, which has to run
    the same computation against a SIMULATED tree (``main``'s versions dir
    with one open PR's revision files overlaid) rather than the checkout.
  * anything future that needs to answer "what are this tree's heads".

Everything here is pure: it parses text and returns data. No exits, no
annotations, no I/O beyond reading the files it is handed. The gate scripts
own the exit codes, because "how loud is this" is a property of the lane,
not of the graph.
"""

from __future__ import annotations

import io
import re
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path

#: Where revision files live, relative to the repo root.
VERSIONS_DIR = "backend/alembic/versions"

#: Ceiling on the baseline `git archive`. A pre-commit hook must not hang.
GIT_TIMEOUT_SECONDS = 60

# Match both the legacy `revision = "x"` and the modern `revision: str = "x"`
# syntaxes. The colon-prefixed type annotation can contain letters (e.g.
# `: str = `, `: str | None = `), so `[: ]+` is too narrow — use an optional
# `:<non-eq chars>` segment between the keyword and the `=`.
REV_RE = re.compile(r'^revision\s*(?::[^=]*)?\s*=\s*["\'](.+?)["\']', re.M)
DOWN_RE = re.compile(r"^down_revision\s*(?::[^=]*)?\s*=\s*(.+)$", re.M)
PARENT_REF_RE = re.compile(r'["\'](\w[\w]*)["\']')

#: Revision ids are interpolated into PR comments, so anything outside this
#: set is stripped before rendering. ``REV_RE`` captures ``(.+?)`` between
#: quotes, which would otherwise let a revision id in someone's own PR close
#: a markdown code span and fire an @mention from a bot-authored comment.
SAFE_ID_RE = re.compile(r"[^0-9A-Za-z._-]")

# KNOWN PARSE LIMIT, deliberately unchanged: ``DOWN_RE`` is line-anchored, so
# a ``down_revision`` tuple wrapped across lines by a formatter parses as no
# parents at all and its children read as heads. Widening it would move the
# gate's PASS/FAIL condition — a currently-failing tree would start passing —
# which is out of scope for the advice work this module exists for. The
# repo's revisions are all single-line today. If that changes, fix it as its
# own change, with its own reasoning about the verdict move.


@dataclass(frozen=True)
class Scan:
    """The result of scanning a set of revision sources.

    ``file_count`` counts every ``*.py`` looked at, including any that held
    no parseable ``revision = ...``; ``revisions`` holds only the parsed
    ones. Keeping both is what lets a caller tell "clean chain" apart from
    "the parse broke" — N files and zero revisions is a defect, not a pass.
    """

    file_count: int
    revisions: dict[str, str]
    """revision id -> the raw right-hand side of its ``down_revision``."""
    paths: dict[str, Path]
    """revision id -> the file it was parsed from."""
    heads: tuple[str, ...]
    """Sorted revision ids that no other revision names as a parent."""


def safe_id(revision: str) -> str:
    """A revision id with everything outside ``[0-9A-Za-z._-]`` stripped.

    For rendering into markdown a bot posts on someone else's PR. See
    :data:`SAFE_ID_RE`.
    """
    return SAFE_ID_RE.sub("", revision)


def parse_source(source: str) -> tuple[str, str] | None:
    """Parse one revision file's text into ``(revision, down_revision_rhs)``.

    Returns ``None`` when the file holds no ``revision = ...`` assignment
    (``__init__.py``, a helper module dropped in the dir, and so on).
    """
    match = REV_RE.search(source)
    if not match:
        return None
    down_match = DOWN_RE.search(source)
    down = down_match.group(1).strip() if down_match else "None"
    return match.group(1), down


def scan_sources(sources: dict[Path, str]) -> Scan:
    """Compute the head set over ``{path: file text}``.

    A revision is a head if no other revision names it as a parent. Parents
    are read out of the ``down_revision`` right-hand side by string literal,
    so both the scalar (``down_revision = "x"``) and the branch-merge tuple
    (``down_revision = ("x", "y")``) forms are handled.
    """
    revisions: dict[str, str] = {}
    paths: dict[str, Path] = {}
    parents: set[str] = set()
    for path, source in sources.items():
        parsed = parse_source(source)
        if parsed is None:
            continue
        rev, down = parsed
        revisions[rev] = down
        paths[rev] = path
        parents.update(PARENT_REF_RE.findall(down))
    heads = tuple(sorted(r for r in revisions if r not in parents))
    return Scan(file_count=len(sources), revisions=revisions, paths=paths, heads=heads)


def read_dir_sources(versions_dir: Path) -> dict[Path, str]:
    """``{path: text}`` for every ``*.py`` directly in ``versions_dir``.

    Non-recursive on purpose: it must match what the gate scans, so that a
    caller simulating a tree cannot disagree with the gate about which files
    are in the revision set.
    """
    return {
        path: path.read_text(encoding="utf-8", errors="replace")
        for path in sorted(versions_dir.glob("*.py"))
    }


def scan_dir(versions_dir: Path) -> Scan:
    """:func:`scan_sources` over every ``*.py`` in ``versions_dir``."""
    return scan_sources(read_dir_sources(versions_dir))


def revisions_at_ref(ref: str, repo_root: Path) -> set[str] | None:
    """The revision ids present in ``VERSIONS_DIR`` at git ``ref``.

    Returns ``None`` — never an empty set — when the answer could not be
    established: no git, not a repo, the ref does not exist (a shallow or
    single-branch CI checkout has no ``origin/main``), or the dir is absent
    there. ``None`` means UNKNOWN and callers must say so rather than
    treating it as "nothing has landed", which would invert the advice this
    powers.
    """
    # One `git archive` rather than one `git show` per file: the dir holds
    # 500+ revisions, and 500 subprocesses in a pre-commit hook would turn a
    # sub-second check into a visible stall.
    # Bare `except Exception` on purpose, and it is the safe direction here.
    # This function only ever chooses the WORDING of an already-decided
    # verdict, so any failure must degrade to UNKNOWN. Letting an unexpected
    # exception escape would turn `--report-only`'s intended exit 0 into an
    # uncaught traceback, aborting the post-land workflow before it can notify
    # anyone — the opposite of what this module is for.
    try:
        archive = subprocess.run(
            ["git", "archive", "--format=tar", ref, "--", VERSIONS_DIR],
            cwd=repo_root,
            capture_output=True,
            check=False,
            timeout=GIT_TIMEOUT_SECONDS,
        )
        if archive.returncode != 0 or not archive.stdout:
            return None
        found: set[str] = set()
        with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
            for member in tar:
                if not member.isfile() or not member.name.endswith(".py"):
                    continue
                handle = tar.extractfile(member)
                if handle is None:
                    continue
                parsed = parse_source(handle.read().decode("utf-8", errors="replace"))
                if parsed is not None:
                    found.add(parsed[0])
    except Exception:
        return None
    return found or None


@dataclass(frozen=True)
class Remediation:
    """What to actually DO about a multi-head chain.

    The distinction this type exists to make: ``alembic merge`` is the right
    tool only when EVERY head has already landed on the baseline, because a
    merge revision is permanent bookkeeping in the chain. When one of the
    heads is still unlanded — the overwhelmingly common case, an open PR that
    a land forked — the fix is to re-point that unlanded revision's
    ``down_revision`` at the landed head, which leaves nothing behind. The
    gate used to recommend ``alembic merge`` unconditionally, which is wrong
    advice on the case it fires on most.
    """

    kind: str
    """``repoint`` | ``merge`` | ``chain`` | ``unknown``."""
    landed_heads: tuple[str, ...]
    unlanded_heads: tuple[str, ...]
    target: str | None
    """The ``down_revision`` value to adopt, when ``kind == "repoint"``."""
    edits: tuple[tuple[str, Path | None], ...]
    """``(revision id to edit, the file it lives in)`` for a ``repoint``."""


def fork_root(head: str, revisions: dict[str, str], landed: set[str]) -> str | None:
    """The shallowest UNLANDED revision on ``head``'s chain, or ``None``.

    Re-pointing the head itself is usually wrong. #989 is the worked example:
    its heads were ``coord_polread_01`` (landed) and ``devenv_10`` (unlanded),
    but ``devenv_10``'s parent ``devenv_09`` is also unlanded and is where the
    chain actually leaves the landed graph — so ``devenv_09`` is the file to
    edit and ``devenv_10`` must not be touched. Walk down until the next
    parent is landed, unknown, or absent.

    ``None`` means "there is no single token to change here", and the caller
    must fall back to ``chain`` rather than name a file. Two cases produce it,
    and BOTH would otherwise generate destructive advice:

    * a **merge revision** (``down_revision = ("b", "c")``). Telling an author
      to set a scalar there drops both merge parents and creates MORE heads —
      it takes a 2-head chain to 3.
    * a **cycle**. There is no shallowest revision to name.

    A chain root (``down_revision = None``) is different and IS returnable:
    re-pointing a root at the landed head is exactly the right fix for a new
    chain authored with no parent.
    """
    current = head
    seen = {current}
    while True:
        down = revisions.get(current)
        if down is None:
            return current
        parents = PARENT_REF_RE.findall(down)
        if len(parents) > 1:
            return None  # merge revision — see the docstring
        if not parents:
            return current  # chain root
        parent = parents[0]
        if parent in seen:
            return None  # cycle
        if parent in landed or parent not in revisions:
            return current
        seen.add(parent)
        current = parent


def plan_remediation(scan: Scan, landed: set[str] | None) -> Remediation:
    """Decide the remedy for ``scan``'s heads given what has landed.

    ``landed is None`` means the baseline could not be read; the result is
    ``kind="unknown"`` and callers must print that as an UNKNOWN rather than
    inventing a recommendation from a baseline they never saw.
    """
    if landed is None:
        return Remediation("unknown", (), (), None, ())
    landed_heads = tuple(h for h in scan.heads if h in landed)
    unlanded_heads = tuple(h for h in scan.heads if h not in landed)

    if len(landed_heads) == 1 and unlanded_heads:
        roots = [fork_root(head, scan.revisions, landed) for head in unlanded_heads]
        # `None` from any chain means at least one fork has no single token to
        # change (a merge revision, or a cycle). Emitting a partial re-point
        # would leave the chain forked while reading as a complete fix, so the
        # whole answer degrades to `chain` and a human picks.
        if all(root is not None for root in roots):
            edits = tuple(
                (root, scan.paths.get(root)) for root in dict.fromkeys(roots) if root
            )
            return Remediation(
                "repoint", landed_heads, unlanded_heads, landed_heads[0], edits
            )

    if not unlanded_heads:
        # Every head is already on the baseline. Nothing can be re-pointed
        # without rewriting landed history, so a merge revision is correct.
        return Remediation("merge", landed_heads, (), None, ())

    # Two or more landed heads (the baseline itself is forked), or every head
    # unlanded (several new chains authored locally off the same parent).
    # Both need a human to choose an order; do not fabricate one.
    return Remediation("chain", landed_heads, unlanded_heads, None, ())
