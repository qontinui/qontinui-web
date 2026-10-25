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
    whyItMatters: copy`Agents check their own changes by operating the real interface through the ${term("runner", "runner")}, and every control declares whether it only reads or also writes, so an automated walk never presses something it should not.`,
  },
  "ui-bridge.apps": {
    title: "Registered applications",
    oneLiner:
      "Every application the fleet knows how to drive, as the web and this runner each record it.",
    whyItMatters: copy`One registry spans every machine, so an agent on any ${term("runner", "runner")} opens the same application by the same name and checks it against the same model.`,
  },
  "ui-bridge.spec-graph": {
    title: "Screens and states",
    oneLiner:
      "The screens an application declares, and the states and transitions on each of them.",
    whyItMatters:
      "The model is extracted from the application's own source rather than drawn by hand, so it changes when the code changes and an agent can plan a route through the interface before it touches anything.",
  },
  "ui-bridge.snapshot": {
    title: "Live element snapshot",
    oneLiner:
      "What is on the runner's screen right now, as structured elements rather than pixels.",
    whyItMatters:
      "An agent reads exact element positions, roles and states instead of guessing from a screenshot, which is what makes its checks repeatable from one run to the next.",
  },
  "ui-bridge.sdk-posture": {
    title: "Capabilities and trust",
    oneLiner:
      "Which UI Bridge capabilities this runner ships, and how strictly it checks who may register an application with it.",
    whyItMatters: copy`Every registration that reaches a ${term("runner", "runner")} through the cloud relay is checked against fixed rules, and these counters show each rule at work rather than asserting that it is.`,
  },
  "ui-bridge.component-actions": {
    title: "Controls and what they do",
    oneLiner:
      "Every control the runner's interface registers, and whether each one only reads, writes, or destroys.",
    whyItMatters: copy`A control whose author declared no effect is counted as undeclared and never assumed to be safe, so an automated walk knows what it may press before it presses anything, and an ${term("operator", "operator")} can see exactly where a declaration is missing. Over the cloud relay the list holds the runner's own controls only, because applications connected to the runner are not asked, and the panel says so rather than implying they were.`,
  },
  "ui-bridge.page-health": {
    title: "Page health",
    oneLiner:
      "Whether the runner's current screen looks healthy, and whether anything on it covers anything else.",
    whyItMatters: copy`A page can pass every selector test and still be broken or covered, so this check reads the layout and the text, and it reports ${term("unknown", "unknown")} when it could not see rather than calling the page clear.`,
  },
} as const satisfies SurfaceCaptions<"ui-bridge">;
