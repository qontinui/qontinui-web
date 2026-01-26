/**
 * Web Extraction Progress Panel
 *
 * Shows real-time progress during web extraction:
 * - Progress bar (pages extracted / max pages)
 * - Elapsed time
 * - Stats (states found, transitions found, errors)
 * - Stuck/frozen detection with visual warning
 */

"use client";

import { useEffect, useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Globe,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  ArrowRightLeft,
  FileText,
  AlertTriangle,
  Square,
  AlertCircle,
} from "lucide-react";

export type WebExtractionStatus = "idle" | "running" | "completed" | "failed";

export interface WebExtractionProgress {
  status: WebExtractionStatus;
  extractionId: string | null;
  statesFound: number;
  transitionsFound: number;
  pagesExtracted: number;
  errors: number;
  errorMessage?: string;
  maxPages?: number;
}

interface WebExtractionProgressPanelProps {
  progress: WebExtractionProgress;
  onStop?: () => void;
}

// Consider extraction "stuck" if no progress for this many seconds
const STUCK_THRESHOLD_SECONDS = 30;

export function WebExtractionProgressPanel({
  progress,
  onStop,
}: WebExtractionProgressPanelProps) {
  const {
    status,
    statesFound,
    transitionsFound,
    pagesExtracted,
    errors,
    errorMessage,
    maxPages = 100,
  } = progress;

  // Track elapsed time
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // Track stuck detection
  const [isStuck, setIsStuck] = useState(false);
  const [stuckSeconds, setStuckSeconds] = useState(0);
  const lastProgressRef = useRef({
    pagesExtracted: 0,
    statesFound: 0,
    transitionsFound: 0,
  });
  const lastProgressTimeRef = useRef<number>(Date.now());

  // Start timer when extraction begins
  useEffect(() => {
    if (status === "running") {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
        lastProgressTimeRef.current = Date.now();
      }

      const timer = setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedSeconds(elapsed);
        }

        // Check for stuck status
        const timeSinceProgress = Math.floor(
          (Date.now() - lastProgressTimeRef.current) / 1000
        );
        setStuckSeconds(timeSinceProgress);
        setIsStuck(timeSinceProgress >= STUCK_THRESHOLD_SECONDS);
      }, 1000);

      return () => clearInterval(timer);
    } else {
      // Reset when not running
      startTimeRef.current = null;
      setElapsedSeconds(0);
      setIsStuck(false);
      setStuckSeconds(0);
      return undefined;
    }
  }, [status]);

  // Detect progress changes
  useEffect(() => {
    if (status === "running") {
      const hasProgress =
        pagesExtracted !== lastProgressRef.current.pagesExtracted ||
        statesFound !== lastProgressRef.current.statesFound ||
        transitionsFound !== lastProgressRef.current.transitionsFound;

      if (hasProgress) {
        lastProgressRef.current = { pagesExtracted, statesFound, transitionsFound };
        lastProgressTimeRef.current = Date.now();
        setIsStuck(false);
        setStuckSeconds(0);
      }
    }
  }, [status, pagesExtracted, statesFound, transitionsFound]);

  const isActive = status === "running";
  const progressPercent =
    status === "completed"
      ? 100
      : Math.min((pagesExtracted / maxPages) * 100, 99);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusIcon = () => {
    switch (status) {
      case "idle":
        return <Clock className="h-5 w-5 text-text-muted" />;
      case "running":
        if (isStuck) {
          return <AlertTriangle className="h-5 w-5 text-yellow-500 animate-pulse" />;
        }
        return <Globe className="h-5 w-5 text-brand-secondary animate-pulse" />;
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-brand-success" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-text-muted" />;
    }
  };

  const getStatusColor = () => {
    if (status === "running" && isStuck) {
      return "text-yellow-500";
    }
    switch (status) {
      case "idle":
        return "text-text-muted";
      case "running":
        return "text-brand-secondary";
      case "completed":
        return "text-brand-success";
      case "failed":
        return "text-red-500";
    }
  };

  const getStatusLabel = () => {
    if (status === "running" && isStuck) {
      return "Possibly Stuck";
    }
    switch (status) {
      case "idle":
        return "Ready";
      case "running":
        return "Extracting";
      case "completed":
        return "Complete";
      case "failed":
        return "Failed";
    }
  };

  const getProgressVariant = () => {
    if (status === "running" && isStuck) {
      return "warning" as const;
    }
    if (status === "completed") {
      return "success" as const;
    }
    if (status === "failed") {
      return "error" as const;
    }
    return "brand-secondary" as const;
  };

  if (status === "idle") {
    return null;
  }

  return (
    <Card className="bg-surface-raised/60 border-brand-secondary/30 backdrop-blur-sm overflow-hidden">
      {/* Header with status */}
      <div className="p-4 border-b border-brand-secondary/20 bg-brand-secondary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon()}
            <div>
              <div className="flex items-center gap-2">
                <span className={`font-mono font-semibold ${getStatusColor()}`}>
                  {getStatusLabel()}
                </span>
                <Badge
                  variant="outline"
                  className="text-[10px] border-brand-secondary/50 text-brand-secondary"
                >
                  Web Extraction
                </Badge>
              </div>
              <div className="text-xs text-text-muted font-mono mt-0.5">
                {pagesExtracted} of {maxPages} pages
                {isActive && ` \u2022 ${formatTime(elapsedSeconds)}`}
              </div>
            </div>
          </div>

          {isActive && onStop && (
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              data-ui-id="extraction-web-stop-btn"
              className="border-red-500/50 text-red-500 hover:bg-red-500/10"
            >
              <Square className="h-3 w-3 mr-1 fill-current" />
              Stop
            </Button>
          )}
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="mt-3">
            <Progress
              value={progressPercent}
              variant={getProgressVariant()}
              className="h-2 bg-surface-canvas"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Stats */}
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-brand-secondary" />
            <span className="text-sm font-mono">
              <span className="text-brand-secondary font-bold">
                {pagesExtracted}
              </span>{" "}
              <span className="text-text-muted">pages</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-secondary" />
            <span className="text-sm font-mono">
              <span className="text-brand-secondary font-bold">
                {statesFound}
              </span>{" "}
              <span className="text-text-muted">states</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-brand-secondary" />
            <span className="text-sm font-mono">
              <span className="text-brand-secondary font-bold">
                {transitionsFound}
              </span>{" "}
              <span className="text-text-muted">transitions</span>
            </span>
          </div>
          {errors > 0 && (
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-mono">
                <span className="text-red-500 font-bold">{errors}</span>{" "}
                <span className="text-text-muted">errors</span>
              </span>
            </div>
          )}
        </div>

        {/* Stuck warning */}
        {isStuck && (
          <div className="p-3 rounded bg-yellow-500/10 border border-yellow-500/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-yellow-400 font-medium">
                  No progress detected
                </p>
                <p className="text-xs text-yellow-500/80 mt-1">
                  Extraction has not progressed for {formatTime(stuckSeconds)}.
                  The process may be stuck or waiting for a slow page to load.
                  Consider stopping and restarting if this persists.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="p-3 rounded bg-red-500/10 border border-red-500/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-400">{errorMessage}</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
