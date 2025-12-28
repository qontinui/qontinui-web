"use client";

/**
 * MonitorFilter Component
 *
 * Toggle between showing all monitors vs only monitors with elements.
 * Used in State Visualization and Transition Visualization.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Monitor, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface MonitorFilterProps {
  /** Whether to show only monitors with elements */
  showOnlyWithElements: boolean;
  /** Callback when filter changes */
  onChange: (showOnlyWithElements: boolean) => void;
  /** Number of total monitors */
  totalMonitors: number;
  /** Number of monitors with elements */
  monitorsWithElements: number;
  /** Additional class names */
  className?: string;
}

export function MonitorFilter({
  showOnlyWithElements,
  onChange,
  totalMonitors,
  monitorsWithElements,
  className,
}: MonitorFilterProps) {
  // Don't show filter if there's only one monitor or no elements
  if (totalMonitors <= 1 || monitorsWithElements === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className={cn("flex rounded-md overflow-hidden", className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={!showOnlyWithElements ? "default" : "secondary"}
              onClick={() => onChange(false)}
              className="h-8 px-3 rounded-none rounded-l-md"
            >
              <Monitor className="h-4 w-4 mr-1" />
              All ({totalMonitors})
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Show all connected monitors</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant={showOnlyWithElements ? "default" : "secondary"}
              onClick={() => onChange(true)}
              className="h-8 px-3 rounded-none rounded-r-md border-l-0"
            >
              <Layers className="h-4 w-4 mr-1" />
              With Elements ({monitorsWithElements})
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Show only monitors with positioned elements</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export default MonitorFilter;
