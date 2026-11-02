/**
 * Captions for the UI Bridge lens surface (`/admin/coord/ui-bridge`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a panel of THIS page — the app registry, the
 * state graph, the component actions, page health — adds its entry here,
 * keyed `ui-bridge.<panel>`, and never touches another surface's file.
 *
 * The panels, in page order (Phase 6): `apps`, `spec-graph`, `snapshot`,
 * `sdk-posture`, `component-actions`, `page-health`.
 */

import { copy, term, type SurfaceCaptions } from "./captionTypes";

export const UI_BRIDGE_CAPTIONS = {
  "ui-bridge.page": {
    title: "UI Bridge",
    oneLiner:
      "How agents see and operate a running application: the screens it declares, the controls on them, and what each control does.",
    // A declaration is optional in the UI Bridge SDK, and an undeclared
    // control is "unclassified", not safe: the copy says what a control CAN
    // declare and that the page counts the ones that have not, never that
    // every control has.
    whyItMatters: copy`Agents can operate the real interface through the ${term("runner", "runner")}, and each control can declare whether it only reads, also writes, or cannot be undone; this page counts the controls nobody has classified yet.`,
  },
  "ui-bridge.apps": {
    title: "Registered applications",
    oneLiner: copy`The applications registered for agents to drive, in the web's registry and in this ${term("runner", "runner")}'s own list.`,
    // Each sentence is checked against the code: a runner on its own
    // database keeps its own rows (`appRegistryStatus.ts`), and neither list
    // is partitioned by project, so the lens reads neither
    // (`appRegistryReadsOf`) — and a caption renders only while presenting.
    whyItMatters: copy`An agent addresses an application by the id it is registered under, and a ${term("runner", "runner")} with its own database keeps its own list, so the two can differ. Neither list is kept per project, so neither is read while presenting.`,
  },
  "ui-bridge.spec-graph": {
    title: "Screens and states",
    oneLiner:
      "The screens an application declares, and the states and transitions on each of them.",
    // What the panel reads (`spec/list`, `spec/graph`), not how the model was
    // made: a spec can be hand-authored, generated or migrated, and the page
    // shows none of that provenance.
    whyItMatters: copy`The ${term("runner", "runner")} keeps this model of the application on disk and reads it without running the application, so an agent can work out a route through the interface before it touches anything.`,
  },
  "ui-bridge.snapshot": {
    title: "Live element snapshot",
    oneLiner: copy`What is on the ${term("runner", "runner")}'s screen right now, as structured elements rather than pixels.`,
    whyItMatters:
      "An agent reads exact element positions, roles and states instead of guessing from a screenshot, which is what makes its checks repeatable from one run to the next.",
  },
  "ui-bridge.sdk-posture": {
    title: "Capabilities and trust",
    oneLiner: copy`Which UI Bridge capabilities this ${term("runner", "runner")} ships, and how strictly it checks who may register an application with it.`,
    // The binding guards the UI Bridge's registrant routes, which pages of
    // any origin call on the runner directly — not the cloud relay this page
    // reads over — and it may be enforcing, only counting, or off
    // (qontinui-runner `mcp/relay_binding.rs` `BindingMode`).
    whyItMatters: copy`Applications register with a ${term("runner", "runner")}'s UI Bridge from their own pages, and the ${term("runner", "runner")} can check who each registration comes from, so that only its maker, or the ${term("operator", "operator")}, may replace or remove it. These counters show what each rule did in the mode shown — refusing when it enforces, only counting when it shadows, nothing when it is off — rather than asserting that the checks are on.`,
  },
  "ui-bridge.component-actions": {
    title: "Controls and what they do",
    oneLiner: copy`Every control the ${term("runner", "runner")}'s interface registers, and whether each one only reads, writes, or destroys.`,
    whyItMatters: copy`A control whose author declared no effect is counted as undeclared and never assumed to be safe, so an automated walk knows what it may press before it presses anything, and an ${term("operator", "operator")} can see exactly where a declaration is missing. Over the cloud relay the list holds the ${term("runner", "runner")}'s own controls only, because applications connected to the ${term("runner", "runner")} are not asked, and the panel says so rather than implying they were.`,
  },
  "ui-bridge.page-health": {
    title: "Page health",
    oneLiner: copy`Whether the ${term("runner", "runner")}'s current screen looks healthy, read from the layout and the text on it.`,
    whyItMatters: copy`A page can pass every selector test and still be broken, so this check reads what is actually on the screen, and it reports ${term("unknown", "unknown")} when it could not see rather than calling the page clear. Whether anything on the screen covers anything else is shown as ${term("unknown", "unknown")}, because the cloud relay does not carry that check yet.`,
  },
} as const satisfies SurfaceCaptions<"ui-bridge">;
