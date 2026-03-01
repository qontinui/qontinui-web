"use client";

import { CheckCircle2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CheckItem } from "@/services/library-service";
import { CHECK_TYPES, CHECK_TYPE_BADGE_COLORS } from "../constants";

interface CheckListItemProps {
  item: CheckItem;
  isSelected: boolean;
}

export function CheckListItem({ item, isSelected }: CheckListItemProps) {
  const typeLabel = CHECK_TYPES.find((t) => t.value === item.check_type)?.label || item.check_type;
  const colors = CHECK_TYPE_BADGE_COLORS[item.check_type] || { bg: "bg-gray-500/10", text: "text-gray-400", border: "border-gray-500/30" };
  const isAiGenerated = item.tags?.includes("ai-generated");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <CheckCircle2
          className={`size-4 shrink-0 ${item.enabled ? "text-green-400" : "text-muted-foreground"}`}
        />
        <span className={`text-sm font-medium truncate ${isSelected ? "text-foreground" : "text-muted-foreground"}`}>
          {item.name}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-6">
        <Badge
          variant="secondary"
          className={`text-[10px] px-1.5 ${colors.bg} ${colors.text} ${colors.border}`}
        >
          {typeLabel}
        </Badge>
        {item.is_critical && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-red-500/10 text-red-400 border-red-500/30">
            Critical
          </Badge>
        )}
        {item.auto_fix && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-blue-500/10 text-blue-400 border-blue-500/30">
            Auto-fix
          </Badge>
        )}
        {isAiGenerated && (
          <Badge variant="secondary" className="text-[10px] px-1.5 bg-purple-500/10 text-purple-400 border-purple-500/30">
            <Sparkles className="size-2.5 mr-0.5" />
            AI
          </Badge>
        )}
      </div>
      {item.description && (
        <p className="text-xs text-muted-foreground truncate pl-6">{item.description}</p>
      )}
    </div>
  );
}
