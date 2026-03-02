"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  ShieldCheck,
  Activity,
  FileCode,
  Terminal as TerminalIcon,
  AlertCircle,
} from "lucide-react";
import { ComparisonResultInline } from "@/components/run-detail/ComparisonResultInline";
import type { ComparisonResult } from "@/lib/runner/types/exploration";
import type { VerificationStepResult } from "@/types/task-runs";
import { CheckResultCard } from "@/components/common/_components/CheckResultCard";
import { EvidenceSection } from "./EvidenceSection";
import { formatDurationMs } from "./utils";

function StepStatusIcon({ success }: { success: boolean }) {
  if (success) {
    return <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />;
  }
  return <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
}

export function StepResultCard({ step }: { step: VerificationStepResult }) {
  const [expanded, setExpanded] = useState(false);
  const details = step.verification_details;
  const hasEvidence =
    !!step.screenshot_path ||
    !!details?.page_snapshot ||
    !!step.output_data?.log_output ||
    !!step.output_data?.console_output;
  const hasExpandableContent =
    step.error ||
    details?.stdout ||
    details?.stderr ||
    details?.console_output ||
    details?.assertions_total !== null ||
    (details?.check_results && details.check_results.length > 0) ||
    hasEvidence;

  return (
    <div className="border border-border-subtle/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={!hasExpandableContent}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-raised/20 transition-colors text-left disabled:cursor-default"
      >
        <div className="flex items-center gap-3">
          <StepStatusIcon success={step.success} />
          <div>
            <div className="text-sm font-medium">{step.step_name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge className="bg-surface-raised text-text-muted border-border-subtle text-[10px] px-1.5 py-0">
                {step.step_type}
              </Badge>
              {step.config?.check_type && (
                <Badge className="bg-brand-secondary/10 text-brand-secondary border-brand-secondary/30 text-[10px] px-1.5 py-0">
                  {step.config.check_type}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">
            <Clock className="w-3 h-3 inline mr-1" />
            {formatDurationMs(step.duration_ms)}
          </span>
          {hasExpandableContent &&
            (expanded ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            ))}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle/30 px-4 py-3 bg-surface-canvas/30 space-y-3">
          {step.error && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-400 mb-1">
                <AlertTriangle className="w-3 h-3" />
                Error
              </div>
              <pre className="text-xs text-red-300 bg-red-500/10 px-3 py-2 rounded font-mono whitespace-pre-wrap">
                {step.error}
              </pre>
            </div>
          )}

          {details?.assertions_total !== null &&
            details?.assertions_total !== undefined && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
                  <ShieldCheck className="w-3 h-3" />
                  Assertions
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={`text-[10px] px-1.5 py-0 ${
                      details.assertions_passed === details.assertions_total
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-red-500/20 text-red-400 border-red-500/30"
                    }`}
                  >
                    {details.assertions_passed ?? 0} /{" "}
                    {details.assertions_total} passed
                  </Badge>
                </div>
              </div>
            )}

          {details?.exit_code !== null && details?.exit_code !== undefined && (
            <div className="text-xs text-text-muted">
              Exit code:{" "}
              <span
                className={
                  details.exit_code === 0 ? "text-green-400" : "text-red-400"
                }
              >
                {details.exit_code}
              </span>
            </div>
          )}

          {details?.stdout && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
                <TerminalIcon className="w-3 h-3" />
                stdout
              </div>
              <pre className="text-xs text-text-secondary bg-surface-canvas/50 px-3 py-2 rounded font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {details.stdout}
              </pre>
            </div>
          )}

          {details?.stderr && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-yellow-400 mb-1">
                <AlertCircle className="w-3 h-3" />
                stderr
              </div>
              <pre className="text-xs text-yellow-300 bg-yellow-500/10 px-3 py-2 rounded font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {details.stderr}
              </pre>
            </div>
          )}

          {details?.console_output && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
                <FileCode className="w-3 h-3" />
                Console Output
              </div>
              <pre className="text-xs text-text-secondary bg-surface-canvas/50 px-3 py-2 rounded font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {details.console_output}
              </pre>
            </div>
          )}

          {details?.check_results && details.check_results.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
                <Activity className="w-3 h-3" />
                Check Results ({details.check_results.length})
              </div>
              <div className="space-y-1.5">
                {details.check_results.map((check, idx) => (
                  <CheckResultCard key={idx} check={check} />
                ))}
              </div>
            </div>
          )}

          {(() => {
            const compResult =
              step.comparison_result ??
              (step.output_data?.comparison_result as
                | ComparisonResult
                | undefined);
            return compResult ? (
              <ComparisonResultInline result={compResult} />
            ) : null;
          })()}

          <EvidenceSection step={step} />
        </div>
      )}
    </div>
  );
}
