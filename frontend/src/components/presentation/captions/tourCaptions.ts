/**
 * Captions for the tour (`/admin/coord/tour`, plan
 * `2026-10-23-console-presentation-spaces` D5 and Phase 8).
 *
 * The tour sequences the five lens pages; each stop's one sentence is that
 * page's own `<surface>.page` one-liner, so a stop's caption and its page's
 * caption are one entry and cannot disagree. This file holds only what is the
 * tour's own: its page caption and any tour-only chrome Phase 8 adds, keyed
 * `tour.<part>`.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const TOUR_CAPTIONS = {
  "tour.page": {
    title: "Tour",
    oneLiner:
      "A guided walk through five live pages of the real console, shown in presentation mode.",
    whyItMatters: copy`Every stop is the ${term("operator", "operator")}'s own working page with its live data, not a separate demo, so what you are shown is what actually runs.`,
  },
} as const satisfies SurfaceCaptions<"tour">;
