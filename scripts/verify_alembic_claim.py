#!/usr/bin/env python3
"""Pre-merge blocking gate: verify alembic revisions match a coord claim.

Phase 5C of the multi-machine coordinator plan
(D:/qontinui-root/tmp_multimachine_coordinator_plan.md §9).

Pairs with the post-merge ``alembic-graph-check.yml`` workflow:

* That one runs after merge, counts heads, comments on the merging PR
  if a fork landed. Informational, not blocking.
* This one runs on every PR that introduces a new alembic revision.
  It demands the contributor pre-claimed the ``down_revision`` via the
  coord service. Fails the PR if no matching claim exists.

Together: the blocking gate prevents *intentional uncoordinated* forks
(contributor authors a revision without checking with the coord service);
the post-merge gate catches the leftover *accidental* forks (race
conditions, claim TTL expiries, etc.).

## What this script does

1. Determine the PR's diff against the base branch (default ``main``)
   to find new revision files in ``backend/alembic/versions/*.py``.
2. Parse each new revision's ``down_revision`` field.
3. POST to the coord service's generic ``/coord/claims/check`` endpoint
   with ``{"kind": "alembic_revision", "resource_key": <down_revision>}``
   and verify a matching claim exists (acquired by SOMEONE for the same
   HEAD / ``down_revision`` the file declares). The claim is a mutex on
   the HEAD being chained off, not on the child revision id.
4. Exit 0 on all-green; non-zero with a per-revision actionable error
   on any mismatch.

## Usage

Locally::

    python scripts/verify_alembic_claim.py \\
        --base-ref origin/main \\
        --coord-url http://localhost:9870

In CI (the workflow at .github/workflows/verify-alembic-claim.yml passes
the right values)::

    python scripts/verify_alembic_claim.py \\
        --base-ref ${{ github.event.pull_request.base.ref }} \\
        --coord-url ${{ secrets.COORD_URL }}

## Failure modes that produce a clear error

* New revision file but no down_revision parseable → error "could not
  parse down_revision".
* New revision file's down_revision doesn't match any claim →
  "no claim acquired for down_revision X. Run: coord.py claim acquire ...".
* Coord service unreachable → 500-ish; CI logs the URL + tells you to
  check the COORD_URL secret.

## Failure modes that DO NOT block

* PR doesn't touch alembic/versions/ — script exits 0 immediately.
* Existing revision file edited (not added) — claim check skipped per
  revision file. Editing an existing revision after it's merged is a
  separate sin (alembic chain rewriting); not this gate's concern.

Exit codes (consistent with other coord scripts)::

    0  all clear / no revisions to check
    1  at least one revision is missing its claim — PR blocked
    2  coord service unreachable / config error
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Match `revision: str = "X"`, `revision = "X"`, single quotes too.
# The optional `: <type>` group accepts any non-`=` chars to handle
# typed declarations like `down_revision: Union[str, None] = "..."`.
REVISION_RE = re.compile(
    r"""^revision\s*(?::\s*[^=]+)?\s*=\s*['"](?P<id>[^'"]+)['"]""",
    re.MULTILINE,
)
DOWN_REVISION_RE = re.compile(
    r"""^down_revision\s*(?::\s*[^=]+)?\s*=\s*['"](?P<id>[^'"]+)['"]""",
    re.MULTILINE,
)


def parse_revision_file(path: Path) -> tuple[str | None, str | None]:
    """Return (revision_id, down_revision) parsed from the file.

    Either may be None if not found / malformed. The first quoted string
    on each declaration line wins. Tuple ``down_revision = (X, Y)`` is
    not supported (multi-parent merge revisions); the gate intentionally
    only validates linear-history additions.
    """
    text = path.read_text(encoding="utf-8")
    rev = REVISION_RE.search(text)
    down = DOWN_REVISION_RE.search(text)
    return (
        rev.group("id") if rev else None,
        down.group("id") if down else None,
    )


def added_revision_files(base_ref: str) -> list[Path]:
    """Run ``git diff --name-status base_ref...HEAD`` and return the paths
    of revision files that were ADDED (status A). Modified files (status
    M) are excluded — editing an existing revision is a different policy
    concern."""
    result = subprocess.run(
        [
            "git",
            "diff",
            "--name-status",
            "--diff-filter=A",
            f"{base_ref}...HEAD",
            "--",
            "backend/alembic/versions/",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    out: list[Path] = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        # Format: "A\tpath/to/file.py"
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        status, path = parts
        if status.startswith("A") and path.endswith(".py"):
            out.append(Path(path))
    return out


def check_claim(
    coord_url: str,
    revision_id: str,
    down_revision: str,
) -> tuple[bool, str]:
    """POST to the coord service to check whether a claim exists for the
    HEAD being chained off (the ``down_revision``). Returns (ok, message).

    The alembic claim is a mutex on the HEAD (``down_revision``), NOT the
    child revision id. The coord ``/coord/claims/check`` endpoint is a
    generic "was this (kind, resource_key) claimed?" check, so the wire
    contract is ``{"kind": "alembic_revision", "resource_key":
    <down_revision>}``. ``revision_id`` is kept only to build the
    human-readable acquire hint; it does not go on the wire.
    """
    body = json.dumps(
        {
            "kind": "alembic_revision",
            "resource_key": down_revision,
        }
    ).encode("utf-8")
    url = urllib.parse.urljoin(coord_url + "/", "coord/claims/check")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return payload.get("matched", False), payload.get("reason", "")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        return False, f"HTTP {e.code}: {body_text[:200]}"
    except urllib.error.URLError as e:
        return False, f"network error: {e.reason}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--base-ref",
        default="origin/main",
        help="Base ref to diff against (e.g. origin/main).",
    )
    parser.add_argument(
        "--coord-url",
        required=True,
        help="Coord service base URL (e.g. https://coord.qontinui.io).",
    )
    args = parser.parse_args()

    try:
        added = added_revision_files(args.base_ref)
    except subprocess.CalledProcessError as e:
        print(
            f"ERROR: git diff against {args.base_ref} failed: {e.stderr}",
            file=sys.stderr,
        )
        return 2

    if not added:
        print(
            f"verify_alembic_claim: no new revisions vs {args.base_ref} — gate skipped"
        )
        return 0

    failures: list[str] = []
    for path in added:
        rev, down = parse_revision_file(path)
        if not rev:
            failures.append(
                f"{path}: could not parse `revision` declaration. "
                'Expected: `revision: str = "..."` or `revision = "..."`'
            )
            continue
        if not down:
            failures.append(
                f"{path}: could not parse `down_revision` declaration. "
                "Multi-parent merge revisions (down_revision = (X, Y)) "
                "are not supported by this gate — open separately and "
                "expect a maintainer override."
            )
            continue

        ok, reason = check_claim(args.coord_url, rev, down)
        if not ok:
            failures.append(
                f"{path}: revision {rev!r} (down_revision={down!r}) has no "
                f"acquired coord claim on its head. Reason: {reason}\n"
                f"    The claim is a mutex on the HEAD ({down!r}) you are "
                f"chaining off — acquire it before authoring:\n"
                f"        coord.py claim acquire \\\n"
                f"            --kind alembic_revision \\\n"
                f"            --resource '{down}' \\\n"
                f'            --metadata \'{{"down_revision":"{down}","revision":"{rev}","repo":"qontinui-web"}}\'\n'
                f"    Or re-acquire with --metadata '{{...,\"intentional_sibling\":true}}' "
                f"if the fork is intentional (per coordinator plan §9)."
            )
            continue

        print(f"verify_alembic_claim: ok  {path}  rev={rev}  down={down}")

    if failures:
        print("", file=sys.stderr)
        print("=" * 72, file=sys.stderr)
        print(
            f"verify_alembic_claim: BLOCKED — {len(failures)} revision(s) lack claims:",
            file=sys.stderr,
        )
        print("=" * 72, file=sys.stderr)
        for f in failures:
            print("", file=sys.stderr)
            print(f, file=sys.stderr)
        print("", file=sys.stderr)
        return 1

    print(f"verify_alembic_claim: all {len(added)} new revision(s) have claims")
    return 0


if __name__ == "__main__":
    sys.exit(main())
