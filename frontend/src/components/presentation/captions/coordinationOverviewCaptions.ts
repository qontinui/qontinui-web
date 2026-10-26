/**
 * Captions for the coordination overview lens surface (`/admin/coord/home`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a tile of THIS page adds its entry here, keyed
 * `coordination-overview.<tile>`, and never touches another surface's file.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const COORDINATION_OVERVIEW_CAPTIONS = {
  "coordination-overview.page": {
    title: "Coordination overview",
    oneLiner: copy`The state of every project on one screen: what is moving, what is waiting, and what needs the ${term("operator", "operator")}.`,
    whyItMatters: copy`Many agents work at once, and the ${term("coord", "coordination service")} keeps their ${term("claim", "claims")}, ${term("work_unit", "work units")} and ${term("gate", "gates")} consistent, so a whole fleet's work reads as one story instead of hundreds of separate events.`,
  },
} as const satisfies SurfaceCaptions<"coordination-overview">;
