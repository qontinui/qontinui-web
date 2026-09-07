"use client";

/**
 * TranscriptStores — the hook and the panel that surface BOTH transcript
 * stores, labelled as the different things they are.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` §1 + Phase 2. The
 * vocabulary, the probes and every dash's sentence live in the pure module
 * beside this one (`transcriptStores.ts`, R8); this file is the React skin and
 * nothing more.
 *
 * ## Two links, never one
 *
 * - **Live / recent** — coord's warm→cold `?stream=transcript`. Authoritative
 *   while the session is open and for ~7 days after it closes.
 * - **Permanent** — qontinui-web's own `agent.session_artifacts`, at
 *   `/sessions/repository/[id]`: digest-verified, object-store-backed,
 *   searchable. The reverse link already shipped
 *   (`SessionArtifactDetail.tsx` → `/sessions/{coord_session_id}`); this is
 *   the forward half of that round trip.
 *
 * ## The probe is LAZY, and that is the honest default
 *
 * Nothing here fires until `enabled` goes true — which the console does on row
 * expansion, not on render. A 40-row list must not issue 80 requests to draw
 * two five-character labels. An unprobed row therefore reads `–`, and the plan
 * says exactly what that means: *a row that has not been probed has not
 * answered*. It is unknown, never "no transcript".
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { listSessionArtifacts } from "@/components/session-repository/api";
import { getSessionOutput } from "./api";
import {
  archiveHref,
  archivedTranscriptIndicator,
  liveTranscriptIndicator,
  probeArchivedTranscript,
  probeLiveTranscript,
  type ArchivedTranscript,
  type ArtifactLister,
  type LiveTranscript,
  type OutputReader,
} from "./transcriptStores";

export interface UseTranscriptStoresOptions {
  /** The id coord answers output reads on. Null when there is none to ask by. */
  liveSessionId: string | null;
  /** Coord reads the cold tier only for a closed session — same as the pane. */
  sessionClosed: boolean;
  /** The archive's identity column, when known. Preferred, and indexed. */
  claudeSessionId: string | null;
  /** The `coord.sessions` id, when known. The unindexed fallback. */
  coordSessionId: string | null;
  /**
   * Is an AI transcript even APPLICABLE to this session?
   *
   * `false` only for a row coord has told us has no Claude Code session id at
   * all (a shell, a workflow) — a positive structural claim, not an
   * observation. `null` means the join half is unresolved, and that is a
   * reason to ASK rather than to assume: an unresolved row may well have one.
   */
  liveApplicable: boolean | null;
  /** Nothing is fetched while this is false. */
  enabled: boolean;
  /** Injected for tests. */
  read?: OutputReader;
  /** Injected for tests. */
  list?: ArtifactLister;
}

export interface TranscriptStoresState {
  live: LiveTranscript;
  archived: ArchivedTranscript;
}

const NOT_APPLICABLE_LIVE: LiveTranscript = {
  state: "not-applicable",
  why: "coord reports no Claude Code session id for this session, so there is no AI conversation to stream. Not applicable — not missing.",
};

/**
 * Probe both stores once, when enabled.
 *
 * The result is kept after `enabled` goes false again (the console collapses
 * the row): an answer already paid for should not be discarded and re-shown as
 * an unknown.
 */
export function useTranscriptStores(
  opts: UseTranscriptStoresOptions
): TranscriptStoresState {
  const {
    liveSessionId,
    sessionClosed,
    claudeSessionId,
    coordSessionId,
    liveApplicable,
    enabled,
    read,
    list,
  } = opts;

  const [live, setLive] = useState<LiveTranscript>({ state: "unprobed" });
  const [archived, setArchived] = useState<ArchivedTranscript>({
    state: "unprobed",
  });

  const reader: OutputReader = useCallback(
    (id, o) => (read ?? getSessionOutput)(id, o),
    [read]
  );
  const lister: ArtifactLister = useCallback(
    (q) => (list ?? listSessionArtifacts)(q),
    [list]
  );

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();

    if (liveApplicable === false) {
      setLive(NOT_APPLICABLE_LIVE);
    } else if (!liveSessionId) {
      setLive({
        state: "not-applicable",
        why: "no session id is known for this row, so coord's transcript stream cannot be addressed. Unknown, not absent.",
      });
    } else {
      setLive((prev) => (prev.state === "unprobed" ? { state: "probing" } : prev));
      void probeLiveTranscript(liveSessionId, {
        read: reader,
        sessionClosed,
        signal: ctrl.signal,
      }).then((next) => {
        if (!ctrl.signal.aborted) setLive(next);
      });
    }

    setArchived((prev) =>
      prev.state === "unprobed" ? { state: "probing" } : prev
    );
    void probeArchivedTranscript(
      { claudeSessionId, coordSessionId },
      { list: lister, signal: ctrl.signal }
    ).then((next) => {
      if (!ctrl.signal.aborted) setArchived(next);
    });

    return () => ctrl.abort();
  }, [
    enabled,
    liveSessionId,
    sessionClosed,
    claudeSessionId,
    coordSessionId,
    liveApplicable,
    reader,
    lister,
  ]);

  return { live, archived };
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export interface TranscriptStoresPanelProps extends TranscriptStoresState {
  /** Rendered above the two stores. */
  heading?: string;
  "data-testid"?: string;
}

/**
 * Both stores, side by side, each saying what it is and what it answered.
 *
 * They are never merged into one "transcript" affordance: they have different
 * owners, different lifetimes and different guarantees, and the 2026-08-26
 * draft's mistake was to believe there was only one of them.
 */
export function TranscriptStoresPanel({
  live,
  archived,
  heading = "Transcripts — two stores, two lifetimes",
  "data-testid": testId = "session-transcript-stores",
}: TranscriptStoresPanelProps) {
  const liveIndicator = liveTranscriptIndicator(live);
  const archivedIndicator = archivedTranscriptIndicator(archived);

  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">{heading}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div
          className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-1"
          data-testid="session-transcript-live"
        >
          <div className="flex items-center gap-2">
            <ScrollText className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Live / recent — coord</span>
            <Badge
              variant="outline"
              className="font-mono text-[10px]"
              title={liveIndicator.title}
              data-testid="session-transcript-live-tier"
            >
              {liveIndicator.label}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            coord&apos;s warm→cold stream. Authoritative while the session is
            open and for about 7 days after it closes, then the warm rows are
            garbage-collected.
          </p>
        </div>

        <div
          className="rounded-md border border-border bg-card/40 px-3 py-2 space-y-1"
          data-testid="session-transcript-archive"
        >
          <div className="flex items-center gap-2">
            <Archive className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">
              Permanent — qontinui-web
            </span>
            <Badge
              variant="outline"
              className="font-mono text-[10px]"
              title={archivedIndicator.title}
              data-testid="session-transcript-archive-state"
            >
              {archivedIndicator.label}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Digest-verified, object-store-backed and searchable. This is the
            copy that outlives coord&apos;s 7-day window.
          </p>
          {archived.state === "present" && (
            <ul className="space-y-0.5" data-testid="session-transcript-archive-links">
              {archived.rows.map((row) => (
                <li key={row.artifactId} className="text-[11px]">
                  <Link
                    href={archiveHref(row)}
                    className="underline underline-offset-2"
                  >
                    Open the archived transcript
                  </Link>
                  {row.accountLabel && (
                    <span className="ml-1.5 text-muted-foreground">
                      account{" "}
                      <span className="font-mono">{row.accountLabel}</span>
                    </span>
                  )}
                  {row.turnCount != null && (
                    <span className="ml-1.5 text-muted-foreground">
                      {row.turnCount} turns
                    </span>
                  )}
                  {row.bodySource === "coord_redacted" && (
                    <span
                      className="ml-1.5 text-muted-foreground"
                      title="These bytes passed through redaction on the way into coord's stream, so the digest can never be checked against the original transcript."
                    >
                      digest not verifiable
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
