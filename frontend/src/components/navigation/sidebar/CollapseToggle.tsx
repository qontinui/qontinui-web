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
  /**
   * What the control does here, when that is not "collapse the sidebar".
   * Below `lg` the same control opens and closes the overlay drawer, and
   * "Collapse" would describe an action that width has no equivalent of.
   */
  label?: string;
}

export function CollapseToggle({
  isCollapsed,
  onToggle,
  label,
}: CollapseToggleProps) {
  if (isCollapsed) {
    const collapsedLabel = label ?? "Expand sidebar";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsedLabel}
            data-sidebar-collapse-toggle=""
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary motion-reduce:transition-none"
          >
            <PanelLeftOpen className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{collapsedLabel}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      data-sidebar-collapse-toggle=""
      className="flex h-8 w-full items-center justify-center gap-2 rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary motion-reduce:transition-none"
    >
      <PanelLeftClose className="size-3.5" aria-hidden />
      <span className="text-xs">{label ?? "Collapse"}</span>
    </button>
  );
}
