"use client";

/**
 * `/settings/storage` — the ONE disk surface.
 *
 * Plan `2026-08-07-product-disk-monitoring-and-cleanup.md` Phase 2 step 4 (D6,
 * discoverability): free space + reclaimable build caches live HERE, alongside
 * the screenshot/video cleanup that already shipped, rather than on a second
 * disk page. A user hunting for "why is my disk full" has one place to look.
 *
 * The media cleanup below was reorganised, not duplicated: the usage bars,
 * paths and delete buttons are the pre-existing surface, gathered into a
 * single "Screenshots and videos" block so the new Disk section reads as the
 * page's headline rather than as a competing fourth card.
 */

import { useState, useEffect, useCallback } from "react";
import { useRunnerHealth, runnerApi, type StorageInfo } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { DiskSection } from "@/components/settings/storage/DiskSection";
import { toast } from "sonner";
import { Loader2, HardDrive, Trash2, Trash, Info } from "lucide-react";

function StorageProgressBar({
  usageMb,
  maxMb,
  fileCount,
  label,
}: {
  usageMb: number;
  maxMb: number;
  fileCount: number;
  label: string;
}) {
  const pct = maxMb > 0 ? Math.min((usageMb / maxMb) * 100, 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span
          data-content-role="label"
          data-content-label="storage category"
          className="text-foreground font-medium"
        >
          {label}
        </span>
        <span
          data-content-role="metric"
          data-content-label="storage usage"
          className="text-muted-foreground"
        >
          {usageMb.toFixed(1)} MB / {maxMb.toFixed(0)} MB
          <span className="ml-2 text-xs">({fileCount} files)</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function StorageSettingsPage() {
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const [loading, setLoading] = useState(true);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [cleaningScreenshots, setCleaningScreenshots] = useState(false);
  const [cleaningVideos, setCleaningVideos] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  /**
   * `silent` refetches do NOT raise the page-level spinner.
   *
   * The spinner replaces the whole page, which unmounts `DiskSection` and
   * throws away a reclaim survey that can cost minutes of filesystem walking —
   * so a screenshot cleanup would silently destroy an unrelated result. Only
   * the first load blanks the page.
   */
  const loadStorageInfo = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await runnerApi.getStorageInfo();
      setStorageInfo(data);
    } catch {
      toast.error("Failed to load storage info");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    loadStorageInfo();
  }, [isOffline, loadStorageInfo]);

  const handleCleanupScreenshots = async () => {
    setCleaningScreenshots(true);
    try {
      await runnerApi.cleanupStorage("screenshots", 30);
      toast.success("Old screenshots deleted");
      await loadStorageInfo(true);
    } catch (err) {
      toast.error(
        `Failed to clean screenshots: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setCleaningScreenshots(false);
    }
  };

  const handleCleanupVideos = async () => {
    setCleaningVideos(true);
    try {
      await runnerApi.cleanupStorage("videos", 30);
      toast.success("Old videos deleted");
      await loadStorageInfo(true);
    } catch (err) {
      toast.error(
        `Failed to clean videos: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setCleaningVideos(false);
    }
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm(
      "Are you sure you want to delete ALL screenshots and videos? This action cannot be undone."
    );
    if (!confirmed) return;

    setClearingAll(true);
    try {
      await runnerApi.clearAllStorage();
      toast.success("All storage cleared");
      await loadStorageInfo(true);
    } catch (err) {
      toast.error(
        `Failed to clear storage: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setClearingAll(false);
    }
  };

  if (healthLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <HardDrive className="size-5" />
            Storage
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Disk space on this machine — free space, reclaimable build caches,
            and screenshot/video cleanup
          </p>
        </div>
      </div>

      {/* Disk — free space (Phase 1 telemetry) + the read-only reclaim preview */}
      <DiskSection />

      {/* Screenshots and videos — the pre-existing cleanup surface, gathered
          into one block so this page has a single disk story (plan D6). */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border bg-muted/50">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="size-4" />
            Screenshots and videos
          </h3>
          <p className="text-xs text-muted-foreground">
            Runner media captured per session — usage, where it lives, and
            cleanup
          </p>
        </div>
        <div className="p-4 space-y-5">
          {storageInfo && (
            <>
              <StorageProgressBar
                label="Screenshots"
                usageMb={storageInfo.screenshot_usage_mb}
                maxMb={storageInfo.screenshot_max_mb}
                fileCount={storageInfo.screenshot_file_count}
              />
              <StorageProgressBar
                label="Videos"
                usageMb={storageInfo.video_usage_mb}
                maxMb={storageInfo.video_max_mb}
                fileCount={storageInfo.video_file_count}
              />
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border bg-muted/30">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Where these files live
          </h4>
        </div>
        <div className="p-4 space-y-3">
          {storageInfo && (
            <>
              <div className="space-y-1">
                <span
                  data-content-role="label"
                  data-content-label="screenshot path label"
                  className="text-xs text-muted-foreground"
                >
                  Screenshot path
                </span>
                <p className="text-sm font-mono text-foreground bg-muted px-3 py-2 rounded-md border border-border break-all">
                  {storageInfo.screenshot_path}
                </p>
              </div>
              <div className="space-y-1">
                <span
                  data-content-role="label"
                  data-content-label="video path label"
                  className="text-xs text-muted-foreground"
                >
                  Video path
                </span>
                <p className="text-sm font-mono text-foreground bg-muted px-3 py-2 rounded-md border border-border break-all">
                  {storageInfo.video_path}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border bg-muted/30">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Trash2 className="size-3.5" />
            Cleanup
          </h4>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleCleanupScreenshots}
              disabled={cleaningScreenshots || clearingAll}
              variant="warning"
              size="sm"
            >
              {cleaningScreenshots ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete Screenshots (30+ days)
            </Button>
            <Button
              onClick={handleCleanupVideos}
              disabled={cleaningVideos || clearingAll}
              variant="warning"
              size="sm"
            >
              {cleaningVideos ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete Videos (30+ days)
            </Button>
          </div>

          <div className="border-t border-border pt-4">
            <DestructiveButton
              onClick={handleClearAll}
              disabled={clearingAll || cleaningScreenshots || cleaningVideos}
              size="sm"
            >
              {clearingAll ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash className="size-4" />
              )}
              {/* Named for what it actually clears. Now that this page also
                  reports build caches, "Clear All Storage" would read as a
                  claim over bytes this button cannot touch. */}
              Clear All Screenshots and Videos
            </DestructiveButton>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-blue-500/5 border border-blue-500/10">
            <Info className="size-4 text-blue-400 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Screenshots and videos are organized by session. Cleanup
              operations only affect files older than the specified number of
              days.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
