"use client";

/**
 * SessionCardView — the twin identity card: name, status, machine binding,
 * restore capability, the "working on" snapshot, recent commits, the card's
 * own lineage list, and the Transcript / Live-tail tabs.
 *
 * **Extracted, not rewritten.** This was declared inside
 * `app/(app)/environments/sessions/[key]/page.tsx` and was reachable from that
 * route alone. Plan `2026-08-26-sessions-console-consolidation.md` D5 requires
 * it on the merged `/sessions/[key]` view, and the honest way to put it there
 * is to move the one component both pages render rather than to grow a second
 * copy that drifts. Phase 3 deleted that page (it 308s to `/sessions/[key]`
 * now); this component survived, and `/sessions/[key]` is its only caller.
 *
 * `twin-session-card` is carried forward **verbatim** — Spec-CI asserts on it
 * (trap 5), and a testid must not be renamed in the PR that moves what it
 * points at. Same for `resume-capability-badge`, which `ResumePanel` owns.
 *
 * The only addition is {@link SessionCardViewProps.archiveSlot}: the merged
 * page renders the PERMANENT transcript store beside coord's live one there
 * (§1 — there are two stores and they are different things). It is optional,
 * which is what let the environments page keep rendering exactly what it
 * rendered before for the one phase it outlived the extraction.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, GitCommitHorizontal, History, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { relativeTime } from "@/components/operations/utils";
import { LiveTailPane } from "./LiveTailPane";
import { ResumePanel } from "./ResumePanel";
import { TranscriptPane } from "./TranscriptPane";
import type { SessionCard } from "@/services/agent-sessions-api";

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "live":
      return <Badge variant="success">live</Badge>;
    case "stale":
      return <Badge variant="warning">stale</Badge>;
    case "closed":
      return <Badge variant="secondary">closed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

/** Label/value pair for the working_on.session snapshot grid. */
function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-xs font-mono truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

export interface SessionCardViewProps {
  card: SessionCard;
  /**
   * Rendered directly under the Transcript / Live-tail tabs.
   *
   * Those tabs are coord's warm→cold stream — authoritative while the session
   * is open and for ~7 days after it closes. The PERMANENT copy lives in
   * qontinui-web's own archive and is a different object with a different
   * lifetime, so it goes BESIDE them and is labelled, never merged into the
   * same tab strip as though there were one transcript.
   */
  archiveSlot?: ReactNode;
}

export function SessionCardView({ card, archiveSlot }: SessionCardViewProps) {
  const displayName = card.name ?? card.derived_name;
  const workingOn = card.working_on;
  const snapshot = workingOn?.session ?? null;
  const commits = workingOn?.commits ?? [];
  const lineage = workingOn?.lineage ?? [];

  return (
    <div
      className="rounded-lg border border-border"
      data-testid="twin-session-card"
    >
      {/* Header: name + status + identifiers */}
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{displayName}</span>
          <StatusBadge status={card.status} />
          <span
            className="font-mono text-[10px] text-muted-foreground"
            title={card.id}
          >
            {card.id}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
          {card.label && card.label !== card.derived_name && (
            <span>
              derived name{" "}
              <span className="font-mono">{card.derived_name}</span>
            </span>
          )}
          <span>first seen {relativeTime(card.first_seen)}</span>
          <span>last seen {relativeTime(card.last_seen)}</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Machine / environment */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Server className="size-4 text-muted-foreground" />
          {card.machine ? (
            <>
              <Link
                href="/environments/machines"
                className="font-medium text-primary hover:underline"
              >
                {card.machine.name}
              </Link>
              {card.machine.hostname && (
                <span className="font-mono text-xs text-muted-foreground">
                  {card.machine.hostname}
                </span>
              )}
              {card.machine.environment && (
                <Badge variant="outline">{card.machine.environment.name}</Badge>
              )}
            </>
          ) : card.device_id ? (
            <span
              className="font-mono text-xs text-muted-foreground"
              title={card.device_id}
            >
              device {card.device_id}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              no machine binding
            </span>
          )}
        </div>

        {/* Restore capability + "Resume here…" (plan
            `2026-07-09-runner-session-history-cloud-sync`, Phase 4).
            Reads the session's newest `restore-record` event and offers
            the Phase-7 handoff toward a picked target device.

            The badge IS the honesty contract and this view only surfaces it:
            `full` → conversation + terminal, `terminal_only` → a FRESH
            conversation with the terminal and cwd only, no restore record →
            not resumable. Nothing here restates or upgrades that claim. */}
        <ResumePanel
          sessionId={card.id}
          sessionClosed={card.status === "closed"}
          currentDeviceId={card.device_id}
        />

        {/* Working-on summary */}
        {card.summary && <p className="text-sm">{card.summary}</p>}

        {/* Live session snapshot */}
        {snapshot && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Field label="purpose" value={snapshot.intent_purpose} />
            <Field label="work unit" value={snapshot.work_unit_slug} />
            <Field label="topic" value={snapshot.correlation_topic} />
            <Field label="repo" value={snapshot.repo} />
            <Field label="branch" value={snapshot.branch} />
            <Field label="provider" value={snapshot.provider} />
            <Field label="kind" value={snapshot.session_kind} />
            <Field label="state" value={snapshot.state} />
          </dl>
        )}

        {/* Recent commits */}
        {commits.length > 0 && (
          <div>
            <h4 className="text-xs font-medium flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <GitCommitHorizontal className="size-3.5" />
              Recent commits
            </h4>
            <ul className="space-y-1">
              {commits.map((c, idx) => (
                <li
                  key={`${c.repo}:${c.sha}:${idx}`}
                  className="flex flex-wrap items-center gap-x-2 text-xs"
                >
                  <span className="font-mono">
                    {c.repo}
                    {c.branch ? `@${c.branch}` : ""}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {shortSha(c.sha)}
                  </span>
                  <span className="text-muted-foreground">
                    {relativeTime(c.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Lineage timeline. A plain chronological list rather than the
            shared <LineageTimeline /> — the card's lineage `kind` is an
            open string set, and LineageTimeline silently drops kinds
            outside its fixed four-kind union. */}
        {lineage.length > 0 && (
          <div>
            <h4 className="text-xs font-medium flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <History className="size-3.5" />
              Lineage
            </h4>
            <ul className="space-y-1">
              {lineage.map((entry, idx) => (
                <li
                  key={`${entry.kind}:${entry.handle}:${idx}`}
                  className="flex flex-wrap items-center gap-x-2 text-xs"
                >
                  <Badge variant="outline">{entry.kind}</Badge>
                  <span className="font-mono truncate max-w-[28rem]">
                    {entry.handle}
                  </span>
                  <span className="text-muted-foreground">
                    {relativeTime(entry.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Session content — Transcript + Live tail (plan
            `2026-07-09-runner-session-history-cloud-sync`, Phases 2 + 6).
            Both panes read coord's `GET /sessions/:id/output` (+ the
            `/events` SSE stream) through the web-backend operations
            proxy, keyed on the card's session id — coord's read path
            resolves the twin session key via
            `coord.sessions.claude_code_session_id` (plan §3.2 join key).
            Inactive tab content is unmounted by Radix, so the SSE
            connection only exists while "Live tail" is open. */}
        <Tabs defaultValue="transcript">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="live-tail">Live tail</TabsTrigger>
          </TabsList>
          <TabsContent value="transcript" className="mt-3">
            <TranscriptPane
              sessionId={card.id}
              sessionClosed={card.status === "closed"}
            />
          </TabsContent>
          <TabsContent value="live-tail" className="mt-3">
            <LiveTailPane
              sessionId={card.id}
              sessionClosed={card.status === "closed"}
            />
          </TabsContent>
        </Tabs>

        {archiveSlot}
      </div>
    </div>
  );
}
