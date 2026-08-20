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
 ``allowed_dispositions`` all three: ``block``, ``degrade``, ``warn_proceed``
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
plan output diffs against what the registry already holds, so a re-run on an
unchanged tree writes the same values and reports ``unchanged``.

Exit codes: ``0`` success (or a clean dry run), ``1`` one or more writes failed,
``2`` bad input (no agents directory, missing token with ``--apply``).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

DEFAULT_COORD_URL = "https://coord.qontinui.io"
SPAWN_PATH = "in_session_subagent"
ALLOWED_DISPOSITIONS = ["block", "degrade", "warn_proceed"]
FANOUT_BOUND = 1

# `verification-and-evidence` → `pre-pr-review` names the code-reviewer agent as
# the policy-required step before opening a PR. Nothing else in the served
# policy set names an agent as required, so nothing else defaults to True.
DEFAULT_POLICY_REQUIRED = ("code-reviewer",)


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
            sys.exit(f"--agents-dir {p} is not a directory")
        return p

    here = Path.cwd().resolve()
    for base in (here, *here.parents):
        candidate = base / ".claude" / "agents"
        if candidate.is_dir():
            return candidate
        sibling = base / "qontinui-claude-config" / ".claude" / "agents"
        if sibling.is_dir():
            return sibling

    sys.exit(
        "could not find a `.claude/agents` directory walking up from "
        f"{here}. Pass --agents-dir explicitly."
    )


def http_json(
    url: str, token: str | None, method: str = "GET", body: dict | None = None
) -> tuple[int, object]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw
    except urllib.error.URLError as e:
        sys.exit(f"cannot reach coord at {url}: {e.reason}")


def existing_rows(coord_url: str, token: str | None) -> dict[str, dict]:
    """Current registry rows, by agent_name. `{}` when the read is not permitted.

    The read is tenant-scoped (any tenant member), so it usually succeeds even
    when the write will not — which is what makes the dry-run plan useful
    without an admin token.
    """
    status, payload = http_json(f"{coord_url}/coord/agent-registry", token)
    if status != 200 or not isinstance(payload, dict):
        print(
            f"  - could not read the current registry (HTTP {status}) - the plan "
            f"below shows every row as `new`, which may overstate the change.",
            file=sys.stderr,
        )
        return {}
    # Confirmed shape: `{"agents": [...], "prefs": [...]}`
    # (coord `agent_registry::get_registry_handler`).
    rows = payload.get("agents") or []
    return {
        r["agent_name"]: r for r in rows if isinstance(r, dict) and "agent_name" in r
    }


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
    if existing is not None:
        enabled = bool(existing.get("default_enabled", True))
    else:
        enabled = agent.agent_name not in policy_required
    return {
        "purpose": agent.purpose,
        "spawn_path": SPAWN_PATH,
        "model": agent.model,
        "default_enabled": enabled,
        "policy_required": agent.agent_name in policy_required,
        "allowed_dispositions": ALLOWED_DISPOSITIONS,
        "fanout_bound": FANOUT_BOUND,
        "definition_body": agent.body,
    }


def describe_change(existing: dict | None, want: dict) -> str:
    if existing is None:
        return "new"
    drift = [
        k
        for k in (
            "purpose",
            "spawn_path",
            "model",
            "policy_required",
            "fanout_bound",
            "default_enabled",
        )
        if existing.get(k) != want.get(k)
    ]
    return "unchanged" if not drift else "update: " + ", ".join(drift)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Seed coord's agent registry from .claude/agents/*.md"
    )
    ap.add_argument("--agents-dir", help="directory holding the agent .md definitions")
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
    ap.add_argument(
        "--apply",
        action="store_true",
        help="actually write. Without it, the plan is printed and nothing is sent.",
    )
    args = ap.parse_args()

    agents_dir = discover_agents_dir(args.agents_dir)
    agents = load_agents(agents_dir)
    if not agents:
        sys.exit(f"no *.md agent definitions found in {agents_dir}")

    policy_required = {n.strip() for n in args.policy_required.split(",") if n.strip()}
    unknown = policy_required - {a.agent_name for a in agents}
    if unknown:
        sys.exit(
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

    current = existing_rows(coord_url, args.token)

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

    if not args.apply:
        print("dry run - nothing written. Re-run with --apply and an admin token.")
        return 0

    if not args.token:
        sys.exit(
            "--apply needs an admin Cognito operator bearer via --token or "
            "$COORD_OPERATOR_JWT. See this script's docstring: machine-mintable "
            "clients are denied on mutating methods by design."
        )

    failures = 0
    for agent, want, _ in plan:
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
        print(f"\n{failures} of {len(plan)} rows failed.", file=sys.stderr)
        return 1

    print(f"\nseeded {len(plan)} agent role rows.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
