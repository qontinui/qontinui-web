"use client";

import React, { useMemo } from "react";
import { LibraryPickerBase, type LibraryItem } from "./LibraryPickerBase";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import { getTotalStepCount } from "@/types/unified-workflow";

interface WorkflowLibraryPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: { id: string; name: string }) => void;
}

export function WorkflowLibraryPicker({
  isOpen,
  onClose,
  onSelect,
}: WorkflowLibraryPickerProps) {
  const { data: workflows, isLoading } = useUnifiedWorkflows();

  const items = useMemo<LibraryItem[] | null>(() => {
    if (!workflows) return null;
    return workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      type: "workflow",
      updated_at: w.modified_at,
    }));
  }, [workflows]);

  // Build a lookup for step counts
  const stepCountMap = useMemo(() => {
    if (!workflows) return new Map<string, number>();
    return new Map(workflows.map((w) => [w.id, getTotalStepCount(w)]));
  }, [workflows]);

  return (
    <LibraryPickerBase
      title="Select Workflow"
      isOpen={isOpen}
      onClose={onClose}
      items={items}
      isLoading={isLoading}
      onSelect={onSelect}
      renderItem={(item) => (
        <div className="min-w-0 flex-1">
          <div className="text-sm text-zinc-200 truncate">{item.name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-zinc-500">
              {stepCountMap.get(item.id) ?? 0} step
              {(stepCountMap.get(item.id) ?? 0) !== 1 ? "s" : ""}
            </span>
            {item.description && (
              <>
                <span className="text-xs text-zinc-600">·</span>
                <span className="text-xs text-zinc-500 truncate">
                  {item.description}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    />
  );
}
