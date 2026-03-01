import React from "react";

interface ExportSummaryProps {
  counts: {
    workflows: number;
    states: number;
    transitions: number;
    images: number;
    screenshots: number;
    categories: number;
  };
}

export function ExportSummary({ counts }: ExportSummaryProps) {
  return (
    <div className="bg-surface-canvas rounded-lg p-4 space-y-2">
      <h4 className="text-sm font-medium text-text-muted">Export Summary</h4>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex justify-between text-text-muted">
          <span>Workflows:</span>
          <span className="text-white">{counts.workflows}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>States:</span>
          <span className="text-white">{counts.states}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>Transitions:</span>
          <span className="text-white">{counts.transitions}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>Images:</span>
          <span className="text-white">{counts.images}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>Screenshots:</span>
          <span className="text-white">{counts.screenshots}</span>
        </div>
        <div className="flex justify-between text-text-muted">
          <span>Categories:</span>
          <span className="text-white">{counts.categories}</span>
        </div>
      </div>
    </div>
  );
}
