"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Terminal,
  Bot,
  Workflow,
  PlayCircle,
  Bug,
  Activity,
  GitBranch,
  Cpu,
  Lock,
  Ban,
  Link2,
  Check,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { relativeTime } from "@/components/operations/utils";
import {
  getSessionClaims,
  getSessionAgentStatus,
  getSessionLineage,
  listRegisteredRepos,
  registeredRepoSlugs,
} from "./api";
import { classifyHeartbeat } from "./types";
import type { SessionRow, SessionIntent, AgentStatus } from "./types";

interface SessionCardProps {
  session: SessionRow;
  hostnameFor?: (deviceId: string) => string | undefined;
  /**
   * Tenant-name lookup. When provided AND the resolved name is
   * non-empty, the card renders a tenant chip identifying which
   * tenant the session belongs to — only meaningful when the page is
   * showing the cross-tenant union view. Omit (default) for the
   * single-tenant case to keep the card chrome-free.
   */
  tenantNameFor?: (tenantId: string) => string | undefined;
}

const KIND_ICON: Record<string, React.ElementType> = {
  terminal_shell: Terminal,
  terminal_claude: Bot,
  agentic: Bot,
  workflow: Workflow,
  automation: PlayCircle,
  debug: Bug,
};

const KIND_LABEL: Record<string, string> = {
  terminal_shell: "Shell",
  terminal_claude: "Claude",
  agentic: "Agentic",
  workflow: "Workflow",
  automation: "Automation",
  debug: "Debug",
};

/** Display label for `coord.sessions.provider` (Phase 6). Unknown providers
 * fall back to a title-cased raw value so a new provider still renders. */
const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

function providerLabel(provider: string): string {
  return (
    PROVIDER_LABEL[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

/** Per-provider chip color so claude vs codex are distinguishable at a glance. */
function providerBadgeClass(provider: string): string {
  switch (provider) {
    case "claude":
      return "border-orange-500/40 text-orange-300 bg-orange-500/5";
    case "codex":
      return "border-emerald-500/40 text-emerald-300 bg-emerald-500/5";
    case "gemini":
      return "border-sky-500/40 text-sky-300 bg-sky-500/5";
    default:
      return "border-border text-muted-foreground bg-muted/10";
  }
}

function heartbeatBadgeClass(
  health: ReturnType<typeof classifyHeartbeat>
): string {
  switch (health) {
    case "fresh":
      return "border-green-500/40 text-green-400 bg-green-500/5";
    case "stale":
      return "border-yellow-500/50 text-yellow-300 bg-yellow-500/10";
    case "dead":
      return "border-red-500/60 text-red-300 bg-red-500/10";
    case "unknown":
      return "border-border text-muted-foreground bg-muted/10";
  }
}

function heartbeatLabel(
  health: ReturnType<typeof classifyHeartbeat>,
  lastHeartbeatAt: string | null
): string {
  switch (health) {
    case "fresh":
      return `Heartbeat ${relativeTime(lastHeartbeatAt)}`;
    case "stale":
      return `Stale (3 missed) — ${relativeTime(lastHeartbeatAt)}`;
    case "dead":
      return `Auto-close pending — ${relativeTime(lastHeartbeatAt)}`;
    case "unknown":
      return "No heartbeat yet";
  }
}

function stateBadgeClass(state: string): string {
  switch (state) {
    case "active":
      return "border-blue-500/40 text-blue-300 bg-blue-500/10";
    case "pending_resolution":
      return "border-orange-500/50 text-orange-300 bg-orange-500/10";
    case "stale":
      return "border-yellow-500/50 text-yellow-300 bg-yellow-500/10";
    case "closed":
      return "border-border text-muted-foreground bg-muted/10";
    default:
      return "border-border text-muted-foreground";
  }
}

function getIntentPurpose(intent: SessionRow["intent"]): string {
  if (intent && typeof intent === "object" && "purpose" in intent) {
    const p = (intent as SessionIntent).purpose;
    if (typeof p === "string" && p.length > 0) return p;
  }
  return "(no purpose declared)";
}

export function SessionCard({
  session,
  hostnameFor,
  tenantNameFor,
}: SessionCardProps) {
  const Icon = KIND_ICON[session.session_kind] ?? Cpu;
  const kindLabel = KIND_LABEL[session.session_kind] ?? session.session_kind;
  const health = classifyHeartbeat(session.last_heartbeat_at);
  const hostname = hostnameFor?.(session.device_id);
  const identity = hostname ?? `${session.device_id.slice(0, 8)}…`;
  const tenantLabel = tenantNameFor?.(session.tenant_id);

  const purpose = getIntentPurpose(session.intent);
  const repo = session.repo;
  const branch = session.branch;

  const [claimsCount, setClaimsCount] = useState<number | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [repoCoordinated, setRepoCoordinated] = useState<boolean | null>(null);
  const [lineageCount, setLineageCount] = useState<number | null>(null);

  useEffect(() => {
    if (session.state === "closed") return;
    const ctrl = new AbortController();
    void getSessionClaims(session.id, ctrl.signal)
      .then((res) => setClaimsCount(res.claims?.length ?? res.count ?? 0))
      .catch(() => {});
    void getSessionAgentStatus(session.id, ctrl.signal)
      .then((res) => {
        const first = res.agents?.[0] ?? null;
        setAgentStatus(first);
      })
      .catch(() => {});
    void getSessionLineage(session.id, ctrl.signal)
      .then((res) => setLineageCount(res.actions?.length ?? 0))
      .catch(() => {});
    if (repo) {
      void listRegisteredRepos(ctrl.signal)
        .then((repos) => setRepoCoordinated(registeredRepoSlugs(repos).has(repo)))
        .catch(() => {});
    }
    return () => ctrl.abort();
  }, [session.id, session.state, repo]);

  return (
    <Link
      href={`/sessions/${session.id}`}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-xl"
      data-ui-bridge-id="sessions.card-link"
      data-session-id={session.id}
    >
      <Card
        className="transition-shadow hover:shadow-lg gap-2 py-3"
        data-ui-bridge-id="sessions.card"
        data-session-state={session.state}
        data-session-kind={session.session_kind}
      >
        <CardContent className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="font-medium truncate"
                    data-ui-bridge-id="sessions.card-host"
                  >
                    {identity}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="font-mono text-[11px]"
                >
                  device_id {session.device_id}
                </TooltipContent>
              </Tooltip>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0"
                data-ui-bridge-id="sessions.card-kind"
              >
                {kindLabel}
              </Badge>
              {session.provider && (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${providerBadgeClass(session.provider)}`}
                  data-ui-bridge-id="sessions.card-provider"
                  data-provider={session.provider}
                >
                  {providerLabel(session.provider)}
                </Badge>
              )}
              {tenantLabel && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-blue-500/40 text-blue-300 bg-blue-500/5"
                  data-ui-bridge-id="sessions.card-tenant"
                  data-tenant-id={session.tenant_id}
                >
                  {tenantLabel}
                </Badge>
              )}
            </div>
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${stateBadgeClass(session.state)}`}
              data-ui-bridge-id="sessions.card-state"
            >
              {session.state}
            </Badge>
          </div>

          <p
            className="text-sm text-foreground/90 line-clamp-2"
            data-ui-bridge-id="sessions.card-purpose"
            title={purpose}
          >
            {purpose}
          </p>

          {(repo || branch) && (
            <div
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              data-ui-bridge-id="sessions.card-repo-branch"
            >
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="font-mono truncate">
                {repo ?? "(no repo)"}
                {branch ? ` · ${branch}` : ""}
              </span>
              {repo && repoCoordinated === true && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 gap-0.5 border-green-500/40 text-green-400 bg-green-500/5 shrink-0"
                  data-ui-bridge-id="sessions.card-repo-coordinated"
                >
                  <Check className="h-2.5 w-2.5" />
                  Coordinated
                </Badge>
              )}
              {repo && repoCoordinated === false && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 gap-0.5 border-yellow-500/40 text-yellow-300 bg-yellow-500/5 shrink-0"
                  data-ui-bridge-id="sessions.card-repo-uncoordinated"
                >
                  <AlertTriangle className="h-2.5 w-2.5" />
                  Uncoordinated
                </Badge>
              )}
            </div>
          )}

          {(claimsCount !== null && claimsCount > 0) ||
           agentStatus?.blocked_on ||
           agentStatus?.correlation_topic ||
           (lineageCount !== null && lineageCount > 0) ? (
            <div
              className="flex flex-wrap items-center gap-1.5"
              data-ui-bridge-id="sessions.card-coordination"
            >
              {claimsCount !== null && claimsCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 gap-1 border-purple-500/40 text-purple-300 bg-purple-500/5"
                  data-ui-bridge-id="sessions.card-claims"
                >
                  <Lock className="h-2.5 w-2.5" />
                  {claimsCount} {claimsCount === 1 ? "file locked" : "files locked"}
                </Badge>
              )}
              {agentStatus?.blocked_on && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 gap-1 border-red-500/40 text-red-300 bg-red-500/5"
                  data-ui-bridge-id="sessions.card-blocked"
                >
                  <Ban className="h-2.5 w-2.5" />
                  blocked
                </Badge>
              )}
              {agentStatus?.correlation_topic && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 gap-1 border-cyan-500/40 text-cyan-300 bg-cyan-500/5"
                  data-ui-bridge-id="sessions.card-correlation"
                >
                  <Link2 className="h-2.5 w-2.5" />
                  {agentStatus.correlation_topic}
                </Badge>
              )}
              {lineageCount !== null && lineageCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 gap-1 border-indigo-500/40 text-indigo-300 bg-indigo-500/5"
                  data-ui-bridge-id="sessions.card-lineage"
                >
                  <Layers className="h-2.5 w-2.5" />
                  {lineageCount} coord {lineageCount === 1 ? "action" : "actions"}
                </Badge>
              )}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground pt-1 border-t border-border">
            <Tooltip>
              <TooltipTrigger asChild>
                <span data-ui-bridge-id="sessions.card-started-at">
                  Started {relativeTime(session.started_at)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {session.started_at
                  ? new Date(session.started_at).toLocaleString()
                  : "never"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 gap-1 ${heartbeatBadgeClass(health)}`}
                  data-ui-bridge-id="sessions.card-heartbeat"
                  data-heartbeat-health={health}
                >
                  <Activity className="h-2.5 w-2.5" />
                  {relativeTime(session.last_heartbeat_at)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {heartbeatLabel(health, session.last_heartbeat_at)}
              </TooltipContent>
            </Tooltip>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
