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
    // Only what the page shows today: the spawn ledger — every request coord
    // was asked to place, where it went, how long it waited and how it ended
    // (`admin/coord/spawns/page.tsx`). The ledger holds operator-started
    // sessions too, so not "started on its own". The spawn-path matrix — each
    // path with its switch and whether it is enforced — is a later phase's
    // panel, and its caption arrives with it.
    oneLiner: copy`Every ${term("agent_session", "agent session")} the ${term("coord", "coordination service")} was asked to start: where it went, how long it waited, and how it ended.`,
    whyItMatters: copy`Each request is a row naming where it came from, so what the system starts on its own and what a person asked for can be told apart, and how every request ended stays on record.`,
  },
} as const satisfies SurfaceCaptions<"agentic-activity">;
