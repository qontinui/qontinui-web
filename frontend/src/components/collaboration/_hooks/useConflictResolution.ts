import * as React from "react";
import { toast } from "sonner";
import type { Conflict, MergeChoices, ViewMode } from "../_types/conflict";

interface UseConflictResolutionParams {
  conflicts: Conflict[];
  currentConflictIndex: number;
  onResolve: (
    conflictId: string,
    resolution: "local" | "remote" | "merge",
    mergedData?: Record<string, unknown>
  ) => Promise<void>;
  onResolveAll: (resolution: "local" | "remote") => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function useConflictResolution({
  conflicts,
  currentConflictIndex,
  onResolve,
  onResolveAll,
  onOpenChange,
}: UseConflictResolutionParams) {
  const [selectedIndex, setSelectedIndex] =
    React.useState(currentConflictIndex);
  const [loading, setLoading] = React.useState(false);
  const [mergeChoices, setMergeChoices] = React.useState<MergeChoices>({});
  const [viewMode, setViewMode] = React.useState<ViewMode>("split");

  const currentConflict = conflicts[selectedIndex];

  React.useEffect(() => {
    setSelectedIndex(currentConflictIndex);
  }, [currentConflictIndex]);

  React.useEffect(() => {
    if (currentConflict) {
      const initialChoices: MergeChoices = {};
      currentConflict.changes.forEach((change) => {
        if (change.conflicted) {
          initialChoices[change.field] = "local";
        }
      });
      setMergeChoices(initialChoices);
    }
  }, [currentConflict]);

  const handleResolve = async (resolution: "local" | "remote" | "merge") => {
    if (!currentConflict) return;

    setLoading(true);
    try {
      let mergedData: Record<string, unknown> | undefined;

      if (resolution === "merge") {
        mergedData = {};
        currentConflict.changes.forEach((change) => {
          if (change.conflicted) {
            const choice = mergeChoices[change.field];
            mergedData![change.field] =
              choice === "local" ? change.local_value : change.remote_value;
          } else {
            mergedData![change.field] = change.local_value;
          }
        });
      }

      await onResolve(currentConflict.id, resolution, mergedData);
      toast.success("Conflict resolved");

      if (selectedIndex < conflicts.length - 1) {
        setSelectedIndex((prev) => prev + 1);
      } else {
        onOpenChange(false);
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to resolve conflict"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResolveAll = async (resolution: "local" | "remote") => {
    if (
      !confirm(
        `Resolve all ${conflicts.length} conflicts by keeping ${resolution} changes?`
      )
    ) {
      return;
    }

    setLoading(true);
    try {
      await onResolveAll(resolution);
      toast.success(`All conflicts resolved with ${resolution} changes`);
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to resolve all conflicts"
      );
    } finally {
      setLoading(false);
    }
  };

  const setMergeChoice = (field: string, choice: "local" | "remote") => {
    setMergeChoices((prev) => ({ ...prev, [field]: choice }));
  };

  const conflictedChanges =
    currentConflict?.changes.filter((c) => c.conflicted) ?? [];
  const nonConflictedChanges =
    currentConflict?.changes.filter((c) => !c.conflicted) ?? [];

  return {
    selectedIndex,
    setSelectedIndex,
    loading,
    mergeChoices,
    setMergeChoice,
    viewMode,
    setViewMode,
    currentConflict,
    conflictedChanges,
    nonConflictedChanges,
    handleResolve,
    handleResolveAll,
  };
}
