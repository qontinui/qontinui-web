"use client";

import { Server } from "lucide-react";

interface RunnerOfflineStateProps {
  title?: string;
  message?: string;
}

export function RunnerOfflineState({
  title = "Runner Not Connected",
  message = "Start the Qontinui Runner desktop app to view this page.",
}: RunnerOfflineStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="w-16 h-16 bg-surface-raised rounded-2xl flex items-center justify-center mb-4">
        <Server className="size-8 text-text-muted" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-muted text-center max-w-md">{message}</p>
    </div>
  );
}
