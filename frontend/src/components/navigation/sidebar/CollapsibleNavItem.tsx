"use client";

import * as React from "react";
import { useState, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NavItem } from "./types";
import { NestedSubGroup } from "./NestedSubGroup";

export interface CollapsibleNavItemProps {
  item: NavItem;
  isCollapsed: boolean;
  onNavigate: (route: string) => void;
  isRouteActive: (route: string, item: NavItem) => boolean;
  mounted: boolean;
}

export function CollapsibleNavItem({
  item,
  isCollapsed,
  onNavigate,
  isRouteActive,
  mounted,
}: CollapsibleNavItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isParentActive = isRouteActive(item.route, item);

  // Helper: check if any descendant is active (supports grandchildren)
  const isAnyDescendantActive = useCallback(
    (children?: NavItem[]): boolean => {
      if (!children) return false;
      return children.some(
        (child) =>
          isRouteActive(child.route, child) ||
          isAnyDescendantActive(child.children)
      );
    },
    [isRouteActive]
  );

  // Auto-open if any child or grandchild is active
  React.useEffect(() => {
    if (isAnyDescendantActive(item.children)) {
      setIsOpen(true);
    }
  }, [item.children, isAnyDescendantActive]);

  if (isCollapsed) {
    // Flatten children + grandchildren for collapsed dropdown
    const flatItems: NavItem[] = [];
    item.children?.forEach((child) => {
      if (child.children && child.children.length > 0) {
        flatItems.push(...child.children);
      } else {
        flatItems.push(child);
      }
    });

    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                data-nav-id={item.id}
                data-tutorial-id={`nav-${item.id}`}
                data-route={item.route}
                className={cn(
                  "flex size-10 items-center justify-center rounded-md transition-colors",
                  isParentActive
                    ? "bg-surface-hover text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
                )}
              >
                <span
                  style={{ color: isParentActive ? item.color : undefined }}
                >
                  {item.icon}
                </span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="right" align="start" className="w-56">
          {item.children?.map((child) =>
            child.children && child.children.length > 0 ? (
              <React.Fragment key={child.id}>
                <DropdownMenuSeparator />
                <div className="px-2 py-1 text-xs font-semibold text-text-muted">
                  {child.label}
                </div>
                {child.children.map((grandchild) => (
                  <DropdownMenuItem
                    key={grandchild.id}
                    onClick={() => onNavigate(grandchild.route)}
                    className={cn(
                      isRouteActive(grandchild.route, grandchild) &&
                        "bg-surface-hover"
                    )}
                  >
                    <span
                      className="mr-2"
                      style={{
                        color: isRouteActive(grandchild.route, grandchild)
                          ? grandchild.color
                          : undefined,
                      }}
                    >
                      {grandchild.icon}
                    </span>
                    {grandchild.label}
                  </DropdownMenuItem>
                ))}
              </React.Fragment>
            ) : (
              <DropdownMenuItem
                key={child.id}
                onClick={() => onNavigate(child.route)}
                className={cn(
                  isRouteActive(child.route, child) && "bg-surface-hover"
                )}
              >
                <span
                  className="mr-2"
                  style={{
                    color: isRouteActive(child.route, child)
                      ? child.color
                      : undefined,
                  }}
                >
                  {child.icon}
                </span>
                {child.label}
                {child.badge && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "ml-auto h-4 px-1 text-[10px]",
                      child.badge === "beta" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    )}
                  >
                    {child.badge}
                  </Badge>
                )}
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          data-nav-id={item.id}
          data-tutorial-id={`nav-${item.id}`}
          data-route={item.route}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
            isParentActive
              ? "bg-surface-hover/50 text-text-primary"
              : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
          )}
        >
          <span style={{ color: isParentActive ? item.color : undefined }}>
            {item.icon}
          </span>
          <span className="flex-1 text-left">{item.label}</span>
          {mounted && item.hiddenInProd && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
            >
              dev
            </Badge>
          )}
          <ChevronRight
            className={cn(
              "size-4 shrink-0 transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="ml-4 flex flex-col gap-0.5 border-l border-border-subtle pl-3 pt-1">
          {item.children?.map((child) => {
            // If child has its own children, render as a nested collapsible
            if (child.children && child.children.length > 0) {
              return (
                <NestedSubGroup
                  key={child.id}
                  item={child}
                  onNavigate={onNavigate}
                  isRouteActive={isRouteActive}
                  mounted={mounted}
                />
              );
            }
            const isChildActive = isRouteActive(child.route, child);
            return (
              <button
                key={child.id}
                data-route={child.route}
                onClick={() => onNavigate(child.route)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  isChildActive
                    ? "bg-surface-hover text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
                )}
              >
                <span
                  style={{ color: isChildActive ? child.color : undefined }}
                >
                  {child.icon}
                </span>
                <span className="flex-1">{child.label}</span>
                {mounted && child.hiddenInProd && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 text-[9px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
                  >
                    dev
                  </Badge>
                )}
                {child.badge && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-4 px-1 text-[9px] font-medium",
                      child.badge === "beta" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-400",
                      child.badge === "experimental" &&
                        "border-purple-500/30 bg-purple-500/10 text-purple-400"
                    )}
                  >
                    {child.badge}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
