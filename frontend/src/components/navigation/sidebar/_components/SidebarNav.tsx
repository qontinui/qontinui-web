import * as React from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NavItem } from "../types";
import { CollapsibleNavItem } from "../CollapsibleNavItem";
import { NavItemButton } from "../NavItemButton";

interface SidebarNavProps {
  isCollapsed: boolean;
  mounted: boolean;
  visibleNavItems: NavItem[];
  projectId: string | null;
  isRouteActive: (route: string, item: NavItem) => boolean;
  onNavigate: (route: string, projectId: string | null) => void;
}

export function SidebarNav({
  isCollapsed,
  mounted,
  visibleNavItems,
  projectId,
  isRouteActive,
  onNavigate,
}: SidebarNavProps) {
  return (
    <ScrollArea className="flex-1 px-2">
      <nav
        data-tutorial-id="sidebar-nav"
        className={cn(
          "flex flex-col gap-0.5 py-2",
          isCollapsed && "items-center"
        )}
      >
        {visibleNavItems.map((item) => (
          <React.Fragment key={item.id}>
            {item.group &&
              (isCollapsed ? (
                <div className="my-1.5 h-px w-6 bg-border-subtle" />
              ) : (
                <div className="flex items-center gap-2 px-2 pt-3 pb-0.5 first:pt-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    {item.group}
                  </span>
                  <div className="h-px flex-1 bg-border-subtle/50" />
                </div>
              ))}
            {item.children ? (
              <CollapsibleNavItem
                item={item}
                isCollapsed={isCollapsed}
                onNavigate={(route) => onNavigate(route, projectId)}
                isRouteActive={isRouteActive}
                mounted={mounted}
              />
            ) : (
              <NavItemButton
                item={item}
                isCollapsed={isCollapsed}
                isActive={isRouteActive(item.route, item)}
                onClick={() => onNavigate(item.route, projectId)}
                mounted={mounted}
              />
            )}
          </React.Fragment>
        ))}
      </nav>
    </ScrollArea>
  );
}
