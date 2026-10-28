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
    oneLiner: copy`Anything degraded that no agent has ${term("claim", "claimed")} yet, and any question that is waiting on the ${term("operator")}.`,
    // What the panel counts, and nothing about how much agents resolve: it
    // shows claimed and open counts beside the unclaimed ones
    // (`FleetConditionsPanel` badges), and no measurement backs a share of
    // problems agents fix.
    whyItMatters: copy`Agents ${term("claim", "claim")} the problems they take on, so the panel counts what no agent has picked up, and what is waiting on a person, separately from everything else still open.`,
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
    // The grade is coord's `headroom` against the floors at which a guard
    // waits or refuses (`device_resource_samples::headroom_against`). It is
    // NOT what places work: coord ranks machines by the load measurement and
    // "only prefers" (`ci_dispatch.rs` "Resource headroom is a RANKING input,
    // never a filter"; `build_dispatcher.rs`, `agent_placement.rs` the same),
    // and its admission gates refuse in bands the grade calls a warning
    // (`policies/isolation.rs` `HostMemory::refuses`). So the caption claims
    // the shared measurement and the preference — never one shared verdict.
    oneLiner:
      "How loaded each machine is right now, and how close it is to the limits at which new work is held back.",
    whyItMatters: copy`The dashboard and the ${term("coord", "coordination service")} measure load with one formula, and the service prefers the least-loaded machine when it places new work.`,
  },
  "dev-ops.worktree-slots": {
    title: "Agent workspaces in use",
    oneLiner: copy`How many isolated agent workspaces (${term("worktree_allocation", "worktree allocations")}) each machine holds against its limit.`,
    // "Usually": a shared branch in the main checkout is the other outcome
    // (the glossary's own word, and `policies/isolation.rs`'s SharedBranch
    // mode). The cap bounds how many copies one machine holds (per machine,
    // never below `MIN_DEVICE_WORKTREES`); memory, disk and build slots are
    // gated separately, so the caption claims only the bound, not that it
    // keeps a machine from being overloaded.
    whyItMatters:
      "Agents usually work in their own isolated copy of the code, so many can work in parallel without overwriting each other; the limit caps how many such copies one machine holds.",
  },
  "dev-ops.audit": {
    title: "Change history",
    // Not "every change": coord's audit writer is best-effort
    // (`auth_sso.rs` `audit_mutation` — a lost audit row is preferred to a
    // lost change), and a row can lack its author or its reach. The panel
    // shows those gaps as gaps, which is what the caption promises.
    oneLiner: copy`A record of deliberate changes to how the fleet runs, such as taking a machine out of service with a ${term("drain")}, with when each was made and how far it reached.`,
    whyItMatters:
      "Changes are recorded as they are made, so there is a trail to check afterwards; a row whose author or reach was not recorded says so instead of hiding the gap.",
  },
} as const satisfies SurfaceCaptions<"dev-ops">;
