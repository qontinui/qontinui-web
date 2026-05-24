"use client";

/**
 * OutputPane — Phase 8 of
 * `2026-05-23-coord-native-sessions-phase-7-10.md`.
 *
 * A read-only xterm.js terminal that tails a session's PTY output from
 * the dashboard. Bootstrap → live-tail flow:
 *
 *   1. Fetch the warm-tier history (`GET /sessions/:id/output?tier=warm`),
 *      decode each chunk's base64 → raw bytes, and write them to the
 *      terminal oldest→newest. Record each `chunk_offset` in a seen-set.
 *   2. Subscribe to the session's `output_chunk` SSE frames (the existing
 *      `/sessions/:id/events` stream carries them as `event: live`), and
 *      append any chunk whose `chunk_offset` isn't already in the seen-set.
 *
 * De-dupe is keyed on `chunk_offset` (the runner-side monotonic byte
 * counter per session), so a chunk present in BOTH the bootstrap window
 * and the live tail is written exactly once. The terminal is append-only;
 * the rare out-of-order live frame is written in arrival order (the warm
 * tier already established the ordered baseline — see the note in
 * `appendChunk`).
 *
 * The pane is strictly read-only: stdin is disabled and no key handler is
 * wired. It renders only for sessions whose intent set `share_output`;
 * otherwise it shows an "output not shared" state.
 *
 * Gated on coord serving the Phase 8 output endpoints (PR #130). Until
 * those deploy, the history fetch errors and the pane surfaces an
 * "output unavailable" notice while still live-tailing (which is a no-op
 * until coord publishes output frames).
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSessionOutput, subscribeSessionOutput } from "./api";
import type { OutputChunk, SessionRow, SessionIntent } from "./types";

interface OutputPaneProps {
  session: SessionRow;
}

/** xterm bootstrap warm-tier fetch cap — matches coord's read default. */
const WARM_LIMIT = 4096;

/** Decode a base64 string to raw bytes for `Terminal.write`. */
function decodeChunk(payloadB64: string): Uint8Array {
  const binary = atob(payloadB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function intentOf(intent: SessionRow["intent"]): SessionIntent {
  if (intent && typeof intent === "object") {
    return intent as SessionIntent;
  }
  return { purpose: "" };
}

type PaneStatus = "loading" | "live" | "unavailable" | "stream-error";

export function OutputPane({ session }: OutputPaneProps) {
  const intent = intentOf(session.intent);
  const shareOutput = intent.share_output === true;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // De-dupe set of chunk_offsets already written to the terminal. Shared
  // between the bootstrap fetch and the live tail so a chunk in both is
  // written once. Held in a ref so the live-tail callback always sees the
  // latest set without re-subscribing.
  const seenOffsetsRef = useRef<Set<number>>(new Set());

  const [status, setStatus] = useState<PaneStatus>("loading");
  const [chunkCount, setChunkCount] = useState(0);

  // Mount xterm + fit addon once per session. The terminal is read-only:
  // stdin disabled, no key handler, no cursor blink.
  useEffect(() => {
    if (!shareOutput) return;
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "underline",
      scrollback: 10_000,
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#d4d4d4",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      fit.fit();
    } catch {
      // fit can throw if the container has no layout yet; the
      // ResizeObserver below re-fits once it does.
    }
    termRef.current = term;
    fitRef.current = fit;

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore transient layout-less fit failures
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      seenOffsetsRef.current = new Set();
    };
  }, [shareOutput, session.id]);

  // Bootstrap (warm history) + live tail (SSE output_chunk frames).
  useEffect(() => {
    if (!shareOutput) return;

    let cancelled = false;
    const ctrl = new AbortController();

    // appendChunk: write a chunk to the terminal iff its offset is new.
    // The terminal is append-only, so an out-of-order live frame is
    // written in arrival order. In practice the warm fetch establishes
    // the ordered baseline and live frames arrive monotonically (the
    // runner emits in byte order); strict reordering would need a
    // gap-buffer, deferred as a refinement.
    const appendChunk = (chunk: OutputChunk): boolean => {
      const term = termRef.current;
      if (!term) return false;
      if (seenOffsetsRef.current.has(chunk.chunk_offset)) return false;
      seenOffsetsRef.current.add(chunk.chunk_offset);
      term.write(decodeChunk(chunk.payload_b64));
      return true;
    };

    // 1. Bootstrap from warm history. Subscribe to the live tail
    //    regardless of the fetch outcome so a session that only just
    //    started sharing (empty warm tier) still streams.
    let writtenFromHistory = 0;
    void (async () => {
      try {
        const history = await getSessionOutput(session.id, {
          tier: "warm",
          limit: WARM_LIMIT,
          signal: ctrl.signal,
        });
        if (cancelled) return;
        // Coord returns chunks oldest→newest; write in order. Defensive
        // sort in case a tier ever returns unordered.
        const ordered = [...history.chunks].sort(
          (a, b) => a.chunk_offset - b.chunk_offset
        );
        for (const chunk of ordered) {
          if (appendChunk(chunk)) writtenFromHistory += 1;
        }
        setChunkCount((c) => c + writtenFromHistory);
        setStatus("live");
      } catch (err) {
        if (cancelled || (err as { name?: string })?.name === "AbortError") {
          return;
        }
        // Coord may not yet serve the Phase 8 output endpoints (PR #130
        // not deployed) — surface "unavailable" but keep live-tailing.
        setStatus("unavailable");
      }
    })();

    // 2. Live tail. De-dupes against the same seen-set as the bootstrap.
    const unsubscribe = subscribeSessionOutput(session.id, {
      onChunk: (chunk) => {
        if (cancelled) return;
        if (appendChunk(chunk)) {
          setChunkCount((c) => c + 1);
          // First live chunk after an "unavailable" bootstrap means coord
          // IS publishing — promote the status.
          setStatus((s) => (s === "unavailable" ? "live" : s));
        }
      },
      onError: () => {
        if (cancelled) return;
        setStatus((s) => (s === "live" ? "stream-error" : s));
      },
    });

    return () => {
      cancelled = true;
      ctrl.abort();
      unsubscribe();
    };
  }, [shareOutput, session.id]);

  if (!shareOutput) {
    return (
      <Card data-ui-bridge-id="sessions.detail-output">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-muted-foreground" />
            Live output
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="rounded-md border border-border/40 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground"
            data-ui-bridge-id="sessions.detail-output-not-shared"
          >
            This session is not sharing its terminal output. Output streaming is
            opt-in per session (<code className="font-mono">share_output</code>
            ); the operator who started it can enable sharing to let teammates
            tail it here.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-ui-bridge-id="sessions.detail-output">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-muted-foreground" />
          Live output
          <Badge variant="outline" className="text-[10px]">
            read-only
          </Badge>
          {status === "loading" && (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
              data-ui-bridge-id="sessions.detail-output-status"
              data-output-status="loading"
            >
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              loading
            </Badge>
          )}
          {status === "live" && (
            <Badge
              variant="outline"
              className="text-[10px] border-green-500/30 text-green-400 bg-green-500/5"
              data-ui-bridge-id="sessions.detail-output-status"
              data-output-status="live"
            >
              live · {chunkCount} chunks
            </Badge>
          )}
          {status === "unavailable" && (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
              data-ui-bridge-id="sessions.detail-output-status"
              data-output-status="unavailable"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              output unavailable
            </Badge>
          )}
          {status === "stream-error" && (
            <Badge
              variant="destructive"
              className="text-[10px]"
              data-ui-bridge-id="sessions.detail-output-status"
              data-output-status="stream-error"
            >
              stream error
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {status === "unavailable" && chunkCount === 0 && (
          <p
            className="mb-2 text-xs italic text-muted-foreground"
            data-ui-bridge-id="sessions.detail-output-unavailable-note"
          >
            No recorded output yet. The session may have just started sharing,
            or the coordination layer is not yet serving stored output. Live
            chunks will appear here as the session emits them.
          </p>
        )}
        <div
          ref={containerRef}
          className="h-[360px] w-full overflow-hidden rounded-md border border-border/40 bg-[#0a0a0a] p-2"
          data-ui-bridge-id="sessions.detail-output-terminal"
        />
      </CardContent>
    </Card>
  );
}
