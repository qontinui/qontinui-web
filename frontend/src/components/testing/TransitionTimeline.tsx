"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  PlayCircle,
  Image as ImageIcon,
} from "lucide-react";
import type { TransitionUpdate } from "@/hooks/useTestingWebSocket";

interface TransitionTimelineProps {
  transitions: TransitionUpdate[];
  currentTransitionId?: string;
  autoScroll?: boolean;
}

export function TransitionTimeline({
  transitions,
  currentTransitionId,
  autoScroll = true,
}: TransitionTimelineProps) {
  const [expandedTransitions, setExpandedTransitions] = useState<Set<string>>(
    new Set()
  );

  const toggleExpanded = (transitionId: string) => {
    setExpandedTransitions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(transitionId)) {
        newSet.delete(transitionId);
      } else {
        newSet.add(transitionId);
      }
      return newSet;
    });
  };

  const getStatusIcon = (status: TransitionUpdate["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "failed":
        return <XCircle className="w-5 h-5 text-red-500" />;
      case "running":
        return <PlayCircle className="w-5 h-5 text-blue-500 animate-pulse" />;
      case "pending":
        return <Clock className="w-5 h-5 text-text-muted" />;
      default:
        return <Clock className="w-5 h-5 text-text-muted" />;
    }
  };

  const getStatusColor = (status: TransitionUpdate["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-500/20 border-green-500/30";
      case "failed":
        return "bg-red-500/20 border-red-500/30";
      case "running":
        return "bg-blue-500/20 border-blue-500/30";
      case "pending":
        return "bg-surface-raised/20 border-border-default/30";
      default:
        return "bg-surface-raised/20 border-border-default/30";
    }
  };

  const formatDuration = (ms: number) => {
    if (ms === 0) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  if (transitions.length === 0) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-12 text-center">
          <Clock className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <div className="text-text-muted">
            Waiting for test execution to start...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {transitions.map((transition, index) => {
        const isExpanded = expandedTransitions.has(transition.id);
        const isCurrent = transition.id === currentTransitionId;
        const hasScreenshot = !!transition.screenshot_url;

        return (
          <Card
            key={transition.id}
            className={`bg-surface-raised/50 border-border-subtle/50 transition-all ${
              isCurrent ? "ring-2 ring-brand-primary/50" : ""
            } ${autoScroll && isCurrent ? "scroll-mt-4" : ""}`}
            ref={
              autoScroll && isCurrent
                ? (el) =>
                    el?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                : undefined
            }
          >
            <CardContent className="p-4">
              {/* Transition header */}
              <div className="flex items-start gap-3">
                {/* Timeline connector */}
                <div className="flex flex-col items-center">
                  <div className="flex-shrink-0">
                    {getStatusIcon(transition.status)}
                  </div>
                  {index < transitions.length - 1 && (
                    <div className="w-px h-full min-h-[20px] bg-border-default mt-2" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          className={`text-xs ${getStatusColor(transition.status)}`}
                        >
                          {transition.status}
                        </Badge>
                        {isCurrent && (
                          <Badge className="bg-brand-primary/20 text-brand-primary border-brand-primary/30 text-xs">
                            Current
                          </Badge>
                        )}
                      </div>

                      <div className="text-sm font-medium text-white truncate">
                        {transition.from_state} → {transition.to_state}
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                        <span className="flex items-center gap-1">
                          <span className="font-medium">Action:</span>
                          <span className="text-brand-primary">
                            {transition.action_type}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(transition.duration_ms)}
                        </span>
                        {hasScreenshot && (
                          <span className="flex items-center gap-1">
                            <ImageIcon className="w-3 h-3" />
                            Screenshot
                          </span>
                        )}
                      </div>

                      {/* Error message */}
                      {transition.error_message && (
                        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                          {transition.error_message}
                        </div>
                      )}
                    </div>

                    {/* Expand button */}
                    {(hasScreenshot || transition.error_message) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleExpanded(transition.id)}
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
                      {/* Screenshot */}
                      {hasScreenshot && (
                        <div className="space-y-2">
                          <div className="text-xs text-text-muted font-medium">
                            Screenshot:
                          </div>
                          <div className="rounded border border-border-default overflow-hidden bg-black/30">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={transition.screenshot_url!}
                              alt={`Transition ${transition.from_state} to ${transition.to_state}`}
                              className="w-full h-auto"
                              loading="lazy"
                            />
                          </div>
                        </div>
                      )}

                      {/* Details */}
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-text-muted mb-1">From State</div>
                          <div className="text-white font-mono bg-surface-raised/50 px-2 py-1 rounded">
                            {transition.from_state}
                          </div>
                        </div>
                        <div>
                          <div className="text-text-muted mb-1">To State</div>
                          <div className="text-white font-mono bg-surface-raised/50 px-2 py-1 rounded">
                            {transition.to_state}
                          </div>
                        </div>
                        <div>
                          <div className="text-text-muted mb-1">
                            Action Type
                          </div>
                          <div className="text-white font-mono bg-surface-raised/50 px-2 py-1 rounded">
                            {transition.action_type}
                          </div>
                        </div>
                        <div>
                          <div className="text-text-muted mb-1">Duration</div>
                          <div className="text-white font-mono bg-surface-raised/50 px-2 py-1 rounded">
                            {formatDuration(transition.duration_ms)}
                          </div>
                        </div>
                      </div>

                      {/* Timestamp */}
                      <div className="text-xs text-text-muted">
                        Executed at:{" "}
                        {new Date(transition.executed_at).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
