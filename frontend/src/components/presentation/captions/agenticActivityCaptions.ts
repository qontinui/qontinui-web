/**
 * Captions for the agentic activity lens surface (`/admin/coord/spawns`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a panel of THIS page — the spawn-path matrix, the
 * per-machine status — adds its entry here, keyed `agentic-activity.<panel>`,
 * and never touches another surface's file.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const AGENTIC_ACTIVITY_CAPTIONS = {
  "agentic-activity.page": {
    title: "Agentic activity",
    oneLiner: copy`Every ${term("agent_session", "agent session")} the system started on its own, why it started, and where it ran.`,
    // Not "each path has its own switch, and it binds": some switches are
    // recorded but only logged (shadow), some are environment-only, and one
    // switch covers every gate continuation. The page lists each path WITH
    // whether its switch is enforced, and the copy says exactly that.
    whyItMatters: copy`Each automated path that starts agents is listed with its switch, its scope and whether that switch is enforced or only recorded, so the ${term("operator", "operator")} can see exactly how much autonomy each path has been given.`,
  },
} as const satisfies SurfaceCaptions<"agentic-activity">;
