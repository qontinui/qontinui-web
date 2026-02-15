"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  WifiOff,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  duration_ms?: number;
  status_code?: number;
  response_body?: string;
  response_headers?: Record<string, string>;
  [key: string]: unknown;
}

interface ExecutionPanelProps {
  onRun: () => Promise<ExecutionResult | void>;
  isRunnerOffline?: boolean;
  disabled?: boolean;
  runLabel?: string;
  className?: string;
}

export function ExecutionPanel({
  onRun,
  isRunnerOffline = false,
  disabled = false,
  runLabel = "Run",
  className,
}: ExecutionPanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await onRun();
      if (res) {
        setResult(res);
        setExpanded(true);
      }
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Execution failed",
      });
      setExpanded(true);
    } finally {
      setRunning(false);
    }
  };

  if (isRunnerOffline) {
    return (
      <div className={cn("flex items-center gap-2 p-3 rounded-lg border border-border-subtle/50 bg-surface-raised/20", className)}>
        <WifiOff className="size-4 text-text-muted" />
        <span className="text-xs text-text-muted">Runner offline — connect to execute</span>
      </div>
    );
  }

  const output = result?.output || result?.stdout || result?.response_body || "";
  const errorOutput = result?.error || result?.stderr || "";

  return (
    <div className={cn("border border-border-subtle/50 rounded-lg bg-surface-raised/20", className)}>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Button
          size="sm"
          className="h-7 gap-1.5"
          onClick={handleRun}
          disabled={disabled || running}
        >
          {running ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          {running ? "Running..." : runLabel}
        </Button>

        {result && (
          <>
            {result.success ? (
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                <CheckCircle2 className="size-3 mr-1" />
                Passed
              </Badge>
            ) : (
              <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">
                <XCircle className="size-3 mr-1" />
                Failed
              </Badge>
            )}

            {result.duration_ms != null && (
              <Badge variant="outline" className="text-[10px] text-text-muted">
                <Clock className="size-3 mr-1" />
                {result.duration_ms}ms
              </Badge>
            )}

            {result.status_code != null && (
              <Badge variant="outline" className="text-[10px] text-text-muted">
                {result.status_code}
              </Badge>
            )}

            {result.exit_code != null && result.exit_code !== 0 && (
              <Badge variant="outline" className="text-[10px] text-red-400">
                exit {result.exit_code}
              </Badge>
            )}

            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="ml-auto text-text-muted hover:text-text-secondary"
            >
              <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
            </button>
          </>
        )}
      </div>

      {result && expanded && (output || errorOutput) && (
        <div className="border-t border-border-subtle/30 px-4 py-3 space-y-2">
          {output && (
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-64 overflow-y-auto bg-surface-canvas/50 rounded p-2">
              {output}
            </pre>
          )}
          {errorOutput && (
            <pre className="text-xs text-red-400 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto bg-red-500/5 rounded p-2">
              {errorOutput}
            </pre>
          )}
          {result.response_headers && (
            <details className="text-xs text-text-muted">
              <summary className="cursor-pointer hover:text-text-secondary">Response Headers</summary>
              <pre className="mt-1 font-mono whitespace-pre-wrap bg-surface-canvas/50 rounded p-2">
                {Object.entries(result.response_headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
