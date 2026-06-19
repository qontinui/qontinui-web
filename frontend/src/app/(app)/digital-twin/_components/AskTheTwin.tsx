"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader2, WifiOff, Bot, User } from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useChatWebSocket } from "@/hooks/useChatWebSocket";

/**
 * "Ask the Twin" — a prompt box that routes a custom question to the user's
 * CONNECTED AI (the paired runner's Claude session) over the chat relay. The
 * runner agent has coord's digital-twin MCP tools (coord_query_* / coord_is_*),
 * so it answers from the SAME live observed state the matrix surfaces — goal #2
 * (the human gets exactly what an agent would get), made interactive.
 *
 * Phase 2 scope: single ephemeral session, single-slot question queue. We seed
 * the first message with a twin-oriented preamble so the agent grounds its
 * answer in the twin tools and reports credibility.
 */

const TWIN_PREAMBLE =
  "You are answering using Qontinui's digital twin. Ground your answer in live " +
  "observed state by calling the coordination layer's digital-twin query tools " +
  "(coord_query_* / coord_is_*), and state the coverage / credibility / staleness " +
  "of what you report so the reader knows how much to trust it. Question: ";

export function AskTheTwin() {
  const { runners } = useRealtimeConnections();
  const activeRunner = runners[0] ?? null;

  const [input, setInput] = useState("");
  const [queued, setQueued] = useState<string | null>(null);
  const hasSessionRef = useRef(false);
  const sentCountRef = useRef(0);

  const { isConnected, sessionState, messages, streamingContent, createSession, sendMessage } =
    useChatWebSocket({
      runnerId: activeRunner?.id ?? null,
      onSessionCreated: useCallback(() => {
        hasSessionRef.current = true;
      }, []),
    });

  // When a runner drops, forget the session so a reconnect starts cleanly.
  useEffect(() => {
    if (!activeRunner) {
      hasSessionRef.current = false;
      sentCountRef.current = 0;
    }
  }, [activeRunner]);

  // State machine to deliver a queued question: create a session when connected,
  // then flush the question once the session is ready. Re-runs as connection /
  // session state advances.
  useEffect(() => {
    if (!queued) return;
    if (!hasSessionRef.current && isConnected && sessionState === "disconnected") {
      createSession("Digital Twin question");
      return;
    }
    if (sessionState === "ready") {
      const isFirst = sentCountRef.current === 0;
      sendMessage(isFirst ? TWIN_PREAMBLE + queued : queued);
      sentCountRef.current += 1;
      setQueued(null);
    }
  }, [queued, isConnected, sessionState, createSession, sendMessage]);

  const busy = sessionState === "processing" || !!queued;

  const handleSubmit = useCallback(() => {
    const q = input.trim();
    if (!q || busy) return;
    setQueued(q);
    setInput("");
  }, [input, busy]);

  // UI Bridge: stable ids so automation can type a question + submit it.
  const { ref: inputRef } = useUIElement({
    id: "ask-the-twin-input",
    label: "Digital Twin question input",
    type: "input",
  });
  const { ref: submitRef } = useUIElement({
    id: "ask-the-twin-submit",
    label: "Ask the Twin — submit question",
    type: "button",
  });

  if (!activeRunner) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4" /> Ask the Twin
        </h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOff className="size-4" /> Connect a runner to ask your AI a
          question about the digital twin.
        </p>
      </section>
    );
  }

  const conversation = messages.filter((m) => m.role === "user" || m.role === "ai");

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" /> Ask the Twin
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Your connected runner answers using the same digital-twin tools an AI
        agent uses — e.g. “Is coord’s deployed commit live?” or “Which observers
        are blind right now?”
      </p>

      {(conversation.length > 0 || streamingContent) && (
        <div className="mb-3 max-h-80 space-y-3 overflow-y-auto rounded-md border border-border bg-muted/30 p-3">
          {conversation.map((m, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                {m.role === "user" ? (
                  <User className="size-4" />
                ) : (
                  <Bot className="size-4" />
                )}
              </span>
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
            </div>
          ))}
          {streamingContent && (
            <div className="flex gap-2 text-sm">
              <span className="mt-0.5 shrink-0 text-muted-foreground">
                <Bot className="size-4" />
              </span>
              <div className="whitespace-pre-wrap break-words">
                {streamingContent}
                <span className="ml-0.5 inline-block animate-pulse">▍</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          rows={2}
          placeholder="Ask a question about the digital twin…"
          className="min-h-[2.5rem] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button ref={submitRef} onClick={handleSubmit} disabled={busy || !input.trim()} className="gap-1.5">
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Ask
        </Button>
      </div>
      {busy && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {sessionState === "processing"
            ? "The agent is querying the twin…"
            : "Connecting to your runner…"}
        </p>
      )}
    </section>
  );
}
