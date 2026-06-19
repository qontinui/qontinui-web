#!/usr/bin/env python3
"""Pre-merge blocking gate: verify migration reservation (auto-binds the PR).

Part of the coord-authoritative migration reservation queue
(plans/2026-06-08-coord-migration-reservation-queue.md, Phase P3) — the
successor to the old alembic head-claim mutex.

The file path is unchanged (``scripts/verify_alembic_claim.py``) because CI
and tooling reference it, but its behavior is now the *reservation gate*: it
no longer checks a TTL'd claim, it binds this PR to the coord reservation that
already assigned its ``down_revision``.

## Why a reservation, not a claim

coord is the authority for chain succession. A contributor reserves a slot
(``POST /coord/migrations/reserve``); coord assigns the ``down_revision``
(merged head, or the queue tail) and returns a reservation id. Reservations
are released by MERGE, not by a TTL, so there is no arms-race window. This gate
is the *binding event*: when CI runs on a PR that adds a migration, the gate
finds the matching reservation and binds this PR to it — the author needs zero
extra steps beyond reserving and pushing.

## What this script does

1. Determine the PR's diff against the base branch (default ``origin/main``)
   to find ADDED revision files in ``backend/alembic/versions/*.py``.
2. If none were added → pass (exit 0).
3. Parse each added revision's ``revision`` + ``down_revision``.
4. ``GET $COORD_URL/coord/migrations/queue?repo=qontinui/qontinui-web`` and find the
   reservation whose ``revision`` matches the file, in state ``queued`` or
   ``pr_bound``. Then, per the decision table below:

   * **queued + down_revision matches the assignment** → auto-bind via
     ``POST $COORD_URL/coord/migrations/<id>/bind-pr {"pr_url": <this PR url>}``.
     200 → PASS. 409 ``file_mismatch`` → FAIL (coord is authoritative; print
     coord's expected vs. the file's found). 503 (App degraded) → FAIL closed.
   * **already pr_bound to THIS pr_number** → PASS (re-run idempotency).
   * **down_revision MISMATCHES the assignment** (you were re-pointed by a
     cascade) → FAIL with the corrective rechain block.
   * **no reservation for this revision** → FAIL telling the author to reserve.

5. Coord unreachable → FAIL CLOSED (same posture as the old gate).

## Reserve mode (``--reserve``) — the pre-push helper

Run with ``--reserve --machine-id <uuid>`` to do the reservation step BEFORE
opening a PR: for each NEW ``backend/alembic/versions/*.py`` that lacks a live
reservation, it ``POST``s ``/coord/migrations/reserve`` and writes coord's
ASSIGNED ``down_revision`` back into the file. coord owns chain succession —
the assigned value (merged head, or the in-flight queue tail when
``position > 1``) is written verbatim; the head is NEVER computed from the
local checkout. Reusing this reserve step plus a push makes the verify gate's
auto-bind a no-surprise. Reserve mode shares all of the verify gate's
diff/parse/coord-client plumbing (same exit-code contract).

The gate runs UNAUTHENTICATED (the workflow has ``permissions: contents: read``
and passes no secret — only ``COORD_URL``). That is safe: ``bind-pr`` is
server-side verified against the PR's actual file content by coord's GitHub
App, so the gate cannot bind a reservation to a PR that doesn't genuinely chain
off its assigned head. The content-match IS the guard.

## Failure modes that DO NOT block

* PR doesn't add a file under ``backend/alembic/versions/`` → exit 0.
* An EXISTING revision file edited (status M, not A) — skipped. Rewriting a
  merged revision is a separate sin (chain rewriting), not this gate's concern.

Exit codes (consistent with other coord scripts)::

    0  all clear / no revisions to check / all bound
    1  at least one revision failed the gate — PR blocked
    2  coord service unreachable / config error
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# The reservation key is the GitHub full_name `owner/repo` — coord keys the
# queue on it and `mirror::ensure_mirror` needs owner/repo to derive the chain
# head server-side. A bare name is rejected (400) by coord.
REPO = "qontinui/qontinui-web"

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


def set_down_revision(text: str, assigned: str) -> str:
    """Return ``text`` with its ``down_revision`` assignment rewritten to
    ``assigned`` (the value coord returned). Preserves the existing left-hand
    side (any ``down_revision: <type> =`` prefix) and re-quotes the value with
    double quotes. Raises ``ValueError`` if no ``down_revision`` line is found —
    the caller must not silently leave a freshly-reserved migration unchained.

    coord OWNS chain succession: ``assigned`` is written verbatim, never a head
    computed from the local checkout. When the reservation's ``position > 1``
    the migration is stacked behind in-flight migrations; the assigned value is
    the in-flight tail and is still written as-is."""
    # Match the LHS up to and including ``=`` (keeping any ``: <type>`` prefix),
    # then the quoted/None RHS, anchored at line start (mirrors DOWN_REVISION_RE
    # but capturing the LHS so we can preserve a typed declaration).
    lhs_rhs = re.compile(
        r"""^(?P<lhs>down_revision\s*(?::\s*[^=]+)?\s*=\s*)"""
        r"""(?:['"][^'"]*['"]|None)""",
        re.MULTILINE,
    )
    new_text, n = lhs_rhs.subn(lambda m: f'{m.group("lhs")}"{assigned}"', text, count=1)
    if n == 0:
        raise ValueError(
            "no `down_revision = ...` assignment found to rewrite "
            "(expected `down_revision: <type> = <value>` or `down_revision = None`)"
        )
    return new_text


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


# --------------------------------------------------------------------------- #
# HTTP layer (faked in tests via a CoordClient subclass / monkeypatch).
# --------------------------------------------------------------------------- #


@dataclass
class HttpResponse:
    """A minimal HTTP result: status code + already-decoded JSON body
    (or ``None`` if the body wasn't JSON / was empty)."""

    status: int
    body: dict | None


class CoordUnreachableError(Exception):
    """Raised when coord cannot be reached at all (network/DNS/timeout).
    Distinct from an HTTP error response, which is returned as an
    ``HttpResponse`` so callers can branch on status (e.g. 409 vs 503)."""


class CoordClient:
    """Thin wrapper over urllib. Tests subclass and override
    ``_get`` / ``_post`` to fake the wire without any network."""

    def __init__(self, coord_url: str, timeout: int = 10) -> None:
        self.base = coord_url.rstrip("/")
        self.timeout = timeout

    # -- transport ------------------------------------------------------- #

    def _request(
        self, method: str, path: str, body: dict | None = None
    ) -> HttpResponse:
        url = urllib.parse.urljoin(self.base + "/", path.lstrip("/"))
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if data else {}
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                return HttpResponse(resp.status, _maybe_json(raw))
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            return HttpResponse(e.code, _maybe_json(raw))
        except urllib.error.URLError as e:
            raise CoordUnreachableError(str(e.reason)) from e
        except TimeoutError as e:  # pragma: no cover - timing dependent
            raise CoordUnreachableError(f"timeout: {e}") from e

    # -- API ------------------------------------------------------------- #

    def get_queue(self, repo: str) -> list[dict]:
        """GET /coord/migrations/queue?repo=<repo> → list of reservation dicts."""
        q = urllib.parse.urlencode({"repo": repo})
        resp = self._request("GET", f"/coord/migrations/queue?{q}")
        if resp.status != 200:
            raise CoordUnreachableError(
                f"queue read returned HTTP {resp.status}: {resp.body!r}"
            )
        body = resp.body or {}
        # coord's queue read-side returns {"repo": ..., "live": [...],
        # "recent_terminal": [...]} (migration_reservations.rs). The gate
        # needs both: live rows for matching/binding, recent terminal rows so
        # a just-expired reservation yields the corrective message rather than
        # a bare "no reservation". Tolerate a bare list for robustness.
        if isinstance(body, list):
            return body
        return list(body.get("live", [])) + list(body.get("recent_terminal", []))

    def bind_pr(self, reservation_id: str, pr_url: str) -> HttpResponse:
        """POST /coord/migrations/<id>/bind-pr {"pr_url": ...}."""
        return self._request(
            "POST",
            f"/coord/migrations/{reservation_id}/bind-pr",
            {"pr_url": pr_url},
        )

    def reserve(self, repo: str, revision: str, machine_id: str) -> HttpResponse:
        """POST /coord/migrations/reserve — claim a slot. coord ASSIGNS the
        ``down_revision`` (the merged chain head, or the live-queue tail) and
        returns ``{reservation_id, down_revision, position, authoring_deadline}``.
        The caller writes the returned ``down_revision`` into the migration file
        verbatim — coord owns chain succession; the client never computes it."""
        return self._request(
            "POST",
            "/coord/migrations/reserve",
            {"repo": repo, "revision": revision, "machine_id": machine_id},
        )


def _maybe_json(raw: str) -> dict | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, (dict, list)) else None


# --------------------------------------------------------------------------- #
# Pure decision logic (HTTP-free; the unit tests exercise this directly).
# --------------------------------------------------------------------------- #


def find_reservation(queue: list[dict], revision: str) -> dict | None:
    """Find the reservation whose ``revision`` matches, restricted to the
    live states (``queued``/``pr_bound``). Terminal states
    (``merged``/``expired``/``withdrawn``) are ignored — a withdrawn slot is
    'not found' for gating purposes."""
    for res in queue:
        if res.get("revision") == revision and res.get("state") in (
            "queued",
            "pr_bound",
        ):
            return res
    return None


@dataclass
class Decision:
    """A gate outcome for one added migration file.

    ``action`` is one of:
      * ``"bind"``   — caller must POST bind-pr (then re-evaluate the result).
      * ``"pass"``   — already satisfied (idempotent re-run); no call needed.
      * ``"fail"``   — blocked; ``message`` explains why.
    """

    action: str  # "bind" | "pass" | "fail"
    reservation_id: str | None = None
    message: str = ""


def decide(
    path: Path,
    revision: str,
    down_revision: str,
    reservation: dict | None,
    pr_number: int | None,
) -> Decision:
    """Decide the gate outcome for one file given its parsed (revision,
    down_revision) and the matching reservation (or None). HTTP-free."""
    if reservation is None:
        return Decision(
            action="fail",
            message=(
                f"{path}: no reservation for revision {revision!r}.\n"
                f"    Reserve a slot before authoring — coord assigns your "
                f"down_revision:\n"
                f"        POST {{COORD_URL}}/coord/migrations/reserve\n"
                f'        {{"repo": "{REPO}", "revision": "{revision}", '
                f'"machine_id": "<your-machine-uuid>"}}\n'
                f"    coord replies with the assigned down_revision; write it "
                f"into the file, push, and this gate auto-binds the PR."
            ),
        )

    state = reservation.get("state")
    assigned = reservation.get("down_revision")
    res_id = reservation.get("id")
    res_pr = reservation.get("pr_number")

    # Idempotent re-run: already bound to THIS PR.
    if state == "pr_bound" and pr_number is not None and res_pr == pr_number:
        return Decision(
            action="pass",
            reservation_id=res_id,
            message=(
                f"{path}: reservation {res_id} already bound to PR "
                f"#{pr_number} (down_revision={assigned!r}) — re-run OK."
            ),
        )

    # Re-pointed by a cascade: the file's down_revision no longer matches the
    # reservation's current assignment.
    if down_revision != assigned:
        return Decision(
            action="fail",
            reservation_id=res_id,
            message=(
                f"{path}: coord assigned down_revision={assigned!r}; your file "
                f"has {down_revision!r}.\n"
                f"    You were re-pointed (a predecessor in the queue was "
                f"withdrawn/expired). Update the migration's down_revision to "
                f"{assigned!r} and re-push — the gate re-binds automatically."
            ),
        )

    # queued + matching assignment → auto-bind.
    if state == "queued":
        return Decision(
            action="bind",
            reservation_id=res_id,
            message=(
                f"{path}: reservation {res_id} queued with matching "
                f"down_revision={assigned!r} — auto-binding this PR."
            ),
        )

    # pr_bound to a DIFFERENT pr, but the assignment matches our file. coord is
    # authoritative; we don't steal the binding. Treat as a pass only if it's
    # ours (handled above); otherwise fail loudly.
    if state == "pr_bound":
        return Decision(
            action="fail",
            reservation_id=res_id,
            message=(
                f"{path}: reservation {res_id} (revision {revision!r}) is "
                f"already bound to PR #{res_pr}, not this PR "
                f"(#{pr_number}). Two PRs are racing the same revision id — "
                f"reserve a fresh slot (coord will assign a new revision/head)."
            ),
        )

    # Unknown live state — fail closed.
    return Decision(
        action="fail",
        reservation_id=res_id,
        message=(
            f"{path}: reservation {res_id} in unexpected state {state!r}; "
            f"cannot bind. Re-reserve or contact coord."
        ),
    )


def interpret_bind_result(path: Path, resp: HttpResponse) -> tuple[bool, str]:
    """Map a bind-pr HTTP response to (ok, message). HTTP-free given a
    response object, so the unit tests can drive it directly."""
    if resp.status == 200:
        body = resp.body or {}
        new_state = body.get("state", "pr_bound")
        return True, (
            f"{path}: BOUND — reservation now {new_state!r} "
            f"(coord verified the PR's migration file)."
        )

    body = resp.body or {}
    err = body.get("error", "")

    if resp.status == 409 and err == "file_mismatch":
        expected = body.get("expected_down_revision", body.get("expected", "?"))
        found = body.get("found_down_revision", body.get("found", "?"))
        return False, (
            f"{path}: bind-pr 409 file_mismatch (coord is authoritative).\n"
            f"    coord expected down_revision={expected!r}; the PR's file "
            f"presents {found!r}.\n"
            f"    Update the migration to chain off {expected!r} and re-push."
        )

    if resp.status == 503:
        return False, (
            f"{path}: coord cannot verify PRs right now (GitHub App "
            f"degraded); retry later. (bind-pr 503)"
        )

    return False, (
        f"{path}: bind-pr failed HTTP {resp.status}: "
        f"{err or (resp.body if resp.body else 'no body')!r}"
    )


def interpret_reserve_result(
    path: Path, revision: str, resp: HttpResponse
) -> tuple[bool, str | None]:
    """Map a reserve HTTP response to ``(ok, assigned_down_revision)``. HTTP-free
    given a response object so the unit tests drive it directly.

    * 200 → ``(True, <assigned down_revision>)`` — write it into the file.
    * 409 ``duplicate_revision`` → a live reservation already exists; re-use ITS
      assigned ``down_revision`` (idempotent re-run / someone else reserved the
      same revision id). ``(True, <existing down_revision>)``.
    * anything else → ``(False, None)`` with the message printed by the caller.
    """
    if resp.status == 200:
        body = resp.body or {}
        assigned = body.get("down_revision")
        if not isinstance(assigned, str):
            return False, None
        return True, assigned

    body = resp.body or {}
    if resp.status == 409 and body.get("error") == "duplicate_revision":
        existing = body.get("reservation") or {}
        assigned = existing.get("down_revision")
        if isinstance(assigned, str):
            return True, assigned
    return False, None


def reserve_file(
    client: CoordClient,
    path: Path,
    revision: str,
    machine_id: str,
) -> tuple[bool, str]:
    """Reserve a slot for one added migration and write coord's ASSIGNED
    ``down_revision`` back into the file. Returns ``(ok, message)``.

    coord owns chain succession — the assigned value is written verbatim, never
    a head computed locally (so a ``position > 1`` stacked reservation chains off
    the in-flight tail coord hands back, not the local main head)."""
    resp = client.reserve(REPO, revision, machine_id)
    ok, assigned = interpret_reserve_result(path, revision, resp)
    if not ok or assigned is None:
        body = resp.body or {}
        err = body.get("error") or body
        return False, (
            f"{path}: reserve failed HTTP {resp.status}: {err!r}. "
            "No slot assigned; the migration's down_revision was left unchanged."
        )

    text = path.read_text(encoding="utf-8")
    _, existing_down = parse_revision_file(path) if path.exists() else (None, None)
    if existing_down == assigned:
        return True, (
            f"{path}: reserved (down_revision={assigned!r}); file already "
            "chains off the assigned head — no rewrite needed."
        )
    try:
        new_text = set_down_revision(text, assigned)
    except ValueError as e:
        return False, f"{path}: reserved but could not rewrite the file: {e}"
    path.write_text(new_text, encoding="utf-8")
    return True, (
        f"{path}: reserved — coord assigned down_revision={assigned!r}; wrote it "
        "into the migration. Commit + push and the verify gate auto-binds the PR."
    )


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def process_file(
    client: CoordClient,
    queue: list[dict],
    path: Path,
    revision: str,
    down_revision: str,
    pr_url: str | None,
    pr_number: int | None,
) -> tuple[bool, str]:
    """Run the decision + (if needed) the bind call for one file.
    Returns (ok, message)."""
    reservation = find_reservation(queue, revision)
    decision = decide(path, revision, down_revision, reservation, pr_number)

    if decision.action == "pass":
        return True, decision.message
    if decision.action == "fail":
        return False, decision.message

    # action == "bind"
    if not pr_url:
        return False, (
            f"{path}: reservation {decision.reservation_id} is ready to bind "
            f"but no PR URL is available (not running in a pull_request "
            f"context). Re-run from the PR's CI."
        )
    assert decision.reservation_id is not None
    print(decision.message)
    resp = client.bind_pr(decision.reservation_id, pr_url)
    return interpret_bind_result(path, resp)


def run_reserve(args: argparse.Namespace) -> int:
    """RESERVE mode (pre-push helper). For every NEW migration that lacks a live
    reservation, POST /coord/migrations/reserve and write coord's assigned
    ``down_revision`` into the file. Reuses the verify gate's diff/parse/coord
    plumbing — same exit-code contract (0 ok / 1 a file failed / 2 config or
    coord-unreachable)."""
    if not args.machine_id:
        print(
            "ERROR: reserve mode needs --machine-id (or $COORD_MACHINE_ID) — "
            "coord scopes the reservation to your machine UUID.",
            file=sys.stderr,
        )
        return 2

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
            f"reserve migration: no new revisions vs {args.base_ref} — "
            "nothing to reserve"
        )
        return 0

    client = CoordClient(args.coord_url)
    # Skip files that ALREADY have a live reservation (idempotent re-run) — read
    # the queue once and match on revision id, reusing the verify gate's lookup.
    try:
        queue = client.get_queue(REPO)
    except CoordUnreachableError as e:
        print(
            f"reserve migration: BLOCKED — coord unreachable at {args.coord_url}: {e}",
            file=sys.stderr,
        )
        return 2

    failures: list[str] = []
    for path in added:
        rev, _down = parse_revision_file(path)
        if not rev:
            failures.append(
                f"{path}: could not parse `revision` declaration. "
                'Expected: `revision: str = "..."` or `revision = "..."`'
            )
            continue
        if find_reservation(queue, rev) is not None:
            print(
                f"reserve migration: ok  {path}: revision {rev!r} already has a "
                "live reservation — skipping (run the verify gate to bind)."
            )
            continue
        try:
            ok, msg = reserve_file(client, path, rev, args.machine_id)
        except CoordUnreachableError as e:
            ok, msg = (
                False,
                f"{path}: coord became unreachable during reserve: {e}. "
                "Failing closed; retry later.",
            )
        if ok:
            print(f"reserve migration: ok  {msg}")
        else:
            failures.append(msg)

    if failures:
        print("", file=sys.stderr)
        print("=" * 72, file=sys.stderr)
        print(
            f"reserve migration: {len(failures)} revision(s) could not be reserved:",
            file=sys.stderr,
        )
        print("=" * 72, file=sys.stderr)
        for f in failures:
            print("", file=sys.stderr)
            print(f, file=sys.stderr)
        return 1

    print(f"reserve migration: reserved {len(added)} new revision(s)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="verify migration reservation (auto-binds the PR)"
    )
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
    parser.add_argument(
        "--pr-url",
        default=os.environ.get("PR_URL") or None,
        help="This PR's html_url (from github.event.pull_request.html_url). "
        "Defaults to $PR_URL.",
    )
    parser.add_argument(
        "--pr-number",
        default=os.environ.get("PR_NUMBER") or None,
        help="This PR's number (from github.event.pull_request.number). "
        "Defaults to $PR_NUMBER.",
    )
    parser.add_argument(
        "--reserve",
        action="store_true",
        help="RESERVE mode: for each NEW migration that lacks a reservation, "
        "POST /coord/migrations/reserve and write coord's assigned down_revision "
        "into the file (a pre-push step). Without this flag the script runs the "
        "verify/bind gate (CI default).",
    )
    parser.add_argument(
        "--machine-id",
        default=os.environ.get("COORD_MACHINE_ID") or None,
        help="Your machine UUID (reserve mode only). Defaults to $COORD_MACHINE_ID.",
    )
    args = parser.parse_args()

    if args.reserve:
        return run_reserve(args)

    pr_number: int | None = None
    if args.pr_number:
        try:
            pr_number = int(args.pr_number)
        except ValueError:
            print(
                f"WARNING: PR number {args.pr_number!r} is not an integer; "
                "idempotency check disabled.",
                file=sys.stderr,
            )

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
            f"verify migration reservation: no new revisions vs "
            f"{args.base_ref} — gate skipped"
        )
        return 0

    client = CoordClient(args.coord_url)
    try:
        queue = client.get_queue(REPO)
    except CoordUnreachableError as e:
        print("", file=sys.stderr)
        print("=" * 72, file=sys.stderr)
        print(
            f"verify migration reservation: BLOCKED — coord unreachable at "
            f"{args.coord_url}: {e}",
            file=sys.stderr,
        )
        print(
            "    Failing closed. Check the COORD_URL repo variable and that "
            "the coord service is up.",
            file=sys.stderr,
        )
        print("=" * 72, file=sys.stderr)
        return 2

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

        try:
            ok, msg = process_file(
                client, queue, path, rev, down, args.pr_url, pr_number
            )
        except CoordUnreachableError as e:
            # bind-pr lost the connection mid-call → fail closed.
            ok, msg = (
                False,
                (
                    f"{path}: coord became unreachable during bind-pr: {e}. "
                    "Failing closed; retry later."
                ),
            )

        if ok:
            print(f"verify migration reservation: ok  {msg}")
        else:
            failures.append(msg)

    if failures:
        print("", file=sys.stderr)
        print("=" * 72, file=sys.stderr)
        print(
            f"verify migration reservation: BLOCKED — "
            f"{len(failures)} revision(s) failed the gate:",
            file=sys.stderr,
        )
        print("=" * 72, file=sys.stderr)
        for f in failures:
            print("", file=sys.stderr)
            print(f, file=sys.stderr)
        print("", file=sys.stderr)
        return 1

    print(
        f"verify migration reservation: all {len(added)} new revision(s) "
        f"are bound to this PR"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
