"use client";

import { Lock, Pencil, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Switch } from "@/components/ui/switch";
import type { FindingCategoryConfig } from "@/lib/api-client";
import { getColorClasses, getActionTypeBadge } from "../finding-rules-utils";
import { CategoryIcon } from "./CategoryIcon";

interface CategoryViewRowProps {
  cat: FindingCategoryConfig;
  isFirst: boolean;
  isLast: boolean;
  showReorderButtons: boolean;
  isToggling: boolean;
  onReorder: (cat: FindingCategoryConfig, direction: "up" | "down") => void;
  onToggleEnabled: (cat: FindingCategoryConfig) => void;
  onEdit: (cat: FindingCategoryConfig) => void;
  onDelete: (id: string) => void;
}

export function CategoryViewRow({
  cat,
  isFirst,
  isLast,
  showReorderButtons,
  isToggling,
  onReorder,
  onToggleEnabled,
  onEdit,
  onDelete,
}: CategoryViewRowProps) {
  const cc = getColorClasses(cat.color);
  const actionBadge = getActionTypeBadge(cat.default_action_type);

  return (
    <div
      className={`p-4 rounded-lg border transition-all ${
        cat.enabled
          ? "border-border bg-background/30"
          : "border-border bg-background/10 opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            className={`p-2 rounded-lg ${cc.bg} ${cc.border} border flex-shrink-0`}
          >
            <CategoryIcon name={cat.icon} className={`w-4 h-4 ${cc.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-medium text-foreground">{cat.name}</p>
              {cat.is_built_in && (
                <Lock className="w-3 h-3 text-muted-foreground" />
              )}
              <Badge
                variant={actionBadge.variant}
                className="text-[10px] px-1.5 py-0"
              >
                {actionBadge.label}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground/60 font-mono">
              {cat.slug}
            </p>
            {cat.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {cat.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {showReorderButtons && (
            <div className="flex flex-col">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-white"
                onClick={() => onReorder(cat, "up")}
                disabled={isFirst}
                title="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-white"
                onClick={() => onReorder(cat, "down")}
                disabled={isLast}
                title="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <Switch
            checked={cat.enabled}
            onCheckedChange={() => onToggleEnabled(cat)}
            disabled={isToggling}
          />
          {!cat.is_built_in && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-white"
                onClick={() => onEdit(cat)}
                title="Edit"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <DestructiveButton
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-red-400"
                onClick={() => onDelete(cat.id)}
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </DestructiveButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
