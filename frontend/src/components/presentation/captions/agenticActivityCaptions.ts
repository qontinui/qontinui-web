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
    whyItMatters: copy`Each automated path that starts agents has its own switch, so autonomy is granted path by path by the ${term("operator", "operator")} and can be seen being used, not hidden in a black box.`,
  },
} as const satisfies SurfaceCaptions<"agentic-activity">;
