"use client";

import { GitBranch } from "lucide-react";

export function EmptyWorkflowState() {
  return (
    <div className="flex items-center justify-center h-full text-text-muted">
      <div className="text-center">
        <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-50" />
        <p className="text-lg">Select a workflow to edit</p>
        <p className="text-sm">or create a new one to get started</p>
      </div>
    </div>
  );
}
