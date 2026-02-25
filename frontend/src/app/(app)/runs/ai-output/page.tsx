"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRunningTaskRuns, useTaskRunOutput } from "@/lib/runner-api";
import type { TaskRun } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, MessageSquare } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface ConversationSegment {
  type: "ai" | "user" | "session-divider";
  content: string;
  sessionNumber?: number;
}

// =============================================================================
// Output Parsing
// =============================================================================

function parseOutputLog(outputLog: string): ConversationSegment[] {
  if (!outputLog) return [];

  const segments: ConversationSegment[] = [];
  const sessionParts = outputLog.split(/(\[SESSION_START:(\d+)\])/);

  let currentSessionNumber = 1;

  for (let i = 0; i < sessionParts.length; i++) {
    const part = sessionParts[i] ?? "";

    const sessionMatch = part.match(/^\[SESSION_START:(\d+)\]$/);
    if (sessionMatch) {
      currentSessionNumber = parseInt(sessionMatch[1] ?? "1", 10);
      segments.push({
        type: "session-divider",
        content: `Session ${currentSessionNumber}`,
        sessionNumber: currentSessionNumber,
      });
      continue;
    }

    // Skip the captured group number (comes right after the full match)
    const prevPart = sessionParts[i - 1] ?? "";
    if (
      /^\d+$/.test(part) &&
      i > 0 &&
      /^\[SESSION_START:\d+\]$/.test(prevPart)
    ) {
      continue;
    }

    if (!part || !part.trim()) continue;

    // Parse user messages within this section
    const userMsgRegex = /\[USER_MESSAGE\]([\s\S]*?)\[\/USER_MESSAGE\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = userMsgRegex.exec(part)) !== null) {
      const aiContent = part.slice(lastIndex, match.index).trim();
      if (aiContent) {
        segments.push({
          type: "ai",
          content: aiContent,
          sessionNumber: currentSessionNumber,
        });
      }

      const userContent = (match[1] ?? "").trim();
      segments.push({
        type: "user",
        content: userContent,
        sessionNumber: currentSessionNumber,
      });

      lastIndex = match.index + match[0].length;
    }

    const remaining = part.slice(lastIndex).trim();
    if (remaining) {
      segments.push({
        type: "ai",
        content: remaining,
        sessionNumber: currentSessionNumber,
      });
    }
  }

  return segments;
}

// =============================================================================
// Sub-components
// =============================================================================

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="success" className="text-[10px]">
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-[10px]">
          Failed
        </Badge>
      );
    case "running":
      return (
        <Badge variant="info" className="text-[10px]">
          Running
        </Badge>
      );
    case "stopped":
      return (
        <Badge variant="secondary" className="text-[10px]">
          Stopped
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-[10px]">
          {status}
        </Badge>
      );
  }
}

function SessionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 h-px bg-border-subtle/50" />
      <span
        data-content-role="label"
        data-content-label="session divider"
        className="text-[10px] text-text-muted font-medium uppercase tracking-wider"
      >
        {label}
      </span>
      <div className="flex-1 h-px bg-border-subtle/50" />
    </div>
  );
}

function AiMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-start max-w-[85%]">
      <div className="rounded-lg px-4 py-3 bg-surface-raised/30 border border-border-subtle/30">
        <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg px-4 py-3 bg-brand-primary/10 border border-brand-primary/30">
        <p className="text-xs text-text-primary whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Run List Panel (Left)
// =============================================================================

function RunListPanel({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: TaskRun[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="w-[250px] shrink-0 border-r border-border-subtle/50 flex flex-col">
      <div className="px-4 py-3 border-b border-border-subtle/50">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
          Recent Runs
        </h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {runs.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-8 px-2">
              No active runs found.
            </p>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                  selectedRunId === run.id
                    ? "bg-brand-primary/10 border border-brand-primary/40"
                    : "hover:bg-surface-raised/50 border border-transparent"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    data-content-role="label"
                    data-content-label="run name"
                    className="text-xs font-medium text-text-primary truncate"
                  >
                    {run.task_name}
                  </span>
                  {getStatusBadge(run.status)}
                </div>
                {run.phase && (
                  <div className="mt-1">
                    <span
                      data-content-role="badge"
                      data-content-label="run phase"
                      className="text-[10px] text-text-muted"
                    >
                      {run.phase}
                    </span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// Conversation Panel (Right)
// =============================================================================

function ConversationPanel({ runId }: { runId: string }) {
  const {
    data: outputData,
    isLoading: outputLoading,
    refetch: refetchOutput,
  } = useTaskRunOutput(runId);

  // Poll for output updates
  useEffect(() => {
    const interval = setInterval(refetchOutput, 2000);
    return () => clearInterval(interval);
  }, [refetchOutput]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevOutputLenRef = useRef(0);

  const output = outputData?.output_log || "";
  const segments = useMemo(() => parseOutputLog(output), [output]);

  const sessionCount = useMemo(() => {
    const dividers = segments.filter((s) => s.type === "session-divider");
    return dividers.length || (output ? 1 : 0);
  }, [segments, output]);

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (autoScroll && output.length !== prevOutputLenRef.current) {
      prevOutputLenRef.current = output.length;
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }
  }, [output, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(nearBottom);
  }, []);

  if (outputLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <div className="flex items-center gap-2 text-sm">
          <div className="size-4 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
          Loading output...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Conversation header */}
      <div className="px-4 py-3 border-b border-border-subtle/50 flex items-center gap-2 shrink-0">
        <MessageSquare className="size-4 text-purple-400" />
        <span
          data-content-role="heading"
          data-content-label="conversation panel title"
          className="text-sm font-medium text-text-primary"
        >
          Conversation
        </span>
        {sessionCount > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {sessionCount} {sessionCount === 1 ? "session" : "sessions"}
          </Badge>
        )}
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
      >
        {segments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <MessageSquare className="size-10 mb-3 opacity-30" />
            <p className="text-sm">No output yet...</p>
            <p className="text-xs mt-1 text-text-muted/60">
              AI conversation output will appear here.
            </p>
          </div>
        ) : (
          segments.map((segment, i) => {
            switch (segment.type) {
              case "session-divider":
                return (
                  <SessionDivider
                    key={`divider-${i}`}
                    label={segment.content}
                  />
                );
              case "user":
                return (
                  <UserMessage key={`user-${i}`} content={segment.content} />
                );
              case "ai":
                return <AiMessage key={`ai-${i}`} content={segment.content} />;
              default:
                return null;
            }
          })
        )}
      </div>

      {/* Scroll to bottom button */}
      {!autoScroll && (
        <div className="px-4 pb-3 shrink-0">
          <button
            onClick={() => {
              setAutoScroll(true);
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="w-full px-3 py-1.5 rounded-lg bg-brand-primary/10 text-brand-primary text-xs hover:bg-brand-primary/20 transition-colors border border-brand-primary/20"
          >
            Scroll to bottom
          </button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Empty State
// =============================================================================

function EmptySelectionState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3">
        <Bot className="size-12 mx-auto text-text-muted/30" />
        <p className="text-sm text-text-muted">
          Select a run from the list to view its AI output.
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

export default function AiOutputPage() {
  const {
    data: activeRuns,
    isLoading: runsLoading,
    isOffline,
  } = useRunningTaskRuns();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runs = useMemo(() => activeRuns || [], [activeRuns]);

  // Auto-select first run if none selected
  useEffect(() => {
    if (!selectedRunId && runs.length > 0) {
      setSelectedRunId(runs[0]!.id);
    }
  }, [runs, selectedRunId]);

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white flex flex-col">
      {/* Page header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-3 px-6 py-3">
          <Bot className="size-5 text-purple-400" />
          <h1 className="text-lg font-bold text-text-primary">AI Output</h1>
          {runs.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {runs.length} active
            </Badge>
          )}
        </div>
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      {/* Main content: two-panel layout */}
      {runsLoading ? (
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="flex items-center gap-2 text-sm">
            <div className="size-5 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
            Loading runs...
          </div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* Left panel: run list */}
          <RunListPanel
            runs={runs}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
          />

          {/* Right panel: conversation */}
          {selectedRunId ? (
            <ConversationPanel runId={selectedRunId} />
          ) : (
            <EmptySelectionState />
          )}
        </div>
      )}
    </div>
  );
}
