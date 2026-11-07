#!/usr/bin/env python3
"""Seed coord's agent registry with the agent ROLE rows from ``.claude/agents/*.md``.

## Why this exists

coord's agent registry (``coord.agent_registry``) decides, per agent, whether a
session may spawn it and what to do when it may not. It holds two disjoint
families of rows:

* **Spawn KINDS** — ``gate_continuation``, ``unit_continuation``,
  ``operator_spawn``, the ``parallel_fanout`` / ``standing_continuation`` class
  opt-ins, and so on. coord seeds these itself, on demand, from
  ``agent_registry::coord_spawn_kind_seeds()`` /
  ``coord_spawn_path_seeds()``.
* **Agent ROLES** — ``code-reviewer``, ``debugging-specialist``, … the agents a
  session actually spawns through the Agent tool. **Nothing seeds these.**

coord's own source has always said this script does it — see
``qontinui-coord/src/spawn_authorization.rs``, the
``every_enforced_spawn_kind_is_seeded_and_classified`` test:

    the web seeder (`scripts/seed_agent_registry.py`) writes agent ROLE names
    from `.claude/agents/*.md`

and the served policy ``verification-and-evidence``
(``registry-readability-is-probed-not-assumed``) says the same. **Both named a
path that held nothing.** A seeder did exist — at ``backend/scripts/`` — but
``.gitignore`` ignored that whole directory while the scripts inside it were
tracked, so it was invisible to ordinary search, and neither the policy nor
coord's source pointed at it. That copy is deleted here in favour of this one:
it wrote ``coord.agent_registry`` with direct SQL, which bypasses coord's RBAC
and its validation entirely. Two seeders with disagreeing consent defaults is
strictly worse than one.

So every tenant reads an effective registry with
no role rows at all, and a session hitting a policy-required review gate cannot
tell "deselected with disposition degrade" from "never seeded" — the two look
identical from ``coord_agent_registry_effective``, and only the second is the
truth. This script closes that gap.

## What it writes

One row per ``.claude/agents/<name>.md``, via
``PUT /coord/agent-registry/<agent_name>``:

===================== ==========================================================
 field                 source
===================== ==========================================================
 ``agent_name``        the file stem (cross-checked against frontmatter ``name``)
 ``purpose``           frontmatter ``description``
 ``model``             frontmatter ``model`` when present, else null (inherit)
 ``spawn_path``        always ``in_session_subagent`` — these are Agent-tool
                       roles, not coord-initiated standing spawns
 ``default_enabled``   for a NEW row, ``False`` when the agent is
                       ``policy_required`` and ``True`` otherwise; an existing
                       row's value is PRESERVED either way, so a re-run never
                       re-enables a deselected agent
 ``policy_required``   ``True`` only for the agents named by
                       ``--policy-required`` (default: ``code-reviewer``,
                       because ``verification-and-evidence`` →
                       ``pre-pr-review`` names it as the required step)
 ``allowed_dispositions`` all three on a NEW row (``block``, ``degrade``,
                       ``warn_proceed``); an existing row's value is
                       PRESERVED, for the same reason ``default_enabled``
                       is — a narrowed set is a recorded operator choice,
                       and coord REPLACES this column rather than merging it
 ``fanout_bound``      1
 ``definition_body``   the markdown body, so the registry carries the
                       definition and not just a name
===================== ==========================================================

## Credentials — read this before you run it

``PUT /coord/agent-registry/<name>`` sits on coord's **admin-gated** sub-router
(``routes.rs``: ``rbac::require_role`` with ``"admin"``, behind
``auth::resolve_operator_optional``). That means:

* It needs a **Cognito operator bearer holding the ``admin`` role**. A device
  JWT, the ``/coord-mcp`` proxy nonce, and the acting-user service token all
  fail — the service token resolves ``roles: vec![]`` by construction.
* It needs an **interactive** one. ``resolve_operator_optional`` calls
  ``auth::deny_non_interactive_write`` and hard-403s any mutating method from a
  client whose ``aud`` is in ``COORD_OIDC_NONINTERACTIVE_AUDIENCES``. In the
  deployed taskdef that set is ``qontinui-coord-verify``, ``qontinui-ci`` and
  ``qontinui-mobile`` — i.e. **every machine-mintable client**. This is a
  deliberate control, not an obstacle to route around.

So: log in to the coord dashboard as an admin, take that bearer, and pass it as
``--token`` or ``$COORD_OPERATOR_JWT``. An agent session cannot mint one, and
should not try.

## Usage

::

    # show what would be written, touch nothing (default)
    python scripts/seed_agent_registry.py

    # actually write
    export COORD_OPERATOR_JWT='<admin Cognito bearer>'
    python scripts/seed_agent_registry.py --apply

Idempotent: ``PUT`` is an upsert keyed on ``(tenant_id, agent_name)``, and the
plan output diffs against what the registry already holds — EVERY field the
write sends, derived from the payload itself — so a re-run on an unchanged tree
writes the same values and reports ``unchanged``, and a re-run after an agent's
markdown changed says so instead of hiding it.

That diff is also a precondition, not just a report. ``default_enabled`` is the
one REQUIRED field of coord's upsert body, so a write built from rows this
script could not read would reset each one to the new-row default. ``--apply``
therefore REFUSES when the pre-read failed: an unreadable registry is UNKNOWN,
never empty.

## Orphans — role rows whose definition is gone

A role row outlives its definition: deleting ``.claude/agents/<name>.md`` leaves
the row ``enabled`` in the registry, so ``GET /coord/agent-registry/effective``
keeps offering every session an agent that no longer exists. An ORPHAN is a
row this seeder could have written: ``spawn_path`` ``in_session_subagent``, no
``.claude/agents/<name>.md``, and an ``agent_name`` outside the shared SPAWN
CONTRACT. That last clause is load-bearing: ``operator_spawn`` is an
``in_session_subagent`` row with no definition, and disabling it vetoes every
operator ``POST /agents/spawn``. The contract's names are its ``kind_seeds``,
its ``class_seeds`` and its ``spawn_paths``, read from
``qontinui-schemas/rust/src/spawn_authorization.json`` at the commit
``spawn-contract.pin.toml`` pins, with the same digest check
``spawnPathContract.test.ts`` applies. A contract that cannot be read at that
digest retires nothing.

Every run prints ``ORPHAN <name> (no definition)`` for the orphans in what it
read (a report; it writes nothing). ``--retire-orphans`` RETIRES them, and is
held to a stricter standard than the report:

* Its definitions come ONLY from qontinui-claude-config at its live
  ``origin`` ``main`` (``git ls-remote``), read from that commit's TREE: either
  ``--agents-dir`` pointing at the ``.claude/agents`` of a clean checkout whose
  ``HEAD`` IS that commit, or, without ``--agents-dir``, the objects of the
  qontinui-claude-config checkout found above this repository (fetched into
  ``FETCH_HEAD`` first when they are missing — no ref of that checkout moves).
  A checkout counts only when its raw ``remote.origin.url`` is
  ``github.com/qontinui/qontinui-claude-config``. The walk-up discovery the
  seed path uses is NOT a source here: from an allocated worktree it lands on
  the shared primary checkout, at whatever branch and staleness it holds —
  stale, nothing retires; a peer's branch, a live agent retires.
* It acts with a fresh coord device JWT — ``$COORD_DEVICE_JWT``, else
  ``~/.qontinui/coord-device-jwt``, never argv; an expired or malformed one is
  skipped, not sent — and in THAT token's tenant. The tenant is PROVEN before
  any row is read: the token's ``tenant_id`` claim must equal ``--tenant`` (or
  ``$QONTINUI_TENANT_ID``) when one is named, and coord's ownership door
  (``GET /pr-merge/qontinui%2Fqontinui-claude-config/0/author-session``) must
  answer 200 about this repository under the token. On a device bound to
  several tenants, a token for another tenant would otherwise judge THAT
  tenant's role rows against these definitions and retire every one.
* It reads the rows through ``GET /coord/agent-registry/effective`` and sends
  each orphan to coord's narrowing-only ``POST /coord/agent-registry/retire``,
  which can only set ``default_enabled = false`` and refuses a contract row, a
  policy-required row and a row off the role path itself. A policy-required
  orphan is reported and not sent: only an operator may disable it, choosing a
  disposition. A coord that predates the door answers that POST with its admin
  route's 401, which stops the run like any refused credential.

``--dry-run`` with ``--retire-orphans`` proves every source and prints the
orphans, and sends nothing.

Exit codes: ``0`` success (or a clean dry run), ``1`` a write failed or coord
was unreachable, ``2`` bad input (no agents directory, missing token with
``--apply``, unreadable registry with ``--apply``), ``3`` ``--retire-orphans``
could not PROVE one of its sources (the credential, the contract, the
definitions, the acting tenant, the rows — an unreachable coord while reading
them included) and sent nothing — UNKNOWN, never "no orphans".
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import NoReturn

DEFAULT_COORD_URL = "https://coord.qontinui.io"
SPAWN_PATH = "in_session_subagent"
ALLOWED_DISPOSITIONS = ["block", "degrade", "warn_proceed"]
FANOUT_BOUND = 1

# `verification-and-evidence` → `pre-pr-review` names the code-reviewer agent as
# the policy-required step before opening a PR. Nothing else in the served
# policy set names an agent as required, so nothing else defaults to True.
DEFAULT_POLICY_REQUIRED = ("code-reviewer",)

# coord's `upsert_registry_row` COALESCEs these text columns to `''` rather
# than storing NULL, so a seeder-side `None` and a stored `''` are the SAME
# value and must not read as drift in the plan. Mirrors coord's column list,
# which is why `trigger_condition` is here even though this seeder does not
# send it yet — adding it later should not re-introduce the phantom drift.
COALESCED_TO_EMPTY = ("purpose", "trigger_condition", "definition_body")


def die(message: str) -> NoReturn:
    """Exit 2 — bad input.

    `sys.exit("...")` exits 1, not 2, so the docstring's exit-code contract was
    never actually produced by any of the usage errors that claimed it. A caller
    scripting this (a runbook step, a wrapper) cannot tell "you invoked it wrong"
    from "a write failed" unless the two differ.
    """
    print(message, file=sys.stderr)
    raise SystemExit(2)


@dataclass
class AgentDef:
    """One `.claude/agents/<name>.md`, parsed."""

    agent_name: str
    purpose: str | None
    model: str | None
    body: str
    source: Path


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Split a `---`-delimited frontmatter block from the body.

    Deliberately a flat ``key: value`` parser rather than a YAML dependency:
    every agent definition in this fleet uses scalar keys only (``name``,
    ``description``, ``tools``, ``model``), and these scripts are stdlib-only by
    convention (see ``verify_ci_baseline.py``). A nested value would be silently
    flattened, so if agent definitions ever grow one, this needs revisiting —
    that is why unknown keys are simply ignored rather than guessed at.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text

    fm: dict[str, str] = {}
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return fm, "\n".join(lines[i + 1 :]).lstrip("\n")
        if ":" not in line:
            # A wrapped continuation of the previous value. Append it rather
            # than dropping it — descriptions in this tree do wrap.
            if fm:
                last = next(reversed(fm))
                fm[last] = f"{fm[last]} {line.strip()}".strip()
            continue
        key, _, value = line.partition(":")
        fm[key.strip()] = value.strip()

    # No closing delimiter — treat the whole file as body rather than
    # half-parsing it.
    return {}, text


def load_agents(agents_dir: Path) -> list[AgentDef]:
    out: list[AgentDef] = []
    for path in sorted(agents_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        fm, body = parse_frontmatter(text)
        stem = path.stem
        declared = fm.get("name")
        if declared and declared != stem:
            print(
                f"  ! {path.name}: frontmatter name `{declared}` != file stem "
                f"`{stem}` - using the stem, since that is what the Agent tool's "
                f"subagent_type resolves.",
                file=sys.stderr,
            )
        out.append(
            AgentDef(
                agent_name=stem,
                purpose=fm.get("description"),
                model=fm.get("model"),
                body=body,
                source=path,
            )
        )
    return out


def discover_agents_dir(explicit: str | None) -> Path:
    """Find `.claude/agents`.

    Order: an explicit ``--agents-dir``; then ``.claude/agents`` walking up from
    the CWD; then the sibling config repo, which is where this fleet actually
    keeps them (``qontinui-claude-config/.claude/agents``, surfaced at the
    workspace root as ``.claude/agents``).
    """
    if explicit:
        p = Path(explicit).expanduser().resolve()
        if not p.is_dir():
            die(f"--agents-dir {p} is not a directory")
        return p

    here = Path.cwd().resolve()
    for base in (here, *here.parents):
        candidate = base / ".claude" / "agents"
        if candidate.is_dir():
            return candidate
        sibling = base / "qontinui-claude-config" / ".claude" / "agents"
        if sibling.is_dir():
            return sibling

    die(
        "could not find a `.claude/agents` directory walking up from "
        f"{here}. Pass --agents-dir explicitly."
    )


class CoordUnreachableError(Exception):
    """No HTTP answer from coord at all (or a request that could not be sent).

    Not exit 2: reaching coord is not something the invocation got wrong. The
    seed path exits 1 on it; `--retire-orphans` exits 3 when it happens while
    proving its sources (nothing was sent) and 1 when it happens mid-run.
    """


def http_json(
    url: str, token: str | None, method: str = "GET", body: dict | None = None
) -> tuple[int, object]:
    """`(status, parsed JSON body | raw text | None)` for one request.

    Every failure to get an HTTP answer raises `CoordUnreachableError`, whose
    message never carries the bearer: `http.client` refuses a header value
    with a control character (a token with a trailing CR) with a `ValueError`
    that quotes the whole value, so that error is replaced, not chained.
    """
    data = json.dumps(body).encode("utf-8") if body is not None else None
    try:
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            status, raw = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
        reason = getattr(e, "reason", None) or type(e).__name__
        raise CoordUnreachableError(f"cannot reach coord at {url}: {reason}") from None
    except ValueError:
        raise CoordUnreachableError(
            f"the request to {url} could not be sent (an invalid header or URL "
            "value; not echoed)"
        ) from None
    if not raw.strip():
        return status, None
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


@dataclass
class RegistryRead:
    """What `GET /coord/agent-registry` returned — and WHETHER it returned.

    `ok=False` means the current rows are UNKNOWN, not that there are none. The
    two are not interchangeable here, because `default_enabled` is the one
    REQUIRED field of coord's upsert body: a write built from an
    unknown-read-as-empty would send the NEW-ROW default for every agent and
    silently reset the recorded choices this seeder exists to preserve. So the
    flag is carried rather than collapsed, and `--apply` refuses on `ok=False`.
    """

    rows: dict[str, dict]
    ok: bool


def existing_rows(coord_url: str, token: str | None) -> RegistryRead:
    """Current registry rows, by agent_name.

    The read is the operator (tenant) door, so it can fail while the write would
    have succeeded — and vice versa. A failed read still leaves a useful dry-run
    plan (every row reads `new`, which overstates the change), so it is reported
    and carried rather than raised.
    """
    status, payload = http_json(f"{coord_url}/coord/agent-registry", token)
    if status != 200 or not isinstance(payload, dict):
        print(
            f"  - could not read the current registry (HTTP {status}) - the plan "
            f"below shows every row as `new`, which may overstate the change.",
            file=sys.stderr,
        )
        return RegistryRead(rows={}, ok=False)
    # Confirmed shape: `{"agents": [...], "prefs": [...]}`
    # (coord `agent_registry::get_registry_handler`).
    rows = payload.get("agents") or []
    return RegistryRead(
        rows={
            r["agent_name"]: r
            for r in rows
            if isinstance(r, dict) and "agent_name" in r
        },
        ok=True,
    )


def build_body(
    agent: AgentDef, policy_required: set[str], existing: dict | None
) -> dict:
    # `default_enabled` PRESERVES an existing value. An operator who deselected
    # an agent did so deliberately, and a re-run of a seeder is not consent to
    # undo it: re-enabling a disabled agent would silently restore spawns (and
    # the quota they spend) that someone turned off on purpose.
    #
    # For a row that does not exist yet, a POLICY-REQUIRED agent seeds OFF and
    # everything else seeds ON. A policy-required agent is spawned BY POLICY,
    # with no per-use decision by the user, and the spawn runs on the user's
    # own AI account — so it is the one class that has to be opted INTO rather
    # than arriving enabled. Ordinary agents keep the True default: they only
    # spawn because a session deliberately invoked them for work the user
    # asked for, so defaulting those off would break delegation rather than
    # protect anyone.
    #
    # This is NOT a weakening of the review gate. A disabled policy-required
    # agent resolves through its `disposition`, which defaults to `degrade` —
    # the calling session performs the review inline. No spawn, no cost, gate
    # kept.
    #
    # Derived from `policy_required` rather than a second hand-kept list, so a
    # future policy-required agent cannot ship silently spawning on the user's
    # account because someone updated one list and not the other.
    #
    # `allowed_dispositions` is preserved for exactly the same reason, and it
    # needs saying separately because coord REPLACES that column rather than
    # merging it: re-sending the full set would widen an operator's narrowed
    # one back to all three without anyone deciding to.
    if existing is not None:
        enabled = bool(existing.get("default_enabled", True))
        dispositions = list(
            existing.get("allowed_dispositions") or ALLOWED_DISPOSITIONS
        )
    else:
        enabled = agent.agent_name not in policy_required
        dispositions = list(ALLOWED_DISPOSITIONS)
    return {
        "purpose": agent.purpose,
        "spawn_path": SPAWN_PATH,
        "model": agent.model,
        "default_enabled": enabled,
        "policy_required": agent.agent_name in policy_required,
        "allowed_dispositions": dispositions,
        "fanout_bound": FANOUT_BOUND,
        "definition_body": agent.body,
    }


def stored_form(name: str, value: object) -> object:
    """The value as coord would STORE it, so the plan compares like with like."""
    if name in COALESCED_TO_EMPTY and value is None:
        return ""
    return value


def describe_change(existing: dict | None, want: dict) -> str:
    """Name every field this write would change.

    Derived from the payload itself, not a hand-kept list of field names — the
    same anti-drift argument `build_body` makes for deriving its default from
    `policy_required`. The hand-kept list omitted `definition_body` and
    `allowed_dispositions`, the two fields most likely to move on a re-run:
    editing an agent's markdown produced a plan that said `unchanged` for the
    row it was about to rewrite. The dry run is this script's DEFAULT mode and
    its only safety surface, so a plan that understates the write is worse than
    no plan at all.
    """
    if existing is None:
        return "new"
    drift = [
        name
        for name in want
        if stored_form(name, existing.get(name)) != stored_form(name, want.get(name))
    ]
    return "unchanged" if not drift else "update: " + ", ".join(drift)


# ---------------------------------------------------------------------------
# Orphans (plan 2026-11-06-what-the-fleet-records-and-advertises-matches-
# what-actually-ran, Phase 6, D8) — see the module docstring.
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[1]
SPAWN_CONTRACT_PIN = "spawn-contract.pin.toml"
SPAWN_CONTRACT_REPO = "qontinui-schemas"
SPAWN_CONTRACT_PATH = "rust/src/spawn_authorization.json"
SPAWN_CONTRACT_OVERRIDE_VAR = "QONTINUI_SPAWN_CONTRACT_FILE"
CONFIG_REPO = "qontinui-claude-config"
CONFIG_REPO_SLUG = f"qontinui/{CONFIG_REPO}"
# The config repo is identified by its RAW `remote.origin.url`, matched whole:
# a fork, a mirror or a look-alike name is not the repository whose `main`
# the fleet's sessions are served from.
CONFIG_REPO_URL_RE = re.compile(
    r"(?:https://(?:[^@/\s]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)"
    r"qontinui/qontinui-claude-config(?:\.git)?/?"
)
AGENTS_SUBDIR = ".claude/agents"
# Resolved per call (not at import) so `Path.home()` decides it, as it does for
# every other reader of this file.
DEVICE_TOKEN_RELATIVE = Path(".qontinui") / "coord-device-jwt"
# A token that expires mid-run is as unusable as an expired one.
TOKEN_FRESHNESS_MARGIN_SECS = 60
# Three base64url segments and nothing else: a value carrying whitespace or a
# control character is never put in a header (http.client would refuse it with
# an error that quotes the whole bearer).
JWT_SHAPE_RE = re.compile(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*")
UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
EXIT_UNPROVEN = 3

Git = Callable[..., bytes | None]


class UnprovenError(Exception):
    """A source `--retire-orphans` rests on could not be PROVEN, so it sends
    nothing. The message names what was read and why it does not suffice."""


def run_git(repo: Path, *args: str) -> bytes | None:
    """`git -C <repo> <args>` -> stdout bytes, or None on ANY failure.

    The single process seam for the orphan path, replaced wholesale in tests.
    `None` is never read as an empty answer by a caller. Never prompts (no
    stdin, `GIT_TERMINAL_PROMPT=0`) and never takes the optional index lock
    (`GIT_OPTIONAL_LOCKS=0`): the checkout it reads is often a shared one.
    """
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}
    try:
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            stdin=subprocess.DEVNULL,
            env=env,
            timeout=180,
        ).stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None


def read_pin(repo_root: Path) -> tuple[str, str]:
    """`(ref, sha256)` from `spawn-contract.pin.toml`, as spawnPathContract.test.ts reads it."""
    path = repo_root / SPAWN_CONTRACT_PIN
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        raise UnprovenError(f"{path} is unreadable: {e}") from e
    ref = re.search(r'^ref = "([0-9a-f]{40})"$', text, re.MULTILINE)
    sha = re.search(r'^sha256 = "([0-9a-f]{64})"$', text, re.MULTILINE)
    if not ref or not sha:
        raise UnprovenError(f"{path} must carry `ref` and `sha256`")
    return ref.group(1), sha.group(1)


def _read_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as e:
        raise UnprovenError(f"{path} is unreadable: {e}") from e


def load_spawn_contract(
    repo_root: Path | None = None,
    env: Mapping[str, str] = os.environ,
    git: Git | None = None,
) -> dict:
    """The shared spawn contract at the pinned commit, digest-checked.

    The same resolution `spawnPathContract.test.ts` uses. Under CI
    (`$GITHUB_ACTIONS`) or with `$QONTINUI_SPAWN_CONTRACT_FILE` set there is
    no fallback: that file, at the pinned digest. Otherwise the sibling
    qontinui-schemas checkout's file when it is at the pinned digest, else the
    pinned blob out of that sibling's objects. Anything else raises
    `UnprovenError` — a contract read at another commit could omit a kind,
    and a kind this seeder does not know is a row it would retire.
    """
    repo_root = REPO_ROOT if repo_root is None else repo_root
    git = git or run_git
    ref, want = read_pin(repo_root)

    def at_digest(raw: bytes, origin: str) -> dict:
        got = hashlib.sha256(raw).hexdigest()
        if got != want:
            raise UnprovenError(
                f"{origin} has sha256 {got}; {SPAWN_CONTRACT_PIN} pins {want} at {ref}"
            )
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise UnprovenError(f"{origin} is not JSON: {e}") from e
        if not isinstance(parsed, dict):
            raise UnprovenError(f"{origin} is not a JSON object")
        return parsed

    override = env.get(SPAWN_CONTRACT_OVERRIDE_VAR)
    if override or env.get("GITHUB_ACTIONS"):
        if not override or not Path(override).is_file():
            where = f"{override} is absent" if override else "it is unset"
            raise UnprovenError(
                f"CI reads the contract from ${SPAWN_CONTRACT_OVERRIDE_VAR} "
                f"(.github/actions/spawn-contract), and {where}; "
                f"{SPAWN_CONTRACT_PIN} pins {want} at {ref}"
            )
        return at_digest(_read_bytes(Path(override)), override)

    sibling = repo_root.parent / SPAWN_CONTRACT_REPO
    candidate = sibling / SPAWN_CONTRACT_PATH
    if candidate.is_file():
        local = _read_bytes(candidate)
        if hashlib.sha256(local).hexdigest() == want:
            return at_digest(local, str(candidate))
    blob = f"{ref}:{SPAWN_CONTRACT_PATH}"
    blob_bytes = git(sibling, "show", blob)
    if blob_bytes is None:
        raise UnprovenError(
            f"{blob} could not be read from {sibling}: run "
            "`python scripts/ci/fetch_pinned_schemas_commits.py` from the repository "
            f"root, or check {SPAWN_CONTRACT_REPO} out beside this repository"
        )
    return at_digest(blob_bytes, blob)


def contract_names(contract: dict) -> set[str]:
    """Every agent name the spawn contract owns: its kind seeds (`operator_spawn`
    among them), every class row (seeded or not) and every `spawn_path` value.
    The last two are the runner's per-path fallback keys, so a row by one of
    those names governs a whole spawn class. A contract missing any of the
    three lists, or carrying one empty, is not one this seeder can trust to
    protect anything."""
    try:
        kinds = {k["agent_name"] for k in contract["kind_seeds"]}
        classes = {c["spawn_path"] for c in contract["class_seeds"]}
        paths = set(contract["spawn_paths"])
    except (KeyError, TypeError) as e:
        raise UnprovenError(f"the spawn contract is missing {e}") from e
    if not kinds or not classes or not paths:
        raise UnprovenError("the spawn contract lists no kinds, classes or spawn paths")
    return kinds | classes | paths


def find_orphans(
    rows: list[dict], definitions: set[str], contract: set[str]
) -> list[dict]:
    """The rows this seeder could have written whose definition is gone: an
    `in_session_subagent` row, no `.claude/agents/<name>.md`, and a name
    outside the spawn contract. Sorted by name."""
    return sorted(
        (
            r
            for r in rows
            if r.get("spawn_path") == SPAWN_PATH
            and r.get("agent_name") not in definitions
            and r.get("agent_name") not in contract
        ),
        key=lambda r: str(r.get("agent_name")),
    )


@dataclass
class DefinitionSource:
    """The definition names `--retire-orphans` judges against, and the
    qontinui-claude-config `origin` `main` commit they were PROVEN to be."""

    names: set[str]
    commit: str
    described: str


def remote_main(repo: Path, git: Git) -> str:
    """The commit qontinui-claude-config's `origin` `main` points at NOW
    (`git ls-remote`), never a possibly-stale remote-tracking ref."""
    out = git(repo, "ls-remote", "origin", "refs/heads/main")
    sha = (out or b"").decode("utf-8", "replace").split()[:1]
    if not sha or not re.fullmatch(r"[0-9a-f]{40}", sha[0]):
        raise UnprovenError(
            f"could not read the live origin main of {repo} (git ls-remote)"
        )
    return sha[0]


def is_config_repo(repo: Path, git: Git) -> bool:
    """`repo`'s raw `remote.origin.url` IS github.com/qontinui/qontinui-claude-config."""
    url = (git(repo, "config", "--get", "remote.origin.url") or b"").decode(
        "utf-8", "replace"
    )
    return CONFIG_REPO_URL_RE.fullmatch(url.strip()) is not None


def definition_names_at(repo: Path, commit: str, git: Git) -> set[str]:
    """The `.claude/agents/*.md` stems in the TREE of `commit` — never a
    working-tree glob, which a sparse, skip-worktree or assume-unchanged file
    can hide a definition from."""
    listing = git(repo, "ls-tree", "-z", "--name-only", commit, f"{AGENTS_SUBDIR}/")
    if listing is None:
        raise UnprovenError(f"could not list {AGENTS_SUBDIR}/ at {commit} in {repo}")
    names = {
        PurePosixPath(entry).stem
        for entry in listing.decode("utf-8", "replace").split("\0")
        if entry.endswith(".md")
    }
    if not names:
        raise UnprovenError(
            f"{AGENTS_SUBDIR}/ at {commit} lists no agent definitions; "
            "every role would read as an orphan"
        )
    return names


def definitions_from_worktree(
    agents_dir: Path, git: Git | None = None
) -> DefinitionSource:
    """An explicit `--agents-dir`: accepted only as the `.claude/agents` of a
    clean qontinui-claude-config checkout whose HEAD IS the live origin main.
    The names are then read from that commit's tree."""
    git = git or run_git
    top_raw = git(agents_dir, "rev-parse", "--show-toplevel")
    if not top_raw:
        raise UnprovenError(f"--agents-dir {agents_dir} is not inside a git checkout")
    top = Path(top_raw.decode("utf-8", "replace").strip())
    if agents_dir.resolve() != (top / AGENTS_SUBDIR).resolve():
        raise UnprovenError(
            f"--agents-dir must be <checkout>/{AGENTS_SUBDIR}; got {agents_dir}"
        )
    if not is_config_repo(top, git):
        raise UnprovenError(
            f"{top} is not a {CONFIG_REPO} checkout (its origin is not "
            f"github.com/{CONFIG_REPO_SLUG})"
        )
    live = remote_main(top, git)
    head = (git(top, "rev-parse", "HEAD") or b"").decode("utf-8", "replace").strip()
    if head != live:
        raise UnprovenError(
            f"{top} is at {head or '<unreadable HEAD>'}, not {CONFIG_REPO} origin main {live}"
        )
    dirty = git(top, "status", "--porcelain", "--", AGENTS_SUBDIR)
    if dirty is None or dirty.strip():
        raise UnprovenError(
            f"{agents_dir} has uncommitted or untracked changes (or git status failed)"
        )
    names = definition_names_at(top, live, git)
    return DefinitionSource(names, live, f"{agents_dir} (HEAD {live} = origin main)")


def definitions_from_origin_main(
    config_repo: Path, git: Git | None = None
) -> DefinitionSource:
    """No `--agents-dir`: the `.claude/agents` tree at the live origin main,
    read out of the repository's objects — never its working tree, which in a
    shared checkout is at whatever branch a peer left it."""
    git = git or run_git
    if not is_config_repo(config_repo, git):
        raise UnprovenError(
            f"{config_repo} is not a {CONFIG_REPO} checkout (its origin is not "
            f"github.com/{CONFIG_REPO_SLUG})"
        )
    live = remote_main(config_repo, git)
    commit = f"{live}^{{commit}}"
    if git(config_repo, "cat-file", "-e", commit) is None:
        # `--refmap=` with no destination writes FETCH_HEAD only: the shared
        # checkout's remote-tracking refs and working tree are left as found.
        git(config_repo, "fetch", "--quiet", "--refmap=", "origin", "main")
        if git(config_repo, "cat-file", "-e", commit) is None:
            raise UnprovenError(
                f"{config_repo} does not hold origin main {live}, even after a fetch"
            )
    names = definition_names_at(config_repo, live, git)
    return DefinitionSource(
        names, live, f"{config_repo} {AGENTS_SUBDIR}/ at origin main {live}"
    )


def locate_config_repo(starts: tuple[Path, ...]) -> Path:
    for start in starts:
        for base in (start, *start.parents):
            candidate = base / CONFIG_REPO
            if (candidate / ".git").exists():
                return candidate
    raise UnprovenError(
        f"no {CONFIG_REPO} checkout above {', '.join(str(s) for s in starts)}"
    )


def resolve_definitions(
    agents_dir: str | None, git: Git | None = None
) -> DefinitionSource:
    if agents_dir:
        return definitions_from_worktree(Path(agents_dir).expanduser().resolve(), git)
    return definitions_from_origin_main(
        locate_config_repo((REPO_ROOT, Path.cwd().resolve())), git
    )


def jwt_claims(token: str) -> dict | None:
    """A JWT's payload, read without verifying it (coord verifies)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        claims = json.loads(base64.urlsafe_b64decode(payload))
    except (IndexError, ValueError, TypeError):
        return None
    return claims if isinstance(claims, dict) else None


def jwt_exp(token: str) -> int | None:
    """The `exp` claim of a JWT, read without verifying it (coord verifies)."""
    claims = jwt_claims(token)
    try:
        return int(claims["exp"]) if claims is not None else None
    except (KeyError, TypeError, ValueError):
        return None


def resolve_device_token(
    env: Mapping[str, str] = os.environ,
    token_file: Path | None = None,
    now: Callable[[], float] = time.time,
) -> str:
    """The first FRESH device JWT of `$COORD_DEVICE_JWT` and
    `~/.qontinui/coord-device-jwt`. Validity, not presence: an expired,
    malformed or unreadable one is skipped, so a stale variable cannot shadow a
    live file. The file is read only when the variable did not answer, and a
    credential is never taken from argv."""
    if token_file is None:
        token_file = Path.home() / DEVICE_TOKEN_RELATIVE
    file_path = token_file

    def from_file() -> str | None:
        try:
            return file_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return None

    candidates: tuple[tuple[str, Callable[[], str | None]], ...] = (
        ("$COORD_DEVICE_JWT", lambda: env.get("COORD_DEVICE_JWT")),
        (str(file_path), from_file),
    )
    for origin, read in candidates:
        raw = read()
        if raw is None or not raw.strip():
            continue
        token = raw.strip()
        if not JWT_SHAPE_RE.fullmatch(token):
            print(
                f"  - {origin}: not a well-formed JWT (whitespace or a control "
                "character inside it), skipped",
                file=sys.stderr,
            )
            continue
        exp = jwt_exp(token)
        if exp is not None and exp > now() + TOKEN_FRESHNESS_MARGIN_SECS:
            return token
        print(
            f"  - {origin}: expired or unreadable device JWT, skipped", file=sys.stderr
        )
    raise UnprovenError(
        f"no fresh coord device JWT ($COORD_DEVICE_JWT, {file_path}); refresh one and re-run"
    )


def expected_tenant(
    explicit: str | None, env: Mapping[str, str] = os.environ
) -> str | None:
    """The tenant the operator NAMED (`--tenant`, else `$QONTINUI_TENANT_ID`),
    or None when neither is set. A malformed value is an error, never ignored."""
    value = (explicit or env.get("QONTINUI_TENANT_ID") or "").strip()
    if not value:
        return None
    if not UUID_RE.fullmatch(value):
        raise UnprovenError(f"--tenant / $QONTINUI_TENANT_ID is not a UUID: {value!r}")
    return value.lower()


def prove_tenant(coord_url: str, token: str, expected: str | None) -> str:
    """The tenant this run acts in, PROVEN to own qontinui-claude-config.

    coord acts in the device JWT's `tenant_id` claim — the registry it serves
    and the row it retires are that tenant's — while the definitions are
    qontinui-claude-config's. On a device bound to several tenants a token for
    another tenant would judge THAT tenant's role rows against this repo's
    definitions and retire every one of them, so: the claim must equal the
    tenant named by `--tenant` / `$QONTINUI_TENANT_ID` when one is, and coord's
    ownership door (`GET /pr-merge/<owner%2Fname>/0/author-session`, the probe
    `coord-tenant-credential.sh` uses) must answer 200 about this repo under
    that token. 404 refutes ownership; anything else leaves it UNKNOWN.
    """
    claims = jwt_claims(token) or {}
    claimed = claims.get("tenant_id")
    if not isinstance(claimed, str) or not UUID_RE.fullmatch(claimed):
        raise UnprovenError(
            "the device JWT carries no tenant_id claim, so the tenant it acts in is UNKNOWN"
        )
    claimed = claimed.lower()
    if expected is not None and claimed != expected:
        raise UnprovenError(
            f"the device JWT acts in tenant {claimed}, not the named tenant {expected}"
        )
    slug = urllib.parse.quote(CONFIG_REPO_SLUG, safe="")
    status, payload = http_json(f"{coord_url}/pr-merge/{slug}/0/author-session", token)
    if (
        status == 200
        and isinstance(payload, dict)
        and payload.get("repo") == CONFIG_REPO_SLUG
    ):
        return claimed
    if status == 404:
        raise UnprovenError(
            f"tenant {claimed} does not own {CONFIG_REPO_SLUG} (coord's ownership door "
            "answered 404 under this token), so its registry is not the one these "
            "definitions govern"
        )
    raise UnprovenError(
        f"coord's ownership door answered HTTP {status} for {CONFIG_REPO_SLUG} without "
        f"naming it; whether tenant {claimed} owns it is UNKNOWN"
    )


def effective_rows(coord_url: str, device_token: str) -> list[dict]:
    """The registry as `GET /coord/agent-registry/effective` serves it to this
    device, which carries `spawn_path` and `policy_required` per row."""
    status, payload = http_json(
        f"{coord_url}/coord/agent-registry/effective", device_token
    )
    agents = payload.get("agents") if isinstance(payload, dict) else None
    if status != 200 or not isinstance(agents, list):
        raise UnprovenError(
            f"GET /coord/agent-registry/effective answered HTTP {status}; the rows are UNKNOWN"
        )
    return [r for r in agents if isinstance(r, dict) and "agent_name" in r]


def report_orphans(rows: list[dict], definitions: set[str], source: str) -> None:
    """The seed path's report: the orphans in what this run READ. Writes nothing."""
    try:
        contract = contract_names(load_spawn_contract())
    except UnprovenError as e:
        print(f"orphans    : UNKNOWN - {e}")
        return
    orphans = find_orphans(rows, definitions, contract)
    print(f"orphans    : {len(orphans)} relative to {source} (report only)")
    for row in orphans:
        print(f"  ORPHAN {row['agent_name']} (no definition)")
    if orphans:
        print(
            "  --retire-orphans retires them, against qontinui-claude-config's origin main."
        )


def retire_orphans(args: argparse.Namespace, coord_url: str) -> int:
    """`--retire-orphans`: prove every source, then send each orphan to coord's
    narrowing-only retire door. Nothing is sent unless all five are proven —
    the credential, the contract, the definitions, the acting tenant and the
    rows — and an unreachable coord during those reads is UNKNOWN too."""
    try:
        token = resolve_device_token()
        contract = contract_names(load_spawn_contract())
        source = resolve_definitions(args.agents_dir)
        tenant = prove_tenant(coord_url, token, expected_tenant(args.tenant))
        rows = effective_rows(coord_url, token)
    except (UnprovenError, CoordUnreachableError) as e:
        print(f"retire-orphans: nothing sent - {e}", file=sys.stderr)
        return EXIT_UNPROVEN

    orphans = find_orphans(rows, source.names, contract)
    print(f"definitions: {source.described}")
    print(f"coord      : {coord_url}")
    print(f"tenant     : {tenant} (proven to own {CONFIG_REPO_SLUG})")
    print(
        f"mode       : {'retire-orphans dry run (nothing sent)' if args.dry_run else 'RETIRE ORPHANS'}"
    )
    print(f"orphans    : {len(orphans)}")

    failures = 0
    held = 0
    for row in orphans:
        name = str(row["agent_name"])
        if row.get("policy_required"):
            held += 1
            print(
                f"  ORPHAN {name} (no definition) - policy_required, not sent: only an "
                "operator may disable it, choosing a disposition"
            )
            continue
        print(f"  ORPHAN {name} (no definition)")
        if args.dry_run:
            continue
        reason = (
            f"seed_agent_registry.py --retire-orphans: no {AGENTS_SUBDIR}/{name}.md in "
            f"{CONFIG_REPO} at origin main {source.commit}"
        )
        try:
            status, payload = http_json(
                f"{coord_url}/coord/agent-registry/retire",
                token,
                method="POST",
                body={"agent_name": name, "reason": reason},
            )
        except CoordUnreachableError as e:
            failures += 1
            print(f"  FAIL {name}: {e}", file=sys.stderr)
            print("    the remaining orphans were not attempted.", file=sys.stderr)
            break
        if (
            status == 200
            and isinstance(payload, dict)
            and payload.get("retired") is True
        ):
            changed = payload.get("changed") is True
            print(f"  RETIRED {name}" + ("" if changed else " (already retired)"))
            continue
        failures += 1
        detail = payload if isinstance(payload, str) else json.dumps(payload)
        print(f"  FAIL {name}: HTTP {status} {detail}", file=sys.stderr)
        if (
            status in (401, 403)
            or not isinstance(payload, dict)
            or "error" not in payload
        ):
            # A credential refusal is the same answer for every row. So is a
            # coord that predates this door: its admin
            # `PUT /coord/agent-registry/:agent_name` route captures the path,
            # and that router's `require_role` layer answers a device JWT with
            # 401 before axum's 405. An untyped body is no door at all.
            print(
                "    this answer is fatal for every row (a refused credential, a coord "
                "that does not serve POST /coord/agent-registry/retire yet, or no typed "
                "answer); the remaining orphans were not attempted.",
                file=sys.stderr,
            )
            break
    if held:
        print(
            f"{held} policy-required orphan(s) left in place: only an operator may "
            "disable one, choosing a disposition."
        )
    if failures:
        return 1
    if args.dry_run:
        print("dry run - nothing sent.")
    return 0


def main() -> int:
    try:
        return _main()
    except CoordUnreachableError as e:
        print(e, file=sys.stderr)
        return 1


def _main() -> int:
    ap = argparse.ArgumentParser(
        description="Seed coord's agent registry from .claude/agents/*.md"
    )
    ap.add_argument(
        "--agents-dir",
        help=(
            "directory holding the agent .md definitions. With --retire-orphans it must "
            "be the .claude/agents of a clean qontinui-claude-config checkout whose HEAD "
            "is its live origin main; without it, that origin main is read from the "
            "objects of the qontinui-claude-config checkout above this repository"
        ),
    )
    ap.add_argument(
        "--coord-url",
        default=os.environ.get("COORD_HTTP_URL", DEFAULT_COORD_URL),
        help=f"coord base URL (default: $COORD_HTTP_URL or {DEFAULT_COORD_URL})",
    )
    ap.add_argument(
        "--token",
        default=os.environ.get("COORD_OPERATOR_JWT"),
        help="admin Cognito operator bearer (default: $COORD_OPERATOR_JWT)",
    )
    ap.add_argument(
        "--policy-required",
        default=",".join(DEFAULT_POLICY_REQUIRED),
        help=(
            "comma-separated agent names to mark policy_required "
            f"(default: {','.join(DEFAULT_POLICY_REQUIRED)})"
        ),
    )
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply",
        action="store_true",
        help="actually write. Without it, the plan is printed and nothing is sent.",
    )
    mode.add_argument(
        "--retire-orphans",
        action="store_true",
        help=(
            "retire every orphan role row through coord's narrowing-only "
            "POST /coord/agent-registry/retire, judged against qontinui-claude-config "
            "at its live origin main (see the module docstring)"
        ),
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="with --retire-orphans: prove every source and print the orphans, send nothing",
    )
    ap.add_argument(
        "--tenant",
        default=None,
        help=(
            "with --retire-orphans: the tenant to act in (default: $QONTINUI_TENANT_ID). "
            "The device JWT ($COORD_DEVICE_JWT, else ~/.qontinui/coord-device-jwt; never "
            "argv) must act in it, and coord must prove it owns qontinui-claude-config"
        ),
    )
    args = ap.parse_args()

    if args.dry_run and not args.retire_orphans:
        die(
            "--dry-run applies to --retire-orphans; the seed path is a dry run unless --apply"
        )
    if args.tenant and not args.retire_orphans:
        die("--tenant applies to --retire-orphans")
    if args.retire_orphans:
        return retire_orphans(args, args.coord_url.rstrip("/"))

    agents_dir = discover_agents_dir(args.agents_dir)
    agents = load_agents(agents_dir)
    if not agents:
        die(f"no *.md agent definitions found in {agents_dir}")

    policy_required = {n.strip() for n in args.policy_required.split(",") if n.strip()}
    unknown = policy_required - {a.agent_name for a in agents}
    if unknown:
        die(
            f"--policy-required names agents with no definition in {agents_dir}: "
            + ", ".join(sorted(unknown))
        )

    coord_url = args.coord_url.rstrip("/")
    print(f"agents dir : {agents_dir}")
    print(f"coord      : {coord_url}")
    print(
        f"mode       : {'APPLY' if args.apply else 'dry run (pass --apply to write)'}"
    )
    print()

    read = existing_rows(coord_url, args.token)
    current = read.rows

    plan: list[tuple[AgentDef, dict, str]] = []
    for agent in agents:
        prior = current.get(agent.agent_name)
        want = build_body(agent, policy_required, prior)
        plan.append((agent, want, describe_change(prior, want)))

    width = max(len(a.agent_name) for a, _, _ in plan)
    for agent, want, change in plan:
        flag = " [policy_required]" if want["policy_required"] else ""
        model = want["model"] or "inherit"
        print(f"  {agent.agent_name:<{width}}  {change:<28} model={model}{flag}")

        prior = current.get(agent.agent_name)
        if prior is not None and prior.get("default_enabled") is False:
            print(
                f"  {'':<{width}}  . currently DISABLED - left disabled "
                f"(a seeder re-run is not consent to re-enable it)."
            )
    print()

    if read.ok:
        report_orphans(
            list(current.values()), {a.agent_name for a in agents}, str(agents_dir)
        )
    else:
        print("orphans    : UNKNOWN - the registry was not read")
    print()

    if not args.apply:
        print("dry run - nothing written. Re-run with --apply and an admin token.")
        return 0

    if not args.token:
        die(
            "--apply needs an admin Cognito operator bearer via --token or "
            "$COORD_OPERATOR_JWT. See this script's docstring: machine-mintable "
            "clients are denied on mutating methods by design."
        )

    # An unreadable registry is UNKNOWN, not empty. `default_enabled` is
    # REQUIRED on every write, so applying against rows this run could not read
    # would send the NEW-ROW default for each agent - re-enabling one an
    # operator had deselected, or disabling `code-reviewer` after they had
    # deliberately turned it on. Preserving a value requires having read it, so
    # the guarantee this seeder advertises does not hold here at all.
    if not read.ok:
        die(
            "the current registry could not be read (see the error above), so "
            "the recorded per-agent choices are UNKNOWN. `default_enabled` is "
            "required on every write, so applying now would reset each row to "
            "the new-row default rather than preserve what is stored. Fix the "
            "read - normally by passing the same admin bearer you intend to "
            "write with - and re-run."
        )

    failures = 0
    attempted = 0
    for agent, want, _ in plan:
        attempted += 1
        url = f"{coord_url}/coord/agent-registry/{urllib.parse.quote(agent.agent_name, safe='')}"
        status, payload = http_json(url, args.token, method="PUT", body=want)
        if 200 <= status < 300:
            print(f"  OK   {agent.agent_name}")
            continue

        failures += 1
        detail = payload if isinstance(payload, str) else json.dumps(payload)
        print(f"  FAIL {agent.agent_name}: HTTP {status} {detail}", file=sys.stderr)

        if (
            isinstance(payload, dict)
            and payload.get("error") == "non_interactive_write_forbidden"
        ):
            print(
                "\n    That token's Cognito client is in "
                "COORD_OIDC_NONINTERACTIVE_AUDIENCES, so coord denies every\n"
                "    mutating method from it BEFORE the role check - even though the "
                "token may well carry\n"
                "    the admin role. Use a bearer from an interactive dashboard login. "
                "This is a deliberate\n"
                "    control (coord `auth::deny_non_interactive_write`); do not route "
                "around it.\n",
                file=sys.stderr,
            )
            break
        if status == 401:
            print(
                "\n    401 means no operator context resolved - the bearer is not a "
                "Cognito operator token\n"
                "    (a device JWT or proxy nonce will do this).\n",
                file=sys.stderr,
            )
            break
        if status == 403:
            print(
                "\n    403 after a resolved operator context means the account lacks "
                "the `admin` role\n"
                "    (coord RBAC: operator < agent_supervisor < admin).\n",
                file=sys.stderr,
            )
            break

    if failures:
        # `len(plan)` would have read as "the rest succeeded". Each of the
        # three branches above breaks out of the loop, because a credential
        # the whole run shares cannot be wrong for one row and right for the
        # next - so the untried rows are untried, not fine.
        skipped = len(plan) - attempted
        summary = f"\n{failures} of {attempted} attempted rows failed."
        if skipped:
            summary += (
                f" {skipped} further row(s) were never attempted: the error "
                f"above is fatal for every row, not just this one."
            )
        print(summary, file=sys.stderr)
        return 1

    print(f"\nseeded {len(plan)} agent role rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
