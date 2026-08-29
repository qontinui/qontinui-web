/**
 * transcriptStores — the TWO transcript stores a session has, kept apart.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` §1 + Phase 2. The 2026-08-26
 * draft asserted qontinui-web keeps no transcripts and was measured wrong: there
 * are two stores, they are different things, and a surface that shows one of them
 * and calls it "the transcript" is lying about the other.
 *
 * | Store | Owner | Lifetime | Read path |
 * |---|---|---|---|
 * | **Live / recent** — `coord.session_output` | coord | warm ~7 days post-close, then a cold object archive | `GET /operations/sessions/:id/output?stream=transcript` |
 * | **Permanent** — `agent.session_artifacts` | **qontinui-web** | permanent, object-store-backed, digest-verified, searchable | `GET /session-repository?claude_session_id=…` |
 *
 * The reverse link already shipped — `session-repository/SessionArtifactDetail.tsx`
 * renders `/sessions/{coord_session_id}`. This module is the FORWARD half.
 *
 * ## Every non-answer is a dash, and they are not the same dash (D2)
 *
 * The plan is explicit that the row indicator's `–` **means unknown, not "no
 * transcript"**: a closed session's warm rows are GC'd 7 days post-close and the
 * cold object is the durable copy, so an empty warm tier proves nothing; a
 * session nobody probed has not answered; and the archive holding no row for an
 * id says only that nothing was ever captured under it. Those are four different
 * sentences behind one glyph, so every state below carries the sentence, and
 * {@link liveTranscriptIndicator} / {@link archivedTranscriptIndicator} hand it
 * back as the `title` beside the label.
 *
 * Pure: no React, no DOM. The probes take their two reads as injected
 * dependencies so the whole vocabulary is unit-testable without a network.
 */

import type { SessionRepositoryQuery } from "@/components/session-repository/api";
import type { SessionArtifactListResponse } from "@/components/session-repository/types";
import type { GetSessionOutputOptions, OutputTier } from "./api";
import type { OutputHistoryResponse } from "./types";

// ---------------------------------------------------------------------------
// Store 1 — coord's warm→cold stream
// ---------------------------------------------------------------------------

/** Which coord tier answered. `warm` is recent; `cold` is the archived copy. */
export type TranscriptTier = OutputTier;

/**
 * What the LIVE store has said about one session.
 *
 * `silent` is the state worth reading twice: coord answered both tiers and
 * served no chunks. That is still not "there is no transcript" — a coord with
 * no cold tier configured answers 503 on the second read, and a runner with
 * cloud sync off never uploaded one. It renders `–`.
 */
export type LiveTranscript =
  | { state: "not-applicable"; why: string }
  | { state: "unprobed" }
  | { state: "probing" }
  | { state: "present"; tier: TranscriptTier }
  | { state: "silent" }
  | { state: "failed"; detail: string };

// ---------------------------------------------------------------------------
// Store 2 — qontinui-web's permanent archive
// ---------------------------------------------------------------------------

/** One archived transcript, as much of it as an indicator needs. */
export interface ArchivedTranscriptRow {
  /** `agent.session_artifacts.id` — the `/sessions/repository/[id]` key. */
  artifactId: string;
  claudeSessionId: string;
  accountLabel: string | null;
  /** `disk_verbatim` | `coord_redacted` | null. Never laundered. */
  bodySource: string | null;
  /** Null when the row is metadata-only — a head row whose bytes never landed. */
  contentSha256: string | null;
  turnCount: number | null;
  byteCount: number | null;
  lastActivityAt: string | null;
}

/**
 * What the PERMANENT archive has said about one session.
 *
 * `absent` is the archive ANSWERING that it holds no row for this id — which
 * the plan requires be rendered `–`, **not** "no transcript". Nothing was
 * captured under that id; whether the session had a transcript is a different
 * question and this store cannot answer it.
 *
 * `present` may carry more than one row: identity is
 * `(claude_session_id, coalesce(account_label,''))`, so one Claude session
 * archived under two account homes is genuinely two rows. Collapsing them to
 * the first would hide a copy.
 */
export type ArchivedTranscript =
  | { state: "unaddressable"; why: string }
  | { state: "unprobed" }
  | { state: "probing" }
  | { state: "present"; rows: ArchivedTranscriptRow[] }
  | { state: "absent" }
  | { state: "failed"; detail: string };

// ---------------------------------------------------------------------------
// Indicators — label + the sentence behind it
// ---------------------------------------------------------------------------

/** The dash this codebase prints for UNKNOWN. One glyph, many sentences. */
export const UNKNOWN_DASH = "–";

export interface StoreIndicator {
  /** `warm` | `cold` | `archived` | `–`. */
  label: string;
  /** Which unknown (or which answer) this is, in a sentence. */
  title: string;
  /** True when the label is the dash — i.e. nothing was established. */
  unknown: boolean;
}

/** The per-row `warm` / `cold` / `–` indicator the plan asks for (Phase 2). */
export function liveTranscriptIndicator(live: LiveTranscript): StoreIndicator {
  switch (live.state) {
    case "present":
      return {
        label: live.tier,
        title:
          live.tier === "warm"
            ? "coord's warm tier holds this session's transcript. Warm rows are garbage-collected about 7 days after a session closes; the cold object is the durable copy."
            : "coord's warm tier held nothing and the cold object archive answered — this is the durable copy of the live stream.",
        unknown: false,
      };
    case "not-applicable":
      return { label: UNKNOWN_DASH, title: live.why, unknown: true };
    case "unprobed":
      return {
        label: UNKNOWN_DASH,
        title:
          "not probed. A row that has not been probed has not answered — this is unknown, not 'no transcript'. Open the row to ask.",
        unknown: true,
      };
    case "probing":
      return {
        label: UNKNOWN_DASH,
        title: "asking coord now — no answer yet.",
        unknown: true,
      };
    case "silent":
      return {
        label: UNKNOWN_DASH,
        title:
          "coord served no transcript chunks from either tier. That is NOT proof none was recorded: a cold tier that is not configured answers 503, and a runner with cloud sync off never uploaded one. Unknown.",
        unknown: true,
      };
    case "failed":
      return {
        label: UNKNOWN_DASH,
        title: `the transcript read did not land — unknown, not absent. ${live.detail}`,
        unknown: true,
      };
  }
}

/** The permanent archive's own indicator, on the same discipline. */
export function archivedTranscriptIndicator(
  archived: ArchivedTranscript
): StoreIndicator {
  switch (archived.state) {
    case "present":
      return {
        label: "archived",
        title:
          archived.rows.length === 1
            ? "qontinui-web's permanent archive holds this session — object-store-backed, digest-verified, searchable."
            : `${archived.rows.length} archived copies — identity is (claude_session_id, account_label), so one session captured under two account homes is two rows.`,
        unknown: false,
      };
    case "unaddressable":
      return { label: UNKNOWN_DASH, title: archived.why, unknown: true };
    case "unprobed":
      return {
        label: UNKNOWN_DASH,
        title:
          "the permanent archive has not been asked about this session — unknown, not absent.",
        unknown: true,
      };
    case "probing":
      return {
        label: UNKNOWN_DASH,
        title: "asking the permanent archive now — no answer yet.",
        unknown: true,
      };
    case "absent":
      return {
        label: UNKNOWN_DASH,
        title:
          "the permanent archive answered and holds no row for this session id. Nothing was ever captured under it — that is not a claim the session had no transcript.",
        unknown: true,
      };
    case "failed":
      return {
        label: UNKNOWN_DASH,
        title: `the archive read did not land — unknown, not absent. ${archived.detail}`,
        unknown: true,
      };
  }
}

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------

/** The one `getSessionOutput`-shaped call the live probe needs. */
export type OutputReader = (
  id: string,
  opts: GetSessionOutputOptions
) => Promise<OutputHistoryResponse>;

/** The one `listSessionArtifacts`-shaped call the archive probe needs. */
export type ArtifactLister = (
  query: SessionRepositoryQuery
) => Promise<SessionArtifactListResponse>;

/**
 * Warm-tier probe cap. The indicator only needs to know whether the tier holds
 * ANYTHING, so it asks for one chunk rather than the pane's 4096 — this runs
 * per opened row and must not pull a transcript across the wire to draw a
 * five-character label.
 */
const PROBE_LIMIT = 1;

/**
 * Ask the LIVE store which tier (if either) holds this session's transcript.
 *
 * Warm first; cold only when the session is closed, which is the same order
 * `TranscriptPane` walks and for the same reason — an open session's history
 * has not been archived yet, so a cold read on one is a wasted request rather
 * than a second chance.
 */
export async function probeLiveTranscript(
  sessionId: string,
  opts: {
    read: OutputReader;
    sessionClosed: boolean;
    signal?: AbortSignal;
  }
): Promise<LiveTranscript> {
  const { read, sessionClosed, signal } = opts;
  try {
    const warm = await read(sessionId, {
      tier: "warm",
      stream: "transcript",
      limit: PROBE_LIMIT,
      signal,
    });
    if (warm.chunks.length > 0) return { state: "present", tier: "warm" };
  } catch (err) {
    return { state: "failed", detail: errorDetail(err) };
  }

  if (!sessionClosed) {
    // An open session whose warm tier is empty has simply not streamed a
    // transcript yet. Reading cold here would answer a question nobody asked.
    return { state: "silent" };
  }

  try {
    const cold = await read(sessionId, {
      tier: "cold",
      stream: "transcript",
      signal,
    });
    if (cold.chunks.length > 0) return { state: "present", tier: "cold" };
    return { state: "silent" };
  } catch {
    // A cold tier that is not configured answers 503. That is an unanswered
    // question, not "there is no transcript" — and the warm read already told
    // us its own tier is empty, so `silent` is the honest floor here.
    return { state: "silent" };
  }
}

/**
 * Ask the PERMANENT archive whether it holds this session.
 *
 * Prefers the Claude session id: it is the archive's own identity column and
 * the indexed arm. The coord id is the fallback for a row the console only
 * knows by its `coord.sessions` id, and it is an unindexed scan — so it is
 * tried second and only when the first is unavailable, never as a widening
 * second request.
 */
export async function probeArchivedTranscript(
  keys: { claudeSessionId?: string | null; coordSessionId?: string | null },
  opts: { list: ArtifactLister; signal?: AbortSignal }
): Promise<ArchivedTranscript> {
  const query = archiveQueryFor(keys);
  if (!query) {
    return {
      state: "unaddressable",
      why: "no session id in either coord id space is known for this row, so the permanent archive cannot be asked. Unknown, not absent.",
    };
  }
  try {
    const page = await opts.list({ ...query, limit: 10, signal: opts.signal });
    if (page.items.length === 0) return { state: "absent" };
    return {
      state: "present",
      rows: page.items.map((item) => ({
        artifactId: item.id,
        claudeSessionId: item.claude_session_id,
        accountLabel: item.account_label,
        bodySource: item.body_source,
        contentSha256: item.content_sha256,
        turnCount: item.turn_count,
        byteCount: item.byte_count,
        lastActivityAt: item.last_activity_at,
      })),
    };
  } catch (err) {
    return { state: "failed", detail: errorDetail(err) };
  }
}

/**
 * The archive query for a row, or `null` when neither id space is known.
 *
 * Exported because "which id did we look this up by?" is a question the detail
 * view states on screen, and a reviewer should be able to test the choice
 * without driving a component.
 */
export function archiveQueryFor(keys: {
  claudeSessionId?: string | null;
  coordSessionId?: string | null;
}): { claudeSessionId?: string; coordSessionId?: string } | null {
  const claude = keys.claudeSessionId?.trim();
  if (claude) return { claudeSessionId: claude };
  const coord = keys.coordSessionId?.trim();
  if (coord) return { coordSessionId: coord };
  return null;
}

/** `/sessions/repository/[id]` — the permanent copy's own page. */
export function archiveHref(row: ArchivedTranscriptRow): string {
  return `/sessions/repository/${encodeURIComponent(row.artifactId)}`;
}

function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "unknown error");
}
