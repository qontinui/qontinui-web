/**
 * FilterBar Component
 *
 * Filter panel for the Image Library with source, usage, and clear-all controls.
 */

"use client";

import React from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ImageFilter } from "./types";

export interface FilterBarProps {
  filter: ImageFilter;
  onFilterChange: (filter: ImageFilter) => void;
}

export function FilterBar({ filter, onFilterChange }: FilterBarProps) {
  return (
    <div className="p-4 bg-surface-raised/50 border-b border-border-subtle">
      <div className="grid grid-cols-4 gap-4">
        {/* Source Filter */}
        <div>
          <label className="text-xs text-text-muted mb-2 block">Source</label>
          <div className="flex flex-wrap gap-1">
            {(
              [
                "uploaded",
                "pattern_optimization",
                "image_extraction",
                "state_discovery",
              ] as const
            ).map((source) => (
              <Badge
                key={source}
                variant="outline"
                className={cn(
                  "cursor-pointer transition-all",
                  filter.sources?.includes(source)
                    ? "bg-brand-success text-black border-brand-success"
                    : "border-border-default hover:border-border-subtle"
                )}
                onClick={() => {
                  const sources = filter.sources || [];
                  const newSources = sources.includes(source)
                    ? sources.filter((s) => s !== source)
                    : [...sources, source];
                  onFilterChange({ ...filter, sources: newSources });
                }}
              >
                {source === "uploaded" && "Uploaded"}
                {source === "pattern_optimization" && "Pattern Opt"}
                {source === "image_extraction" && "Extraction"}
                {source === "state_discovery" && "Discovery"}
              </Badge>
            ))}
          </div>
        </div>

        {/* Usage Filter */}
        <div>
          <label className="text-xs text-text-muted mb-2 block">Usage</label>
          <div className="flex gap-1">
            {(["all", "used", "unused"] as const).map((usage) => (
              <Badge
                key={usage}
                variant="outline"
                className={cn(
                  "cursor-pointer transition-all",
                  filter.usageFilter === usage
                    ? "bg-brand-success text-black border-brand-success"
                    : "border-border-default hover:border-border-subtle"
                )}
                onClick={() =>
                  onFilterChange({ ...filter, usageFilter: usage })
                }
              >
                {usage.charAt(0).toUpperCase() + usage.slice(1)}
              </Badge>
            ))}
          </div>
        </div>

        {/* Clear Filters */}
        <div className="flex items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onFilterChange({})}
            className="border-border-default"
          >
            <XCircle className="w-4 h-4 mr-2" />
            Clear All
          </Button>
        </div>
      </div>
    </div>
  );
}
