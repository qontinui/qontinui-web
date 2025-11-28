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
 */

import { useAutomation } from "@/contexts/automation-context";
import ScreenshotUploadTab from "@/components/ScreenshotTab/ScreenshotUploadTab";
import { RequireProject } from "@/components/require-project";

export default function ScreenshotsPage() {
  const { states } = useAutomation();

  return (
    <RequireProject pageName="Screenshots">
      <ScreenshotUploadTab states={states} onExport={() => {}} />
    </RequireProject>
  );
}
