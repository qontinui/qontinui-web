/**
 * Captions for the dev-ops lens surface (`/admin/coord/devops`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a section of THIS page — the health strip, the
 * conditions panel, the machine list, roles, resources, worktree slots, the
 * audit panel — adds its entry here, keyed `dev-ops.<section>`, and never
 * touches another surface's file.
 *
 * Phase 7 captions every section the page renders (`SectionCaption` mounts
 * them, presentation mode only), in the order the page shows them.
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
    // spawn_admission.rs), so that sentence would not be true. And no "here":
    // a withheld page's placeholder shows its title and one-liner only, so a
    // why-it-matters never sits above "kept off screen" pointing at the page.
    whyItMatters: copy`Each ${term("device", "machine")} reports its own health and load, so a machine that is struggling or offline shows in its own report rather than being discovered when work stops moving.`,
  },
  "dev-ops.health-strip": {
    title: "Fleet health at a glance",
    oneLiner: copy`Whether the ${term("coord", "coordination service")} can reach every machine, and whether each machine can still reach it back.`,
    whyItMatters: copy`A machine can answer every check and still have lost the credential it works with, so both directions are checked, and a machine nobody has measured is shown as ${term("unknown")} rather than as healthy.`,
  },
  "dev-ops.conditions": {
    title: "Problems nobody has picked up",
    oneLiner: copy`Anything degraded that no agent has claimed yet, and any question that is waiting on the ${term("operator")}.`,
    whyItMatters:
      "Agents claim and fix most problems on their own, so this panel shows only what is left over, and a person looks only at what genuinely needs a person.",
  },
  "dev-ops.machines": {
    title: "Machines",
    oneLiner: copy`Every ${term("device", "machine")} in the fleet, with what is running on it and how much disk it has left.`,
    whyItMatters: copy`A machine that stops reporting stays on this list as ${term("unknown")} instead of disappearing, so a silent machine can never pass for a healthy one.`,
  },
  "dev-ops.roles": {
    title: "Machine roles",
    oneLiner:
      "What kind of work each machine is allowed to take: everything, only builds and tests, or nothing.",
    whyItMatters: copy`One fleet can mix large workstations with build-only machines, and the ${term("coord", "coordination service")} respects each role every time it places new work.`,
  },
  "dev-ops.resources": {
    title: "Room for more work",
    oneLiner:
      "How loaded each machine is right now, and whether it will accept more work.",
    whyItMatters: copy`The verdict shown here is the same one the ${term("coord", "coordination service")} uses to decide where new work goes, so the dashboard and the scheduler cannot disagree.`,
  },
  "dev-ops.worktree-slots": {
    title: "Agent workspaces in use",
    oneLiner: copy`How many isolated agent workspaces (${term("worktree_allocation", "worktree allocations")}) each machine holds against its limit.`,
    whyItMatters:
      "Every agent works in its own copy of the code, so many agents can work in parallel without overwriting each other, and the limit keeps any one machine from being overloaded.",
  },
  "dev-ops.audit": {
    title: "Change history",
    oneLiner:
      "A durable record of every manual change made to the fleet, when it happened, and how far it reached.",
    whyItMatters: copy`Nothing about the fleet changes without a trace: taking a machine out of service with a ${term("drain")}, or changing a fleet setting, is recorded as it happens.`,
  },
} as const satisfies SurfaceCaptions<"dev-ops">;
