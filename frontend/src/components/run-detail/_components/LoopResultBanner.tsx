import React from "react";
import type { LoopResult } from "@/lib/runner-api";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  StopCircle,
  Repeat,
} from "lucide-react";

export function LoopResultBanner({ loopResult }: { loopResult: LoopResult }) {
  return (
    <div
      className={`rounded-lg p-4 ${
        loopResult.verification_passed
          ? "bg-green-500/10 border border-green-500/30"
          : loopResult.critical_failure
            ? "bg-red-500/10 border border-red-500/30"
            : loopResult.was_stopped
              ? "bg-amber-500/10 border border-amber-500/30"
              : "bg-amber-500/10 border border-amber-500/30"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {loopResult.verification_passed ? (
            <CheckCircle2 className="size-5 text-green-500" />
          ) : loopResult.critical_failure ? (
            <AlertTriangle className="size-5 text-red-500" />
          ) : loopResult.was_stopped ? (
            <StopCircle className="size-5 text-amber-500" />
          ) : (
            <XCircle className="size-5 text-amber-500" />
          )}
          <span
            className={`font-medium ${
              loopResult.verification_passed
                ? "text-green-400"
                : loopResult.critical_failure
                  ? "text-red-400"
                  : "text-amber-400"
            }`}
          >
            {loopResult.verification_passed
              ? "Verification Passed"
              : loopResult.critical_failure
                ? "Critical Failure"
                : loopResult.was_stopped
                  ? "Run Stopped"
                  : loopResult.max_iterations_reached
                    ? "Max Iterations Reached"
                    : "Verification Failed"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm text-text-muted">
          <Repeat className="size-4" />
          <span>
            {loopResult.iterations_run} iteration
            {loopResult.iterations_run !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      {loopResult.summary && (
        <p className="text-sm text-text-secondary">{loopResult.summary}</p>
      )}
      {/* Per-iteration quick summary badges */}
      {loopResult.iteration_results &&
        loopResult.iteration_results.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {loopResult.iteration_results.map((iter) => (
              <span
                key={iter.iteration}
                className={`text-xs px-2 py-1 rounded ${
                  iter.verification_passed
                    ? "bg-green-500/20 text-green-400"
                    : iter.critical_failure
                      ? "bg-red-500/20 text-red-400"
                      : "bg-amber-500/20 text-amber-400"
                }`}
              >
                #{iter.iteration}: {iter.passed_checks}/
                {iter.passed_checks + iter.failed_checks} checks
                {iter.agentic_phase_ran && (
                  <span className="ml-1">
                    {iter.agentic_phase_success ? "(AI ok)" : "(AI ran)"}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
    </div>
  );
}
