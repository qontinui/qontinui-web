"use client";

import type { VariableScope } from "@/types/workflow-variables";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const SCOPE_OPTIONS = ["all", "execution", "workflow", "global"] as const;

interface VariableMonitorToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  scopeFilter: VariableScope | "all";
  onScopeFilterChange: (scope: VariableScope | "all") => void;
}

export function VariableMonitorToolbar({
  searchTerm,
  onSearchChange,
  scopeFilter,
  onScopeFilterChange,
}: VariableMonitorToolbarProps) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <Input
          placeholder="Search variables..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10 bg-surface-canvas border-border-default"
        />
      </div>

      <div className="flex gap-2">
        {SCOPE_OPTIONS.map((scope) => (
          <Button
            key={scope}
            variant={scopeFilter === scope ? "default" : "outline"}
            size="sm"
            onClick={() => onScopeFilterChange(scope)}
            className="capitalize"
          >
            {scope === "all" ? "All" : scope}
          </Button>
        ))}
      </div>
    </div>
  );
}
