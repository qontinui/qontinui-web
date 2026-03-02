"use client";

import { useEffect, useRef, useState } from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Maximize2,
} from "lucide-react";
import type { TestStep } from "@/hooks/useTestStream";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StepProgressMarker } from "@/components/shared/StepProgressMarker";

interface TestStepTimelineProps {
  steps: TestStep[];
  currentStepId?: string;
  autoScroll?: boolean;
  /** Task run ID for progress tracking */
  taskRunId?: string;
  /** Enable real-time progress tracking for running steps */
  enableProgressTracking?: boolean;
}

export function TestStepTimeline({
  steps,
  currentStepId,
  autoScroll = true,
  taskRunId,
  enableProgressTracking = false,
}: TestStepTimelineProps) {
  const { expanded: expandedSteps, toggle: toggleExpanded } =
    useExpandableSet();
  const [selectedScreenshot, setSelectedScreenshot] = useState<{
    url: string;
    step: TestStep;
  } | null>(null);
  const currentStepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && currentStepRef.current) {
      currentStepRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentStepId, autoScroll]);

  const getStatusIcon = (status: TestStep["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "running":
        return <PlayCircle className="w-5 h-5 text-blue-500 animate-pulse" />;
      case "pending":
        return <Clock className="w-5 h-5 text-text-muted" />;
    }
  };

  const getStatusColor = (status: TestStep["status"]) => {
    switch (status) {
      case "success":
        return "bg-green-500/20 border-green-500/30 text-green-500";
      case "failed":
        return "bg-red-500/20 border-red-500/30 text-red-500";
      case "running":
        return "bg-blue-500/20 border-blue-500/30 text-blue-500";
      case "pending":
        return "bg-surface-raised/20 border-border-subtle text-text-muted";
    }
  };

  const getStepTypeLabel = (type: TestStep["stepType"]) => {
    switch (type) {
      case "transition":
        return "Transition";
      case "action":
        return "Action";
      case "assertion":
        return "Assertion";
      case "screenshot":
        return "Screenshot";
    }
  };

  const formatDuration = (ms: number) => {
    if (ms === 0) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (steps.length === 0) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <div className="text-text-muted">
            Waiting for test steps to begin...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {steps.map((step, index) => {
          const isExpanded = expandedSteps.has(step.id);
          const isCurrent = step.id === currentStepId;
          const hasScreenshot = !!step.screenshotUrl;
          const hasDetails =
            hasScreenshot || step.errorMessage || step.metadata;

          return (
            <Card
              key={step.id}
              ref={isCurrent ? currentStepRef : undefined}
              className={`bg-surface-raised/50 border-border-subtle/50 transition-all ${
                isCurrent
                  ? "ring-2 ring-brand-primary/50 shadow-lg shadow-brand-primary/10"
                  : ""
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {/* Timeline connector */}
                  <div className="flex flex-col items-center">
                    <div className="flex-shrink-0">
                      {getStatusIcon(step.status)}
                    </div>
                    {index < steps.length - 1 && (
                      <div className="w-px flex-1 min-h-[30px] bg-border-default mt-2" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Status and type badges */}
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="text-xs font-mono">
                            #{step.stepNumber}
                          </Badge>
                          <Badge
                            className={`text-xs ${getStatusColor(step.status)}`}
                          >
                            {step.status}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {getStepTypeLabel(step.stepType)}
                          </Badge>
                          {isCurrent && (
                            <Badge className="bg-brand-primary/20 text-brand-primary border-brand-primary/30 text-xs">
                              Current
                            </Badge>
                          )}
                        </div>

                        {/* Step details */}
                        {step.stepType === "transition" && (
                          <div className="text-sm font-medium text-white mb-1">
                            {step.fromState} → {step.toState}
                          </div>
                        )}

                        {step.actionType && (
                          <div className="text-sm text-text-muted mb-2">
                            <span className="font-medium text-text-secondary">
                              Action:
                            </span>{" "}
                            <span className="text-brand-primary">
                              {step.actionType}
                            </span>
                          </div>
                        )}

                        {/* Meta info */}
                        <div className="flex items-center gap-3 text-xs text-text-muted">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(step.duration)}
                          </span>
                          <span>
                            {new Date(step.timestamp).toLocaleTimeString()}
                          </span>
                          {hasScreenshot && (
                            <span className="flex items-center gap-1 text-brand-primary">
                              <ImageIcon className="w-3 h-3" />
                              Screenshot
                            </span>
                          )}
                        </div>

                        {/* Error message (always visible) */}
                        {step.errorMessage && (
                          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                            {step.errorMessage}
                          </div>
                        )}
                      </div>

                      {/* Expand button */}
                      {hasDetails && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleExpanded(step.id)}
                          className="flex-shrink-0 h-8 w-8 p-0 hover:bg-surface-raised/50"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="mt-3 space-y-3">
                        {/* Progress Marker for Running Steps */}
                        {enableProgressTracking &&
                          taskRunId &&
                          step.status === "running" && (
                            <StepProgressMarker
                              taskRunId={taskRunId}
                              checkpointId={step.id}
                              isRunning={true}
                              autoRefresh={true}
                              compact={false}
                            />
                          )}

                        {/* Screenshot thumbnail */}
                        {hasScreenshot && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-text-muted font-medium">
                                Screenshot:
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setSelectedScreenshot({
                                    url: step.screenshotUrl!,
                                    step,
                                  })
                                }
                                className="h-6 text-xs gap-1 text-brand-primary hover:text-brand-primary/80"
                              >
                                <Maximize2 className="w-3 h-3" />
                                View Full
                              </Button>
                            </div>
                            <div className="rounded border border-border-default overflow-hidden bg-black/30 cursor-pointer hover:border-brand-primary/50 transition-colors">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={step.screenshotUrl!}
                                alt={`Step ${step.stepNumber} screenshot`}
                                className="w-full h-auto"
                                loading="lazy"
                                onClick={() =>
                                  setSelectedScreenshot({
                                    url: step.screenshotUrl!,
                                    step,
                                  })
                                }
                              />
                            </div>
                          </div>
                        )}

                        {/* Metadata */}
                        {step.metadata &&
                          Object.keys(step.metadata).length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs text-text-muted font-medium">
                                Metadata:
                              </div>
                              <div className="bg-surface-raised/50 rounded p-2 text-xs font-mono">
                                <pre className="text-text-secondary whitespace-pre-wrap">
                                  {JSON.stringify(step.metadata, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}

                        {/* Full details grid */}
                        {step.stepType === "transition" && (
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <div className="text-text-muted mb-1">
                                From State
                              </div>
                              <div className="text-white font-mono bg-surface-raised/50 px-2 py-1 rounded">
                                {step.fromState}
                              </div>
                            </div>
                            <div>
                              <div className="text-text-muted mb-1">
                                To State
                              </div>
                              <div className="text-white font-mono bg-surface-raised/50 px-2 py-1 rounded">
                                {step.toState}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Screenshot viewer dialog */}
      <Dialog
        open={selectedScreenshot !== null}
        onOpenChange={(open) => !open && setSelectedScreenshot(null)}
      >
        <DialogContent className="bg-surface-raised border-border-subtle max-w-6xl">
          <DialogHeader>
            <DialogTitle className="text-white">
              Step #{selectedScreenshot?.step.stepNumber} Screenshot
            </DialogTitle>
          </DialogHeader>
          {selectedScreenshot && (
            <div className="space-y-4">
              <div className="rounded border border-border-default overflow-hidden bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedScreenshot.url}
                  alt="Full size screenshot"
                  className="w-full h-auto"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-text-muted mb-1">Status</div>
                  <Badge
                    className={getStatusColor(selectedScreenshot.step.status)}
                  >
                    {selectedScreenshot.step.status}
                  </Badge>
                </div>
                <div>
                  <div className="text-text-muted mb-1">Duration</div>
                  <div className="text-white">
                    {formatDuration(selectedScreenshot.step.duration)}
                  </div>
                </div>
                {selectedScreenshot.step.fromState && (
                  <div>
                    <div className="text-text-muted mb-1">From State</div>
                    <div className="text-white font-mono">
                      {selectedScreenshot.step.fromState}
                    </div>
                  </div>
                )}
                {selectedScreenshot.step.toState && (
                  <div>
                    <div className="text-text-muted mb-1">To State</div>
                    <div className="text-white font-mono">
                      {selectedScreenshot.step.toState}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
