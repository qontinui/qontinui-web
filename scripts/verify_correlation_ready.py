#!/usr/bin/env python3
"""Pre-merge cross-repo bundle gate: verify a correlation bundle is ready.

Phase 6 Item 5 of the multi-machine coordinator plan
(``D:/qontinui-root/tmp_coord_phase6_agent_coordination_hardening.md``
§Item 5).

Cross-repo correlation lets agents tie sibling PRs (e.g. qontinui-web
PR #11, qontinui-runner PR #6, qontinui PR #2 for one logical change)
to a shared ``correlation_id``. The id rides on each PR via a body
footer:

    Correlation: 0193a1bb-3c3c-77c4-9000-1234abcd5678

This gate runs on every PR that carries that footer. It asks coord
``GET /coord/correlation/<id>?check=ready`` and blocks the merge until
*every* sibling PR in the bundle has reached CI-green. Closed/merged
PRs no longer gate the bundle; the answer flips to ready=true once
they all leave the queue.

Pairs with ``verify_alembic_claim.py``:

* That one is single-revision, single-repo: "did you pre-claim the
  alembic chain you're about to mutate?"
* This one is cross-repo, multi-PR: "is the *bundle* mergeable yet?"

Both are read-only; both surface a structured pass/fail to CI.

## What this script does

1. Locate the PR body (via ``--pr-body``, ``--pr-body-file``, env
   ``GITHUB_EVENT_PATH``'s ``pull_request.body``, or a direct
   ``--correlation-id`` override).
2. Parse the body for ``^Correlation: <uuid>$`` (multiline). The match
   is case-insensitive on the prefix; the UUID itself is matched in
   strict 8-4-4-4-12 hex form.
3. If no marker → exit 0 (PR isn't part of a bundle, gate doesn't apply).
4. GET ``/coord/correlation/<id>?check=ready``.
5. Exit 0 if ``ready=true``; 1 if ``ready=false`` with the reason
   spelled out; 2 on coord-unreachable / network errors.

## Usage

Locally with an explicit correlation_id::

    python scripts/verify_correlation_ready.py \\
        --correlation-id 0193a1bb-3c3c-77c4-9000-1234abcd5678 \\
        --coord-url http://localhost:9870

In CI on a PR (auto-skips if no Correlation: footer in the PR body)::

    python scripts/verify_correlation_ready.py \\
        --pr-body-file pr_body.txt \\
        --coord-url ${{ secrets.COORD_URL }}

Reading the PR body from the GitHub event payload (CI default)::

    python scripts/verify_correlation_ready.py \\
        --coord-url ${{ secrets.COORD_URL }}
    # picks up GITHUB_EVENT_PATH and reads .pull_request.body

Exit codes (consistent with other coord scripts)::

    0  PR has no Correlation: footer  /  bundle is ready
    1  bundle is NOT ready — merge blocked, reason printed to stdout
    2  coord unreachable, malformed input, or other config error
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Multi-line, case-insensitive on the prefix label only. The UUID is
# matched strictly so we don't accept `Correlation: tbd` or arbitrary
# strings — the parser must agree with the coord-side acceptance regex.
CORRELATION_RE = re.compile(
    r"^Correlation:\s*(?P<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
    r"[0-9a-f]{4}-[0-9a-f]{12})\s*$",
    re.MULTILINE | re.IGNORECASE,
)


def find_correlation_id(text: str) -> str | None:
    """Extract the first Correlation: <uuid> footer line, if any.

    Returns the UUID (lowercased) or None if no marker is present.
    Picks the *last* match in the body — agents may append updated
    correlation IDs as the bundle evolves; the latest marker wins.
    """
    matches = list(CORRELATION_RE.finditer(text))
    if not matches:
        return None
    return matches[-1].group("id").lower()


def read_pr_body(args: argparse.Namespace) -> str | None:
    """Resolve the PR body text from one of the supported sources.

    Preference order: ``--pr-body`` (literal) → ``--pr-body-file`` →
    ``GITHUB_EVENT_PATH`` JSON. Returns None if none of them produce
    text. Callers treat None as "no marker" and skip the gate.
    """
    if args.pr_body is not None:
        return args.pr_body
    if args.pr_body_file is not None:
        try:
            return Path(args.pr_body_file).read_text(encoding="utf-8")
        except OSError as e:
            print(
                f"verify_correlation_ready: cannot read --pr-body-file "
                f"{args.pr_body_file!r}: {e}",
                file=sys.stderr,
            )
            return None
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if event_path:
        try:
            with open(event_path, encoding="utf-8") as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(
                f"verify_correlation_ready: cannot parse "
                f"GITHUB_EVENT_PATH={event_path!r}: {e}",
                file=sys.stderr,
            )
            return None
        body = payload.get("pull_request", {}).get("body")
        if isinstance(body, str):
            return body
    return None


def fetch_ready(coord_url: str, correlation_id: str) -> dict:
    """GET /coord/correlation/<id>?check=ready and return the parsed JSON.

    Raises RuntimeError on transport failure, with a message safe to
    print to CI logs.
    """
    url = f"{coord_url.rstrip('/')}/coord/correlation/{correlation_id}?check=ready"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read()
            return json.loads(body)
    except urllib.error.HTTPError as e:
        # 404 = unknown correlation id (no claims, no PRs). Treat as
        # "not ready, but not a transport error" — exit 1, not 2.
        if e.code == 404:
            return {"ready": False, "reason": f"correlation_id {correlation_id} unknown to coord"}
        raise RuntimeError(
            f"coord returned HTTP {e.code} for {url}: {e.read().decode('utf-8', 'replace')}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"coord unreachable at {url}: {e.reason}") from e
    except (TimeoutError, json.JSONDecodeError) as e:
        raise RuntimeError(f"coord call to {url} failed: {e}") from e


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Verify a correlation bundle is CI-green before merge",
    )
    parser.add_argument(
        "--coord-url",
        default=os.environ.get("COORD_URL", "http://localhost:9870"),
        help="Base URL of the coord service (default: $COORD_URL or http://localhost:9870)",
    )
    parser.add_argument(
        "--correlation-id",
        help="Skip PR-body parsing; check this correlation_id directly.",
    )
    parser.add_argument(
        "--pr-body",
        help="PR body text (literal). Overrides --pr-body-file and GITHUB_EVENT_PATH.",
    )
    parser.add_argument(
        "--pr-body-file",
        help="Path to a file containing the PR body.",
    )
    args = parser.parse_args(argv)

    if args.correlation_id:
        cid = args.correlation_id.strip().lower()
    else:
        body = read_pr_body(args)
        if body is None:
            print(
                "verify_correlation_ready: no PR body available "
                "(pass --pr-body, --pr-body-file, or set GITHUB_EVENT_PATH); "
                "skipping gate",
                file=sys.stderr,
            )
            return 0
        cid = find_correlation_id(body)
        if cid is None:
            # No marker means this PR isn't part of a bundle. Gate skipped.
            return 0

    try:
        result = fetch_ready(args.coord_url, cid)
    except RuntimeError as e:
        print(f"verify_correlation_ready: {e}", file=sys.stderr)
        return 2

    ready = bool(result.get("ready"))
    reason = result.get("reason") or "(no reason returned)"
    if ready:
        print(f"verify_correlation_ready: bundle {cid} is READY — {reason}")
        return 0
    print(
        f"verify_correlation_ready: bundle {cid} is NOT READY — {reason}",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
