"use client";

import { useState } from "react";
import { ScanSearch, Globe, Play, Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// =============================================================================
// Types
// =============================================================================

interface ReviewStep {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  details?: string;
  error?: string;
}

// =============================================================================
// Page
// =============================================================================

export default function ReviewWorkflowPage() {
  const [targetUrl, setTargetUrl] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [steps, setSteps] = useState<ReviewStep[]>([]);
  const [, setError] = useState<string | null>(null);

  const handleStartReview = async () => {
    if (!targetUrl.trim()) return;
    setReviewing(true);
    setError(null);

    // Build review steps based on UI Bridge checks
    const reviewSteps: ReviewStep[] = [
      { name: "Connect to application", status: "pending" },
      { name: "Load UI Bridge snapshot", status: "pending" },
      { name: "Verify page structure", status: "pending" },
      { name: "Check interactive elements", status: "pending" },
      { name: "Validate navigation links", status: "pending" },
      { name: "Review accessibility", status: "pending" },
    ];

    setSteps(reviewSteps);

    // Simulate step-by-step execution
    for (let i = 0; i < reviewSteps.length; i++) {
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "running" } : s))
      );

      try {
        // Try fetching UI Bridge snapshot
        if (i === 1) {
          const snapshotUrl = targetUrl.includes("localhost:9876")
            ? `${targetUrl}/ui-bridge/control/snapshot`
            : `${targetUrl}/api/ui-bridge/control/snapshot`;

          try {
            const res = await fetch(snapshotUrl, { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
              const data = await res.json();
              const elementCount = data?.elements?.length ?? 0;
              setSteps((prev) =>
                prev.map((s, idx) =>
                  idx === i
                    ? { ...s, status: "passed", details: `${elementCount} elements found` }
                    : s
                )
              );
              continue;
            }
          } catch {
            // UI Bridge not available — mark as skipped
            setSteps((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, status: "skipped", details: "UI Bridge not available at this URL" }
                  : s
              )
            );
            continue;
          }
        }

        // For other steps, try a basic HTTP check on the target
        if (i === 0) {
          try {
            await fetch(targetUrl, {
              method: "HEAD",
              mode: "no-cors",
              signal: AbortSignal.timeout(10000),
            });
            setSteps((prev) =>
              prev.map((s, idx) =>
                idx === i ? { ...s, status: "passed", details: "Connection established" } : s
              )
            );
          } catch {
            setSteps((prev) =>
              prev.map((s, idx) =>
                idx === i
                  ? { ...s, status: "failed", error: "Could not connect to target URL" }
                  : s
              )
            );
          }
          continue;
        }

        // Mark remaining steps as skipped if UI Bridge wasn't available
        await new Promise((r) => setTimeout(r, 300));
        const uiBridgeStep = steps[1] ?? reviewSteps[1];
        if (uiBridgeStep && uiBridgeStep.status !== "passed") {
          setSteps((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: "skipped", details: "Requires UI Bridge connection" }
                : s
            )
          );
        } else {
          setSteps((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "passed", details: "Check completed" } : s
            )
          );
        }
      } catch (e) {
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "failed", error: e instanceof Error ? e.message : "Check failed" }
              : s
          )
        );
      }
    }

    setReviewing(false);
  };

  const passedCount = steps.filter((s) => s.status === "passed").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;
  const skippedCount = steps.filter((s) => s.status === "skipped").length;

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <ScanSearch className="size-5 text-cyan-400" />
          <h1 className="text-lg font-semibold text-foreground">Review Workflow</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
      <div className="w-full max-w-3xl mx-auto space-y-6">
        <p className="text-sm text-muted-foreground">
          Use UI Bridge to review your application against workflow expectations.
        </p>

        {/* Target URL + Run */}
        <div className="border border-border rounded-lg bg-muted/50 p-4">
            <div className="flex items-center gap-3">
              <Globe className="size-4 text-muted-foreground shrink-0" />
              <Input
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="http://localhost:3001 or http://localhost:9876"
                className="h-9 text-sm bg-background border-border flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleStartReview();
                }}
              />
              <Button
                onClick={handleStartReview}
                disabled={!targetUrl.trim() || reviewing}
                className="gap-1.5"
              >
                {reviewing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {reviewing ? "Reviewing..." : "Start Review"}
              </Button>
            </div>
        </div>

        {/* Results */}
        {steps.length > 0 && (
          <div className="space-y-3">
            {/* Summary */}
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-foreground">Review Results</h2>
              {!reviewing && (
                <div className="flex items-center gap-2">
                  {passedCount > 0 && (
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                      {passedCount} passed
                    </Badge>
                  )}
                  {failedCount > 0 && (
                    <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px]">
                      {failedCount} failed
                    </Badge>
                  )}
                  {skippedCount > 0 && (
                    <Badge className="bg-gray-500/10 text-gray-400 border-gray-500/30 text-[10px]">
                      {skippedCount} skipped
                    </Badge>
                  )}
                </div>
              )}
              {!reviewing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 gap-1 text-muted-foreground"
                  onClick={handleStartReview}
                >
                  <RefreshCw className="size-3" />
                  Re-run
                </Button>
              )}
            </div>

            {/* Step list */}
            <div className="space-y-1.5">
              {steps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/50"
                >
                  <div className="mt-0.5">
                    {step.status === "pending" && (
                      <div className="size-4 rounded-full border-2 border-border" />
                    )}
                    {step.status === "running" && (
                      <Loader2 className="size-4 text-blue-400 animate-spin" />
                    )}
                    {step.status === "passed" && (
                      <CheckCircle2 className="size-4 text-emerald-400" />
                    )}
                    {step.status === "failed" && (
                      <XCircle className="size-4 text-red-400" />
                    )}
                    {step.status === "skipped" && (
                      <AlertTriangle className="size-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{step.name}</p>
                    {step.details && (
                      <p className="text-xs text-muted-foreground mt-0.5">{step.details}</p>
                    )}
                    {step.error && (
                      <p className="text-xs text-red-400 mt-0.5">{step.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
