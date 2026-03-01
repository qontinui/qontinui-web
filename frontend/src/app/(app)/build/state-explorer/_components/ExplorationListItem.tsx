"use client";

import { Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STRATEGY_OPTIONS, type SavedExplorationItem } from "../types";

export function ExplorationListItem({
  item,
  isSelected,
}: {
  item: SavedExplorationItem;
  isSelected: boolean;
}) {
  const strategyOpt = STRATEGY_OPTIONS.find(
    (s) => s.value === item.config.strategy
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Compass
          className={`size-4 shrink-0 ${isSelected ? "text-emerald-400" : "text-muted-foreground"}`}
        />
        <span
          className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}
        >
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        {strategyOpt && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
          >
            {strategyOpt.label}
          </Badge>
        )}
        {item.run_count > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 bg-muted text-muted-foreground"
          >
            {item.run_count} run{item.run_count !== 1 ? "s" : ""}
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">
          {item.description}
        </p>
      )}
    </div>
  );
}
