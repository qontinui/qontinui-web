"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { runnerApi } from "@/lib/runner-api";
import type { TaskRunOutput, SessionState } from "@/lib/runner-api";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationSegment {
  type: "ai" | "user" | "session-divider";
  content: string;
  sessionNumber?: number;
}

// ---------------------------------------------------------------------------
// Output Parsing
// ---------------------------------------------------------------------------

function parseOutputLog(outputLog: string): ConversationSegment[] {
  if (!outputLog) return [];

  const segments: ConversationSegment[] = [];

  // Split the output by session markers while capturing the session numbers
  const sessionParts = outputLog.split(/(\[SESSION_START:(\d+)\])/);

  let currentSessionNumber = 1;
  let isFirstChunk = true;

  for (let i = 0; i < sessionParts.length; i++) {
    const part = sessionParts[i] ?? "";

    // Check if this is a session marker match
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

    // For the first chunk before any session marker
    if (isFirstChunk && segments.length === 0 && part.trim()) {
      isFirstChunk = false;
    }

    // Parse user messages within this section
    const userMsgRegex = /\[USER_MESSAGE\]([\s\S]*?)\[\/USER_MESSAGE\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = userMsgRegex.exec(part)) !== null) {
      // AI content before the user message
      const aiContent = part.slice(lastIndex, match.index).trim();
      if (aiContent) {
        segments.push({
          type: "ai",
          content: aiContent,
          sessionNumber: currentSessionNumber,
        });
      }

      // The user message itself
      const userContent = (match[1] ?? "").trim();
      segments.push({
        type: "user",
        content: userContent,
        sessionNumber: currentSessionNumber,
      });

      lastIndex = match.index + match[0].length;
    }

    // Remaining AI content after the last user message
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SessionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-border-subtle/50" />
      <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">
        {label}
      </span>
      <div className="flex-1 h-px bg-border-subtle/50" />
    </div>
  );
}

function AiMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-lg px-3 py-2 bg-surface-raised/30 border border-border-subtle/30">
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
      <div className="max-w-[85%] rounded-lg px-3 py-2 bg-brand-primary/10 border border-brand-primary/30">
        <p className="text-xs text-text-primary whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </p>
      </div>
    </div>
  );
}

function SessionStateIndicator({
  state,
  canSend,
}: {
  state: string;
  canSend: boolean;
}) {
  if (state === "waiting" || canSend) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="size-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-[10px] text-green-400">Ready</span>
      </div>
    );
  }
  if (state === "processing" || state === "running") {
    return (
      <div className="flex items-center gap-1.5">
        <div className="size-2 rounded-full bg-yellow-500 animate-pulse" />
        <span className="text-[10px] text-yellow-400">AI Processing</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="size-2 rounded-full bg-red-500" />
      <span className="text-[10px] text-red-400">Disconnected</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message Input
// ---------------------------------------------------------------------------

function MessageInput({
  runId,
  canSend,
  sessionState,
}: {
  runId: string;
  canSend: boolean;
  sessionState: string;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    setSending(true);
    try {
      await runnerApi.sendTaskRunMessage(runId, trimmed);
      setMessage("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  }, [message, runId, sending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 4 * 24; // ~4 rows
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  const isProcessing =
    sessionState === "processing" || sessionState === "running";

  return (
    <div className="border-t border-border-subtle/50 pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <SessionStateIndicator state={sessionState} canSend={canSend} />
        {isProcessing && !canSend && (
          <span className="text-[10px] text-text-muted italic">
            Message will be queued
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            canSend
              ? "Send a message to the AI..."
              : "Type a message (will be queued)..."
          }
          disabled={sending || sessionState === "disconnected"}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border-subtle/50 bg-surface-canvas/50 px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minHeight: "36px", maxHeight: "96px" }}
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={
            !message.trim() || sending || sessionState === "disconnected"
          }
          className="h-9 px-3 bg-brand-primary hover:bg-brand-primary/90 text-white shrink-0"
        >
          {sending ? (
            <RefreshCw className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Widget
// ---------------------------------------------------------------------------

export function AiConversationWidget({ runId }: { runId: string }) {
  const {
    data: outputData,
    isLoading: outputLoading,
  } = useEventTriggeredFetch<TaskRunOutput>(
    "ai-output",
    `/task-runs/${runId}/output`,
    {
      transform: (raw: unknown) => {
        const obj = raw as Record<string, unknown>;
        if (obj && typeof obj === "object") {
          return {
            id: obj.id as number,
            output_log: (obj.output_log as string) ?? (obj.output as string) ?? "",
          } as TaskRunOutput;
        }
        return raw as TaskRunOutput;
      },
    }
  );
  const { data: sessionStateData } = useEventTriggeredFetch<SessionState>(
    "orchestrator-state-change",
    `/task-runs/${runId}/session-state`
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevOutputLenRef = useRef(0);

  const output = outputData?.output_log || "";
  const segments = useMemo(() => parseOutputLog(output), [output]);

  const sessionCount = useMemo(() => {
    const dividers = segments.filter((s) => s.type === "session-divider");
    return dividers.length || (output ? 1 : 0);
  }, [segments, output]);

  const sessionState = sessionStateData?.state || "disconnected";
  const canSend = sessionStateData?.can_send ?? false;

  // Auto-scroll when new content arrives
  useEffect(() => {
    if (autoScroll && output.length !== prevOutputLenRef.current) {
      prevOutputLenRef.current = output.length;
      // Defer to let the DOM update
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
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="size-4 text-purple-400" />
            AI Conversation
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="size-4 text-purple-400" />
          AI Conversation
          {sessionCount > 0 && (
            <Badge variant="secondary" className="text-xs">
              {sessionCount} {sessionCount === 1 ? "session" : "sessions"}
            </Badge>
          )}
          <div className="ml-auto">
            <SessionStateIndicator state={sessionState} canSend={canSend} />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        {/* Conversation display */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1"
        >
          {segments.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-8">
              No output yet...
            </p>
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
                  return (
                    <AiMessage key={`ai-${i}`} content={segment.content} />
                  );
                default:
                  return null;
              }
            })
          )}

          {/* Scroll anchor */}
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                const el = scrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
              }}
              className="sticky bottom-0 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-primary/20 text-brand-primary text-[10px] hover:bg-brand-primary/30 transition-colors"
            >
              Scroll to bottom
            </button>
          )}
        </div>

        {/* Message input */}
        <MessageInput
          runId={runId}
          canSend={canSend}
          sessionState={sessionState}
        />
      </CardContent>
    </Card>
  );
}
