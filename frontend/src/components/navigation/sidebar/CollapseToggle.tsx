"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface CollapseToggleProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function CollapseToggle({ isCollapsed, onToggle }: CollapseToggleProps) {
  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onToggle}
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      onClick={onToggle}
      className="flex h-8 w-full items-center justify-center gap-2 rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
    >
      <PanelLeftClose className="size-3.5" />
      <span className="text-xs">Collapse</span>
    </button>
  );
}
