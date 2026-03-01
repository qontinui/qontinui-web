"use client";

import { Code2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PlaywrightScript } from "@/lib/runner/types/library";

interface ScriptListItemProps {
  item: PlaywrightScript;
  isSelected: boolean;
}

export function ScriptListItem({ item, isSelected }: ScriptListItemProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <Code2
          className={`size-4 mt-0.5 shrink-0 ${isSelected ? "text-blue-400" : "text-muted-foreground"}`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-foreground truncate">
            {item.name}
          </div>
          {item.category && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 mt-1 bg-blue-500/10 text-blue-400 border-blue-500/30"
            >
              {item.category}
            </Badge>
          )}
        </div>
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 pl-6">
          {item.description}
        </p>
      )}
    </div>
  );
}
