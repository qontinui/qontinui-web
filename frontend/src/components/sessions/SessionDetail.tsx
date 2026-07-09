"use client";

/**
 * Session detail view — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Bundles together:
 *   - Header: session metadata (kind, host, repo, branch, intent purpose)
 *   - Events timeline: replay + JetStream live-tail via SSE
 *   - Coordination: claims (file locks) + agent_status overlay (Phase 3.3)
 *   - Held claims: cross-references the existing `/coord/claims/list`
 *     proxy by `device_id` (machine_id-keyed)
 *   - Actions: Close (DELETE /sessions/:id). Phase 6 layers Steal on
 *     top of the same wire shape.
 *
 * Hostname resolution: caller passes `hostnameFor` (same prop as the
 * list). The events SSE is bridged through the web backend so the
 * browser stays same-origin.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Swords,
  ArrowRightLeft,
  Lock,
  Ban,
  Link2,
  FileText,
  Globe,
  Check,
  ExternalLink,
  Layers,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { relativeTime } from "@/components/operations/utils";
import {
  closeSession,
  getSession,
  getSessionClaims,
  getSessionAgentStatus,
  getSessionLineage,
  subscribeSessionEvents,
  listRegisteredRepos,
  findRegisteredRepo,
  registeredRepoSlugs,
} from "./api";
import { LineageTimeline } from "./LineageTimeline";
import { classifyHeartbeat } from "./types";
import { StealModal, getDashboardMachineId } from "./StealModal";
import { HandoffModal, type HandoffTarget } from "./HandoffModal";
import { OutputPane } from "./OutputPane";
import {
  filterEventsByPolicy,
  type ClaimStolenPayload,
  type ClaimStealVisibility,
} from "./visibility";
import type {
  SessionEventRow,
  SessionRow,
  SessionIntent,
  SessionClaim,
  AgentStatus,
  RegisteredRepo,
  LineageAction,
} from "./types";

interface SessionDetailProps {
  sessionId: string;
  hostnameFor?: (deviceId: string) => string | undefined;
  handoffTargets?: HandoffTarget[];
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

function mirrorStateBadgeClass(state: string): string {
  switch (state) {
    case "synced":
      return "border-green-500/40 text-green-400 bg-green-500/5";
    case "drifting":
      return "border-yellow-500/40 text-yellow-300 bg-yellow-500/5";
    case "error":
      return "border-red-500/40 text-red-300 bg-red-500/5";
    default:
      return "border-border text-muted-foreground bg-muted/10";
  }
}

export function SessionDetail({
  sessionId,
  hostnameFor,
  handoffTargets = [],
}: SessionDetailProps) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [events, setEvents] = useState<SessionEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [stealOpen, setStealOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);

  const [claims, setClaims] = useState<SessionClaim[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [lineageActions, setLineageActions] = useState<LineageAction[]>([]);
  const [coordLoading, setCoordLoading] = useState(true);
  const [repoRegistration, setRepoRegistration] =
    useState<RegisteredRepo | null>(null);
  const [repoIsCoordinated, setRepoIsCoordinated] = useState<boolean | null>(
    null
  );

  const dashboardMachineId = useMemo(() => getDashboardMachineId(), []);

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const row = await getSession(sessionId, ctrl.signal);
        setSession(row);
        setError(null);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "failed to load session");
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [sessionId]);

  useEffect(() => {
    const ctrl = new AbortController();
    setCoordLoading(true);
    Promise.allSettled([
      getSessionClaims(sessionId, ctrl.signal),
      getSessionAgentStatus(sessionId, ctrl.signal),
      getSessionLineage(sessionId, ctrl.signal),
    ]).then(([claimsResult, statusResult, lineageResult]) => {
      if (claimsResult.status === "fulfilled") {
        setClaims(claimsResult.value.claims ?? []);
      }
      if (statusResult.status === "fulfilled") {
        setAgentStatuses(statusResult.value.agents ?? []);
      }
      if (lineageResult.status === "fulfilled") {
        setLineageActions(lineageResult.value.actions ?? []);
      }
      setCoordLoading(false);
    });
    return () => ctrl.abort();
  }, [sessionId]);

  useEffect(() => {
    if (!session?.repo) return;
    const ctrl = new AbortController();
    void listRegisteredRepos(ctrl.signal)
      .then((repos) => {
        const match = findRegisteredRepo(repos, session.repo!);
        setRepoIsCoordinated(registeredRepoSlugs(repos).has(session.repo!));
        setRepoRegistration(match ?? null);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [session?.repo]);

  useEffect(() => {
    const cleanup = subscribeSessionEvents(sessionId, {
      onEvent: (row) => {
        if (row.event_kind === "output_chunk") return;
        setEvents((prev) => {
          if (prev.some((e) => e.seq === row.seq)) return prev;
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

  const visibleEvents = useMemo(
    () =>
      filterEventsByPolicy(events, {
        viewerMachineId: dashboardMachineId,
        sessionDeviceId: session?.device_id,
      }),
    [events, dashboardMachineId, session?.device_id]
  );

  const primaryAgent = agentStatuses[0] ?? null;
  const correlatedAgents = useMemo(() => {
    if (!primaryAgent?.correlation_topic) return [];
    return agentStatuses.filter(
      (a) =>
        a.correlation_topic === primaryAgent.correlation_topic &&
        a.id !== primaryAgent.id
    );
  }, [agentStatuses, primaryAgent]);

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
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setHandoffOpen(true)}
                  data-ui-bridge-id="sessions.detail-handoff"
                >
                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                  Continue elsewhere
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setStealOpen(true)}
                  data-ui-bridge-id="sessions.detail-steal"
                >
                  <Swords className="h-4 w-4 mr-2" />
                  Steal claim
                </Button>
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
              </>
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
              {session.provider && (
                <Badge
                  variant="outline"
                  className="text-[10px] capitalize"
                  data-ui-bridge-id="sessions.detail-provider"
                  data-provider={session.provider}
                >
                  {session.provider}
                </Badge>
              )}
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
                <div className="space-y-1.5">
                  <p
                    className="text-sm font-mono flex items-center gap-1.5"
                    data-ui-bridge-id="sessions.detail-repo-branch"
                  >
                    <GitBranch className="h-3 w-3 text-muted-foreground" />
                    {session.repo ?? "(no repo)"}
                    {session.branch ? ` · ${session.branch}` : ""}
                  </p>
                  {session.repo && repoIsCoordinated === true && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 gap-0.5 border-green-500/40 text-green-400 bg-green-500/5"
                        data-ui-bridge-id="sessions.detail-repo-coordinated"
                      >
                        <Check className="h-2.5 w-2.5" />
                        Coordinated
                      </Badge>
                      {repoRegistration?.mirror_state && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${mirrorStateBadgeClass(repoRegistration.mirror_state)}`}
                          data-ui-bridge-id="sessions.detail-repo-mirror"
                        >
                          {repoRegistration.mirror_state}
                        </Badge>
                      )}
                      {repoRegistration?.last_reconciled_at && (
                        <span className="text-[10px] text-muted-foreground">
                          Reconciled{" "}
                          {relativeTime(repoRegistration.last_reconciled_at)}
                        </span>
                      )}
                    </div>
                  )}
                  {session.repo && repoIsCoordinated === false && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 gap-0.5 border-yellow-500/40 text-yellow-300 bg-yellow-500/5"
                      data-ui-bridge-id="sessions.detail-repo-uncoordinated"
                    >
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Uncoordinated
                    </Badge>
                  )}
                  {session.repo && repoIsCoordinated !== null && (
                    <Link
                      href="/settings/repos"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      data-ui-bridge-id="sessions.detail-manage-repos-link"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Manage repositories
                    </Link>
                  )}
                </div>
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

        {/* Coordination card (Phase 3.3) */}
        <CoordinationCard
          claims={claims}
          agentStatuses={agentStatuses}
          lineageActions={lineageActions}
          primaryAgent={primaryAgent}
          correlatedAgents={correlatedAgents}
          loading={coordLoading}
        />

        <OutputPane session={session} />

        {/* Events timeline */}
        <Card data-ui-bridge-id="sessions.detail-events">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Events
              <Badge variant="outline" className="text-[10px]">
                {visibleEvents.length}
              </Badge>
              {visibleEvents.length !== events.length && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-muted-foreground"
                >
                  {events.length - visibleEvents.length} hidden
                </Badge>
              )}
              {streamError && (
                <Badge variant="destructive" className="text-[10px]">
                  stream error
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {visibleEvents.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No events yet. The SSE stream replays the last 100 events and
                then live-tails — events arrive within seconds of the source
                machine emitting them.
              </p>
            ) : (
              <ScrollArea className="max-h-[400px] pr-3">
                <ul
                  className="space-y-1.5"
                  data-ui-bridge-id="sessions.detail-events-list"
                >
                  {visibleEvents.map((evt) => (
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
                      {evt.event_kind === "claim_stolen" ? (
                        <ClaimStolenRow
                          payload={evt.payload as ClaimStolenPayload}
                          hostnameFor={hostnameFor}
                        />
                      ) : (
                        evt.payload &&
                        Object.keys(evt.payload).length > 0 && (
                          <pre className="mt-2 text-[10px] font-mono text-muted-foreground/90 whitespace-pre-wrap break-all">
                            {JSON.stringify(evt.payload, null, 2)}
                          </pre>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <StealModal
        open={stealOpen}
        onOpenChange={setStealOpen}
        session={session}
        hostnameFor={hostnameFor}
        onSucceeded={() => {
          void getSession(session.id)
            .then(setSession)
            .catch(() => {});
        }}
      />

      <HandoffModal
        open={handoffOpen}
        onOpenChange={setHandoffOpen}
        sessionId={session.id}
        currentDeviceId={session.device_id}
        candidates={handoffTargets}
        onSucceeded={() => {
          void getSession(session.id)
            .then(setSession)
            .catch(() => {});
        }}
      />
    </TooltipProvider>
  );
}

function CoordinationCard({
  claims,
  agentStatuses,
  lineageActions,
  primaryAgent,
  correlatedAgents,
  loading,
}: {
  claims: SessionClaim[];
  agentStatuses: AgentStatus[];
  lineageActions: LineageAction[];
  primaryAgent: AgentStatus | null;
  correlatedAgents: AgentStatus[];
  loading: boolean;
}) {
  const [lineageOpen, setLineageOpen] = useState(false);
  const hasData =
    claims.length > 0 || agentStatuses.length > 0 || lineageActions.length > 0;

  if (loading) {
    return (
      <Card data-ui-bridge-id="sessions.detail-coordination">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Coordination
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading coordination data...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasData) {
    return (
      <Card data-ui-bridge-id="sessions.detail-coordination">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Coordination
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs italic text-muted-foreground">
            No active claims or agent status for this session&apos;s device.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-ui-bridge-id="sessions.detail-coordination">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Coordination
          {claims.length > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-purple-500/40 text-purple-300"
            >
              <Lock className="h-2.5 w-2.5" />
              {claims.length} {claims.length === 1 ? "claim" : "claims"}
            </Badge>
          )}
          {primaryAgent?.blocked_on && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-red-500/40 text-red-300"
            >
              <Ban className="h-2.5 w-2.5" />
              blocked
            </Badge>
          )}
          {lineageActions.length > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-indigo-500/40 text-indigo-300"
              data-ui-bridge-id="sessions.detail-lineage-badge"
            >
              <Layers className="h-2.5 w-2.5" />
              {lineageActions.length} coord{" "}
              {lineageActions.length === 1 ? "action" : "actions"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {claims.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Active claims (file locks)
            </p>
            <div className="space-y-1">
              {claims.map((claim) => (
                <div
                  key={claim.id}
                  className="flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 rounded-md bg-muted/40"
                  data-ui-bridge-id="sessions.detail-claim-row"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3 w-3 text-purple-400 shrink-0" />
                    <span className="font-mono truncate">
                      {claim.resource_key}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {claim.kind}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {relativeTime(claim.acquired_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {primaryAgent && (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Agent status
            </p>
            <div className="space-y-2">
              {primaryAgent.status_text && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Status: </span>
                  <span>{primaryAgent.status_text}</span>
                </div>
              )}
              {primaryAgent.blocked_on && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Blocked on: </span>
                  <span className="text-red-300 font-mono">
                    {primaryAgent.blocked_on}
                  </span>
                </div>
              )}
              {primaryAgent.intent_globs &&
                primaryAgent.intent_globs.length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">
                      Intent globs:{" "}
                    </span>
                    <span className="font-mono">
                      {primaryAgent.intent_globs.join(", ")}
                    </span>
                  </div>
                )}
              {primaryAgent.correlation_topic && (
                <div className="text-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Link2 className="h-3 w-3 text-cyan-400" />
                    <span className="text-muted-foreground">
                      Correlation topic:{" "}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 border-cyan-500/40 text-cyan-300"
                    >
                      {primaryAgent.correlation_topic}
                    </Badge>
                  </div>
                  {correlatedAgents.length > 0 && (
                    <div className="ml-4 mt-1 space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">
                        {correlatedAgents.length} other{" "}
                        {correlatedAgents.length === 1 ? "agent" : "agents"} on
                        this topic:
                      </p>
                      {correlatedAgents.map((a) => (
                        <div
                          key={a.id}
                          className="text-[10px] font-mono text-muted-foreground/80 pl-2"
                        >
                          {a.device_id.slice(0, 8)}…
                          {a.status_text ? ` — ${a.status_text}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                Updated {relativeTime(primaryAgent.updated_at)}
              </div>
            </div>
          </div>
        )}

        {lineageActions.length > 0 && (
          <Collapsible
            open={lineageOpen}
            onOpenChange={setLineageOpen}
            data-ui-bridge-id="sessions.detail-lineage"
          >
            <CollapsibleTrigger
              className="flex w-full items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground hover:bg-muted/60"
              data-ui-bridge-id="sessions.detail-lineage-toggle"
            >
              {lineageOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Layers className="h-3.5 w-3.5" />
              Coordination lineage
              <Badge variant="outline" className="ml-auto text-[10px]">
                {lineageActions.length}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <LineageTimeline actions={lineageActions} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function ClaimStolenRow({
  payload,
  hostnameFor,
}: {
  payload: ClaimStolenPayload;
  hostnameFor?: (deviceId: string) => string | undefined;
}) {
  const stealer = payload.stealing_machine_id ?? "(unknown)";
  const victim = payload.originating_machine_id ?? "(unknown)";
  const stealerHost = hostnameFor?.(stealer) ?? `${stealer.slice(0, 8)}…`;
  const victimHost = hostnameFor?.(victim) ?? `${victim.slice(0, 8)}…`;
  const policyTag = (payload.policy as ClaimStealVisibility | undefined) ?? "—";

  return (
    <div
      className="mt-2 space-y-1.5 text-xs"
      data-ui-bridge-id="sessions.detail-claim-stolen"
    >
      <p>
        <span className="font-mono text-red-300">{stealerHost}</span> stole from{" "}
        <span className="font-mono text-muted-foreground">{victimHost}</span>
      </p>
      {payload.reason && (
        <blockquote
          className="border-l-2 border-red-500/40 pl-2 italic text-muted-foreground"
          data-ui-bridge-id="sessions.detail-claim-stolen-reason"
        >
          &ldquo;{payload.reason}&rdquo;
        </blockquote>
      )}
      <p className="text-[10px] text-muted-foreground">
        policy: <code className="font-mono">{policyTag}</code>
      </p>
    </div>
  );
}
