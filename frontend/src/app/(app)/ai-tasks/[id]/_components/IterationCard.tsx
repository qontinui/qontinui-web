"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldX,
  SkipForward,
} from "lucide-react";
import type { VerificationResultResponse } from "@/types/task-runs";
import { StepResultCard } from "./StepResultCard";
import { formatDurationMs } from "./utils";

export function IterationCard({
  result,
}: {
  result: VerificationResultResponse;
}) {
  const [expanded, setExpanded] = useState(false);
  const phase = result.resultJson;

  return (
    <div className="border border-border-subtle/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-raised/30 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            {result.allPassed ? (
              <ShieldCheck className="w-6 h-6 text-green-500" />
            ) : result.criticalFailure ? (
              <ShieldX className="w-6 h-6 text-red-500" />
            ) : (
              <Shield className="w-6 h-6 text-yellow-500" />
            )}
          </div>
          <div className="text-left">
            <div className="font-medium">Iteration {result.iteration}</div>
            <div className="text-sm text-text-muted mt-0.5">
              {formatDurationMs(result.totalDurationMs)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {result.passedSteps > 0 && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              {result.passedSteps} passed
            </Badge>
          )}
          {result.failedSteps > 0 && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
              <XCircle className="w-3 h-3 mr-1" />
              {result.failedSteps} failed
            </Badge>
          )}
          {result.skippedSteps > 0 && (
            <Badge className="bg-surface-raised text-text-muted border-border-subtle">
              <SkipForward className="w-3 h-3 mr-1" />
              {result.skippedSteps} skipped
            </Badge>
          )}
          {result.criticalFailure && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Critical
            </Badge>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle/50 px-5 py-4 bg-surface-canvas/30 space-y-4">
          {phase.gateBasedEvaluation &&
            phase.gateResults &&
            phase.gateResults.length > 0 && (
              <div>
                <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
                  Gate Evaluations
                </div>
                <div className="flex flex-wrap gap-2">
                  {phase.gateResults.map((gate, idx) => (
                    <Badge
                      key={idx}
                      className={`text-xs ${
                        gate.passed
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-red-500/20 text-red-400 border-red-500/30"
                      }`}
                    >
                      {gate.passed ? (
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                      ) : (
                        <XCircle className="w-3 h-3 mr-1" />
                      )}
                      {gate.gateName}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

          <div>
            <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
              Step Results ({phase.stepResults.length})
            </div>
            <div className="space-y-2">
              {phase.stepResults.map((step, idx) => (
                <StepResultCard key={idx} step={step} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
