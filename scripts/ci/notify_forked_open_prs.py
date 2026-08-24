#!/usr/bin/env python3
"""Tell every open PR that THIS land just forked its alembic chain.

Invoked by ``.github/workflows/alembic-graph-check.yml`` on every push to
``main`` that touches ``backend/alembic/versions/``.

## The gap this closes

``alembic-heads-pr`` (``count_alembic_heads.py``, blocking) and
``alembic-graph-check.yml`` (informational) both already work, and both
inspect only ONE chain: the one in front of them. Neither notices the thing
that actually strands PRs — **a land on ``main`` silently forks every open PR
that carries a revision.** All three forks on record were created that way,
minutes to hours AFTER the forked revision was authored and committed:

| PR | revision committed | forking sibling landed | gap |
|---|---|---|---|
| #1048 | 2026-08-22T15:28:36Z | ``cmpaxis_01`` 16:51:56Z | +83 min |
| #989 | 2026-08-15T00:00:24Z | ``coord_system_tenant_marker`` 09:43:21Z | +9h43m |
| ``066c2e6c``'s PR | 2026-08-19 | ``coord_sessions_tool_activity`` | days |

So no author-time check could have caught any of them — the declared parent
was the single head when it was written. Detection was never the gap either:
the required check went red both times. The gap is that the author found out
from a red check on a PR they had stopped watching, with an advisory that
recommended the wrong remedy. #989 sat for 9.7 days and #1048 for 2.2 days.

This script closes it at the one moment the information exists: the land.
For each open PR that touches the versions dir it rebuilds the chain that PR
would have after this land (``main``'s revision files with the PR's own
overlaid — the exact simulation, not a prediction), and when that chain has
more than one head it comments the **exact ``down_revision`` token to
adopt**, which was the entire fix in 3 of 3 recorded cases.

## What it deliberately does NOT do

It does not rewrite anyone's branch. coord already owns that lane —
``restack_engine::proactively_repoint_stale_siblings`` and
``pr_merge::alembic_fork_repoint_watcher`` re-point stale siblings on a main
advance — but that machinery is shadow-mode unless ``COORD_AUTO_REWRITE_ARMED
=1``, and armed or not it never tells the author anything. Notification is
the missing half, and it is safe to ship unconditionally; rewriting is not.

It also does not claim ``down_revision`` up front. That mechanism existed
(``POST /claims/acquire`` with ``ClaimKind::AlembicRevision``) and was
deliberately retired — it now answers **410 Gone** — in favour of land-time
re-pointing. The stale advice to use it is removed from this workflow's
comment in the same change that adds this script.

## Scope and cost

Only PRs based on ``main`` are swept: this runs on a push to ``main``, so a
``develop``-based PR was not forked by it. ``alembic-graph-pr.yml`` does gate
``develop`` PRs too, and they are NOT covered here — say so rather than imply
the sweep is exhaustive.

Cost is one API call per open PR (its file list), plus a blob per changed
revision file and a comment listing per PR that actually carries one, plus a
single search for PRs holding a stale notice. With 16 open PRs that is ~20
calls; ``GITHUB_TOKEN``'s budget is 1,000/hour/repo. It scales linearly with
open PRs, so on a repo with hundreds, watch it.

Exit codes: 0 the sweep ran to completion (whether or not it found forks), 2
it could not run or could not finish — no token, ``main``'s own chain
unreadable, or one or more PRs that could not be swept. Silence is never
success: a sweep that skipped PRs must not look like a sweep that found
nothing. Per-PR failures are collected rather than fatal on the spot, so one
transient 502 cannot leave the rest of the PRs unnotified.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _alembic_graph import (  # noqa: E402
    VERSIONS_DIR,
    plan_remediation,
    read_dir_sources,
    safe_id,
    scan_dir,
    scan_sources,
)
from _gate_lib import EXIT_VACUOUS, REPO_ROOT, err, note  # noqa: E402

MARKER = "<!-- alembic-fork-notice -->"
#: HTTP statuses worth a second look: 5xx, secondary rate limit, primary
#: rate limit. Everything else is an answer.
RETRYABLE_STATUS = frozenset({403, 429, 500, 502, 503, 504})
RETRIES = 3
BACKOFF_SECONDS = 2.0
API_ROOT = os.environ.get("GITHUB_API_URL", "https://api.github.com")


class ApiError(RuntimeError):
    """A GitHub API call failed. Always fatal — never swallowed into a pass."""


def _request(
    url: str,
    token: str,
    *,
    method: str = "GET",
    body: dict | None = None,
    accept: str = "application/vnd.github+json",
) -> tuple[object, dict[str, str]]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Accept", accept)
    request.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    # Retry the transient shapes only: 5xx, the secondary-rate-limit 403, the
    # primary 429, and connection errors. A 404 or a 422 is an answer, not a
    # blip, and retrying it just burns budget.
    last: Exception | None = None
    for attempt in range(RETRIES):
        if attempt:
            time.sleep(BACKOFF_SECONDS * (2 ** (attempt - 1)))
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                headers = {k.lower(): v for k, v in response.headers.items()}
            break
        except urllib.error.HTTPError as exc:  # pragma: no cover - network path
            detail = exc.read()[:400]
            last = ApiError(f"{method} {url} -> HTTP {exc.code}: {detail!r}")
            if exc.code not in RETRYABLE_STATUS:
                raise last from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network path
            last = ApiError(f"{method} {url} -> {exc.reason}")
    else:
        raise last or ApiError(f"{method} {url} -> exhausted {RETRIES} attempts")
    if accept.endswith("raw"):
        return raw.decode("utf-8", errors="replace"), headers
    return (json.loads(raw) if raw else None), headers


def _paginate(url: str, token: str) -> list[dict]:
    """Follow ``Link: rel="next"`` to the end. A truncated sweep is a lie."""
    out: list[dict] = []
    while url:
        page, headers = _request(url, token)
        if not isinstance(page, list):
            raise ApiError(f"expected a list from {url}, got {type(page).__name__}")
        out.extend(page)
        url = ""
        for part in headers.get("link", "").split(","):
            if 'rel="next"' in part:
                url = part.split(";")[0].strip().strip("<>")
    return out


def open_prs(repo: str, token: str) -> list[dict]:
    query = urllib.parse.urlencode({"state": "open", "per_page": "100", "base": "main"})
    return _paginate(f"{API_ROOT}/repos/{repo}/pulls?{query}", token)


def pr_version_files(repo: str, number: int, token: str) -> list[dict]:
    """This PR's changes to files the GATE would actually scan.

    The filter must match ``scan_dir``'s ``glob("*.py")`` exactly — directly
    in the dir, ``.py`` only. A looser prefix match would flag a PR adding
    ``backend/alembic/versions/sub/x.py`` as forked while `alembic-heads-pr`
    passes it green, i.e. tell an author their required check is red when it
    is not. Disagreeing with the gate is the one thing this must never do.
    """
    files = _paginate(
        f"{API_ROOT}/repos/{repo}/pulls/{number}/files?per_page=100", token
    )
    prefix = f"{VERSIONS_DIR}/"
    return [
        f
        for f in files
        if (name := str(f.get("filename", ""))).startswith(prefix)
        and name.endswith(".py")
        and "/" not in name[len(prefix) :]
    ]


def blob_at(repo: str, path: str, ref: str, token: str) -> str:
    query = urllib.parse.urlencode({"ref": ref})
    url = f"{API_ROOT}/repos/{repo}/contents/{urllib.parse.quote(path)}?{query}"
    text, _ = _request(url, token, accept="application/vnd.github.raw")
    assert isinstance(text, str)
    return text


def simulate(
    main_sources: dict[Path, str],
    repo: str,
    pr: dict,
    touched: list[dict],
    token: str,
) -> dict[Path, str]:
    """``main``'s versions dir with this PR's revision files overlaid.

    This is the same construction the PR gate would see after the PR updates
    its base onto the new ``main`` — branch protection is ``strict``, so it
    must — which is why it is a simulation and not a guess.
    """
    sources = dict(main_sources)
    head_sha = pr["head"]["sha"]
    # `touched` is passed in rather than re-fetched: main() already paid for
    # this PR's file list, and the sweep's cost is dominated by one API call
    # per open PR.
    for entry in touched:
        path = REPO_ROOT / entry["filename"]
        if entry.get("status") == "removed":
            sources.pop(path, None)
            continue
        sources[path] = blob_at(repo, entry["filename"], head_sha, token)
    return sources


def render_comment(heads: tuple[str, ...], remediation, landed_sha: str) -> str:
    lines = [
        MARKER,
        "### ⚠️ A land on `main` just forked this PR's alembic chain",
        "",
        f"`main` moved to `{landed_sha[:8]}` with a new revision. Rebuilt against it,",
        f"this PR's chain has **{len(heads)} heads**:",
        "",
        # `safe_id`, not the raw id: these come from a `(.+?)` capture in a
        # file the PR author controls, and this comment is posted by a bot.
        # An id like ``a` @org/team `b`` would close the code span and fire
        # a real team mention.
        *[f"- `{safe_id(h)}`" for h in heads],
        "",
        "`alembic-heads-pr` is a required check and will be red until this is",
        "resolved. Nothing is wrong with the code in this PR — the revision it",
        "carries was authored off what was then the single head, and a sibling",
        "landed underneath it.",
        "",
    ]
    if remediation.kind == "repoint":
        lines += [
            "**Fix — one token.** Set",
            "",
            "```python",
            f'down_revision: str | Sequence[str] | None = "{safe_id(remediation.target or "")}"',
            "```",
            "",
            "in:",
            "",
            *[
                f"- `{path.relative_to(REPO_ROOT) if path else safe_id(revision)}`"
                for revision, path in remediation.edits
            ],
            "",
            "(that is the shallowest **unlanded** revision on the forked chain —",
            "anything stacked above it travels along unchanged and must not be",
            "touched), update its `Revises:` docstring line to match, update this",
            "branch onto `main`, and push.",
            "",
            "**Do not run `alembic merge` for this.** A merge revision is correct",
            "only when both heads have already landed; the forked revision here is",
            "unlanded, so re-pointing costs one token and leaves nothing behind,",
            "while a merge revision would be permanent bookkeeping in the chain.",
        ]
    else:
        lines += [
            "This one does not reduce to a single re-point "
            f"(`{remediation.kind}`): landed head(s) "
            f"{', '.join(f'`{safe_id(h)}`' for h in remediation.landed_heads) or '(none)'}, "
            "unlanded head(s) "
            f"{', '.join(f'`{safe_id(h)}`' for h in remediation.unlanded_heads) or '(none)'}.",
            "",
            "Run `python scripts/ci/count_alembic_heads.py` locally for the full",
            "diagnosis rather than guessing an order from this comment.",
        ]
    lines += [
        "",
        "---",
        "<sub>Posted by `scripts/ci/notify_forked_open_prs.py` from",
        "`.github/workflows/alembic-graph-check.yml`. It only comments; it never",
        "rewrites your branch.</sub>",
    ]
    return "\n".join(lines)


RESOLVED_BODY = "\n".join(
    [
        MARKER,
        "### ✅ Alembic chain fork resolved",
        "",
        "This PR's chain rebuilt against current `main` has a single head again.",
        "The earlier fork notice no longer applies.",
    ]
)


def find_marker_comment(repo: str, number: int, token: str) -> dict | None:
    """This script's own comment on ``number``, or ``None``. One API call."""
    comments = _paginate(
        f"{API_ROOT}/repos/{repo}/issues/{number}/comments?per_page=100", token
    )
    return next((c for c in comments if MARKER in str(c.get("body", ""))), None)


def write_comment(
    repo: str,
    number: int,
    body: str,
    token: str,
    existing: dict | None,
    *,
    dry_run: bool,
) -> str:
    """Edit ``existing`` if given, else post. Never a second marker comment."""
    if existing is not None and str(existing.get("body", "")).strip() == body.strip():
        return "unchanged"
    if dry_run:
        return "would-edit" if existing else "would-post"
    if existing is not None:
        _request(
            f"{API_ROOT}/repos/{repo}/issues/comments/{existing['id']}",
            token,
            method="PATCH",
            body={"body": body},
        )
        return "edited"
    _request(
        f"{API_ROOT}/repos/{repo}/issues/{number}/comments",
        token,
        method="POST",
        body={"body": body},
    )
    return "posted"


def prs_carrying_a_notice(repo: str, token: str) -> set[int] | None:
    """Open PRs that already carry this script's marker comment.

    ONE search call, so that a PR which has since dropped its revision file
    still gets its stale "your chain forked" notice cleared. Without this the
    per-PR loop skips it (it no longer touches the dir) and the false warning
    stands forever.

    Returns ``None`` on failure — UNKNOWN, so the caller says "could not
    check" rather than "nobody was notified". Search is eventually consistent,
    so a miss just means the next land clears it; a false positive is
    impossible because the marker is re-verified before anything is written.
    """
    query = urllib.parse.urlencode(
        {"q": f'repo:{repo} is:pr is:open "{MARKER}" in:comments', "per_page": "100"}
    )
    try:
        page, _ = _request(f"{API_ROOT}/search/issues?{query}", token)
    except ApiError as exc:
        err(f"could not search for existing fork notices: {exc}")
        return None
    if not isinstance(page, dict) or "items" not in page:
        return None
    return {int(item["number"]) for item in page["items"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute and print what would be posted, without writing anything.",
    )
    parser.add_argument(
        "--repo",
        default=os.environ.get("GITHUB_REPOSITORY", ""),
        help="owner/name. Defaults to $GITHUB_REPOSITORY.",
    )
    parser.add_argument(
        "--sha",
        default=os.environ.get("GITHUB_SHA", ""),
        help="The landed commit, named in the comment. Defaults to $GITHUB_SHA.",
    )
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        err("GITHUB_TOKEN is not set; cannot sweep open PRs.")
        err("This is UNKNOWN, not 'no PRs were forked'.")
        return EXIT_VACUOUS
    if not args.repo:
        err("--repo / $GITHUB_REPOSITORY is empty; cannot sweep open PRs.")
        return EXIT_VACUOUS

    versions = REPO_ROOT / VERSIONS_DIR
    if not versions.is_dir():
        err(f"{VERSIONS_DIR}/ does not exist under {REPO_ROOT}.")
        return EXIT_VACUOUS
    main_scan = scan_dir(versions)
    if not main_scan.revisions:
        err(f"parsed zero revisions from {VERSIONS_DIR}/ — the scan proved nothing.")
        return EXIT_VACUOUS
    if len(main_scan.heads) != 1:
        # `main` itself is forked. The workflow's own comment on the merging PR
        # covers that; simulating other PRs against a broken baseline would
        # produce advice keyed off a head that should not exist.
        err(
            f"`main` itself has {len(main_scan.heads)} heads "
            f"({', '.join(main_scan.heads) or 'none'}) — fix that first."
        )
        err(
            "Skipping the open-PR sweep rather than advising against a forked baseline."
        )
        return EXIT_VACUOUS
    note(f"main head: {main_scan.heads[0]} ({len(main_scan.revisions)} revisions)")

    # Reuse what `scan_dir` already read rather than reading 500 files twice.
    main_sources = read_dir_sources(versions)
    landed = set(main_scan.revisions)

    try:
        prs = open_prs(args.repo, token)
    except ApiError as exc:
        err(f"could not list open PRs: {exc}")
        return EXIT_VACUOUS
    note(f"open PRs against main: {len(prs)}")

    notified = prs_carrying_a_notice(args.repo, token)
    if notified is None:
        note("existing-notice search failed: stale notices will not be cleared.")

    # Per-PR failures are COLLECTED, not fatal on the spot. One 502 on PR #17
    # must not leave #18..#N unnotified — the whole point of this script is
    # that the affected authors hear about it. The job still reddens at the
    # end, so a partial sweep is never mistaken for a clean one.
    failures: list[str] = []
    examined = forked = cleared = 0
    for pr in prs:
        number = int(pr["number"])
        try:
            touched = pr_version_files(args.repo, number, token)
        except ApiError as exc:
            failures.append(f"#{number}: could not list files: {exc}")
            continue

        if not touched:
            # Nothing to check — but it may still be carrying a notice from an
            # earlier land, which is now a lie.
            if notified and number in notified:
                try:
                    existing = find_marker_comment(args.repo, number, token)
                    if existing is not None:
                        result = write_comment(
                            args.repo,
                            number,
                            RESOLVED_BODY,
                            token,
                            existing,
                            dry_run=args.dry_run,
                        )
                        cleared += 1
                        note(
                            f"#{number}: no longer carries a revision; notice {result}"
                        )
                except ApiError as exc:
                    failures.append(f"#{number}: could not clear its notice: {exc}")
            continue

        examined += 1
        try:
            sources = simulate(main_sources, args.repo, pr, touched, token)
        except ApiError as exc:
            failures.append(f"#{number}: could not read its revision files: {exc}")
            continue
        scan = scan_sources(sources)

        if not scan.heads:
            # A zero-head chain is a CYCLE. `count_alembic_heads.py` exits 2 on
            # exactly this tree, so it is not "ok" and its notice must not be
            # cleared — but it is also not the fork this script describes, and
            # posting the fork text would be wrong. Report and leave alone.
            failures.append(
                f"#{number}: simulated chain has ZERO heads (a cycle) — "
                "not a fork; left untouched"
            )
            continue

        if len(scan.heads) == 1:
            note(f"#{number}: single head ({scan.heads[0]}) — ok")
            try:
                existing = find_marker_comment(args.repo, number, token)
            except ApiError as exc:
                failures.append(f"#{number}: could not read comments: {exc}")
                continue
            # Only clear a notice that is actually there; never post a
            # "resolved" comment to a PR that was never told it was forked.
            if existing is not None:
                try:
                    result = write_comment(
                        args.repo,
                        number,
                        RESOLVED_BODY,
                        token,
                        existing,
                        dry_run=args.dry_run,
                    )
                except ApiError as exc:
                    failures.append(f"#{number}: could not clear its notice: {exc}")
                    continue
                cleared += 1
                note(f"#{number}: fork notice cleared ({result})")
            continue

        forked += 1
        remediation = plan_remediation(scan, landed)
        body = render_comment(scan.heads, remediation, args.sha or "main")
        try:
            existing = find_marker_comment(args.repo, number, token)
            result = write_comment(
                args.repo, number, body, token, existing, dry_run=args.dry_run
            )
        except ApiError as exc:
            failures.append(f"#{number}: could not comment: {exc}")
            continue
        note(
            f"#{number}: FORKED — heads {', '.join(scan.heads)}; "
            f"remedy={remediation.kind} target={remediation.target}; comment={result}"
        )
        if args.dry_run:
            note("---- comment body ----")
            note(body)
            note("---- end ----")

    note(
        f"swept {len(prs)} open PR(s); {examined} touch {VERSIONS_DIR}/; "
        f"{forked} forked; {cleared} notice(s) cleared."
    )
    if failures:
        for failure in failures:
            err(failure)
        err(
            f"{len(failures)} PR(s) could not be swept — this run is INCOMPLETE, "
            "not clean."
        )
        return EXIT_VACUOUS
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
