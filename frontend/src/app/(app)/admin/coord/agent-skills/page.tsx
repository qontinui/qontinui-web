"use client";

/**
 * /admin/coord/agent-skills — the fleet's agent-skill corpus (plan
 * `2026-08-20-fleet-served-agent-skills.md`, Phase 3).
 *
 * A skill is a DIRECTORY, not a body: `SKILL.md` plus any siblings it invokes
 * by relative path (the largest real one, `coord-revive`, is `SKILL.md` plus a
 * 58 KB `coord-revive.sh` the skill tells the agent to `bash`). That is why the
 * shared editor is built on a `files` map rather than a single body, and why
 * the version diff is per-file.
 *
 * The body is shared with `/admin/coord/agent-commands` — one editor over one
 * `project.agent_text_units` table, parameterized by `kind`. A command is the
 * degenerate single-file case.
 *
 * **Nothing provisions these to a session yet.** The runner's `agent_skills`
 * module and its spawn-time provisioning are Phase 4, and the corpus import is
 * Phase 5; until those land, this page authors and versions the text and the
 * text reaches no session. The page does not claim otherwise — the editor's
 * "newly spawned sessions" copy names the provisioning target, which is where
 * Phase 4 will write it.
 *
 * Backend: `GET/POST /api/v1/agent-text-units`,
 * `GET/PATCH/DELETE /api/v1/agent-text-units/{name}?kind=skill`,
 * `GET /api/v1/agent-text-units/{name}/versions`,
 * `POST /api/v1/agent-text-units/{name}/revert`, each addressing either the
 * account layer or, with `fleet_default=true`, the fleet layer.
 */

import { AgentTextUnitsConsole } from "../_agent-text-units/_components/AgentTextUnitsConsole";
import { KIND_SKILL } from "../_agent-text-units/types";

export default function AgentSkillsConsolePage() {
  return <AgentTextUnitsConsole kind={KIND_SKILL} />;
}
