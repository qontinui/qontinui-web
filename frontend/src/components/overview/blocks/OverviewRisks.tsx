"use client";

/**
 * `overview-risks top=N` — the project's top risks, once there are risks to
 * show (plan `2026-09-19-project-overview-for-business-leaders` Phase 9; plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * Risks are not built yet (authoring-layer Phase 6), so the block says so in
 * the voice of the section that will hold them (`SectionNotReady`) — never an
 * empty list, which would read as "this project has no risks".
 */

import { OVERVIEW_SECTIONS } from "@/components/overview/sections";
import type { DataBlockProps, OverviewRisksArgs } from "./blockArgs";
import { BlockFrame, BlockNotice } from "./blockChrome";

const RISKS = OVERVIEW_SECTIONS.find((s) => s.id === "overview-risks");

export function OverviewRisks({ args }: DataBlockProps<OverviewRisksArgs>) {
  const top = args.top ? Number(args.top) : null;
  return (
    <BlockFrame
      name="overview-risks"
      uiBridgeId="overview.block.risks"
      label="Risks"
    >
      <BlockNotice
        title="Risks aren't available yet"
        detail={`${RISKS?.description ?? "What could go wrong"}. When ${RISKS?.label ?? "that section"} is ready, this block will show the project's ${top ? `top ${top} risks` : "top risks"}.`}
        uiBridgeId="overview.block.risks.not-ready"
      />
    </BlockFrame>
  );
}
