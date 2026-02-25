"use client";

import { RefreshCw } from "lucide-react";
import type { Target } from "@/lib/ui-bridge/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

interface TargetSelectorProps {
  targets: Target[];
  selectedTargetId: string | null;
  onTargetChange: (targetId: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  showRefresh?: boolean;
  label?: string;
}

// =============================================================================
// Component
// =============================================================================

export function TargetSelector({
  targets,
  selectedTargetId,
  onTargetChange,
  onRefresh,
  isLoading,
  placeholder = "Select target...",
  className,
  showRefresh = true,
  label,
}: TargetSelectorProps) {
  // Group targets by type
  const webTargets = targets.filter((t) => t.type === "web");
  const desktopTargets = targets.filter((t) => t.type === "desktop");
  const mobileTargets = targets.filter((t) => t.type === "mobile");

  const groups = [
    { key: "web", label: "Web Tabs", items: webTargets },
    { key: "desktop", label: "Desktop Apps", items: desktopTargets },
    { key: "mobile", label: "Mobile Apps", items: mobileTargets },
  ].filter((g) => g.items.length > 0);

  const hasMultipleGroups = groups.length > 1;

  if (targets.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && (
        <span className="text-xs text-text-muted whitespace-nowrap">
          {label}
        </span>
      )}
      <Select
        value={selectedTargetId ?? undefined}
        onValueChange={onTargetChange}
      >
        <SelectTrigger className="h-7 text-xs bg-surface-raised/50 border-border-subtle flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) =>
            hasMultipleGroups ? (
              <SelectGroup key={group.key}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map((target) => (
                  <SelectItem
                    key={target.id}
                    value={target.id}
                    disabled={target.isSelf}
                  >
                    {target.label}
                    {target.isSelf ? " (this page)" : ""}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : (
              group.items.map((target) => (
                <SelectItem
                  key={target.id}
                  value={target.id}
                  disabled={target.isSelf}
                >
                  {target.label}
                  {target.isSelf ? " (this page)" : ""}
                </SelectItem>
              ))
            )
          )}
        </SelectContent>
      </Select>
      {showRefresh && onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-text-muted hover:text-text-secondary shrink-0"
          onClick={onRefresh}
          disabled={isLoading}
          title="Refresh targets"
        >
          <RefreshCw className={cn("size-3", isLoading && "animate-spin")} />
        </Button>
      )}
    </div>
  );
}
