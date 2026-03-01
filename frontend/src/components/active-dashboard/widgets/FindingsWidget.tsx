"use client";

import { useState } from "react";
import {
  runnerApi,
  type Finding,
  type TaskRunKnowledge,
} from "@/lib/runner-api";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Bug,
  RefreshCw,
  CheckCircle2,
  Send,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";

function getSeverityColor(severity: string | undefined): string {
  switch (severity?.toLowerCase()) {
    case "critical":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "high":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "medium":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "low":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    default:
      return "bg-surface-raised/30 text-text-muted border-border-subtle";
  }
}

function FindingInputAction({
  finding,
  onSubmitted,
}: {
  finding: Finding;
  onSubmitted: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      await runnerApi.provideFindingResponse(String(finding.id), trimmed);
      toast.success("Response sent");
      setText("");
      onSubmitted();
    } catch {
      toast.error("Failed to send response");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        placeholder="Type your response..."
        disabled={submitting}
        className="flex-1 rounded-md border border-border-subtle/50 bg-surface-canvas/50 px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary/50 disabled:opacity-50"
      />
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={!text.trim() || submitting}
        className="h-6 px-2 text-[10px]"
      >
        {submitting ? (
          <RefreshCw className="size-3 animate-spin" />
        ) : (
          <Send className="size-3" />
        )}
      </Button>
    </div>
  );
}

function FindingResolveAction({
  finding,
  onResolved,
}: {
  finding: Finding;
  onResolved: () => void;
}) {
  const [resolving, setResolving] = useState(false);

  const handleResolve = async () => {
    setResolving(true);
    try {
      await runnerApi.resolveFinding(
        String(finding.id),
        "Resolved from Active Dashboard"
      );
      toast.success("Finding resolved");
      onResolved();
    } catch {
      toast.error("Failed to resolve finding");
    } finally {
      setResolving(false);
    }
  };

  if (finding.status === "resolved") {
    return (
      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-green-400">
        <CheckCircle2 className="size-3" />
        Resolved
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={handleResolve}
        disabled={resolving}
        className="h-6 px-2 text-[10px] gap-1"
      >
        {resolving ? (
          <RefreshCw className="size-3 animate-spin" />
        ) : (
          <CheckCircle2 className="size-3" />
        )}
        Resolve
      </Button>
    </div>
  );
}

function FindingCard({
  finding,
  onMutated,
}: {
  finding: Finding;
  onMutated: () => void;
}) {
  const needsInput = finding.category === "needs_user_input";

  return (
    <div className="p-2 rounded-lg bg-surface-canvas/50 border border-border-subtle/30">
      <div className="flex items-center gap-1.5">
        <Badge
          variant="outline"
          className={`text-[10px] ${getSeverityColor(finding.severity)}`}
        >
          {finding.severity}
        </Badge>
        {needsInput && (
          <Badge
            variant="outline"
            className="text-[10px] bg-purple-500/20 text-purple-400 border-purple-500/30"
          >
            <MessageSquareText className="size-2.5 mr-0.5" />
            Input needed
          </Badge>
        )}
        <span className="text-xs font-medium text-text-primary truncate">
          {finding.title}
        </span>
      </div>
      <p className="text-[10px] text-text-muted mt-1 line-clamp-2">
        {finding.description}
      </p>
      {finding.file_path && (
        <p className="text-[9px] text-text-muted mt-0.5 font-mono truncate">
          {finding.file_path}
          {finding.line_number != null && `:${finding.line_number}`}
        </p>
      )}

      {/* Interactive actions */}
      {needsInput ? (
        <FindingInputAction finding={finding} onSubmitted={onMutated} />
      ) : (
        <FindingResolveAction finding={finding} onResolved={onMutated} />
      )}
    </div>
  );
}

export function FindingsWidget({ runId }: { runId: string }) {
  const { data, isLoading, refetch } = useEventTriggeredFetch<TaskRunKnowledge>(
    ["finding_detected", "finding_resolved"],
    `/task-runs/${runId}/knowledge`,
    {
      transform: (raw: unknown) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "knowledge" in obj &&
          Array.isArray(obj.knowledge)
        ) {
          const items = obj.knowledge as Array<Record<string, unknown>>;
          return {
            findings: items.filter(
              (k) => k.category === "finding"
            ) as unknown as Finding[],
            observations: items
              .filter((k) => k.category === "observation")
              .map((k) => String(k.content || k.title || "")),
            hypotheses: items
              .filter((k) => k.category === "hypothesis")
              .map((k) => String(k.content || k.title || "")),
          };
        }
        if (obj && "findings" in obj) return obj as unknown as TaskRunKnowledge;
        return { findings: [], observations: [], hypotheses: [] };
      },
    }
  );

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bug className="size-4 text-red-400" />
            Findings
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const findings = data?.findings || [];

  // Severity summary
  const severityCounts = findings.reduce(
    (acc: Record<string, number>, f: Finding) => {
      const key = (f.severity ?? "unknown").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {}
  );

  const unresolvedCount = findings.filter(
    (f) => f.status !== "resolved"
  ).length;

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bug className="size-4 text-red-400" />
          Findings
          <Badge variant="secondary" className="text-xs">
            {findings.length}
          </Badge>
          {unresolvedCount > 0 && unresolvedCount < findings.length && (
            <Badge variant="warning" className="text-xs">
              {unresolvedCount} open
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        {/* Severity bar */}
        {findings.length > 0 && (
          <div className="flex gap-1.5 mb-3">
            {Object.entries(severityCounts).map(([severity, count]) => (
              <Badge
                key={severity}
                variant="outline"
                className={`text-[10px] ${getSeverityColor(severity)}`}
              >
                {severity}: {count}
              </Badge>
            ))}
          </div>
        )}
        <ScrollArea className="h-full">
          <div className="space-y-2">
            {findings.map((finding: Finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                onMutated={() => refetch()}
              />
            ))}
            {findings.length === 0 && (
              <p className="text-xs text-text-muted">No findings yet...</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
