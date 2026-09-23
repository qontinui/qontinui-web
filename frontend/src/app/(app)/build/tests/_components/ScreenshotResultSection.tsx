"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import {
  RUNNER_NEEDS_LOCAL,
  runnerFetch,
  targetKey,
  useRunnerObjectUrl,
  useRunnerTarget,
} from "@/lib/runner";

interface ScreenshotResultSectionProps {
  testId: string;
  onOpenScreenshot: (url: string) => void;
}

/**
 * Where the last execution's screenshot lives: inline in the result (a data
 * URL), or a file the runner serves (a runner path, fetched through the
 * resolver — never an `<img src>` pointing at a loopback URL).
 */
type ScreenshotSource =
  | { kind: "inline"; url: string }
  | { kind: "runner"; path: string };

export function ScreenshotResultSection({
  testId,
  onOpenScreenshot,
}: ScreenshotResultSectionProps) {
  const runnerTarget = useRunnerTarget();
  const runnerKey = targetKey(runnerTarget);
  const [source, setSource] = useState<ScreenshotSource | null>(null);

  // Fetch the screenshot reference from the last execution result when the
  // test (or the runner it is read from) changes.
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    void (async () => {
      try {
        const result = await runnerFetch<Record<string, unknown>>(
          runnerTarget,
          `/tests/${testId}/last-result`
        );
        if (cancelled || !result) return;
        // Check for screenshot data in various fields
        const screenshot = result.screenshot as string | undefined;
        const screenshotPath = result.screenshot_path as string | undefined;
        const screenshotBase64 = result.screenshot_base64 as string | undefined;

        if (screenshotBase64) {
          const prefix = screenshotBase64.startsWith("data:") ? "" : "data:image/png;base64,";
          setSource({ kind: "inline", url: `${prefix}${screenshotBase64}` });
        } else if (screenshot && screenshot.startsWith("data:")) {
          setSource({ kind: "inline", url: screenshot });
        } else if (screenshotPath) {
          // A file path: ask the runner to serve it.
          setSource({
            kind: "runner",
            path: `/screenshots/${encodeURIComponent(screenshotPath)}`,
          });
        }
      } catch {
        // No last result (or runner unreachable) - no screenshot to show.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed by the runner's route key; the target object identity may churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, runnerKey]);

  const served = useRunnerObjectUrl(
    runnerTarget,
    source?.kind === "runner" ? source.path : null
  );

  if (!source) return null;

  const screenshotUrl = source.kind === "inline" ? source.url : served.url;
  const needsLocal =
    source.kind === "runner" && served.errorCode === RUNNER_NEEDS_LOCAL;

  if (!screenshotUrl && !needsLocal) return null;

  return (
    <div className="border border-border rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Last Execution Screenshot</span>
      </div>
      {screenshotUrl ? (
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
      ) : (
        <p className="text-xs text-muted-foreground">{served.error}</p>
      )}
    </div>
  );
}
