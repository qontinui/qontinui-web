/**
 * The sidebar's entries while presenting (plan
 * `2026-10-23-console-presentation-spaces` D3), over the REAL web menu
 * (`nav-items.ts`): only entries inside a lens tree stay — and the tour's
 * entry, the presenter's way in (Phase 8), is one of them.
 */

import { describe, expect, it } from "vitest";
import { TOUR_SURFACE, isLensTreePath } from "@/components/presentation";
import { devNavItems } from "./nav-items";
import { lensNavItems } from "./presentationNav";
import type { NavItem } from "./types";

function flatten(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

const leaves = (items: readonly NavItem[]) =>
  flatten(items).filter((item) => !item.children?.length);

describe("lensNavItems over the web menu", () => {
  it("keeps the tour entry, top-level in the Coord section", () => {
    const kept = lensNavItems(devNavItems);
    const tour = kept.find((item) => item.route === TOUR_SURFACE.route);
    expect(tour?.label).toBe("Tour");
    expect(tour?.id).toBe("coord-tour");
    expect(tour?.group).toBe("Coord");
  });

  it("keeps only entries inside a lens tree, and drops the rest", () => {
    const kept = leaves(lensNavItems(devNavItems));
    // Not vacuous: the menu has entries on both sides of the line.
    expect(kept.length).toBeGreaterThan(0);
    expect(leaves(devNavItems).length).toBeGreaterThan(kept.length);
    for (const item of kept) {
      expect(isLensTreePath(item.route), item.route).toBe(true);
    }
    expect(kept.some((item) => item.route === "/sessions")).toBe(false);
  });
});
