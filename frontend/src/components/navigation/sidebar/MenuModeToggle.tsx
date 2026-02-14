"use client";

import { Layers } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMenuModeStore } from "@/stores/menu-mode";

export interface MenuModeToggleProps {
  isCollapsed: boolean;
}

export function MenuModeToggle({ isCollapsed }: MenuModeToggleProps) {
  const menuMode = useMenuModeStore((s) => s.menuMode);
  const toggleMenuMode = useMenuModeStore((s) => s.toggleMenuMode);

  const label =
    menuMode === "simple" ? "Show All Pages" : "Show Fewer Pages";

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleMenuMode}
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <Layers className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={toggleMenuMode}
      className="flex h-9 w-full items-center justify-center gap-2 rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
    >
      <Layers className="size-4" />
      <span className="text-sm">{label}</span>
    </button>
  );
}
