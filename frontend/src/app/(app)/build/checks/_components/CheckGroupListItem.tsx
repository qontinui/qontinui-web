"use client";

import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CheckGroupItem } from "@/services/library-service";

interface CheckGroupListItemProps {
  item: CheckGroupItem;
  isSelected: boolean;
}

export function CheckGroupListItem({ item, isSelected }: CheckGroupListItemProps) {
  const checkCount = item.check_ids?.length || 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Layers className="size-4 text-teal-400 shrink-0" />
        <span className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        <Badge variant="secondary" className="text-[10px] px-1.5 bg-teal-500/10 text-teal-400 border-teal-500/30">
          {checkCount} {checkCount === 1 ? "check" : "checks"}
        </Badge>
        {item.run_in_parallel && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-purple-500/10 text-purple-400 border-purple-500/30">
            Parallel
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">{item.description}</p>
      )}
    </div>
  );
}
