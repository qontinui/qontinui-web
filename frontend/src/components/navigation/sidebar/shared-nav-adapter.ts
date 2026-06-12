import {
  getWebNavigation,
  getChildrenForPlatform,
  setDevelopmentMode,
  type NavigationItem,
} from "@qontinui/navigation";
import type { NavItem } from "./types";
import { resolveIcon } from "./icon-resolver";

// Set development mode for navigation filtering before any items are resolved
setDevelopmentMode(process.env.NODE_ENV === "development");

function toNavItem(item: NavigationItem, iconSize = "size-5"): NavItem {
  const children = getChildrenForPlatform(item.id, "web");
  return {
    id: item.id,
    label: item.label,
    description: item.description,
    icon: resolveIcon(item.icon, iconSize),
    route: item.route ?? `/${item.id}`,
    color: item.color ?? "#9CA3AF",
    hiddenInProd: item.hiddenInProd,
    productMode: item.productMode,
    adminOnly: item.adminOnly,
    children:
      children.length > 0
        ? children.map((c) => toNavItem(c, "size-4"))
        : undefined,
  };
}

export function getWebNavItems(): NavItem[] {
  const groups = getWebNavigation();
  return groups.flatMap((group) =>
    group.items.map((item) => {
      const navItem = toNavItem(item);
      navItem.group = group.label || undefined;
      return navItem;
    })
  );
}
