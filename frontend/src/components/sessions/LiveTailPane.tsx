"use client";

/**
 * LiveTailPane — the twin session page's "Live tail" tab (Phase 6 of
 * plan `2026-07-09-runner-session-history-cloud-sync`).
 *
 * A read-only terminal-style pane: replays the warm-tier scrollback for
 * the selected output stream (`pty` by default, toggleable to
 * `transcript`), then follows the session's SSE events stream
 * (`GET /api/v1/operations/sessions/:id/events`), appending live
 * `output_chunk` frames whose `stream` matches the selection. De-dupe
 * between the warm bootstrap and the live tail is keyed on
 * `chunk_offset` (offsets are allocated per-stream by the runner).
 *
 * Deliberately a plain `<pre>` scrollback rather than the operations
 * panel's xterm `OutputPane`: this pane must follow the app's light/dark
 * theme (xterm needs a hardcoded color theme), and the transcript toggle
 * renders JSONL text, not terminal bytes. ANSI escapes are stripped via
 * the shared `output-text` util. Scrollback is capped (~2 MB, tail kept)
 * with a truncation notice, and auto-scrolls while the reader is at the
 * bottom.
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Radio, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getSessionOutput,
  SessionsApiError,
  subscribeSessionOutput,
} from "./api";
import { chunkStream, type OutputChunkFrame, type OutputStream } from "./types";
import { capTail, decodeBase64Bytes, stripAnsi } from "./output-text";

interface LiveTailPaneProps {
  /** Coord session id (the twin card's session key). */
  sessionId: string;
  /** True when the session's derived status is `closed`. */
  sessionClosed: boolean;
}

/** Warm-tier bootstrap fetch cap — matches coord's read default. */
const WARM_LIMIT = 4096;

/** Pixels from the bottom within which auto-scroll stays engaged. */
const STICKY_THRESHOLD_PX = 48;

type TailStatus =
  | "loading"
  | "tailing"
  | "ended"
  | "unauthorized"
  | "not-found"
  | "unavailable";

export function LiveTailPane({ sessionId, sessionClosed }: LiveTailPaneProps) {
  const [stream, setStream] = useState<OutputStream>("pty");
  const [status, setStatus] = useState<TailStatus>("loading");
  const [text, setText] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [corruptChunks, setCorruptChunks] = useState(0);

  const scrollRef = useRef<HTMLPreElement | null>(null);
  // Auto-scroll stays engaged while the reader is at (or near) the
  // bottom; scrolling up detaches it so history can be read in peace.
  const stickyRef = useRef(true);

  // Bootstrap (warm history) + live tail (SSE output_chunk frames),
  // restarted whenever the session or the selected stream changes.
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    setStatus("loading");
    setText("");
    setTruncated(false);
    setCorruptChunks(0);
    stickyRef.current = true;

    const seenOffsets = new Set<number>();
    // Streaming UTF-8 decoder so a multi-byte character split across
    // two chunks decodes correctly. The decoder carries mid-sequence
    // state, so bytes MUST flow through it in chunk order: all bootstrap
    // chunks first, then live chunks (buffered until bootstrap settles).
    const decoder = new TextDecoder("utf-8", { fatal: false });

    const appendBytes = (bytes: Uint8Array) => {
      const piece = stripAnsi(decoder.decode(bytes, { stream: true }));
      if (!piece) return;
      setText((prev) => {
        const capped = capTail(prev + piece);
        if (capped.truncated) setTruncated(true);
        return capped.text;
      });
    };

    // Malformed base64 is non-fatal: skip the chunk, count it, and let
    // the pane surface a "corrupt chunks skipped" notice.
    const decodeChunkPayload = (payloadB64: string): Uint8Array | null => {
      try {
        return decodeBase64Bytes(payloadB64);
      } catch {
        setCorruptChunks((n) => n + 1);
        return null;
      }
    };

    // Live chunks that arrive while the warm bootstrap is in flight are
    // buffered here and flushed (in chunk_offset order) once the
    // bootstrap settles, so the shared streaming decoder never sees the
    // two phases interleaved out of order.
    let bootstrapSettled = false;
    const pendingLive: OutputChunkFrame[] = [];

    const processLiveChunk = (chunk: OutputChunkFrame) => {
      if (seenOffsets.has(chunk.chunk_offset)) return;
      seenOffsets.add(chunk.chunk_offset);
      const bytes = decodeChunkPayload(chunk.payload_b64);
      if (bytes) appendBytes(bytes);
      setStatus((s) =>
        s === "loading" || s === "unavailable" ? "tailing" : s
      );
    };

    const settleBootstrap = () => {
      if (bootstrapSettled || cancelled) return;
      bootstrapSettled = true;
      const buffered = pendingLive
        .splice(0, pendingLive.length)
        .sort((a, b) => a.chunk_offset - b.chunk_offset);
      for (const chunk of buffered) {
        processLiveChunk(chunk);
      }
    };

    // 1. Bootstrap from the warm history. Subscribe to the live tail
    //    regardless of the fetch outcome so a session that only just
    //    started streaming (empty warm tier) still tails.
    void (async () => {
      try {
        const history = await getSessionOutput(sessionId, {
          tier: "warm",
          stream,
          limit: WARM_LIMIT,
          signal: ctrl.signal,
        });
        if (cancelled) return;
        const ordered = [...history.chunks].sort(
          (a, b) => a.chunk_offset - b.chunk_offset
        );
        for (const chunk of ordered) {
          if (seenOffsets.has(chunk.chunk_offset)) continue;
          seenOffsets.add(chunk.chunk_offset);
          const bytes = decodeChunkPayload(chunk.payload_b64);
          if (bytes) appendBytes(bytes);
        }
        setStatus((s) => (s === "loading" ? "tailing" : s));
      } catch (err) {
        if (cancelled || (err as { name?: string })?.name === "AbortError") {
          return;
        }
        if (err instanceof SessionsApiError) {
          if (err.status === 401 || err.status === 403) {
            setStatus("unauthorized");
            return;
          }
          if (err.status === 404) {
            setStatus("not-found");
            return;
          }
        }
        // History unavailable (older coord, transient error) — keep
        // live-tailing; a live chunk promotes the status back.
        setStatus("unavailable");
      } finally {
        // Whatever the bootstrap outcome, release the buffered live
        // chunks (offset-ordered) through the decoder and go live.
        settleBootstrap();
      }
    })();

    // 2. Live tail — same SSE endpoint the operations panel consumes;
    //    frames for the other stream are ignored (chunks without a
    //    `stream` field predate the discriminator and are PTY output).
    const unsubscribe = subscribeSessionOutput(sessionId, {
      onChunk: (chunk) => {
        if (cancelled) return;
        if (chunkStream(chunk) !== stream) return;
        if (!bootstrapSettled) {
          pendingLive.push(chunk);
          return;
        }
        processLiveChunk(chunk);
      },
      onError: (err) => {
        if (cancelled) return;
        if (err instanceof SessionsApiError) {
          if (err.status === 401 || err.status === 403) {
            setStatus("unauthorized");
            return;
          }
          if (err.status === 404) {
            setStatus("not-found");
            return;
          }
        }
        setStatus((s) =>
          s === "unauthorized" || s === "not-found" ? s : "unavailable"
        );
      },
      onClose: () => {
        if (cancelled) return;
        setStatus((s) =>
          s === "unauthorized" || s === "not-found" ? s : "ended"
        );
      },
    });

    return () => {
      cancelled = true;
      ctrl.abort();
      unsubscribe();
    };
  }, [sessionId, stream]);

  // Auto-scroll to the bottom on new content while sticky.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickyRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickyRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_THRESHOLD_PX;
  };

  const streamToggle = (value: OutputStream, label: string) => (
    <Button
      variant={stream === value ? "secondary" : "ghost"}
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => setStream(value)}
      aria-pressed={stream === value}
    >
      {label}
    </Button>
  );

  return (
    <div className="space-y-2" data-testid="twin-session-live-tail">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <TerminalSquare className="size-3.5" />
        <span>Live tail</span>
        <Badge variant="outline">read-only</Badge>
        {status === "loading" && (
          <Badge variant="outline">
            <Loader2 className="size-3 animate-spin" />
            loading
          </Badge>
        )}
        {status === "tailing" && (
          <Badge variant="success">
            <Radio className="size-3" />
            tailing
          </Badge>
        )}
        {status === "ended" && <Badge variant="secondary">stream ended</Badge>}
        {status === "unavailable" && (
          <Badge variant="warning">
            <AlertTriangle className="size-3" />
            history unavailable
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {streamToggle("pty", "Terminal")}
          {streamToggle("transcript", "Transcript")}
        </div>
      </div>

      {status === "unauthorized" ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          You are not authorized to view this session&apos;s output.
        </div>
      ) : status === "not-found" ? (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          This session is unknown to the coordination layer.
        </div>
      ) : (
        <>
          {truncated && (
            <p className="text-[11px] text-muted-foreground">
              Scrollback truncated — showing the most recent ~2 MB.
            </p>
          )}
          {corruptChunks > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {corruptChunks} corrupt chunk{corruptChunks === 1 ? "" : "s"}{" "}
              skipped.
            </p>
          )}
          <pre
            ref={scrollRef}
            onScroll={onScroll}
            className="h-[360px] overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-words"
            data-testid="twin-session-live-tail-body"
          >
            {text ||
              (status === "ended"
                ? "No output was streamed on this stream."
                : "No output yet — live chunks will appear here as the session emits them.")}
          </pre>
          {status === "ended" && (
            <p className="text-[11px] text-muted-foreground">
              {sessionClosed
                ? "Closed session — stream ended."
                : "Stream ended — the event stream closed."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
