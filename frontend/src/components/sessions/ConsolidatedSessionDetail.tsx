"use client";

/**
 * ConsolidatedSessionDetail — ONE resolved session, with both detail halves.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` D5. The two shipped
 * detail views are complementary and each is incomplete: `/sessions/[id]`
 * mounts the coordination half (identity, claims, conflicts, PTY output,
 * lineage, steal/handoff) and no transcript or resume; `/environments/sessions/[key]`
 * mounts the twin card (working-on, commits, resume capability, transcript,
 * live tail) and none of the coordination half. Both sets of panes live in
 * THIS directory; the two pages each imported a different half of it.
 *
 * **Nine sections, eight components, all already written.** Nothing here is a
 * new pane — this is composition:
 *
 * | Section | Component |
 * |---|---|
 * | Identity / status / machine / tenant | `SessionDetail` header |
 * | Coordination — claims, conflicts, agent status, peers | `SessionDetail` → `CoordinationCard`, `ConflictRow` |
 * | PTY output | `SessionDetail` → `OutputPane` |
 * | Live tail | `SessionCardView` → `LiveTailPane` |
 * | Transcript | `SessionCardView` → `TranscriptPane` |
 * | Resume / restore capability | `SessionCardView` → `ResumePanel` |
 * | Working-on snapshot + recent commits | `SessionCardView` |
 * | Lineage timeline | `SessionDetail` → `LineageTimeline`, plus the card's own list |
 * | Steal / handoff | `SessionDetail` → `StealModal`, `HandoffModal` |
 *
 * Plus the tenth thing this phase adds: **both transcript stores**, labelled
 * (`TranscriptStoresPanel`).
 *
 * ## The lifecycle probe, and why the halves are asked separately (D2)
 *
 * `SessionDetail` fetches its own `coord.sessions` row and renders one error
 * state for every failure — so an `agent_only` session (allocated by
 * `POST /agents/allocate`, which writes an `agent_sessions` row and never a
 * `sessions` one) would read "Session not available", which is a claim about
 * the session rather than about the half that is missing. So this component
 * asks first, cheaply, and branches:
 *
 * - coord answers with a row → mount `SessionDetail`;
 * - coord answers **404** → say there is no lifecycle row and that the
 *   coordination half is *not applicable*, never "unavailable";
 * - the read does not land → say it is **unknown**, and do not claim either.
 *
 * That costs one extra proxy GET per rendered match. It is the price of not
 * reporting a structural absence as a fault, and it is stated rather than
 * hidden.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Network } from "lucide-react";
import { getSession } from "./api";
import { classifyLifecycleError, type LifecycleHalf } from "./sessionKeyResolution";
import { SessionCardView } from "./SessionCardView";
import { SessionDetail } from "./SessionDetail";
import { TranscriptStoresPanel, useTranscriptStores } from "./TranscriptStores";
import type { HandoffTarget } from "./HandoffModal";
import type { SessionCard } from "@/services/agent-sessions-api";
import type { ArtifactLister, OutputReader } from "./transcriptStores";

export interface ConsolidatedSessionDetailProps {
  /**
   * The agent-session card, when the agent resolver produced one. `null` for a
   * key that only a `coord.sessions` row answered — a `lifecycle_only`
   * session has no Claude Code session id, so no card CAN exist for it.
   */
  card: SessionCard | null;
  /**
   * The id coord is asked by. `card.id` when there is a card (coord's
   * lifecycle read resolves `id = $1 OR claude_code_session_id = $1`, so the
   * agent-session uuid reaches the bridged lifecycle row), otherwise the
   * `coord.sessions` id the lifecycle half resolved.
   */
  sessionId: string;
  hostnameFor?: (deviceId: string) => string | undefined;
  handoffTargets?: HandoffTarget[];
  /** Injected for tests — the coord lifecycle read. */
  fetchSession?: typeof getSession;
  /** Injected for tests — the coord transcript-stream read. */
  readOutput?: OutputReader;
  /** Injected for tests — the permanent archive's list read. */
  listArtifacts?: ArtifactLister;
}

export function ConsolidatedSessionDetail({
  card,
  sessionId,
  hostnameFor,
  handoffTargets = [],
  fetchSession,
  readOutput,
  listArtifacts,
}: ConsolidatedSessionDetailProps) {
  const [lifecycle, setLifecycle] = useState<LifecycleHalf>({
    state: "loading",
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setLifecycle({ state: "loading" });
    void (fetchSession ?? getSession)(sessionId, ctrl.signal)
      .then((row) => {
        if (!ctrl.signal.aborted) setLifecycle({ state: "resolved", value: row });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (!ctrl.signal.aborted) setLifecycle(classifyLifecycleError(err));
      });
    return () => ctrl.abort();
  }, [sessionId, fetchSession]);

  const sessionClosed =
    card != null
      ? card.status === "closed"
      : lifecycle.state === "resolved" && lifecycle.value.state === "closed";

  const stores = useTranscriptStores({
    liveSessionId: sessionId,
    sessionClosed,
    // The archive's identity column is the Claude session uuid, which is
    // exactly `card.id`. With no card we only have the coord id, and the
    // archive's `coord_session_id` is the (unindexed, GC-tolerant) fallback.
    claudeSessionId: card?.id ?? null,
    coordSessionId: card == null ? sessionId : null,
    // A card exists ⇒ there IS a Claude session id ⇒ a transcript is
    // applicable. With no card, coord's lifecycle row having no
    // `claude_code_session_id` is a positive structural claim; anything else
    // is a reason to ask rather than to assume.
    liveApplicable:
      card != null
        ? true
        : lifecycle.state === "resolved"
          ? lifecycle.value.claude_code_session_id != null
          : null,
    enabled: true,
    read: readOutput,
    list: listArtifacts,
  });

  const archiveSlot = (
    <TranscriptStoresPanel live={stores.live} archived={stores.archived} />
  );

  return (
    <div
      className="space-y-4"
      data-testid="consolidated-session-detail"
      data-session-id={sessionId}
    >
      {card ? (
        <SessionCardView card={card} archiveSlot={archiveSlot} />
      ) : (
        <div
          className="rounded-lg border border-border p-4 space-y-3"
          data-testid="consolidated-session-agent-half-absent"
        >
          <p className="text-xs text-muted-foreground">
            No agent-session lineage row resolved for this key. A session with
            no Claude Code session id — a shell, a workflow, an automation —
            cannot have one, so the working-on snapshot, the resume capability
            and the AI transcript are <strong>not applicable here</strong>, not
            empty.
          </p>
          {archiveSlot}
        </div>
      )}

      <section
        className="space-y-3"
        data-testid="consolidated-session-coordination"
      >
        {lifecycle.state === "loading" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the coordination half…
          </div>
        )}

        {lifecycle.state === "resolved" && (
          <SessionDetail
            sessionId={sessionId}
            hostnameFor={hostnameFor}
            handoffTargets={handoffTargets}
          />
        )}

        {lifecycle.state === "absent" && (
          <div
            className="rounded-lg border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground"
            data-testid="consolidated-session-lifecycle-absent"
          >
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <Network className="size-3.5" />
              No coord.sessions row bridges this session
            </p>
            <p className="mt-1 max-w-3xl">
              coord answered: there is no lifecycle row for this id.{" "}
              <span className="font-mono">POST /agents/allocate</span> writes an
              agent-session lineage row and never a lifecycle one, so an
              allocated agent exists in one id space and nowhere in the other.
              Claims, conflicts, PTY output, heartbeat and steal/handoff are
              therefore <strong>not applicable</strong> to this session — that
              is not a report that they are empty, and it is not a heartbeat
              that stopped.
            </p>
          </div>
        )}

        {lifecycle.state === "unknown" && (
          <div
            className="rounded-lg border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground"
            data-testid="consolidated-session-lifecycle-unknown"
          >
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <AlertTriangle className="size-3.5" />
              The coordination half could not be read
            </p>
            <p className="mt-1 max-w-3xl">
              This read did not land, so nothing below it is established.
              Whether this session has claims, conflicts or a heartbeat is{" "}
              <strong>unknown</strong> — not none.
            </p>
            <p className="mt-1 break-all font-mono text-[10px]">
              {lifecycle.detail}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
