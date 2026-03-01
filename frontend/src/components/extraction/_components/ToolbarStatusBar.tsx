"use client";

import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";

export function ToolbarStatusBar() {
  const { selectedElementIds, elements } = useExtractionAnnotationStore();

  return (
    <div className="ml-auto text-xs text-text-muted flex items-center gap-2">
      {selectedElementIds.length > 0 && (
        <span className="font-mono text-[#9B59B6]">
          {selectedElementIds.length} selected
        </span>
      )}
      <span className="font-mono">
        {elements.length} element{elements.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
