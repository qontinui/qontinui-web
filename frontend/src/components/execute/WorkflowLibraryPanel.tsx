"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Library } from "lucide-react";
import { WorkflowLibraryCard } from "./WorkflowLibraryCard";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

interface WorkflowLibraryPanelProps {
  workflows: UnifiedWorkflow[] | null;
  isLoading: boolean;
  queuedWorkflowIds: Set<string>;
  onAddWorkflow: (workflow: UnifiedWorkflow) => void;
}

export function WorkflowLibraryPanel({
  workflows,
  isLoading,
  queuedWorkflowIds,
  onAddWorkflow,
}: WorkflowLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const categories = useMemo(() => {
    if (!workflows) return [];
    const cats = new Set<string>();
    workflows.forEach((w) => {
      if (w.category) cats.add(w.category);
    });
    return Array.from(cats).sort();
  }, [workflows]);

  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    let filtered = workflows;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.description && w.description.toLowerCase().includes(q))
      );
    }
    if (categoryFilter) {
      filtered = filtered.filter((w) => w.category === categoryFilter);
    }
    return filtered;
  }, [workflows, searchQuery, categoryFilter]);

  return (
    <div className="w-full lg:w-96 shrink-0 space-y-4">
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Library className="size-4" />
            Workflow Library
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
            <Input
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 bg-surface-canvas/50 border-border-subtle/50 text-xs"
            />
          </div>

          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setCategoryFilter(null)}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                  !categoryFilter
                    ? "bg-brand-primary/20 text-brand-primary"
                    : "bg-surface-hover text-text-muted hover:text-text-secondary"
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() =>
                    setCategoryFilter(categoryFilter === cat ? null : cat)
                  }
                  className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                    categoryFilter === cat
                      ? "bg-brand-primary/20 text-brand-primary"
                      : "bg-surface-hover text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-24 w-full bg-surface-raised/50 rounded-lg"
                />
              ))
            ) : filteredWorkflows.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-4">
                {searchQuery || categoryFilter
                  ? "No workflows match your filters"
                  : "No workflows available"}
              </p>
            ) : (
              filteredWorkflows.map((workflow) => (
                <WorkflowLibraryCard
                  key={workflow.id}
                  workflow={workflow}
                  isQueued={queuedWorkflowIds.has(workflow.id)}
                  onAdd={onAddWorkflow}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
