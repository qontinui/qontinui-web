"use client";

/**
 * Screenshot Upload Page
 *
 * Upload and manage screenshots for use in automation workflows.
 * Allows users to:
 * - Upload multiple screenshots at once
 * - Capture screenshots directly from running applications
 * - Organize screenshots by project or state
 * - Preview uploaded screenshots
 * - Extract patterns and elements from screenshots
 * - Associate screenshots with states
 *
 * State Persistence:
 * Uses IndexedDB-backed state store to persist:
 * - Uploaded screenshots (as blobs)
 * - Selected screenshot IDs
 * - View mode (grid/list)
 * - Sort preferences
 */

import { useAutomation } from "@/contexts/automation-context";
import ScreenshotUploadTab from "@/components/ScreenshotTab/ScreenshotUploadTab";
import { RequireProject } from "@/components/require-project";
import { useScreenshotsBridge } from "@/stores/page-state";
import { Loader2 } from "lucide-react";

export default function ScreenshotsPage() {
  const { states } = useAutomation();
  const screenshotsState = useScreenshotsBridge();

  // Show loading state while hydrating from IndexedDB
  if (screenshotsState.isHydrating) {
    return (
      <RequireProject pageName="Screenshots">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading screenshots...</p>
          </div>
        </div>
      </RequireProject>
    );
  }

  return (
    <RequireProject pageName="Screenshots">
      <ScreenshotUploadTab states={states} onExport={() => {}} />
    </RequireProject>
  );
}
