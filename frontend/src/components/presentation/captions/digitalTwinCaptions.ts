/**
 * Captions for the digital twin lens surface (`/digital-twin`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a panel of THIS page adds its entry here, keyed
 * `digital-twin.<panel>`, and never touches another surface's file. The key
 * prefix is enforced by `SurfaceCaptions<"digital-twin">`.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const DIGITAL_TWIN_CAPTIONS = {
  "digital-twin.page": {
    // The page's own title: `Caption` renders it as the page heading, and
    // Spec CI asserts a heading reading exactly "Digital Twin".
    title: "Digital Twin",
    oneLiner:
      "The environment your agents act in, the process they follow and the intent they serve: how much of each the twin observes, and how credibly.",
    whyItMatters: copy`An ${term("agent_session", "agent")} reads this same model before it acts, so whatever the twin cannot observe is shown as ${term("unknown", "unknown")} rather than guessed.`,
  },
} as const satisfies SurfaceCaptions<"digital-twin">;
