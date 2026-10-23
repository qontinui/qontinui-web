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
    whyItMatters: copy`Agents check their own changes by operating the real interface through the ${term("runner", "runner")}, and every control declares whether it only reads or also writes, so an automated walk never presses something it should not.`,
  },
} as const satisfies SurfaceCaptions<"ui-bridge">;
