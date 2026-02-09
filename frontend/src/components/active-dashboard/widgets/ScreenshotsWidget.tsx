"use client";

import { useState, useEffect, useMemo } from "react";
import { useTaskRunScreenshotsDetailed } from "@/lib/runner-api";
import type { TaskRunScreenshot } from "@/lib/runner-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, RefreshCw, ImageOff } from "lucide-react";

const RUNNER_BASE = "http://localhost:9876";

function getScreenshotUrl(screenshot: TaskRunScreenshot): string | null {
  if (screenshot.url) return screenshot.url;
  if (screenshot.data) return `data:image/png;base64,${screenshot.data}`;
  if (screenshot.path) {
    // If path is absolute (starts with http), use as-is
    if (screenshot.path.startsWith("http")) return screenshot.path;
    // Otherwise, construct URL from runner base
    const cleanPath = screenshot.path.replace(/^\/+/, "");
    return `${RUNNER_BASE}/screenshots/${cleanPath}`;
  }
  return null;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function ScreenshotImage({
  screenshot,
  className,
  onClick,
}: {
  screenshot: TaskRunScreenshot;
  className?: string;
  onClick?: () => void;
}) {
  const url = getScreenshotUrl(screenshot);
  const [hasError, setHasError] = useState(false);

  if (!url || hasError) {
    // Fallback: show metadata card
    return (
      <div
        onClick={onClick}
        className={`flex flex-col items-center justify-center bg-surface-canvas/50 border border-border-subtle/30 rounded-lg p-3 cursor-pointer ${className || ""}`}
      >
        <ImageOff className="size-6 text-text-muted mb-2" />
        <span className="text-[10px] text-text-muted text-center">
          {screenshot.description || "Screenshot"}
        </span>
        <span className="text-[9px] text-text-muted mt-1">
          {formatTimestamp(screenshot.timestamp)}
        </span>
        {screenshot.phase && (
          <Badge variant="outline" className="text-[9px] mt-1">
            {screenshot.phase}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={screenshot.description || `Screenshot at ${screenshot.timestamp}`}
      className={`object-contain rounded-lg cursor-pointer ${className || ""}`}
      onClick={onClick}
      onError={() => setHasError(true)}
    />
  );
}

export function ScreenshotsWidget({ runId }: { runId: string }) {
  const { data, isLoading } = useTaskRunScreenshotsDetailed(runId);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [autoSelectLatest, setAutoSelectLatest] = useState(true);

  const screenshots = useMemo(() => data || [], [data]);

  // Auto-select latest screenshot when new ones arrive
  useEffect(() => {
    if (autoSelectLatest && screenshots.length > 0) {
      setSelectedIndex(screenshots.length - 1);
    }
  }, [screenshots.length, autoSelectLatest]);

  const handleThumbnailClick = (index: number) => {
    setSelectedIndex(index);
    setAutoSelectLatest(false);
  };

  const selected =
    selectedIndex !== null && screenshots[selectedIndex]
      ? screenshots[selectedIndex]
      : null;

  // Show last 10 thumbnails
  const thumbnailStart = Math.max(0, screenshots.length - 10);
  const thumbnails = screenshots.slice(thumbnailStart);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="size-4 text-cyan-400" />
            Screenshots
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Camera className="size-4 text-cyan-400" />
          Screenshots
          {screenshots.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {screenshots.length}
            </Badge>
          )}
          {!autoSelectLatest && screenshots.length > 0 && (
            <button
              onClick={() => {
                setAutoSelectLatest(true);
                setSelectedIndex(screenshots.length - 1);
              }}
              className="ml-auto text-[10px] text-brand-primary hover:text-brand-primary/80"
            >
              Follow latest
            </button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4 flex flex-col gap-3">
        {screenshots.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
            <Camera className="size-12 mb-3 opacity-30" />
            <p className="text-xs">No screenshots captured yet</p>
          </div>
        ) : (
          <>
            {/* Main display */}
            <div className="flex-1 min-h-0 flex items-center justify-center bg-surface-canvas/30 rounded-lg border border-border-subtle/30 overflow-hidden relative">
              {selected ? (
                <>
                  <ScreenshotImage
                    screenshot={selected}
                    className="max-h-full max-w-full"
                  />
                  {/* Metadata overlay */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                    <div className="flex items-center gap-2 text-[10px] text-white/80">
                      <span>{formatTimestamp(selected.timestamp)}</span>
                      {selected.phase && (
                        <Badge
                          variant="outline"
                          className="text-[9px] border-white/30 text-white/80"
                        >
                          {selected.phase}
                        </Badge>
                      )}
                      {selected.step && (
                        <span className="truncate">{selected.step}</span>
                      )}
                      {selected.description && (
                        <span className="truncate ml-auto">
                          {selected.description}
                        </span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-text-muted">Select a screenshot</p>
              )}
            </div>

            {/* Thumbnail strip */}
            <div className="shrink-0 flex gap-2 overflow-x-auto pb-1">
              {thumbnails.map((screenshot, i) => {
                const realIndex = thumbnailStart + i;
                const isActive = realIndex === selectedIndex;
                return (
                  <div
                    key={screenshot.id || realIndex}
                    onClick={() => handleThumbnailClick(realIndex)}
                    className={`relative shrink-0 w-16 h-12 rounded-md overflow-hidden cursor-pointer border-2 transition-all ${
                      isActive
                        ? "border-brand-primary ring-1 ring-brand-primary/30"
                        : "border-border-subtle/30 hover:border-border-default"
                    }`}
                  >
                    <ScreenshotImage
                      screenshot={screenshot}
                      className="w-full h-full object-cover"
                    />
                    {/* Timestamp overlay on thumbnail */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-0.5 py-0.5">
                      <span className="text-[8px] text-white/80 block text-center truncate">
                        {formatTimestamp(screenshot.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
