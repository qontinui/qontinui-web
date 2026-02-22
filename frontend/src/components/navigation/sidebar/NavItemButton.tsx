"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NavItem } from "./types";

export interface NavItemButtonProps {
  item: NavItem;
  isCollapsed: boolean;
  isActive?: boolean;
  onClick?: () => void;
  mounted?: boolean;
}

export function NavItemButton({
  item,
  isCollapsed,
  isActive,
  onClick,
  mounted,
}: NavItemButtonProps) {
  const content = (
    <button
      onClick={onClick}
      data-ui-id={`nav-${item.id}`}
      data-nav-id={item.id}
      data-tutorial-id={`nav-${item.id}`}
      data-route={item.route}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors",
        isActive
          ? "bg-surface-hover font-medium text-text-primary"
          : "text-text-muted hover:bg-surface-hover hover:text-text-primary",
        isCollapsed && "justify-center"
      )}
    >
      <span style={{ color: isActive ? item.color : undefined }}>
        {item.icon}
      </span>
      {!isCollapsed && (
        <>
          <span className="flex-1 text-left">{item.label}</span>
          {mounted && item.hidden && (
            <Badge
              variant="outline"
              className="ml-auto h-5 px-1.5 text-[10px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
            >
              hidden
            </Badge>
          )}
          {item.badge && (
            <Badge
              variant="outline"
              className={cn(
                "ml-auto h-5 px-1.5 text-[10px] font-medium",
                item.badge === "beta" &&
                  "border-amber-500/30 bg-amber-500/10 text-amber-400",
                item.badge === "experimental" &&
                  "border-purple-500/30 bg-purple-500/10 text-purple-400"
              )}
            >
              {item.badge}
            </Badge>
          )}
        </>
      )}
    </button>
  );

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {item.label}
          {item.badge && (
            <Badge variant="outline" className="h-4 px-1 text-[10px]">
              {item.badge}
            </Badge>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
