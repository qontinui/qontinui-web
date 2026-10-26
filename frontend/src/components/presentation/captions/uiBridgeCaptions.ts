/**
 * Captions for the UI Bridge lens surface (`/admin/coord/ui-bridge`).
 *
 * One file per lens surface (plan `2026-10-23-console-presentation-spaces`
 * D5): a phase captioning a panel of THIS page — the app registry, the
 * state graph, the component actions, page health — adds its entry here,
 * keyed `ui-bridge.<panel>`, and never touches another surface's file.
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
} as const satisfies SurfaceCaptions<"ui-bridge">;
