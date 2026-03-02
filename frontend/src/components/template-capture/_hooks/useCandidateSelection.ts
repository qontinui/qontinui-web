import { useState, useCallback } from "react";
import type { TemplateCandidate } from "@/services/template-capture-service";

export function useCandidateSelection(candidates: TemplateCandidate[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const pendingIds = candidates
      .filter((c) => c.status === "pending")
      .map((c) => c.id);
    setSelectedIds(new Set(pendingIds));
  }, [candidates]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    selectedIds,
    toggleSelect,
    selectAll,
    clearSelection,
  };
}
