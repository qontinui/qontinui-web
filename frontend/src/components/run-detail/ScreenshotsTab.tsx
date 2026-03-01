"use client";

import { useTaskRunScreenshots, type Screenshot } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Camera, FileImage, Clock, FolderOpen } from "lucide-react";

interface ScreenshotsTabProps {
  runId: string;
}

function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

export function ScreenshotsTab({ runId }: ScreenshotsTabProps) {
  const { data, isLoading, error } = useTaskRunScreenshots(runId);

  const screenshots = (data ?? []) as Screenshot[];

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading screenshots...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (screenshots.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Camera className="size-12 mx-auto mb-4" />
        <p>No screenshots captured for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Screenshots</span>
        <Badge variant="secondary" className="text-xs">
          {screenshots.length}
        </Badge>
      </div>

      {/* Screenshot Cards */}
      <div className="space-y-3">
        {screenshots.map((screenshot) => (
          <div
            key={screenshot.id}
            className="p-4 rounded-lg bg-surface-raised/30 border border-border-subtle/50 space-y-2"
          >
            {/* Filename and timestamp */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileImage className="size-4 text-text-muted shrink-0" />
                <span className="text-sm font-medium text-text-primary truncate">
                  {screenshot.filename}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Clock className="size-3 text-text-muted" />
                <span className="text-xs text-text-muted">
                  {formatDateTime(screenshot.timestamp)}
                </span>
              </div>
            </div>

            {/* Description */}
            {screenshot.description && (
              <p className="text-sm text-text-secondary leading-relaxed">
                {screenshot.description}
              </p>
            )}

            {/* File path */}
            <div className="flex items-center gap-2">
              <FolderOpen className="size-3.5 text-text-muted shrink-0" />
              <code className="text-xs font-mono text-text-muted bg-surface-canvas/50 px-2 py-0.5 rounded truncate">
                {screenshot.path}
              </code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
