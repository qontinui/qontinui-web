"use client";

/**
 * /vga/runs/[runId] — playback / inspection of a single VGA runtime run.
 *
 * Renders the run's step_log as a vertical timeline. Each step shows
 * the action, prompt, predicted bbox thumbnail, IoU/template similarity,
 * pass/fail status, and timestamp. When the runner stored a screenshot
 * URL for a step, we embed a thumbnail.
 */

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { VgaStepEvent } from "@/lib/types/vga";
import { getRun } from "../../_components/api-client";

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function statusTone(status: string): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  switch (status) {
    case "succeeded":
    case "success":
      return { label: "Succeeded", variant: "secondary" };
    case "failed":
      return { label: "Failed", variant: "destructive" };
    case "drifted":
      return { label: "Drifted", variant: "outline" };
    case "running":
      return { label: "Running", variant: "default" };
    default:
      return { label: status, variant: "outline" };
  }
}

function stepStatusIcon(status: VgaStepEvent["status"]) {
  switch (status) {
    case "ok":
      return (
        <CheckCircle2 className="size-4 text-emerald-500" aria-label="Ok" />
      );
    case "failed":
      return <XCircle className="size-4 text-red-500" aria-label="Failed" />;
    case "drift":
      return (
        <span
          aria-label="Drift"
          className="size-4 inline-flex items-center justify-center text-amber-500 font-bold"
        >
          ~
        </span>
      );
  }
}

export default function VgaRunInspectionPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);

  const {
    data: run,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["vga", "run", runId],
    queryFn: () => getRun(runId),
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      return d.status === "running" ? 2000 : false;
    },
  });

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-sm text-red-500">
          Failed to load run: {(error as Error)?.message ?? "unknown"}
        </div>
      </div>
    );
  }

  const { variant, label } = statusTone(run.status);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/vga" aria-label="Back to VGA landing">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <h1 className="text-lg font-semibold truncate max-w-md">
            Run {run.id.slice(0, 8)}
          </h1>
          <Badge variant={variant}>{label}</Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            {run.groundingModel}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Started {new Date(run.startedAt).toLocaleString()}</span>
          <span>Duration {formatDuration(run.startedAt, run.endedAt)}</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">State machine</CardTitle>
              <CardDescription>
                <Link
                  href={`/vga/builder/${run.stateMachineId}`}
                  className="underline"
                >
                  {run.stateMachineName ?? run.stateMachineId}
                </Link>
              </CardDescription>
            </CardHeader>
          </Card>

          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Step log ({run.stepLog.length})
          </h2>

          {run.stepLog.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No steps recorded yet.
            </div>
          ) : (
            <ol className="relative border-l border-border ml-2 space-y-4">
              {run.stepLog.map((step, idx) => (
                <li key={idx} className="ml-4">
                  <span className="absolute -left-[9px] mt-1.5 size-4 rounded-full bg-background border border-border" />
                  <Card>
                    <CardContent className="pt-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {stepStatusIcon(step.status)}
                          <Badge variant="secondary">{step.action.kind}</Badge>
                          {step.action.element_id && (
                            <span className="text-xs font-mono text-muted-foreground">
                              element {step.action.element_id.slice(0, 8)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">
                            IoU {(step.iou ?? 0).toFixed(2)}
                          </Badge>
                          <Badge variant="outline">
                            sim {(step.template_similarity ?? 0).toFixed(2)}
                          </Badge>
                          {step.ts && (
                            <span>
                              {new Date(step.ts).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground mr-1">
                          Prompt:
                        </span>
                        {step.prompt}
                      </div>
                      {step.error && (
                        <div className="text-xs text-red-500 break-all">
                          {step.error}
                        </div>
                      )}
                      {step.bbox_pred && (
                        <div className="text-xs text-muted-foreground">
                          predicted {step.bbox_pred.x},{step.bbox_pred.y} (
                          {step.bbox_pred.w}x{step.bbox_pred.h})
                          {step.bbox_last && (
                            <span className="ml-2">
                              last {step.bbox_last.x},{step.bbox_last.y}
                            </span>
                          )}
                        </div>
                      )}
                      {step.screenshot_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={step.screenshot_url}
                          alt={`Step ${idx + 1} screenshot`}
                          className="max-w-full h-auto rounded border border-border"
                        />
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}
