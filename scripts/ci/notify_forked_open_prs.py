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

The ONE relaxation of that rule, stated so it is not a surprise: a failed
notice SEARCH (:func:`prs_carrying_a_notice`) logs and returns ``None``
without changing the exit code. It only drives best-effort clearing of stale
notices on PRs that no longer carry a revision; nothing about the current
land's correctness depends on it, and the next land retries.
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
#: Statuses ALWAYS worth a second look on an idempotent request. 403 is not
#: here because it is CONDITIONAL — see `_is_retryable`, which retries the
#: rate-limit 403 and refuses the permissions 403. Do not read this constant
#: on its own as "403 is never retried".
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
#: Methods safe to replay, limited to the ones this file actually issues.
#:
#: POST is NOT one: GitHub can 502 *after* the write commits, so retrying
#: `POST /issues/{n}/comments` posts two marker comments on one PR — the exact
#: duplicate the marker upsert and the workflow's `concurrency:` group both
#: exist to prevent. It gets read-back idempotency instead (`_post_comment`),
#: which is safe AND keeps the resilience a blanket refusal would throw away.
#:
#: DELETE is deliberately ABSENT even though it is idempotent by EFFECT: it is
#: not idempotent by observed STATUS. A DELETE that commits and then 502s
#: answers 404 on replay, 404 is not retryable, so the run would report a
#: FAILURE for a delete that SUCCEEDED. If a real delete is ever added here
#: (removing a stale notice rather than rewriting it), treat 404-after-a-
#: retried-DELETE as success before adding DELETE to this set. HEAD and PUT
#: are omitted on the same principle: nothing here issues them, so nothing
#: here allows them.
IDEMPOTENT_METHODS = frozenset({"GET", "PATCH"})
RETRIES = 3
BACKOFF_SECONDS = 2.0
#: Ceiling on an honoured `Retry-After` / `x-ratelimit-reset`. GitHub's primary
#: limit can reset an hour out and its secondary asks for >=60s; a CI job must
#: not sit there. Past this we give up and say so rather than sleep.
MAX_HONOURED_DELAY_SECONDS = 90.0
API_ROOT = os.environ.get("GITHUB_API_URL", "https://api.github.com")


class ApiError(RuntimeError):
    """A GitHub API call failed. Always fatal — never swallowed into a pass."""


def _is_retryable(status: int, headers: dict[str, str], detail: bytes = b"") -> bool:
    """Is this status worth another attempt?

    403 is the interesting one and must not be blanket-retryable in EITHER
    direction. GitHub uses it for two unrelated things: a rate limit
    (transient) and ``Resource not accessible by integration`` (a permissions
    failure — the exact class ``issues: write`` was added to defend against).
    Retrying the latter buys attempts and sleep before the identical failure;
    refusing the former gives up on something that would have succeeded.

    Headers alone cannot make that call: a secondary-rate-limit 403 carrying
    NEITHER ``retry-after`` nor ``x-ratelimit-remaining: 0`` is a documented
    GitHub shape, and classifying it as a permissions failure hard-fails a
    sweep that only needed to wait. The response BODY is the strong signal and
    the caller already has it, so read that first and fall back to headers.
    """
    if status in RETRYABLE_STATUS:
        return True
    if status != 403:
        return False
    body = detail.lower()
    if b"rate limit" in body:
        return True
    if b"not accessible" in body or b"must have admin rights" in body:
        return False
    return (
        bool(headers.get("retry-after")) or headers.get("x-ratelimit-remaining") == "0"
    )


def _retry_delay(attempt: int, headers: dict[str, str]) -> float | None:
    """Seconds to wait before ``attempt``, or ``None`` meaning give up loudly.

    A fixed 2s/4s ladder is useless against a rate limit that asks for 60s: it
    burns three attempts and six seconds and then fails identically — exactly
    the waste this module criticises for the permissions 403. Honour what the
    server asked for, up to :data:`MAX_HONOURED_DELAY_SECONDS`. Past that,
    sleeping is not a strategy a CI job can use, so return ``None`` and let
    the caller fail loudly rather than pretend a retry will help.
    """
    raw = headers.get("retry-after", "").strip()
    asked: float | None = None
    if raw.isdigit():
        # GitHub sends delay-seconds here. The legal HTTP-date form is not
        # parsed; it falls through to the plain ladder rather than being
        # silently misread as zero.
        asked = float(raw)
    elif headers.get("x-ratelimit-remaining") == "0":
        reset = headers.get("x-ratelimit-reset", "").strip()
        if reset.isdigit():
            asked = max(0.0, float(reset) - time.time())
    if asked is None:
        return BACKOFF_SECONDS * (2 ** (attempt - 1))
    return None if asked > MAX_HONOURED_DELAY_SECONDS else asked


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
    # Retry the transient shapes only, and ONLY on a replayable method. A 404
    # or a 422 is an answer, not a blip, and retrying it just burns budget.
    attempts = RETRIES if method in IDEMPOTENT_METHODS else 1
    last: Exception | None = None
    delay = 0.0
    for attempt in range(attempts):
        if attempt:
            time.sleep(delay)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                headers = {k.lower(): v for k, v in response.headers.items()}
            break
        except urllib.error.HTTPError as exc:  # pragma: no cover - network path
            detail = exc.read()[:400]
            headers = (
                {k.lower(): v for k, v in exc.headers.items()} if exc.headers else {}
            )
            last = ApiError(f"{method} {url} -> HTTP {exc.code}: {detail!r}")
            if not _is_retryable(exc.code, headers, detail):
                raise last from exc
            wait = _retry_delay(attempt + 1, headers)
            if wait is None:
                raise ApiError(
                    f"{method} {url} -> HTTP {exc.code}, and the server asked for a "
                    f"wait longer than {MAX_HONOURED_DELAY_SECONDS:.0f}s; "
                    "not sleeping through it"
                ) from exc
            delay = wait
        except urllib.error.URLError as exc:  # pragma: no cover - network path
            last = ApiError(f"{method} {url} -> {exc.reason}")
            delay = BACKOFF_SECONDS * (2**attempt)
    else:
        raise last or ApiError(f"{method} {url} -> exhausted {attempts} attempt(s)")
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


def _in_versions_dir(name: str) -> bool:
    """Would ``scan_dir`` scan this path? Non-recursive, ``.py`` only."""
    prefix = f"{VERSIONS_DIR}/"
    return (
        name.startswith(prefix)
        and name.endswith(".py")
        and "/" not in name[len(prefix) :]
    )


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
    return [f for f in files if _in_versions_dir(str(f.get("filename", "")))]


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


def _pretty_path(revision: str, path: Path | None) -> str:
    """A pasteable location. Repo-relative when it can be, never a crash.

    `Path.relative_to` RAISES when the path is not under the root — it does
    not fall back — so an unguarded call here turns a rendering detail into
    an exception that aborts the whole sweep.
    """
    if path is None:
        return safe_id(revision)
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _edit_lines(remediation) -> list[str]:
    """The `set this token in these files` block, shared by two branches."""
    return [
        "```python",
        f'down_revision: str | Sequence[str] | None = "{safe_id(remediation.target or "")}"',
        "```",
        "",
        "in:",
        "",
        *[
            f"- `{_pretty_path(revision, path)}`"
            for revision, path in remediation.edits
        ],
        "",
        "(that is the shallowest **unlanded** revision on the forked chain —",
        "anything stacked above it travels along unchanged and must not be",
        "touched), and update its `Revises:` docstring line to match.",
    ]


BLOCK_ADVICE = {
    "merge_revision": (
        "is a MERGE revision: its `down_revision` is a tuple. **APPEND** the "
        "landed head to that tuple — replacing it with a scalar would drop the "
        "existing merge parents and ADD heads."
    ),
    "cycle": (
        "sits on a CYCLE, so there is no shallowest revision to re-point. "
        "Break the cycle first; the chain is unupgradable until you do."
    ),
}


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
        lines += ["**Fix — one token.** Set", "", *_edit_lines(remediation), ""]
        lines += [
            "Then update this branch onto `main` and push.",
            "",
            "**Do not run `alembic merge` for this.** A merge revision is correct",
            "only when both heads have already landed; the forked revision here is",
            "unlanded, so re-pointing costs one token and leaves nothing behind,",
            "while a merge revision would be permanent bookkeeping in the chain.",
        ]
    elif remediation.kind == "blocked":
        # Name BOTH halves. Degrading the whole answer and mentioning only the
        # blocked chain left the author never told that the other fork did
        # have a one-token fix, so it took two rounds instead of one.
        if remediation.edits and remediation.target:
            lines += [
                "**Part of this is one token.** Set",
                "",
                *_edit_lines(remediation),
                "",
            ]
        lines += ["**But at least one chain needs more than a re-point:**", ""]
        for head, reason, blocker in remediation.blocked:
            named = safe_id(blocker or head)
            lines.append(
                f"- head `{safe_id(head)}` — `{named}` "
                f"{BLOCK_ADVICE.get(reason, f'is blocked ({reason}).')}"
            )
        lines += [
            "",
            "Run `python scripts/ci/count_alembic_heads.py` locally for the full",
            "diagnosis before editing anything named above.",
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
    return _post_comment(repo, number, body, token)


def _post_comment(repo: str, number: int, body: str, token: str) -> str:
    """POST once; on failure, READ BACK before deciding whether to POST again.

    POST cannot be blindly replayed — GitHub can 502 after the write commits,
    and the replay would post a second marker comment. But refusing to retry
    at all throws away resilience the code had before: a connection reset that
    never reached GitHub leaves that PR unnotified until the NEXT land
    touching the versions dir, an interval this module's own docstring
    measures in DAYS. Read-back gets both properties. If the marker is there
    now, the write landed and only the response was lost; if it is not, the
    write did not land and one more POST is safe.
    """
    url = f"{API_ROOT}/repos/{repo}/issues/{number}/comments"
    try:
        _request(url, token, method="POST", body={"body": body})
        return "posted"
    except ApiError as first:
        try:
            landed = find_marker_comment(repo, number, token)
        except ApiError:
            # Could not establish what happened. Surface the ORIGINAL failure
            # rather than the read error, and never guess that it worked.
            raise first from None
        if landed is not None:
            return "posted"
        _request(url, token, method="POST", body={"body": body})
        return "posted-on-retry"


def prs_carrying_a_notice(repo: str, token: str) -> tuple[set[int] | None, str]:
    """``(open PRs already carrying this script's marker, partial-reason)``.

    ONE search call, so that a PR which has since dropped its revision file
    still gets its stale "your chain forked" notice cleared. Without it the
    per-PR loop skips that PR (it no longer touches the dir) and the false
    warning stands.

    The set is ``None`` on FAILURE — UNKNOWN, so the caller says "could not
    check" rather than "nobody was notified". That case is best-effort and is
    the one place this module tolerates a non-reddening gap.

    The second element is a DIFFERENT thing: non-empty when the search
    SUCCEEDED and its answer is knowingly incomplete. That is not the blessed
    case, and the caller must treat it as a failure — otherwise PRs keep a
    false notice while the job looks clean.

    Search is eventually consistent, so a miss just means a later land clears
    it; a false positive is impossible because the marker is re-verified
    before anything is written.
    """
    query = urllib.parse.urlencode(
        {"q": f'repo:{repo} is:pr is:open "{MARKER}" in:comments', "per_page": "100"}
    )
    try:
        page, _ = _request(f"{API_ROOT}/search/issues?{query}", token)
    except ApiError as exc:
        err(f"could not search for existing fork notices: {exc}")
        return None, ""
    if not isinstance(page, dict) or "items" not in page:
        return None, ""
    items = page["items"]
    total = page.get("total_count")
    partial = ""
    # 100 is GitHub's hard per-page cap and this is one un-paginated request,
    # so this can only fire above 100 carriers — unreachable on a repo with
    # ~16 open PRs, but structural rather than decorative: it must say so
    # rather than truncate in silence.
    if isinstance(total, int) and total > len(items):
        partial = (
            f"{total} PRs carry a fork notice but only {len(items)} were listed; "
            f"{total - len(items)} may still be showing a stale one."
        )
    elif page.get("incomplete_results"):
        partial = "GitHub reported the notice search as incomplete (it timed out)."
    if partial:
        err(partial)
    return {int(item["number"]) for item in items}, partial


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

    notified, notice_search_partial = prs_carrying_a_notice(args.repo, token)
    if notified is None:
        note("existing-notice search failed: stale notices will not be cleared.")

    # Per-PR failures are COLLECTED, not fatal on the spot. One 502 on PR #17
    # must not leave #18..#N unnotified — the whole point of this script is
    # that the affected authors hear about it. The job still reddens at the
    # end, so a partial sweep is never mistaken for a clean one.
    failures: list[str] = []
    if notice_search_partial:
        # The search SUCCEEDED and returned a knowingly-incomplete answer. That
        # is not the blessed best-effort case (a FAILED search), and leaving it
        # green would let PRs keep a false notice while the job reads clean.
        failures.append(notice_search_partial)
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
            if notified is not None and number in notified:
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
                        # Count only a REAL write. RESOLVED_BODY persists once
                        # written, so an unguarded increment re-reports the
                        # same PR as "cleared" on every subsequent land — a
                        # permanently wrong number in the one line an operator
                        # reads.
                        if result not in {"unchanged", "would-edit", "would-post"}:
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
                if result not in {"unchanged", "would-edit", "would-post"}:
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
