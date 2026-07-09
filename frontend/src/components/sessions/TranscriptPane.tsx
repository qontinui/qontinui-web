"use client";

/**
 * TranscriptPane — the twin session page's "Transcript" tab (Phase 2 of
 * plan `2026-07-09-runner-session-history-cloud-sync`).
 *
 * Fetches the session's AI-conversation transcript stream from coord via
 * the web-backend proxy (`GET /api/v1/operations/sessions/:id/output
 * ?stream=transcript`): warm tier first; when the warm tier is empty and
 * the session is closed, falls back to the cold-tier archive (a closed
 * session's warm rows are GC'd 7 days post-close — the cold object is
 * the durable copy). Chunks are base64 → UTF-8 decoded, concatenated
 * oldest→newest, and rendered as JSONL-aware monospace text: each line's
 * JSON is parsed for readable message content where possible, with a raw
 * fallback so nothing is silently dropped.
 *
 * Rendered content is capped (~2 MB, tail kept) with a truncation notice.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSessionOutput, SessionsApiError } from "./api";
import type { OutputChunk } from "./types";
import {
  capTail,
  decodeBase64Bytes,
  parseTranscriptText,
  type TranscriptLine,
} from "./output-text";

interface TranscriptPaneProps {
  /** Coord session id (the twin card's session key). */
  sessionId: string;
  /** True when the session's derived status is `closed`. */
  sessionClosed: boolean;
}

type PaneState =
  | { phase: "loading" }
  | { phase: "unauthorized" }
  | { phase: "not-found" }
  | { phase: "error"; message: string }
  | { phase: "empty" }
  | {
      phase: "ready";
      lines: TranscriptLine[];
      tier: string;
      truncated: boolean;
    };

/** Decode + concatenate chunks (oldest→newest) into one UTF-8 string. */
function chunksToText(chunks: OutputChunk[]): string {
  const ordered = [...chunks].sort((a, b) => a.chunk_offset - b.chunk_offset);
  const buffers = ordered.map((c) => decodeBase64Bytes(c.payload_b64));
  const total = buffers.reduce((n, b) => n + b.length, 0);
  const merged = new Uint8Array(total);
  let at = 0;
  for (const b of buffers) {
    merged.set(b, at);
    at += b.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export function TranscriptPane({
  sessionId,
  sessionClosed,
}: TranscriptPaneProps) {
  const [state, setState] = useState<PaneState>({ phase: "loading" });

  const load = useCallback(
    async (signal: AbortSignal) => {
      setState({ phase: "loading" });
      try {
        let tier = "warm";
        let history = await getSessionOutput(sessionId, {
          tier: "warm",
          stream: "transcript",
          signal,
        });
        if (history.chunks.length === 0 && sessionClosed) {
          // Closed session with an empty warm tier — the transcript (if
          // any) lives in the cold archive. A cold-tier miss or a coord
          // without the cold tier configured still lands on "empty".
          try {
            history = await getSessionOutput(sessionId, {
              tier: "cold",
              stream: "transcript",
              signal,
            });
            tier = "cold";
          } catch {
            // Cold tier unavailable (503 when not configured, or any
            // transient error) — fall through to the honest empty state;
            // the warm read already succeeded with zero chunks.
          }
        }
        if (signal.aborted) return;
        if (history.chunks.length === 0) {
          setState({ phase: "empty" });
          return;
        }
        const { text, truncated } = capTail(chunksToText(history.chunks));
        setState({
          phase: "ready",
          lines: parseTranscriptText(text),
          tier,
          truncated,
        });
      } catch (err) {
        if (
          signal.aborted ||
          (err as { name?: string })?.name === "AbortError"
        ) {
          return;
        }
        if (err instanceof SessionsApiError) {
          if (err.status === 401 || err.status === 403) {
            setState({ phase: "unauthorized" });
            return;
          }
          if (err.status === 404) {
            setState({ phase: "not-found" });
            return;
          }
        }
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [sessionId, sessionClosed]
  );

  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, reloadNonce]);

  const notice = (icon: ReactNode, text: ReactNode) => (
    <div
      className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground"
      data-testid="twin-session-transcript-notice"
    >
      <span className="inline-flex items-center gap-1.5">
        {icon}
        {text}
      </span>
    </div>
  );

  return (
    <div className="space-y-2" data-testid="twin-session-transcript">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ScrollText className="size-3.5" />
        <span>AI conversation transcript</span>
        {state.phase === "ready" && (
          <>
            <Badge variant="outline">{state.tier} tier</Badge>
            <span>{state.lines.length} lines</span>
          </>
        )}
      </div>

      {state.phase === "loading" && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {state.phase === "unauthorized" &&
        notice(
          <AlertTriangle className="size-3.5" />,
          "You are not authorized to view this session's transcript."
        )}

      {state.phase === "not-found" &&
        notice(
          <AlertTriangle className="size-3.5" />,
          "This session is unknown to the coordination layer."
        )}

      {state.phase === "empty" &&
        notice(
          <ScrollText className="size-3.5" />,
          "No transcript synced for this session — cloud sync may be off on the runner."
        )}

      {state.phase === "error" && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          <p className="inline-flex items-center gap-1.5">
            <AlertTriangle className="size-3.5" />
            Couldn&apos;t load the transcript.
          </p>
          <p className="mt-1 break-all">{state.message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setReloadNonce((n) => n + 1)}
          >
            <RefreshCw className="size-4" />
            Retry
          </Button>
        </div>
      )}

      {state.phase === "ready" && (
        <>
          {state.truncated && (
            <p className="text-[11px] text-muted-foreground">
              Transcript truncated — showing the most recent ~2 MB.
            </p>
          )}
          <div
            className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted/30 p-3"
            data-testid="twin-session-transcript-body"
          >
            <ol className="space-y-1.5">
              {state.lines.map((line, idx) => (
                <li key={idx} className="text-xs">
                  {line.kind && (
                    <span className="mr-2 select-none text-[10px] uppercase tracking-wide text-muted-foreground">
                      {line.kind}
                    </span>
                  )}
                  <span
                    className={
                      line.raw
                        ? "font-mono whitespace-pre-wrap break-words text-muted-foreground"
                        : "font-mono whitespace-pre-wrap break-words"
                    }
                  >
                    {line.text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
