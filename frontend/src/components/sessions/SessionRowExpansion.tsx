"use client";

/**
 * SessionRowExpansion — what a click on a `/sessions` row earns.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 2 / D3, and the
 * console style guide's R5: **detail expands IN PLACE**, never as a slide-over.
 * The panel is `RecordDetail`, whose five slots are fixed by the primitive and
 * are not this page's choice:
 *
 * | slot | what this surface puts in it |
 * |---|---|
 * | `why` | the row class, in the operator's words — which halves of the join exist |
 * | `problems` | the coordination answer: claims held, agent status, what is blocked |
 * | `actions` | Open full view ↗, and the two transcript stores |
 * | `history` | the coord lineage timeline (worktree / claim / build / merge) |
 * | `raw` | the ids, mono, last |
 *
 * ## Every read is asked for itself (D2)
 *
 * Three coordination reads run in parallel and each is classified on its own:
 * a **404 is an answer** (this session holds no claims), any other failure is
 * **unknown** (we could not ask). `Promise.allSettled` with a shared "loaded"
 * flag — the shape `SessionDetail` uses — cannot tell those apart, and a page
 * that renders the second as the first reports an outage as an all-clear.
 *
 * Nothing fetches until the row is OPEN. `RecordList` keeps one row open at a
 * time, so this is bounded at one session's worth of reads no matter how large
 * the fleet is.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { RecordDetail, relativeTime } from "@/components/console";
import { Badge } from "@/components/ui/badge";
import {
  getSessionAgentStatus,
  getSessionClaims,
  getSessionLineage,
} from "./api";
import { LineageTimeline } from "./LineageTimeline";
import { classifyLifecycleError, type HalfResult } from "./sessionKeyResolution";
import {
  agentSessionId,
  hasAgentHalf,
  hasLifecycleHalf,
  rowClassExplanation,
  type ConsolidatedSessionRow,
} from "./sessionConsoleStatus";
import { TranscriptStoresPanel } from "./TranscriptStores";
import type { TranscriptStoresState } from "./TranscriptStores";
import type { AgentStatus, LineageAction, SessionClaim } from "./types";

/** The three coordination reads, each with its own answer/non-answer split. */
export interface SessionCoordination {
  claims: HalfResult<SessionClaim[]>;
  agents: HalfResult<AgentStatus[]>;
  lineage: HalfResult<LineageAction[]>;
}

export interface CoordinationReaders {
  claims?: typeof getSessionClaims;
  agents?: typeof getSessionAgentStatus;
  lineage?: typeof getSessionLineage;
}

const IDLE: HalfResult<never> = { state: "loading" };

/**
 * Read the coordination half for one session, once, while the row is open.
 *
 * `classifyLifecycleError` is reused verbatim rather than re-spelled: all
 * three routes throw the same `SessionsApiError`, and the 404-is-an-answer
 * split must not be written twice.
 */
export function useSessionCoordination(
  sessionId: string | null,
  enabled: boolean,
  readers: CoordinationReaders = {}
): SessionCoordination {
  const [state, setState] = useState<SessionCoordination>({
    claims: IDLE,
    agents: IDLE,
    lineage: IDLE,
  });

  const { claims: readClaims, agents: readAgents, lineage: readLineage } =
    readers;

  useEffect(() => {
    if (!enabled || !sessionId) return;
    const ctrl = new AbortController();

    const run = <T, R>(
      read: (id: string, signal?: AbortSignal) => Promise<R>,
      pick: (value: R) => T,
      apply: (result: HalfResult<T>) => void
    ) => {
      void read(sessionId, ctrl.signal)
        .then((value) => {
          if (!ctrl.signal.aborted) {
            apply({ state: "resolved", value: pick(value) });
          }
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === "AbortError") return;
          if (!ctrl.signal.aborted) {
            apply(classifyLifecycleError(err) as HalfResult<T>);
          }
        });
    };

    run(
      readClaims ?? getSessionClaims,
      (r) => r.claims ?? [],
      (claims) => setState((prev) => ({ ...prev, claims }))
    );
    run(
      readAgents ?? getSessionAgentStatus,
      (r) => r.agents ?? [],
      (agents) => setState((prev) => ({ ...prev, agents }))
    );
    run(
      readLineage ?? getSessionLineage,
      (r) => r.actions ?? [],
      (lineage) => setState((prev) => ({ ...prev, lineage }))
    );

    return () => ctrl.abort();
  }, [enabled, sessionId, readClaims, readAgents, readLineage]);

  return state;
}

export interface SessionRowExpansionProps {
  row: ConsolidatedSessionRow;
  coordination: SessionCoordination;
  stores: TranscriptStoresState;
  /** Injected for tests so relative timestamps are deterministic. */
  now?: number;
}

export function SessionRowExpansion({
  row,
  coordination,
  stores,
  now,
}: SessionRowExpansionProps) {
  const agentId = agentSessionId(row);

  return (
    <RecordDetail
      data-testid="sessions-console-detail"
      why={<p className="text-muted-foreground">{rowClassExplanation(row)}</p>}
      problems={
        <div className="space-y-2" data-testid="sessions-console-detail-coordination">
          <p className="text-xs font-medium text-muted-foreground">
            Coordination — claims and agent status
          </p>
          <HalfBlock
            half={coordination.claims}
            testId="sessions-console-detail-claims"
            unknownWhy="the claims read did not land, so what this session holds is unknown — not none."
            absentWhy="coord has no claims record for this session id."
            empty="coord answered: this session holds no claims."
            render={(claims) => (
              <ul className="space-y-1">
                {claims.map((claim) => (
                  <li
                    key={claim.id}
                    className="flex flex-wrap items-center gap-x-2 text-xs"
                  >
                    <Lock className="size-3 text-muted-foreground" />
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {claim.kind}
                    </Badge>
                    <span
                      className="font-mono truncate max-w-[28rem]"
                      title={claim.resource_key}
                    >
                      {claim.resource_key}
                    </span>
                    <span className="text-muted-foreground">
                      held {relativeTime(claim.acquired_at, { now })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          />
          <HalfBlock
            half={coordination.agents}
            testId="sessions-console-detail-agent-status"
            unknownWhy="the agent-status read did not land — unknown, not idle."
            absentWhy="coord has no agent-status record for this session id."
            empty="coord answered: no agent has published a status for this session."
            render={(agents) => (
              <ul className="space-y-1">
                {agents.map((agent) => (
                  <li key={agent.id} className="text-xs">
                    <span className="font-medium">
                      {agent.status_text ?? "no status text"}
                    </span>
                    {agent.blocked_on && (
                      <span className="ml-2 text-amber-300">
                        blocked on {agent.blocked_on}
                      </span>
                    )}
                    <span className="ml-2 text-muted-foreground">
                      {relativeTime(agent.updated_at, { now })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          />
        </div>
      }
      actions={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* The full-height route (D3). The tall panes — Transcript, Live
                tail, PTY output — need viewport height, so they live there
                and this expansion links to them rather than cramming them in. */}
            <Link
              href={`/sessions/${encodeURIComponent(row.id)}`}
              className="text-xs underline underline-offset-2"
              data-testid="sessions-console-open-full"
            >
              Open full view ↗
            </Link>
          </div>
          <TranscriptStoresPanel
            live={stores.live}
            archived={stores.archived}
            heading="Transcripts — two stores, two lifetimes"
          />
        </div>
      }
      history={
        <div className="space-y-2" data-testid="sessions-console-detail-lineage">
          <p className="text-xs font-medium text-muted-foreground">
            Lineage — worktrees, claims, builds, merges
          </p>
          {hasAgentHalf(row) === false ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="sessions-console-detail-lineage-na"
            >
              – This session has no Claude Code session id, so no agent-session
              lineage row can exist. Not applicable — not empty.
            </p>
          ) : (
            <HalfBlock
              half={coordination.lineage}
              testId="sessions-console-detail-lineage-actions"
              unknownWhy="the lineage read did not land — unknown, not empty."
              absentWhy="coord has no lineage record for this session id."
              empty="coord answered: no worktree, claim, build or merge is attributed to this session."
              render={(actions) => <LineageTimeline actions={actions} />}
            />
          )}
        </div>
      }
      raw={
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground/60">
          <dt>row_class</dt>
          <dd>{row.row_class ?? "unknown"}</dd>
          <dt>coord.sessions.id</dt>
          <dd>
            {hasLifecycleHalf(row) === true ? (
              row.id
            ) : (
              <RawDash title="no coord.sessions row for this session" />
            )}
          </dd>
          <dt>agent_sessions.id</dt>
          <dd>
            {agentId ?? (
              <RawDash title="no agent-session id is known for this row" />
            )}
          </dd>
          <dt>device_id</dt>
          <dd>
            {row.device_id ?? <RawDash title="coord recorded no device" />}
          </dd>
        </dl>
      }
    />
  );
}

/**
 * One read's three honest renderings: unknown, coord-answered-absent, and the
 * data. `resolved` with an EMPTY array is the fourth and it is data — coord
 * looked and there is nothing, which is a different sentence from both dashes
 * above it.
 */
function HalfBlock<T>({
  half,
  testId,
  unknownWhy,
  absentWhy,
  empty,
  render,
}: {
  half: HalfResult<T[]>;
  testId: string;
  unknownWhy: string;
  absentWhy: string;
  empty: string;
  render: (value: T[]) => React.ReactNode;
}) {
  if (half.state === "loading") {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        reading…
      </p>
    );
  }
  if (half.state === "unknown") {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        <span title={unknownWhy}>–</span> {unknownWhy}
      </p>
    );
  }
  if (half.state === "absent") {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        <span title={absentWhy}>–</span> {absentWhy}
      </p>
    );
  }
  if (half.value.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        {empty}
      </p>
    );
  }
  return <div data-testid={testId}>{render(half.value)}</div>;
}

function RawDash({ title }: { title: string }) {
  return (
    <span
      className="text-muted-foreground/70"
      title={title}
      data-testid="sessions-console-unknown"
    >
      –
    </span>
  );
}
