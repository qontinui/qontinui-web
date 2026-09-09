"use client";

/**
 * /admin/coord/agent-commands — the fleet's slash-command corpus (plan
 * `2026-08-20-fleet-served-agent-skills.md`, Phase 3).
 *
 * Supersedes `/settings/agent-commands`, which is retired to a redirect in
 * `next.config.mjs` in the same change: two editors over one corpus is how the
 * two diverge, and the account-only page could not express the fleet layer
 * Phase 2 added at all.
 *
 * The body is shared with `/admin/coord/agent-skills` — one editor over one
 * `project.agent_text_units` table, parameterized by `kind`. See
 * `../_agent-text-units/_components/AgentTextUnitsConsole.tsx`.
 *
 * Backend: `GET/POST /api/v1/agent-text-units`,
 * `GET/PATCH/DELETE /api/v1/agent-text-units/{name}?kind=command`,
 * `GET /api/v1/agent-text-units/{name}/versions`,
 * `POST /api/v1/agent-text-units/{name}/revert`, each addressing either the
 * account layer or, with `fleet_default=true`, the fleet layer.
 *
 * Crawl-safety: a child of the `/admin/coord` layout, and it talks only to the
 * always-registered `httpClient` (no cloud-only extension slot), matching every
 * sibling admin/coord page.
 */

import { AgentTextUnitsConsole } from "../_agent-text-units/_components/AgentTextUnitsConsole";
import { KIND_COMMAND } from "../_agent-text-units/types";

export default function AgentCommandsConsolePage() {
  return <AgentTextUnitsConsole kind={KIND_COMMAND} />;
}
