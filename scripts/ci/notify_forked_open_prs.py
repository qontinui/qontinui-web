#!/usr/bin/env python3
"""Tell every open PR that THIS land just forked its alembic chain.

Invoked by ``.github/workflows/alembic-graph-check.yml`` on every push to
``main`` that touches ``backend/alembic/versions/``, and on a manual
``workflow_dispatch`` of that workflow (which exists because the paths filter
means a change to this sweep never re-fires the lane that runs it).

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
more than one head it comments the **exact re-point**: the ``down_revision``
token to adopt, which was the core of the fix in 3 of 3 recorded cases, plus
the two sites that must move with it — the module docstring's ``Revises:``
line and the ``_PARENT_REVISION_ID`` pin in the revision's migration test.
Advice naming only the token turned a red head count into a red test suite
on #1216, because several of those tests assert the pin equals
``down_revision``.

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

Only PRs based on ``main`` are swept: this runs on a push to ``main`` (or a
dispatch against it), so a ``develop``-based PR was not forked by it. ``alembic-graph-pr.yml`` does gate
``develop`` PRs too, and they are NOT covered here — say so rather than imply
the sweep is exhaustive.

Cost is one API call per open PR (its file list), plus a blob per changed
revision file and a comment listing per PR that actually carries one, plus a
single search for PRs holding a stale notice. A PR that needs a re-point
reuses that same file list and adds one blob per CANDIDATE test file under
``backend/tests/`` — an added file whose patch never mentions
``_PARENT_REVISION_ID`` is not downloaded. With 16 open PRs that is ~20
calls; ``GITHUB_TOKEN``'s budget is 1,000/hour/repo. It scales linearly with
open PRs, so on a repo with hundreds, watch it.

Exit codes: 0 the sweep ran to completion (whether or not it found forks), 2
it could not run or could not finish — no token, ``main``'s own chain
unreadable, or one or more PRs that could not be swept. Silence is never
success: a sweep that skipped PRs must not look like a sweep that found
nothing. Per-PR failures are collected rather than fatal on the spot, so one
transient 502 cannot leave the rest of the PRs unnotified.

**A FINDING ABOUT A PR IS NOT A FAILURE OF THE SWEEP**, and the exit code
turns on that distinction. ``2`` means *this sweep proved nothing* about one
or more PRs. It does not mean *the sweep found something bad*: the whole
point of the run is to find forks, and a fork has always exited 0. The two
un-adviseable trees below — a duplicate revision id, and a zero-head chain
(a cycle) — are verdicts in exactly that class. The sweep read the PR, built
its simulated tree and reached a definite answer; what it declined to do was
post fork text that would be wrong. They are reported as annotations and
counted in the summary, and they leave the exit code alone.

Routing them to ``2`` instead reddened this lane on ``main`` for a defect
wholly contained in ONE unmerged PR, while ``main``'s own chain was provably
single-headed — a red that no commit to ``main`` could clear, because the
offending file was not in ``main``. Their real gate is the PR's own required
``alembic-heads-pr`` check: ``count_alembic_heads.py`` exits 2 on both of
these trees, and ``alembic-graph-pr.yml`` runs it on every PR against the
merge ref — no ``paths:`` filter and ``main`` still in its branch list, both
deliberately. Three of the four links are asserted by tests: the counter's
verdict, the invocation, and the workflow narrowings that would silently
reopen this hole. The REMAINING link — that the check is REQUIRED and
protection is strict, so a stale-base PR must re-run it before it can land —
is a GitHub setting that nothing in this tree can observe, and it is the
load-bearing premise of the paragraph above: relax it and this lane's
tolerance silently becomes a hole.

The ONE relaxation of the FAILURE rule — not of the finding rule two
paragraphs above, which is a separate thing — stated so it is not a surprise:
a failed notice SEARCH (:func:`prs_carrying_a_notice`) logs and returns
``None`` without changing the exit code. It only drives best-effort clearing
of stale notices on PRs that no longer carry a revision; nothing about the
current land's correctness depends on it, and the next land retries.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _alembic_graph import (  # noqa: E402
    TESTS_DIR,
    VERSIONS_DIR,
    RepointSites,
    Scan,
    computed_pin_text,
    duplicate_groups,
    mismatched_pin_text,
    no_pin_found_text,
    plan_remediation,
    plan_repoint_sites,
    read_dir_sources,
    safe_id,
    scan_dir,
    scan_sources,
)
from _gate_lib import (  # noqa: E402
    EXIT_VACUOUS,
    REPO_ROOT,
    err,
    note,
    repo_relative,
)

MARKER = "<!-- alembic-fork-notice -->"
API_ROOT = os.environ.get("GITHUB_API_URL", "https://api.github.com")


class ApiError(RuntimeError):
    """A GitHub API call failed. Never swallowed into a pass.

    Every raise is recorded as a FAILURE that makes the sweep exit 2 — with ONE
    exception. A failed read of a PR's test files (:func:`pr_test_sources`) is
    used only to word the ``_PARENT_REVISION_ID`` advice, not to decide
    anything, so it is recorded as a finding: the notice still posts and says
    the pin search is UNKNOWN, and the exit code does not move.
    """


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
    # ONE attempt, deliberately. There is no retry layer here any more.
    #
    # Four of the six blockers found reviewing this file lived in a
    # hand-rolled retry, and each fix was locally correct while getting the
    # blast radius wrong in a new direction: a replayed POST that duplicated
    # a comment, a 403 classifier that hard-failed a wait-and-succeed, a
    # rate-limit cap that hard-failed a trivially retryable 5xx, and a
    # read-back that turned a transient duplicate into a PERMANENT one.
    #
    # The complexity never paid for itself, because this module's job is
    # NOTIFICATION, not delivery. Every failure is recorded and reddens the
    # job, the workflow re-runs on the next push to the versions dir, and a
    # human can re-run a red job immediately — which is a better retry than
    # this code was, because it has context. Not re-POSTing is also the only
    # way to be certain a duplicate marker comment is never created.
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            headers = {k.lower(): v for k, v in response.headers.items()}
    except urllib.error.HTTPError as exc:  # pragma: no cover - network path
        raise ApiError(
            f"{method} {url} -> HTTP {exc.code}: {exc.read()[:400]!r}"
        ) from exc
    except urllib.error.URLError as exc:  # pragma: no cover - network path
        raise ApiError(f"{method} {url} -> {exc.reason}") from exc
    except (OSError, http.client.HTTPException) as exc:
        # The body read can fail AFTER `urlopen` returned: a `TimeoutError` or
        # `ConnectionResetError` (both `OSError`) or `http.client.IncompleteRead`.
        # Unwrapped, any of them escaped every `except ApiError` in `main` and
        # crashed the sweep instead of being recorded against one PR.
        raise ApiError(f"{method} {url} -> {type(exc).__name__}: {exc}") from exc
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


def pr_files(repo: str, number: int, token: str) -> list[dict]:
    """EVERY file this PR changes. Listed ONCE per PR and filtered by callers."""
    return _paginate(
        f"{API_ROOT}/repos/{repo}/pulls/{number}/files?per_page=100", token
    )


def pr_version_files(files: list[dict]) -> list[dict]:
    """This PR's changes to files the GATE would actually scan.

    The filter must match ``scan_dir``'s ``glob("*.py")`` exactly — directly
    in the dir, ``.py`` only. A looser prefix match would flag a PR adding
    ``backend/alembic/versions/sub/x.py`` as forked while `alembic-heads-pr`
    passes it green, i.e. tell an author their required check is red when it
    is not. Disagreeing with the gate is the one thing this must never do.
    """
    return [f for f in files if _in_versions_dir(str(f.get("filename", "")))]


def blob_at(repo: str, path: str, ref: str, token: str) -> str:
    query = urllib.parse.urlencode({"ref": ref})
    url = f"{API_ROOT}/repos/{repo}/contents/{urllib.parse.quote(path)}?{query}"
    text, _ = _request(url, token, accept="application/vnd.github.raw")
    assert isinstance(text, str)
    return text


def _in_tests_dir(name: str) -> bool:
    """A ``.py`` file anywhere under ``TESTS_DIR``."""
    return name.startswith(f"{TESTS_DIR}/") and name.endswith(".py")


#: GitHub's "list pull request files" endpoint returns at most this many files,
#: however it is paginated. A listing that reaches it may be missing the very
#: test file that holds a pin, so the pin search is UNKNOWN there.
PR_FILES_LISTING_CAP = 3000


def _worth_downloading(entry: dict) -> bool:
    """Could this changed test file hold a ``_PARENT_REVISION_ID`` pin?

    Skipped ONLY when that is certain: an ADDED file whose ``patch`` is present
    is the whole file, so a patch never mentioning the constant proves the file
    has none. A modified file's patch shows only hunks — the pin can sit
    outside them — and GitHub omits ``patch`` on large diffs, so both of those
    are downloaded rather than guessed at.
    """
    name = str(entry.get("filename", ""))
    if not _in_tests_dir(name) or entry.get("status") == "removed":
        return False
    patch = entry.get("patch")
    # ASSUMPTION this skip rests on: for a diff too large to render, GitHub
    # OMITS `patch` rather than truncating it, so a present patch on an added
    # file is the whole file. If GitHub ever truncated instead, a pin past the
    # cut would be skipped and read as "no pin found". Separately, the listing
    # itself stops at PR_FILES_LISTING_CAP files; `main` checks that before
    # this runs.
    if entry.get("status") == "added" and isinstance(patch, str):
        return "_PARENT_REVISION_ID" in patch
    return True


def pr_test_sources(
    repo: str, pr: dict, files: list[dict], token: str
) -> dict[Path, str]:
    """``{path: text at the PR head}`` for the test files this PR changes.

    Where a forked revision's ``_PARENT_REVISION_ID`` pin lives: the revision
    is unlanded, so its migration test arrives in the same PR. ``files`` is the
    PR's listing that ``main`` already fetched with :func:`pr_files`, so this
    costs one blob per candidate test file and no second listing. Called only
    for a PR with a revision to re-point. Raises :class:`ApiError`; the caller
    records that as a finding and an UNKNOWN pin search.
    """
    head_sha = pr["head"]["sha"]
    return {
        REPO_ROOT / str(entry["filename"]): blob_at(
            repo, str(entry["filename"]), head_sha, token
        )
        for entry in files
        if _worth_downloading(entry)
    }


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
        # A RENAME must drop the old path, or `main`'s copy survives alongside
        # the PR's new one and the two declare the same revision id — a
        # duplicate the PR did not introduce, in a tree that does not exist.
        # The PR gate never sees it (the real checkout has only the new file),
        # so this simulation was the only place it could appear.
        previous = entry.get("previous_filename")
        if previous:
            sources.pop(REPO_ROOT / previous, None)
        sources[path] = blob_at(repo, entry["filename"], head_sha, token)
    return sources


def _pretty_path(revision: str, path: Path | None) -> str:
    """A pasteable location for a revision."""
    return repo_relative(path, safe_id(revision))


def _roots_block(remediation) -> list[str]:
    """Name the shallowest unlanded revision per chain when no single target.

    These were computed and then dropped on the arms without exactly one
    landed head, so the comment named the problem and withheld the file list
    it already had.
    """
    if not remediation.edits:
        return []
    return [
        "The shallowest **unlanded** revision on each forked chain is:",
        "",
        *[
            f"- `{_pretty_path(revision, path)}` (revision `{safe_id(revision)}`)"
            for revision, path in remediation.edits
        ],
        "",
        "Those are the files to edit — not the heads, which travel along",
        "unchanged. Re-pointing any of them is **three** edits: its",
        "`down_revision`, its module docstring's `Revises:` line, and the",
        f"`_PARENT_REVISION_ID` pin in its migration test under `{TESTS_DIR}/`.",
        "",
    ]


def _fence_safe(text: str) -> str:
    """One physical line, for a line placed inside a fenced code block.

    Every line this module fences starts with ``-``, ``+`` or ``#``, so no
    line can close the fence; the only remaining escape is an embedded
    newline, which a file path from a PR could carry.
    """
    return text.replace("\r", " ").replace("\n", " ")


def _site_block(
    revision: str,
    path: Path | None,
    target: str,
    sites: RepointSites | None,
    pin_scope: str | None,
) -> list[str]:
    """The three edit sites for re-pointing ONE revision, as markdown.

    ``sites is None`` means nobody read the file or searched for a pin, so the
    before-lines are named rather than quoted and the pin search is UNKNOWN.
    """
    where = _pretty_path(revision, path)
    rev = safe_id(revision)
    new = safe_id(target)
    fenced_where = _fence_safe(where)
    down_before = sites.down_revision[0] if sites else None
    down_after = (
        sites.down_revision[1]
        if sites
        else f'down_revision: str | Sequence[str] | None = "{new}"'
    )
    lines = [
        f"**`{where}`** (revision `{rev}`) — three edits:",
        "",
        "```diff",
        f"# 1. the down_revision assignment — {fenced_where}",
        f"- {_fence_safe(down_before)}"
        if down_before is not None
        else "# (its current down_revision line)",
        f"+ {_fence_safe(down_after)}",
    ]
    if sites is not None and sites.parent_unparsed:
        lines.append(
            "# (no parent literal parsed from down_revision — check it by hand)"
        )
    if sites is not None and sites.revises is None:
        lines.append(
            f"# 2. the module docstring has no Revises: line — {fenced_where}"
            " — nothing to change there"
        )
    else:
        revises_before = sites.revises[0] if sites and sites.revises else None
        lines += [
            f"# 2. the module docstring's Revises: line — {fenced_where}",
            f"- {_fence_safe(revises_before)}"
            if revises_before is not None
            else "# (its current Revises: line)",
            f"+ Revises: {new}",
        ]
    pins = sites.pins if sites else ()
    computed = sites.computed_pins if sites else ()
    for pin in pins:
        lines += [
            f"# 3. the test pin — {_fence_safe(repo_relative(pin.path))}:{pin.lineno}",
            f"- {_fence_safe(pin.before)}",
            f"+ {_fence_safe(pin.after)}",
        ]
    mismatched = sites.mismatched_pins if sites else ()
    for computed_pin in computed:
        lines += [
            f"# 3. the test pin — {_fence_safe(repo_relative(computed_pin.path))}:"
            f"{computed_pin.lineno} — computed, not literal: check it by hand",
            f"# {_fence_safe(computed_pin.line)}",
        ]
    for other in mismatched:
        lines += [
            f"# 3. the test pin — {_fence_safe(repo_relative(other.path))}:"
            f"{other.lineno} — names another parent: check it",
            f"# {_fence_safe(other.line)}",
        ]
    if not pins and not computed and not mismatched:
        lines.append("# 3. the test pin — see below")
    lines += ["```", ""]
    if computed:
        lines += [f"3. **Test pin:** {computed_pin_text()}.", ""]
    old_parent = sites.old_parent if sites else None
    for other in mismatched:
        location = _fence_safe(repo_relative(other.path)).replace("`", "")
        text = mismatched_pin_text(
            f"`{location}:{other.lineno}`",
            safe_id(other.value),
            safe_id(old_parent) if old_parent is not None else None,
            new_parent=new,
            parent_unparsed=bool(sites and sites.parent_unparsed),
        )
        lines += [f"3. **Test pin:** {text}.", ""]
    if not pins and not computed and not mismatched:
        if sites is None or pin_scope is None:
            lines += [
                "3. **Test pin: UNKNOWN** — the pin search did not complete. Look under",
                f"   `{TESTS_DIR}/` for this revision's migration test and set its",
                f'   `_PARENT_REVISION_ID` to `"{new}"` too; several of those tests',
                "   assert it equals `down_revision`.",
                "",
            ]
        else:
            lines += [
                f"3. **Test pin:** {no_pin_found_text(f'`{rev}`')}.",
                f"   (Searched: {pin_scope}.)",
                "",
            ]
    return lines


def _edit_lines(
    remediation,
    sites: dict[str, RepointSites] | None = None,
    pin_scope: str | None = None,
) -> list[str]:
    """The re-point block, shared by two branches — all three edit sites."""
    target = remediation.target or ""
    lines = [
        f"Re-point onto the landed head `{safe_id(target)}`. Each revision below",
        "is the shallowest **unlanded** revision on its forked chain — anything",
        "stacked above it travels along unchanged and must not be touched.",
        "",
        "A re-point is **three** edits. Skipping the test pin turns this red",
        "head count into a red test suite.",
        "",
    ]
    for revision, path in remediation.edits:
        lines += _site_block(
            revision, path, target, (sites or {}).get(revision), pin_scope
        )
    return lines


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


def render_comment(
    heads: tuple[str, ...],
    remediation,
    landed_sha: str,
    *,
    sites: dict[str, RepointSites] | None = None,
    pin_scope: str | None = None,
) -> str:
    """The fork notice for one PR.

    ``sites`` carries the exact before -> after lines per re-pointed revision,
    and ``pin_scope`` names what the pin search looked at. ``pin_scope is
    None`` means the search did not run, and the comment says UNKNOWN rather
    than implying the test has no pin.
    """
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
            "**Fix — a three-site re-point.**",
            "",
            *_edit_lines(remediation, sites, pin_scope),
        ]
        lines += [
            "Then update this branch onto `main`, run the revision's migration",
            "test, and push.",
            "",
            "**Do not run `alembic merge` for this.** A merge revision is correct",
            "only when both heads have already landed; the forked revision here is",
            "unlanded, so a re-point leaves nothing behind, while a merge revision",
            "would be permanent bookkeeping in the chain.",
        ]
    elif remediation.kind == "blocked":
        # Name BOTH halves. Degrading the whole answer and mentioning only the
        # blocked chain left the author never told that the other fork did
        # have a plain re-point, so it took two rounds instead of one.
        if remediation.edits and remediation.target:
            lines += [
                "**Part of this is a plain re-point.**",
                "",
                *_edit_lines(remediation, sites, pin_scope),
            ]
        elif remediation.edits:
            lines += _roots_block(remediation)
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
    elif remediation.kind == "unknown":
        # Say UNKNOWN. Printing a landed/unlanded split here would assert
        # something about a baseline that could not be read at all.
        lines += [
            "The baseline could not be read, so which of these heads already",
            "landed is **unknown** — and this comment will not guess. Run",
            "`python scripts/ci/count_alembic_heads.py` locally, where",
            "`origin/main` is available, for the exact token.",
        ]
    else:
        lines += _roots_block(remediation)
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


def _is_our_comment(comment: dict) -> bool:
    """Is this one of OURS, as opposed to a human quoting one of ours?

    `MARKER in body` is not enough. GitHub's "Quote reply" copies the raw
    markdown of the comment being quoted, HTML comment included, so a human
    replying to a fork notice produces a body containing the marker — which
    under a first-match lookup was merely confusing and under an all-matches
    lookup is worse: it raises a spurious "delete the extras" failure and
    REDDENS the job over a normal human reply.

    Every comment this script writes begins with the marker; a quote-reply
    always prefixes `> `. So anchor it. Deliberately NOT an author check: the
    token holder is `github-actions[bot]` in the workflow but need not be
    elsewhere, and a filter that stops recognising our own comments would
    post a fresh one on every land.
    """
    return str(comment.get("body") or "").lstrip().startswith(MARKER)


def find_marker_comments(repo: str, number: int, token: str) -> list[dict]:
    """EVERY comment on ``number`` carrying this script's marker. One API call.

    All of them, not just the first. A first-match-only lookup silently
    ORPHANS any duplicate: every later run edits comment #1 and nothing in
    this file can ever see, update or remove #2. Duplicates should be
    impossible now that nothing re-POSTs, but "impossible" is exactly the
    claim worth checking rather than assuming — so the caller reports any it
    finds instead of quietly editing around them.
    """
    comments = _paginate(
        f"{API_ROOT}/repos/{repo}/issues/{number}/comments?per_page=100", token
    )
    return [c for c in comments if _is_our_comment(c)]


# Carried by the two content-defect messages and by nothing else. It used to
# live in the shared trailer, which was wrong the moment `_report_duplicates`
# joined `findings`: `alembic-heads-pr` counts revision heads and has no
# opinion at all about duplicate bot comments, so the trailer was telling a
# reader that an irrelevant gate had their finding covered. A remedy belongs
# to the finding that earned it.
_GATED_BY_THE_PR_LANE = (
    "This lane does not read check status: the PR's own `alembic-heads-pr` "
    "check counts the same tree and SHOULD be red on it — verify that before "
    "landing the PR."
)


def content_defect(number: int, scan: Scan) -> str | None:
    """Describe a defect in the PR's OWN simulated tree, or ``None`` if clean.

    The two trees whose head count is not a verdict, so the fork text this
    script posts would be wrong: a DUPLICATE revision id (two files declaring
    one id collapse into a single node, so every count is computed over a tree
    we did not fully see) and a ZERO-head chain (a cycle).

    This is a *finding*, not a sweep failure — see the exit-code contract in
    the module docstring. The caller reports it and leaves the PR's notice
    alone; it must not change the exit code.
    """
    if scan.duplicates:
        groups = duplicate_groups(scan)
        # Named WITH their files, as the `main`-tree arm does. This annotation
        # is the only signal this arm emits, so "which two files" has to be in
        # it or the reader has to rebuild the tree locally to find out.
        dupes = "; ".join(
            f"{rev} ({', '.join(sorted(f.name for f in files))})"
            for rev, files in groups.items()
        )
        return (
            f"#{number}: simulated tree has DUPLICATE revision id(s) "
            f"({dupes}) — the head count is not a verdict; left untouched. "
            f"{_GATED_BY_THE_PR_LANE}"
        )
    if not scan.heads:
        return (
            f"#{number}: simulated chain has ZERO heads (a cycle) — "
            f"not a fork; left untouched. {_GATED_BY_THE_PR_LANE}"
        )
    return None


def sweep_exit_code(failures: list[str], findings: list[str]) -> int:
    """The exit code is a verdict on the SWEEP, not on what the sweep found.

    ``failures`` are PRs this run could not read, could not comment on, or
    otherwise could not finish — it proved nothing about them, so the run is
    INCOMPLETE and exits :data:`EXIT_VACUOUS`. ``findings`` are PRs it read
    successfully and reached a definite verdict on; like a fork, they are
    reported and exit 0. ``findings`` is accepted rather than ignored so the
    asymmetry is stated in the signature instead of being implied by an
    absence.

    ONE ``findings`` class is not a verdict about a PR's tree: a failed read of
    the PR's test files (:func:`pr_test_sources`). That read only words the
    ``_PARENT_REVISION_ID`` advice — the fork verdict was already reached and
    the notice still posts, saying the pin search is UNKNOWN — so it is the
    single :class:`ApiError` that does not count as a failure.
    """
    return EXIT_VACUOUS if failures else 0


def _report_duplicates(number: int, found: list[dict], findings: list[str]) -> None:
    """A second marker comment is a defect, not something to edit around.

    A FINDING, by the contract in the module docstring: the sweep listed the
    comments, found more than one, and maintained the first. It proved plenty
    about this PR — and the extra comment is on the PR, not in `main`, so
    reddening `main`'s lane for it would be a red no commit to `main` can
    clear, which is the shape this script's exit contract exists to avoid.
    """
    if len(found) > 1:
        ids = ", ".join(str(c.get("id")) for c in found[1:])
        findings.append(
            f"#{number}: {len(found)} fork-notice comments exist (extra ids: "
            f"{ids}); only the first is maintained. Delete the extras."
        )


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
    reasons = []
    if isinstance(total, int) and total > len(items):
        reasons.append(
            f"{total} PRs carry a fork notice but only {len(items)} were listed; "
            f"{total - len(items)} may still be showing a stale one."
        )
    # `if`, not `elif`: both can be true, and reporting only the first one
    # silently drops a signal the caller was given.
    if page.get("incomplete_results"):
        reasons.append(
            "GitHub reported the notice search as incomplete (it timed out)."
        )
    partial = " ".join(reasons)
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
    if main_scan.duplicates:
        # Keyed by revision id, so a duplicate silently dropped a node and
        # `landed` below would be missing an id every simulated PR is compared
        # against. Advising off that is worse than not advising.
        main_groups = duplicate_groups(main_scan)
        err(
            f"{VERSIONS_DIR}/ declares {len(main_groups)} DUPLICATE "
            f"revision id(s) — {main_scan.parsed_count} file(s) parsed a revision "
            f"but only {len(main_scan.revisions)} survived, so the head "
            "computation is not a verdict:"
        )
        for rev, files in main_groups.items():
            err(f"  - {rev}: {', '.join(str(p) for p in files)}")
        err("Skipping the open-PR sweep rather than advising off a collapsed graph.")
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
    # Findings are kept apart from failures because they answer a different
    # question — see `sweep_exit_code`. A PR whose simulated tree is
    # un-adviseable was swept successfully; this lane reports it and stays
    # green, and the PR's own required gate is what blocks the merge.
    findings: list[str] = []
    if notice_search_partial:
        # The search SUCCEEDED and returned a knowingly-incomplete answer. That
        # is not the blessed best-effort case (a FAILED search), and leaving it
        # green would let PRs keep a false notice while the job reads clean.
        # Prefixed, because `failures` is otherwise per-PR and the summary
        # counts it: an unlabelled entry reads as "a PR could not be swept".
        failures.append(f"notice search: {notice_search_partial}")
    examined = forked = cleared = un_adviseable = 0
    for pr in prs:
        number = int(pr["number"])
        try:
            # Listed ONCE: the versions-dir filter and, for a PR that needs a
            # re-point, the test-file pin search both read this same list.
            files = pr_files(args.repo, number, token)
        except ApiError as exc:
            failures.append(f"#{number}: could not list files: {exc}")
            continue
        touched = pr_version_files(files)

        if not touched:
            # Nothing to check — but it may still be carrying a notice from an
            # earlier land, which is now a lie.
            if notified is not None and number in notified:
                try:
                    found = find_marker_comments(args.repo, number, token)
                    existing = found[0] if found else None
                    _report_duplicates(number, found, findings)
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

        # A duplicate revision id or a zero-head cycle makes the head count
        # meaningless, so the fork text would be wrong. Report and leave the
        # PR's notice alone — and do NOT redden this lane for it: the tree is
        # the PR's, not `main`'s, and `alembic-heads-pr` already blocks it.
        defect = content_defect(number, scan)
        if defect is not None:
            findings.append(defect)
            un_adviseable += 1
            # TODO: this arm tells the AUTHOR nothing — it leaves the notice
            # alone and only annotates a green run on `main`. Posting a
            # distinct body (not the fork text, which would be wrong here) is
            # the real close, deliberately deferred: it means writing new
            # comment bodies to live PRs, which is a wider blast radius than
            # the red-main fix this arm was added by. Safe to defer only
            # because the PR cannot land un-noticed while the PR lane's check
            # is required — see the premise named in the module docstring.
            continue

        if len(scan.heads) == 1:
            note(f"#{number}: single head ({scan.heads[0]}) — ok")
            try:
                found = find_marker_comments(args.repo, number, token)
                existing = found[0] if found else None
                _report_duplicates(number, found, findings)
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
        sites: dict[str, RepointSites] = {}
        pin_scope: str | None = None
        if remediation.target is not None and remediation.edits:
            # No `edits` (a `blocked` remedy whose only chain has no one-token
            # site) means no revision to re-point: no pin to find, no fetch,
            # and no "pin search is UNKNOWN" finding for a notice without one.
            test_sources: dict[Path, str] = {}
            if len(files) >= PR_FILES_LISTING_CAP:
                # The listing may be truncated, so a pin file can be missing
                # from it: leave `pin_scope` None and the notice says UNKNOWN,
                # never "no pin found".
                note(
                    f"#{number}: file listing reached GitHub's "
                    f"{PR_FILES_LISTING_CAP}-file cap — pin search is UNKNOWN."
                )
            else:
                try:
                    test_sources = pr_test_sources(args.repo, pr, files, token)
                    pin_scope = f"the files this PR changes under `{TESTS_DIR}/`"
                except ApiError as exc:
                    # A FINDING, not a failure: the fork verdict and the
                    # comment still stand, and the comment says the pin search
                    # is UNKNOWN (`pin_scope is None`) rather than implying
                    # there is no pin.
                    findings.append(
                        f"#{number}: could not read its test files, so its notice "
                        f"says the `_PARENT_REVISION_ID` pin search is UNKNOWN: {exc}"
                    )
            sites = plan_repoint_sites(scan, remediation, sources, test_sources)
        body = render_comment(
            scan.heads,
            remediation,
            args.sha or "main",
            sites=sites,
            pin_scope=pin_scope,
        )
        try:
            found = find_marker_comments(args.repo, number, token)
            existing = found[0] if found else None
            _report_duplicates(number, found, findings)
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
        f"{forked} forked; {cleared} notice(s) cleared; "
        f"{un_adviseable} left untouched as un-adviseable."
    )
    # Findings are annotated, so they are never silent — but they are not part
    # of the exit code. `::error` in the log is the loud channel; a red job on
    # `main` is the wrong one, because `main` is not what is broken.
    for finding in findings:
        err(finding)
    if findings:
        # Deliberately says nothing about WHAT was found or what to do about
        # it: `findings` holds unrelated classes (an un-adviseable tree, a
        # second marker comment, a failed read of a PR's test files) whose
        # remedies differ, and each message carries its own. All this line may
        # state is the one property they share — none of them is a failure of
        # the sweep.
        err(
            f"{len(findings)} finding(s) recorded. None of them redden this "
            "lane: each is a defect in a PR rather than in `main`, or a failed "
            "read of a PR's test files that only words its pin advice."
        )
    if failures:
        for failure in failures:
            err(failure)
        err(f"{len(failures)} problem(s) recorded — this run is INCOMPLETE, not clean.")
    return sweep_exit_code(failures, findings)


if __name__ == "__main__":
    raise SystemExit(main())
