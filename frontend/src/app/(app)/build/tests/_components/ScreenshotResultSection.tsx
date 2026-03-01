"use client";

import { useState, useCallback } from "react";
import { Image as ImageIcon } from "lucide-react";

interface ScreenshotResultSectionProps {
  testId: string;
  onOpenScreenshot: (url: string) => void;
}

export function ScreenshotResultSection({
  testId,
  onOpenScreenshot,
}: ScreenshotResultSectionProps) {
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Attempt to fetch screenshot from the last execution result
  // This runs once when the component mounts or testId changes
  const fetchScreenshot = useCallback(async () => {
    if (checked) return;
    setChecked(true);
    try {
      const { runnerFetch } = await import("@/lib/runner/api-client");
      const result = await runnerFetch<Record<string, unknown>>(`/tests/${testId}/last-result`);
      if (result) {
        // Check for screenshot data in various fields
        const screenshot = result.screenshot as string | undefined;
        const screenshotPath = result.screenshot_path as string | undefined;
        const screenshotBase64 = result.screenshot_base64 as string | undefined;

        if (screenshotBase64) {
          const prefix = screenshotBase64.startsWith("data:") ? "" : "data:image/png;base64,";
          setScreenshotUrl(`${prefix}${screenshotBase64}`);
        } else if (screenshot && screenshot.startsWith("data:")) {
          setScreenshotUrl(screenshot);
        } else if (screenshotPath) {
          // If it's a file path, we can't display it directly in the browser
          // but we'll try as a URL in case the runner serves it
          setScreenshotUrl(`http://localhost:9876/screenshots/${encodeURIComponent(screenshotPath)}`);
        }
      }
    } catch {
      // Silently fail - no screenshot available is fine
    }
  }, [testId, checked]);

  // Run on mount
  useState(() => { fetchScreenshot(); });

  if (!screenshotUrl) return null;

  return (
    <div className="border border-border rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Last Execution Screenshot</span>
      </div>
      <button
        type="button"
        onClick={() => onOpenScreenshot(screenshotUrl)}
        className="block overflow-hidden rounded border border-border hover:border-text-muted transition-colors cursor-pointer"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={screenshotUrl}
          alt="Test execution screenshot thumbnail"
          className="w-48 h-auto object-contain"
        />
      </button>
    </div>
  );
}
