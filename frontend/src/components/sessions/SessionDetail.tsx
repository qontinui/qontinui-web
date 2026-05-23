"use client";

/**
 * Session detail view — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Bundles together:
 *   - Header: session metadata (kind, host, repo, branch, intent purpose)
 *   - Events timeline: replay + JetStream live-tail via SSE
 *   - Held claims: cross-references the existing `/coord/claims/list`
 *     proxy by `device_id` (machine_id-keyed)
 *   - Actions: Close (DELETE /sessions/:id). Phase 6 layers Steal on
 *     top of the same wire shape.
 *
 * Hostname resolution: caller passes `hostnameFor` (same prop as the
 * list). The events SSE is bridged through the web backend so the
 * browser stays same-origin.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Power,
  Loader2,
  AlertTriangle,
  GitBranch,
  Terminal,
  Bot,
  Workflow,
  PlayCircle,
  Bug,
  Cpu,
  Activity as ActivityIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { relativeTime } from "@/components/operations/utils";
import {
  closeSession,
  getSession,
  subscribeSessionEvents,
} from "./api";
import { classifyHeartbeat } from "./types";
import type { SessionEventRow, SessionRow, SessionIntent } from "./types";

interface SessionDetailProps {
  sessionId: string;
  hostnameFor?: (deviceId: string) => string | undefined;
}

const KIND_ICON: Record<string, React.ElementType> = {
  terminal_shell: Terminal,
  terminal_claude: Bot,
  agentic: Bot,
  workflow: Workflow,
  automation: PlayCircle,
  debug: Bug,
};

const EVENT_KIND_COLORS: Record<string, string> = {
  started: "border-blue-500/40 text-blue-300 bg-blue-500/10",
  state_change: "border-purple-500/40 text-purple-300 bg-purple-500/10",
  heartbeat: "border-green-500/30 text-green-400 bg-green-500/5",
  closed: "border-muted text-muted-foreground bg-muted/30",
  claim_stolen: "border-red-500/50 text-red-300 bg-red-500/10",
  output_chunk: "border-cyan-500/30 text-cyan-300 bg-cyan-500/5",
  handoff_request: "border-orange-500/50 text-orange-300 bg-orange-500/10",
};

function eventKindBadgeClass(kind: string): string {
  return (
    EVENT_KIND_COLORS[kind] ?? "border-border text-muted-foreground bg-muted/30"
  );
}

function getIntent(intent: SessionRow["intent"]): SessionIntent {
  if (intent && typeof intent === "object") {
    return intent as SessionIntent;
  }
  return { purpose: "" };
}

export function SessionDetail({ sessionId, hostnameFor }: SessionDetailProps) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [events, setEvents] = useState<SessionEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Fetch the session row.
  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const row = await getSession(sessionId, ctrl.signal);
        setSession(row);
        setError(null);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "failed to load session"
        );
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [sessionId]);

  // Subscribe to events SSE.
  useEffect(() => {
    const cleanup = subscribeSessionEvents(sessionId, {
      onEvent: (row) => {
        setEvents((prev) => {
          // Dedup on (session_id, seq) — backend may replay during
          // reconnect.
          if (prev.some((e) => e.seq === row.seq)) return prev;
          // Keep newest first; the SSE replay arrives oldest-first
          // per coord's design.
          const next = [...prev, row];
          next.sort((a, b) => b.seq - a.seq);
          return next.slice(0, 200);
        });
      },
      onError: (err) => {
        setStreamError(err instanceof Error ? err.message : String(err));
      },
    });
    return cleanup;
  }, [sessionId]);

  const onClose = useCallback(async () => {
    if (!session) return;
    setClosing(true);
    setCloseError(null);
    try {
      const row = await closeSession(session.id);
      setSession(row);
    } catch (err) {
      setCloseError(
        err instanceof Error ? err.message : "failed to close session"
      );
    } finally {
      setClosing(false);
    }
  }, [session]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading session…</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <AlertTriangle className="h-10 w-10 opacity-40" />
        <p className="text-sm font-medium">Session not available</p>
        <p className="text-xs max-w-md text-center">
          {error ?? "no session row returned"}
        </p>
        <Link href="/sessions">
          <Button size="sm" variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to sessions
          </Button>
        </Link>
      </div>
    );
  }

  const intent = getIntent(session.intent);
  const Icon = KIND_ICON[session.session_kind] ?? Cpu;
  const hostname = hostnameFor?.(session.device_id);
  const identity = hostname ?? `${session.device_id.slice(0, 8)}…`;
  const health = classifyHeartbeat(session.last_heartbeat_at);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="space-y-4"
        data-ui-bridge-id="sessions.detail"
        data-session-id={session.id}
      >
        {/* Header strip with back + actions */}
        <div className="flex items-center justify-between gap-3">
          <Link href="/sessions">
            <Button size="sm" variant="ghost">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to sessions
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs"
              data-ui-bridge-id="sessions.detail-state"
            >
              {session.state}
            </Badge>
            {session.state !== "closed" && (
              <Button
                size="sm"
                variant="outline"
                onClick={onClose}
                disabled={closing}
                data-ui-bridge-id="sessions.detail-close"
              >
                {closing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Power className="h-4 w-4 mr-2" />
                )}
                Close session
              </Button>
            )}
          </div>
        </div>

        {closeError && (
          <Card className="border-red-500/40 bg-red-500/5">
            <CardContent className="text-xs text-red-300 py-3">
              {closeError}
            </CardContent>
          </Card>
        )}

        {/* Metadata card */}
        <Card data-ui-bridge-id="sessions.detail-metadata">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span data-ui-bridge-id="sessions.detail-host">{identity}</span>
              <Badge variant="outline" className="text-[10px]">
                {session.session_kind}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Purpose
              </p>
              <p
                className="text-sm"
                data-ui-bridge-id="sessions.detail-purpose"
              >
                {intent.purpose || "(no purpose declared)"}
              </p>
            </div>

            {(session.repo || session.branch) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Repo / Branch
                </p>
                <p
                  className="text-sm font-mono flex items-center gap-1"
                  data-ui-bridge-id="sessions.detail-repo-branch"
                >
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  {session.repo ?? "(no repo)"}
                  {session.branch ? ` · ${session.branch}` : ""}
                </p>
              </div>
            )}

            {intent.declared_paths && intent.declared_paths.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Declared paths
                </p>
                <ul
                  className="text-xs font-mono space-y-0.5"
                  data-ui-bridge-id="sessions.detail-declared-paths"
                >
                  {intent.declared_paths.map((p, i) => (
                    <li key={`${p}-${i}`} className="truncate">
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="uppercase tracking-wider text-muted-foreground mb-1">
                  Started
                </p>
                <p data-ui-bridge-id="sessions.detail-started-at">
                  {session.started_at
                    ? new Date(session.started_at).toLocaleString()
                    : "—"}
                </p>
                <p className="text-muted-foreground">
                  {relativeTime(session.started_at)}
                </p>
              </div>
              <div>
                <p className="uppercase tracking-wider text-muted-foreground mb-1">
                  Last heartbeat
                </p>
                <p
                  className="flex items-center gap-1"
                  data-ui-bridge-id="sessions.detail-heartbeat"
                  data-heartbeat-health={health}
                >
                  <ActivityIcon className="h-3 w-3 text-muted-foreground" />
                  {relativeTime(session.last_heartbeat_at)}
                </p>
                <p className="text-muted-foreground">
                  {health === "dead"
                    ? "Auto-close pending"
                    : health === "stale"
                      ? "3 missed beats"
                      : health === "fresh"
                        ? "Healthy"
                        : "no heartbeat yet"}
                </p>
              </div>
            </div>

            {(intent.share_output || intent.redact_secrets !== undefined) && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Output policy
                </p>
                <div className="flex flex-wrap gap-1">
                  {intent.share_output && (
                    <Badge variant="outline" className="text-[10px]">
                      output streaming on
                    </Badge>
                  )}
                  {intent.redact_secrets !== false && (
                    <Badge variant="outline" className="text-[10px]">
                      redact_secrets
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {session.parent_session_id && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                  Parent (handoff origin)
                </p>
                <Link
                  href={`/sessions/${session.parent_session_id}`}
                  className="text-xs font-mono text-primary hover:underline"
                  data-ui-bridge-id="sessions.detail-parent-link"
                >
                  {session.parent_session_id}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Events timeline */}
        <Card data-ui-bridge-id="sessions.detail-events">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Events
              <Badge variant="outline" className="text-[10px]">
                {events.length}
              </Badge>
              {streamError && (
                <Badge variant="destructive" className="text-[10px]">
                  stream error
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No events yet. The SSE stream replays the last 100
                events and then live-tails — events arrive within
                seconds of the source machine emitting them.
              </p>
            ) : (
              <ScrollArea className="max-h-[400px] pr-3">
                <ul
                  className="space-y-1.5"
                  data-ui-bridge-id="sessions.detail-events-list"
                >
                  {events.map((evt) => (
                    <li
                      key={evt.seq}
                      className="rounded-md border border-border/40 bg-muted/20 px-3 py-2"
                      data-ui-bridge-id="sessions.detail-event-row"
                      data-event-kind={evt.event_kind}
                      data-event-seq={evt.seq}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${eventKindBadgeClass(evt.event_kind)}`}
                        >
                          {evt.event_kind}
                        </Badge>
                        <span
                          className="text-muted-foreground tabular-nums"
                          title={new Date(evt.occurred_at).toLocaleString()}
                        >
                          seq {evt.seq} · {relativeTime(evt.occurred_at)}
                        </span>
                      </div>
                      {evt.payload && Object.keys(evt.payload).length > 0 && (
                        <pre className="mt-2 text-[10px] font-mono text-muted-foreground/90 whitespace-pre-wrap break-all">
                          {JSON.stringify(evt.payload, null, 2)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
