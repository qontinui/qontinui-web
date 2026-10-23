"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  MessageSquare,
  Send,
  Loader2,
  WifiOff,
  Bot,
  User,
} from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { OperatorOnly } from "@/components/presentation";
import { useDispatchTarget } from "@/contexts/active-runner-context";
import { useChatWebSocket } from "@/hooks/useChatWebSocket";

/**
 * "Ask the Twin" — a prompt box that routes a custom question to the user's
 * CONNECTED AI over the chat relay: the runner starts a fresh Claude Code
 * session for it (qontinui-runner `backend_relay.rs` `handle_chat_create`).
 * The runner provisions coord's digital-twin MCP tools (coord_query_* /
 * coord_is_*) into that session FAIL-OPEN — with no device credential the
 * session still answers, just without them — and nothing on the wire says
 * which happened. So this component never claims the answer came from the
 * twin; the copy says when it can.
 *
 * Phase 2 scope: single ephemeral session, single-slot question queue. We seed
 * the first message with a twin-oriented preamble so the agent grounds its
 * answer in the twin tools and reports credibility — and, since this page
 * cannot see whether the session got those tools, so the answer itself says
 * when it did not.
 */

const TWIN_PREAMBLE =
  "You are answering using Qontinui's digital twin. Ground your answer in live " +
  "observed state by calling the coordination layer's digital-twin query tools " +
  "(coord_query_* / coord_is_*), and state the coverage / credibility / staleness " +
  "of what you report so the reader knows how much to trust it. If those tools " +
  "are not available in this session, say so plainly at the start of your " +
  "answer and do not present anything as observed state. Question: ";

/**
 * The line under a busy Ask button, saying only what this page knows.
 *
 * Only the runner's `processing` state says its agent is working. Streamed
 * text says output arrived, not that more is coming, and nothing tells this
 * page when an answer finishes. The backend relay forwards the runner's
 * `chat_session_state` frames (`devices_ws.py` `_route_device_message`), but
 * the runner sends one only in reply to a request — a load, an interrupt, a
 * close — and this component makes none. The runner's `session-state`
 * broadcast, which would announce `ready` after an answer, has no producer.
 */
function busyHint(
  sessionGone: boolean,
  processing: boolean,
  streaming: boolean
): string {
  // A session that can no longer answer is not working on anything: only a
  // queued question can keep the page busy then, and it waits on the socket.
  if (sessionGone) return "Connecting to your runner…";
  if (processing) return "Your runner’s agent is working on an answer…";
  if (streaming) {
    return "Receiving your runner’s answer — this page has not been told whether it is finished.";
  }
  return "Connecting to your runner…";
}

interface AskTheTwinProps {
  /**
   * A question handed over from elsewhere on the page (the sub-space drawer's
   * "Ask the Twin about this"). It is typed into the box, NOT asked: the
   * operator reviews and submits it. `onDraftApplied` fires once it is in.
   */
  draft?: string | null;
  onDraftApplied?: () => void;
}

/**
 * What presentation mode shows in Ask the Twin's place: what the panel is
 * for, and nothing an outsider could press or read from a conversation.
 */
function AskTheTwinPresented() {
  return (
    <section
      data-testid="ask-the-twin-presented"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" /> Ask the Twin
      </h2>
      <p className="text-sm text-muted-foreground">
        An operator can ask the twin a question here and an agent session
        answers it from the same readings; questions and answers are not shown
        in presentation mode.
      </p>
    </section>
  );
}

/**
 * Ask the Twin, inside the presentation lens's write boundary (plan
 * `2026-10-23-console-presentation-spaces` D3.2): asking starts an AI session
 * on a runner, so the whole panel — its input, its Ask button, its chat
 * socket and any conversation — is `OperatorOnly`, unmounted in presentation
 * mode rather than hidden.
 */
export function AskTheTwin(props: AskTheTwinProps = {}) {
  return (
    <OperatorOnly placeholder={<AskTheTwinPresented />}>
      <AskTheTwinPanel {...props} />
    </OperatorOnly>
  );
}

function AskTheTwinPanel({ draft, onDraftApplied }: AskTheTwinProps) {
  // Asking starts a NEW AI session, so it goes only where new work may go:
  // the user's explicit choice or coord's resolved pick — never a read
  // fallback. Otherwise coord's outcome is shown.
  const dispatchTarget = useDispatchTarget();
  const runnerId = dispatchTarget.runnerId;

  const [input, setInput] = useState("");
  const [queued, setQueued] = useState<string | null>(null);
  const hasSessionRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Set when a handed-over draft is typed in; the effect after that commit
  // focuses the box if it is mounted, and either way clears it — so focus
  // never jumps here later (e.g. when a runner connects minutes after).
  const [focusDraft, setFocusDraft] = useState(false);
  // Read through a ref so a parent passing a fresh callback each render does
  // not re-run the effect and retype the draft over the operator's edits.
  const onDraftAppliedRef = useRef(onDraftApplied);
  onDraftAppliedRef.current = onDraftApplied;

  useEffect(() => {
    if (!draft) return;
    setInput(draft);
    setFocusDraft(true);
    onDraftAppliedRef.current?.();
  }, [draft]);
  const sentCountRef = useRef(0);

  const {
    isConnected,
    sessionState,
    sessionError,
    messages,
    streamingContent,
    createSession,
    sendMessage,
  } = useChatWebSocket({
    runnerId,
    onSessionCreated: useCallback(() => {
      hasSessionRef.current = true;
    }, []),
  });

  // The latest question failed: the runner refused the session, the session
  // entered its error state, or the request was not delivered or accepted.
  // Each of these used to be dropped, leaving the question with no answer.
  const failed = sessionState === "error" || !!sessionError;
  // No answer can come from the current session any more — it failed, was
  // closed, or the runner no longer knows it. A question asked now must start
  // a fresh session: the follow-up path waits for `ready`, which none of these
  // states can reach, so routing it there hung on "Connecting to your runner…"
  // forever.
  const sessionGone =
    failed || sessionState === "closed" || sessionState === "not_found";

  // When a runner drops, forget the session so a reconnect starts cleanly.
  useEffect(() => {
    if (runnerId === null) {
      hasSessionRef.current = false;
      sentCountRef.current = 0;
    }
  }, [runnerId]);

  // Forget a session that can no longer answer (declared before the delivery
  // effect below, so it runs first in any commit that changes both).
  useEffect(() => {
    if (sessionGone) hasSessionRef.current = false;
  }, [sessionGone]);

  // State machine to deliver a queued question: create a session when connected,
  // then flush the question once the session is ready. Re-runs as connection /
  // session state advances.
  useEffect(() => {
    if (!queued) return;
    // First question → ONE-SHOT: the twin-primed question IS the session's
    // initial prompt, so the session's first turn is the answer. This avoids the
    // fragile "create, then wait for `ready`, then sendMessage" handshake — the
    // runner's chat session auto-responds to its first turn, and the terminal
    // `ready` that the old flow waited on to send the real question was never
    // reliably observed (the question stayed queued → busy stuck forever).
    // The same path serves a question asked after the session became unable
    // to answer (`sessionGone`): it starts a fresh session.
    if (
      !hasSessionRef.current &&
      isConnected &&
      (sessionState === "disconnected" || sessionGone)
    ) {
      createSession("Digital Twin question", TWIN_PREAMBLE + queued, queued);
      sentCountRef.current += 1;
      setQueued(null);
      return;
    }
    // Follow-up question in an already-created session.
    if (hasSessionRef.current && sessionState === "ready") {
      sendMessage(queued);
      sentCountRef.current += 1;
      setQueued(null);
    }
  }, [
    queued,
    isConnected,
    sessionState,
    sessionGone,
    createSession,
    sendMessage,
  ]);

  // Busy from submit until the answer finishes: `queued` (awaiting send),
  // `processing` (session generating), or a live stream in flight. Not keyed
  // on `queued` alone — the one-shot clears it immediately after
  // createSession, so the stream/processing signals carry the rest. A session
  // that can no longer answer ends the wait: nothing more is coming from it.
  // (A failed session's partial output stays in `streamingContent` — the hook
  // flushes it only on `ready` / `closed` — so without that guard the Ask
  // button stayed disabled under "Asking again starts a fresh session.")
  const processing = !sessionGone && sessionState === "processing";
  const busy = !!queued || processing || (!sessionGone && !!streamingContent);

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
  const setTextarea = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      inputRef(el);
    },
    [inputRef]
  );

  useEffect(() => {
    if (!focusDraft) return;
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: "center" });
    }
    setFocusDraft(false);
  }, [focusDraft]);
  const { ref: submitRef } = useUIElement({
    id: "ask-the-twin-submit",
    label: "Ask the Twin — submit question",
    type: "button",
  });

  if (runnerId === null) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4" /> Ask the Twin
        </h2>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <WifiOff className="size-4" /> No runner can take a new question right
          now.
        </p>
        {/* Whatever is in the box — typed, or handed over by the drawer — is
            kept and shown while no runner can take it (for as long as this
            tab stays mounted), so a handed-over question is not lost unseen. */}
        {input.trim() && (
          <p
            data-testid="ask-the-twin-kept-question"
            className="mt-1 text-xs text-muted-foreground"
          >
            Your question is kept for when one can: “{input.trim()}”
          </p>
        )}
        {dispatchTarget.message && (
          <p
            data-testid="ask-the-twin-outcome"
            className="mt-1 text-xs text-muted-foreground"
          >
            {dispatchTarget.message}
          </p>
        )}
      </section>
    );
  }

  const conversation = messages.filter(
    (m) => m.role === "user" || m.role === "ai"
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="size-4" /> Ask the Twin
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Ask your connected runner about the digital twin — e.g. “Is coord’s
        deployed commit live?” or “Which observers are blind right now?”
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
                {/* A pulsing caret says "more is coming" — shown only while
                    the runner says its agent is working, never merely
                    because text arrived (see `busyHint`). */}
                {processing && (
                  <span
                    aria-hidden="true"
                    data-testid="ask-the-twin-caret"
                    className="ml-0.5 inline-block animate-pulse"
                  >
                    ▍
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {failed && (
        // `role="alert"`: this replaces an answer that will never arrive, and
        // appears asynchronously — without it a screen reader gets no signal.
        <div
          role="alert"
          data-testid="ask-the-twin-error"
          className="mb-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500"
          />
          <div className="min-w-0 space-y-1">
            <p className="font-medium">The question could not be answered.</p>
            <p className="break-words text-muted-foreground">
              {sessionError ??
                "The runner reported the session failed and gave no reason."}
            </p>
            <p className="text-xs text-muted-foreground">
              Asking again starts a fresh session.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={setTextarea}
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
        <Button
          ref={submitRef}
          onClick={handleSubmit}
          disabled={busy || !input.trim()}
          className="gap-1.5"
        >
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
          {busyHint(sessionGone, processing, !!streamingContent)}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Answers come from a fresh Claude Code session on your runner. It uses
        the twin’s tools only if the runner could provision them for that
        session, and this page cannot see whether it did.
      </p>
    </section>
  );
}
