"use client";

import type {
  VerificationData,
  VerificationResult,
  VerificationSummary,
} from "@/lib/runner-api";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";

export function VerificationWidget({ runId }: { runId: string }) {
  const { data, isLoading } = useEventTriggeredFetch<VerificationData>(
    "step-progress",
    `/task-runs/${runId}/verification-results`,
    {
      transform: (raw: unknown) => {
        const obj = raw as Record<string, unknown>;
        if (obj && typeof obj === "object" && "results" in obj && Array.isArray(obj.results)) {
          return {
            results: obj.results as VerificationResult[],
            summary: (obj.summary as VerificationSummary) ?? null,
          };
        }
        if (Array.isArray(raw)) return { results: raw as VerificationResult[], summary: null };
        return { results: [], summary: null };
      },
    }
  );
  const { data: stepsData } = useSharedStepsData();

  // Extract check steps from execution steps as supplementary data
  // Match all verification-related step types (aligned with runner's mapCheckType)
  const checkSteps = (stepsData?.executions || []).filter((e) => {
    const t = e.step_type.toLowerCase();
    return [
      "check", "check_group", "playwright", "verification", "test",
      "error_check", "log_check", "shell", "gui_automation", "repo_test",
    ].includes(t) || t.includes("check") || t.includes("verification");
  });

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-400" />
            Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const results = data?.results || [];
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="size-4 text-green-400" />
          Verification
          {results.length > 0 && (
            <Badge
              variant={failed === 0 ? "success" : "destructive"}
              className="text-xs"
            >
              {passed}/{results.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        <ScrollArea className="h-full">
          <div className="space-y-1.5">
            {results.map((r) => (
              <div key={r.id} className="flex items-start gap-2 text-xs">
                {r.passed ? (
                  <CheckCircle2 className="size-3.5 text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="size-3.5 text-red-500 mt-0.5 shrink-0" />
                )}
                <span className="text-text-secondary">{r.criterion}</span>
              </div>
            ))}
            {results.length === 0 && checkSteps.length > 0 && (
              <>
                <p className="text-[10px] text-text-muted mb-2 uppercase tracking-wider">
                  Check Steps from Execution
                </p>
                {checkSteps.map((step) => (
                  <div key={step.id} className="flex items-start gap-2 text-xs">
                    {step.status === "success" ? (
                      <CheckCircle2 className="size-3.5 text-green-500 mt-0.5 shrink-0" />
                    ) : step.status === "failed" ? (
                      <XCircle className="size-3.5 text-red-500 mt-0.5 shrink-0" />
                    ) : step.status === "running" ? (
                      <Loader2 className="size-3.5 text-blue-400 animate-spin mt-0.5 shrink-0" />
                    ) : (
                      <div className="size-3.5 rounded-full border border-border-subtle/50 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="text-text-secondary">
                        {step.step_name}
                      </span>
                      {step.duration_ms != null && (
                        <span className="text-text-muted ml-2">
                          {step.duration_ms < 1000
                            ? `${step.duration_ms}ms`
                            : `${(step.duration_ms / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
            {results.length === 0 && checkSteps.length === 0 && (
              <p className="text-xs text-text-muted">
                No verification results yet...
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
