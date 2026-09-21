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
   * "Collapse sidebar" would describe an action that width has no equivalent of.
   */
  label?: string;
  /**
   * Set when this control is acting as the drawer's disclosure button rather
   * than a collapse toggle: it then owns an expanded/collapsed relationship a
   * screen reader has to be told about.
   */
  controlsDrawer?: { open: boolean; id: string };
}

export function CollapseToggle({
  isCollapsed,
  onToggle,
  label,
  controlsDrawer,
}: CollapseToggleProps) {
  const disclosureProps = controlsDrawer
    ? {
        "aria-expanded": controlsDrawer.open,
        // Only while the panel exists: the drawer is unmounted when closed,
        // and `aria-controls` pointing at a missing id is an invalid
        // relationship rather than a helpful one.
        "aria-controls": controlsDrawer.open ? controlsDrawer.id : undefined,
      }
    : {};

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
            {...disclosureProps}
            className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary motion-reduce:transition-none"
          >
            <PanelLeftOpen className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{collapsedLabel}</TooltipContent>
      </Tooltip>
    );
  }

  // As the phone drawer's disclosure button it is the only visible way to
  // close the menu, and a touch user never sees a hover tooltip — so it keeps
  // its visible wording there.
  if (controlsDrawer) {
    return (
      <button
        type="button"
        onClick={onToggle}
        data-sidebar-collapse-toggle=""
        {...disclosureProps}
        className="flex h-8 shrink-0 items-center justify-center gap-2 rounded-md px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary motion-reduce:transition-none"
      >
        <PanelLeftClose className="size-3.5" aria-hidden />
        <span className="text-xs">{label ?? "Collapse sidebar"}</span>
      </button>
    );
  }

  // Otherwise it shares the footer's bottom row with the runner status, so it
  // is an icon button — its name lives in `aria-label` and the tooltip.
  const expandedLabel = label ?? "Collapse sidebar";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={expandedLabel}
          data-sidebar-collapse-toggle=""
          {...disclosureProps}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary motion-reduce:transition-none"
        >
          <PanelLeftClose className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{expandedLabel}</TooltipContent>
    </Tooltip>
  );
}
