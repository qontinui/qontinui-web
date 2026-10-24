/**
 * Captions for the dev-ops lens surface (`/admin/coord/devops`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a section of THIS page — the health strip, the
 * conditions panel, the machine list, roles, resources, worktree slots, the
 * audit panel — adds its entry here, keyed `dev-ops.<section>`, and never
 * touches another surface's file.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const DEV_OPS_CAPTIONS = {
  "dev-ops.page": {
    title: "Dev Ops",
    oneLiner:
      "The machines the agents run on, whether each one is healthy, and how much more work it can take.",
    // Only what this page itself shows. Not "work is placed only where there
    // is room": coord refuses automated fix sessions over a machine's ceiling,
    // but other work is counted, never refused (qontinui-coord
    // spawn_admission.rs), so that sentence would not be true.
    whyItMatters: copy`Each ${term("device", "machine")} reports its own health and load, so a machine that is struggling or offline is visible here, not discovered when work stops moving.`,
  },
} as const satisfies SurfaceCaptions<"dev-ops">;
