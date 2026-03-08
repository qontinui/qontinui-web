/**
 * UI-TARS Extraction Progress Panel
 *
 * Shows real-time progress during UI-TARS exploration:
 * - Current step / max steps
 * - Elapsed time
 * - Last thought (what the model is reasoning about)
 * - Last action (what action was taken)
 * - States and transitions discovered
 */

"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Bot,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Brain,
  MousePointer2,
  Layers,
  ArrowRightLeft,
  Square,
  AlertCircle,
} from "lucide-react";

export type UITarsExtractionStatus =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export interface UITarsProgress {
  status: UITarsExtractionStatus;
  currentStep: number;
  maxSteps: number;
  elapsedSeconds: number;
  lastThought?: string;
  lastAction?: string;
  statesDiscovered: number;
  transitionsDiscovered: number;
  errorMessage?: string;
}

interface UITarsProgressPanelProps {
  progress: UITarsProgress;
  onStop?: () => void;
}

export function UITarsProgressPanel({
  progress,
  onStop,
}: UITarsProgressPanelProps) {
  const {
    status,
    currentStep,
    maxSteps,
    elapsedSeconds,
    lastThought,
    lastAction,
    statesDiscovered,
    transitionsDiscovered,
    errorMessage,
  } = progress;

  const isActive = status === "starting" || status === "running";
  const progressPercent =
    status === "completed" ? 100 : Math.min((currentStep / maxSteps) * 100, 99);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusIcon = () => {
    switch (status) {
      case "idle":
        return <Clock className="h-5 w-5 text-text-muted" />;
      case "starting":
        return (
          <Loader2 className="h-5 w-5 text-brand-secondary animate-spin" />
        );
      case "running":
        return <Bot className="h-5 w-5 text-brand-secondary animate-pulse" />;
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-brand-success" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "stopped":
        return <Square className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "idle":
        return "text-text-muted";
      case "starting":
      case "running":
        return "text-brand-secondary";
      case "completed":
        return "text-brand-success";
      case "failed":
        return "text-red-500";
      case "stopped":
        return "text-yellow-500";
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "idle":
        return "Ready";
      case "starting":
        return "Initializing...";
      case "running":
        return "Exploring";
      case "completed":
        return "Complete";
      case "failed":
        return "Failed";
      case "stopped":
        return "Stopped";
    }
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
                  UI-TARS
                </Badge>
              </div>
              <div className="text-xs text-text-muted font-mono mt-0.5">
                Step {currentStep} of {maxSteps} • {formatTime(elapsedSeconds)}
              </div>
            </div>
          </div>

          {isActive && onStop && (
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
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
              className="h-2 bg-surface-canvas"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Stats */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-brand-secondary" />
            <span className="text-sm font-mono">
              <span className="text-brand-secondary font-bold">
                {statesDiscovered}
              </span>{" "}
              <span className="text-text-muted">states</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-brand-secondary" />
            <span className="text-sm font-mono">
              <span className="text-brand-secondary font-bold">
                {transitionsDiscovered}
              </span>{" "}
              <span className="text-text-muted">transitions</span>
            </span>
          </div>
        </div>

        {/* Last Thought */}
        {lastThought && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-text-muted font-mono uppercase">
              <Brain className="h-3 w-3" />
              Current Thought
            </div>
            <div className="p-2 rounded bg-surface-canvas/50 border border-brand-secondary/10">
              <p className="text-sm text-text-secondary italic line-clamp-2">
                &quot;{lastThought}&quot;
              </p>
            </div>
          </div>
        )}

        {/* Last Action */}
        {lastAction && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-text-muted font-mono uppercase">
              <MousePointer2 className="h-3 w-3" />
              Last Action
            </div>
            <div className="p-2 rounded bg-surface-canvas/50 border border-brand-secondary/10">
              <code className="text-sm text-brand-secondary">{lastAction}</code>
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

/**
 * Simulated progress for demo/development purposes.
 * In production, this would poll the backend for real status.
 */
export function useSimulatedUITarsProgress(
  isExtracting: boolean,
  maxSteps: number = 50
): UITarsProgress {
  const [progress, setProgress] = useState<UITarsProgress>({
    status: "idle",
    currentStep: 0,
    maxSteps,
    elapsedSeconds: 0,
    statesDiscovered: 0,
    transitionsDiscovered: 0,
  });

  useEffect(() => {
    if (!isExtracting) {
      if (progress.status === "running") {
        // Mark as stopped if we were running
        setProgress((p) => ({ ...p, status: "stopped" }));
      }
      return;
    }

    // Start extraction
    setProgress({
      status: "starting",
      currentStep: 0,
      maxSteps,
      elapsedSeconds: 0,
      statesDiscovered: 0,
      transitionsDiscovered: 0,
    });

    // Simulate initialization
    const initTimer = setTimeout(() => {
      setProgress((p) => ({
        ...p,
        status: "running",
        lastThought:
          "Analyzing the initial screen to identify interactive elements...",
      }));
    }, 1500);

    // Simulate progress updates
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p.status !== "running") return p;

        const newStep = p.currentStep + 1;
        const thoughts = [
          "Looking for clickable buttons and links...",
          "Examining the navigation menu structure...",
          "Checking for dropdown menus and interactive elements...",
          "Analyzing form inputs and their states...",
          "Exploring submenu options...",
          "Identifying state transitions...",
          "Capturing screenshot of current state...",
          "Determining next action to discover new states...",
        ];
        const actions = [
          "click(450, 230)",
          "hover(320, 180)",
          "click(600, 400)",
          "scroll(down, 200)",
          "click(150, 90)",
          "type('test input')",
          "click(800, 550)",
        ];

        if (newStep >= maxSteps) {
          return {
            ...p,
            status: "completed",
            currentStep: maxSteps,
            elapsedSeconds: p.elapsedSeconds + 2,
            lastThought:
              "Exploration complete. All reachable states discovered.",
            statesDiscovered: p.statesDiscovered + 1,
          };
        }

        const shouldDiscoverState = Math.random() > 0.7;
        const shouldDiscoverTransition = Math.random() > 0.6;

        return {
          ...p,
          currentStep: newStep,
          elapsedSeconds: p.elapsedSeconds + 2,
          lastThought: thoughts[Math.floor(Math.random() * thoughts.length)],
          lastAction: actions[Math.floor(Math.random() * actions.length)],
          statesDiscovered: p.statesDiscovered + (shouldDiscoverState ? 1 : 0),
          transitionsDiscovered:
            p.transitionsDiscovered + (shouldDiscoverTransition ? 1 : 0),
        };
      });
    }, 2000);

    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress.status is read inside setProgress callback, not needed as a dependency
  }, [isExtracting, maxSteps]);

  return progress;
}
