/**
 * The sidebar's navigation while presenting (plan
 * `2026-10-23-console-presentation-spaces` D3).
 *
 * Presentation mode exists only inside the lens trees (`LENS_TREES`): a page
 * outside them has no lens, so it renders its operator view — its costs, its
 * hostnames, its controls. A sidebar entry leading out of the lens is
 * therefore one click from a presentation to a page that was never meant to
 * be presented. While presenting, the sidebar offers only entries whose route
 * is inside a lens tree; a section keeps the entries that are, and goes when
 * none is. Pure: `UnifiedSidebar` applies it.
 */

import { isLensTreePath } from "@/components/presentation";
import type { NavItem } from "./types";

export function lensNavItems(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => {
    if (item.children && item.children.length > 0) {
      const children = lensNavItems(item.children);
      return children.length > 0 ? [{ ...item, children }] : [];
    }
    return isLensTreePath(item.route) ? [item] : [];
  });
}
