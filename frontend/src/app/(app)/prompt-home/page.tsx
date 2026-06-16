"use client";

/**
 * /prompt-home — the web Home surface.
 *
 * Home IS the co-pilot: the `prompt-home` nav item (from the shared
 * `@qontinui/navigation` registry, route `/prompt-home`) renders the AI
 * co-pilot command surface directly, mirroring the runner where the
 * prompt-home/Home IS the co-pilot/prompt surface (there is no separate
 * co-pilot page). The legacy `/co-pilot` route redirects here.
 *
 * The surface lives in {@link CoPilotHome}, which carries the
 * `data-bridge-invisible` self-targeting guard so the planner can never ground
 * a step on the co-pilot's own controls or "navigate to /prompt-home" from
 * /prompt-home.
 */

import { CoPilotHome } from "@/components/co-pilot/CoPilotHome";

export default function PromptHomePage() {
  return <CoPilotHome />;
}
