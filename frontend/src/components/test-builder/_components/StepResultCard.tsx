"use client";

import { Badge } from "@/components/ui/badge";
import { Check, X, ChevronDown, ChevronRight, Variable } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StepExecutionResult } from "../_types/orchestrator-types";
import { formatValue, formatJson } from "../orchestrator-utils";

function HttpMethodBadge({ method }: { method: string }) {
  const m = method.toUpperCase();
  const colors: Record<string, string> = {
    GET: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    POST: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    PUT: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    PATCH: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    DELETE: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-mono px-1.5 py-0",
        colors[m] || "text-text-muted"
      )}
    >
      {m}
    </Badge>
  );
}

function StatusCodeBadge({ code }: { code: number }) {
  let colorClass = "text-text-muted border-border-subtle/50";
  if (code >= 200 && code < 300) {
    colorClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  } else if (code >= 400 && code < 500) {
    colorClass = "bg-amber-500/10 text-amber-400 border-amber-500/30";
  } else if (code >= 500) {
    colorClass = "bg-red-500/10 text-red-400 border-red-500/30";
  }
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] font-mono px-1.5 py-0", colorClass)}
    >
      {code}
    </Badge>
  );
}

export function StepResultCard({
  step,
  isExpanded,
  onToggle,
}: {
  step: StepExecutionResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "border rounded-md overflow-hidden",
        step.success ? "border-border-subtle/40" : "border-red-500/20"
      )}
    >
      {/* Header */}
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 text-left",
          "hover:bg-surface-raised/30 transition-colors",
          step.success ? "bg-surface-canvas/30" : "bg-red-500/5"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="size-3.5 text-text-muted" />
        ) : (
          <ChevronRight className="size-3.5 text-text-muted" />
        )}

        <div
          className={cn(
            "size-5 rounded-full flex items-center justify-center",
            step.success ? "bg-emerald-500/20" : "bg-red-500/20"
          )}
        >
          {step.success ? (
            <Check className="size-3 text-emerald-400" />
          ) : (
            <X className="size-3 text-red-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-primary font-medium truncate">
              {step.step_name}
            </span>
            <StatusCodeBadge code={step.response.status_code} />
            <span className="text-[10px] text-text-muted">
              {step.duration_ms}ms
            </span>
          </div>
          <div className="text-xs text-text-muted truncate">
            {step.request.method} {step.request.url}
          </div>
        </div>

        {Object.keys(step.extracted_variables).length > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/20"
          >
            <Variable className="size-2.5" />
            {Object.keys(step.extracted_variables).length} var
          </Badge>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border-subtle/30 px-3 py-3 space-y-3 bg-surface-canvas/20">
          {/* Error */}
          {step.error && (
            <div className="p-2 bg-red-500/5 border border-red-500/20 rounded text-xs text-red-400">
              {step.error}
            </div>
          )}

          {/* Request */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
              Request
            </div>
            <div className="p-2 bg-surface-canvas/50 rounded">
              <div className="flex items-center gap-2 text-xs">
                <HttpMethodBadge method={step.request.method} />
                <code className="text-text-secondary break-all text-xs">
                  {step.request.url}
                </code>
              </div>
              {step.request.body && (
                <div className="mt-2">
                  <div className="text-[10px] text-text-muted mb-1">Body:</div>
                  <pre className="text-xs text-text-muted font-mono overflow-auto max-h-24 whitespace-pre-wrap">
                    {formatJson(step.request.body)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Response */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] font-medium text-text-muted uppercase tracking-wider">
              Response
              <span className="text-text-muted/60">
                ({step.response.size_bytes} bytes)
              </span>
            </div>
            <pre className="p-2 bg-surface-canvas/50 rounded text-xs text-text-muted font-mono overflow-auto max-h-40 whitespace-pre-wrap">
              {formatJson(step.response.body)}
            </pre>
          </div>

          {/* Extracted variables */}
          {Object.keys(step.extracted_variables).length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-purple-400 uppercase tracking-wider">
                <Variable className="size-3" />
                Extracted Variables
              </div>
              <div className="space-y-1">
                {Object.entries(step.extracted_variables).map(
                  ([name, value]) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 p-2 bg-purple-500/5 rounded text-xs font-mono"
                    >
                      <span className="text-purple-400 shrink-0">{name}</span>
                      <span className="text-text-muted">=</span>
                      <span className="text-text-secondary break-all">
                        {formatValue(value, 200)}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
