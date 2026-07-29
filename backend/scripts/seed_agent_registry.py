#!/usr/bin/env python3
"""Seed ``coord.agent_registry`` from ``.claude/agents/*.md`` definitions.

Phase 4a of the CLAUDE.md-into-qontinui migration plan
(``qontinui-dev-notes/plans/2026-07-28-migrate-claude-md-into-qontinui.md``).

Reads every ``*.md`` agent definition in an agents directory (the fleet's
``qontinui-claude-config/.claude/agents/`` by default), parses the flat YAML
frontmatter (``name`` / ``description`` / ``model`` / ``effort`` — ``tools``
stays inside the stored markdown), and UPSERTs one ``coord.agent_registry``
row per agent for the given tenant.

Column mapping
==============
* ``agent_name``      — frontmatter ``name`` (falls back to the file stem).
* ``purpose``         — frontmatter ``description`` (empty if absent).
* ``model``/``effort``— frontmatter values, NULL if absent.
* ``definition_body`` — the **full original file text** (frontmatter + body),
  so the registry is a lossless canonical store; the structured columns are
  extracted for querying only.
* ``policy_required`` — ``true`` for ``code-reviewer`` (pre-PR review is
  policy-mandated), ``false`` otherwise.
* ``default_enabled`` — ``true``; ``spawn_path`` — ``in_session_subagent``.
* ``allowed_dispositions`` / ``fanout_bound`` / ``trigger_condition`` are
  left at their DB defaults and never overwritten — they are coord/operator
  managed knobs, not properties of the definition file.

Safety posture
==============
* **Idempotent** — ``ON CONFLICT (tenant_id, agent_name) DO UPDATE``;
  re-running refreshes definition-derived columns only.
* **Upsert-only, never prunes** — deleting an agent's ``.md`` file does NOT
  remove or disable its registry row; row retirement is operator-managed
  (the registry drives spawn/consent decisions, so silent auto-pruning is
  the wrong default).
* ``--dry-run`` parses + logs the intended upserts and writes nothing.

Run it::

    python -m scripts.seed_agent_registry --tenant-id <uuid>
    QONTINUI_TENANT_ID=<uuid> python -m scripts.seed_agent_registry
    python -m scripts.seed_agent_registry --tenant-id <uuid> --dry-run
    python -m scripts.seed_agent_registry --tenant-id <uuid> \
        --agents-dir /path/to/.claude/agents
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

# Allow ``python scripts/seed_agent_registry.py`` (not just ``-m``).
sys.path.insert(0, str(Path(__file__).parent.parent))

import structlog  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db.session import AsyncSessionLocal  # noqa: E402

logger = structlog.get_logger(__name__)

# Env-overridable so containers / other machines never inherit the operator
# path; the constant is only the fleet dev-machine convenience default.
DEFAULT_AGENTS_DIR = os.environ.get(
    "QONTINUI_AGENTS_DIR",
    "D:/qontinui-root/qontinui-claude-config/.claude/agents",
)

# Agents whose spawn is policy-mandated (consent may not disable them
# silently): pre-PR review is required by the fleet's Pre-PR Review policy.
POLICY_REQUIRED_AGENTS = frozenset({"code-reviewer"})

_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.DOTALL)


@dataclass(frozen=True)
class AgentDefinition:
    """One parsed ``.claude/agents/*.md`` file."""

    agent_name: str
    purpose: str
    model: str | None
    effort: str | None
    definition_body: str

    @property
    def policy_required(self) -> bool:
        return self.agent_name in POLICY_REQUIRED_AGENTS


def _parse_frontmatter(raw: str) -> dict[str, str]:
    """Parse the flat ``key: value`` YAML frontmatter block, if present.

    Agent frontmatter is flat scalars only (name/description/model/tools/
    effort), so a line parser suffices — no YAML dependency, no surprises
    from multi-line values (unrecognized lines are simply skipped).
    """
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        return {}
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, sep, value = line.partition(":")
        if sep and key.strip() and not key.startswith((" ", "\t")):
            fields[key.strip()] = value.strip()
    return fields


def parse_agent_file(path: Path) -> AgentDefinition:
    """Parse one agent definition file into its registry row values."""
    # utf-8-sig: strip a BOM if present so the \A frontmatter anchor holds.
    raw = path.read_text(encoding="utf-8-sig")
    fields = _parse_frontmatter(raw)
    return AgentDefinition(
        agent_name=fields.get("name") or path.stem,
        purpose=fields.get("description", ""),
        model=fields.get("model") or None,
        effort=fields.get("effort") or None,
        definition_body=raw,
    )


_UPSERT_SQL = text(
    """
    INSERT INTO coord.agent_registry
        (tenant_id, agent_name, purpose, spawn_path, model, effort,
         default_enabled, policy_required, definition_body)
    VALUES
        (:tenant_id, :agent_name, :purpose, 'in_session_subagent', :model,
         :effort, true, :policy_required, :definition_body)
    ON CONFLICT (tenant_id, agent_name) DO UPDATE SET
        purpose         = EXCLUDED.purpose,
        model           = EXCLUDED.model,
        effort          = EXCLUDED.effort,
        policy_required = EXCLUDED.policy_required,
        definition_body = EXCLUDED.definition_body,
        updated_at      = now()
    """
)


async def seed(
    *,
    tenant_id: uuid.UUID,
    definitions: list[AgentDefinition],
    dry_run: bool = False,
) -> None:
    """Upsert every parsed agent definition for ``tenant_id``."""
    async with AsyncSessionLocal() as session:
        for d in definitions:
            logger.info(
                "agent_registry_seed_upsert",
                agent_name=d.agent_name,
                purpose=d.purpose[:80],
                model=d.model,
                effort=d.effort,
                policy_required=d.policy_required,
                body_chars=len(d.definition_body),
                dry_run=dry_run,
            )
            if dry_run:
                continue
            await session.execute(
                _UPSERT_SQL,
                {
                    "tenant_id": str(tenant_id),
                    "agent_name": d.agent_name,
                    "purpose": d.purpose,
                    "model": d.model,
                    "effort": d.effort,
                    "policy_required": d.policy_required,
                    "definition_body": d.definition_body,
                },
            )
        if not dry_run:
            await session.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tenant-id",
        default=os.environ.get("QONTINUI_TENANT_ID", ""),
        help="Tenant UUID to seed rows for (default: env QONTINUI_TENANT_ID).",
    )
    parser.add_argument(
        "--agents-dir",
        type=Path,
        default=Path(DEFAULT_AGENTS_DIR),
        help=f"Directory of agent *.md definitions (default: {DEFAULT_AGENTS_DIR}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse + log intended upserts but write nothing.",
    )
    args = parser.parse_args()

    if not args.tenant_id:
        parser.error("--tenant-id is required (or set QONTINUI_TENANT_ID)")
    try:
        tenant_id = uuid.UUID(args.tenant_id)
    except ValueError:
        parser.error(f"--tenant-id is not a valid UUID: {args.tenant_id!r}")
    if not args.agents_dir.is_dir():
        parser.error(f"--agents-dir is not a directory: {args.agents_dir}")

    definitions = [parse_agent_file(p) for p in sorted(args.agents_dir.glob("*.md"))]
    if not definitions:
        parser.error(f"no *.md agent definitions found in {args.agents_dir}")

    asyncio.run(
        seed(tenant_id=tenant_id, definitions=definitions, dry_run=args.dry_run)
    )

    # A human-greppable one-line summary for CloudWatch / workflow logs.
    names = ",".join(d.agent_name for d in definitions)
    print(
        f"agent-registry-seed: tenant={tenant_id} agents={len(definitions)} "
        f"[{names}] dry_run={args.dry_run}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
