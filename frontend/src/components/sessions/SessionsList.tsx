"use client";

/**
 * SessionsList — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Renders the live grid of `coord.sessions` rows for the operator's
 * tenant, grouped by device (machine). Polls `GET /api/v1/operations/sessions`
 * on a 5s interval.
 *
 * Phase 3.2 enhancement: sessions are grouped by device_id with
 * machine header cards and a cross-machine summary bar showing total
 * sessions, sessions per kind, and active vs stale counts.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  WifiOff,
  Server,
  Activity,
  AlertTriangle,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { SessionCard } from "./SessionCard";
import { listSessions } from "./api";
import type {
  ListSessionsScope,
  ListSessionsTenantScope,
  ListSessionsOptions,
} from "./api";
import type { SessionRow } from "./types";
import { classifyHeartbeat } from "./types";
import { relativeTime } from "@/components/operations/utils";
import { useTenant } from "@/contexts/tenant-context";

const SCOPE_STORAGE_KEY = "qontinui.sessions.scope";
const TENANT_SCOPE_STORAGE_KEY = "qontinui.sessions.tenant_scope";
const POLL_INTERVAL_MS = 5_000;

interface SessionsListProps {
  hostnameFor?: (deviceId: string) => string | undefined;
  pollEnabled?: boolean;
  fetcher?: (opts: ListSessionsOptions) => Promise<{
    count: number;
    scope: string;
    sessions: SessionRow[];
  }>;
}

interface MachineSessionGroup {
  deviceId: string;
  hostname: string;
  sessions: SessionRow[];
  activeSessions: number;
  staleSessions: number;
}

function readStoredScope(): ListSessionsScope {
  if (typeof window === "undefined") return "active";
  const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
  return raw === "all" ? "all" : "active";
}

function writeStoredScope(scope: ListSessionsScope) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, scope);
  } catch {
    // ignore quota / private-mode errors
  }
}

function readStoredTenantScope(): ListSessionsTenantScope {
  if (typeof window === "undefined") return "active";
  const raw = localStorage.getItem(TENANT_SCOPE_STORAGE_KEY);
  return raw === "all" ? "all" : "active";
}

function writeStoredTenantScope(s: ListSessionsTenantScope) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TENANT_SCOPE_STORAGE_KEY, s);
  } catch {
    // ignore quota / private-mode errors
  }
}

function buildMachineGroups(
  sessions: SessionRow[],
  hostnameFor?: (deviceId: string) => string | undefined
): MachineSessionGroup[] {
  const byDevice = new Map<string, SessionRow[]>();
  for (const session of sessions) {
    const key = session.device_id;
    const existing = byDevice.get(key);
    if (existing) {
      existing.push(session);
    } else {
      byDevice.set(key, [session]);
    }
  }

  const groups: MachineSessionGroup[] = [];
  for (const [deviceId, deviceSessions] of byDevice) {
    const sorted = [...deviceSessions].sort((a, b) => {
      const aActive = a.state === "active" ? 0 : 1;
      const bActive = b.state === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const aStarted = a.started_at ? new Date(a.started_at).getTime() : 0;
      const bStarted = b.started_at ? new Date(b.started_at).getTime() : 0;
      return bStarted - aStarted;
    });

    groups.push({
      deviceId,
      hostname: hostnameFor?.(deviceId) ?? `${deviceId.slice(0, 8)}…`,
      sessions: sorted,
      activeSessions: sorted.filter((s) => s.state === "active").length,
      staleSessions: sorted.filter(
        (s) => classifyHeartbeat(s.last_heartbeat_at) === "stale" ||
               classifyHeartbeat(s.last_heartbeat_at) === "dead"
      ).length,
    });
  }

  groups.sort((a, b) => {
    if (a.activeSessions !== b.activeSessions)
      return b.activeSessions - a.activeSessions;
    return a.hostname.localeCompare(b.hostname);
  });

  return groups;
}

function CrossMachineSummary({ sessions }: { sessions: SessionRow[] }) {
  const stats = useMemo(() => {
    const kindCounts = new Map<string, number>();
    let active = 0;
    let stale = 0;
    const deviceIds = new Set<string>();

    for (const s of sessions) {
      deviceIds.add(s.device_id);
      const kind = s.session_kind;
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
      if (s.state === "active") active++;
      const health = classifyHeartbeat(s.last_heartbeat_at);
      if (health === "stale" || health === "dead") stale++;
    }

    return { kindCounts, active, stale, machines: deviceIds.size, total: sessions.length };
  }, [sessions]);

  if (stats.total === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-ui-bridge-id="sessions.summary"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/30">
        <Server className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Machines</span>
        <Badge variant="outline" className="ml-auto text-xs">
          {stats.machines}
        </Badge>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/30">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Active</span>
        <Badge variant="outline" className="ml-auto text-xs border-green-500/40 text-green-400 bg-green-500/5">
          {stats.active}
        </Badge>
      </div>
      {stats.stale > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/30">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Stale</span>
          <Badge variant="outline" className="ml-auto text-xs border-yellow-500/40 text-yellow-300 bg-yellow-500/5">
            {stats.stale}
          </Badge>
        </div>
      )}
      {Array.from(stats.kindCounts.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([kind, count]) => (
          <div
            key={kind}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/30"
          >
            <span className="text-xs text-muted-foreground capitalize">{kind.replace(/_/g, " ")}</span>
            <Badge variant="outline" className="ml-auto text-xs">
              {count}
            </Badge>
          </div>
        ))}
    </div>
  );
}

function MachineHeader({ group }: { group: MachineSessionGroup }) {
  return (
    <div
      className="flex items-center gap-3"
      data-ui-bridge-id="sessions.machine-header"
      data-device-id={group.deviceId}
    >
      <div
        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
          group.activeSessions > 0 && group.staleSessions === 0
            ? "bg-green-500"
            : group.activeSessions > 0
              ? "bg-yellow-500"
              : "bg-muted-foreground/40"
        }`}
      />
      <span className="text-sm font-semibold">{group.hostname}</span>
      <Badge variant="outline" className="text-[10px]">
        {group.sessions.length} {group.sessions.length === 1 ? "session" : "sessions"}
      </Badge>
      {group.staleSessions > 0 && (
        <Badge
          variant="outline"
          className="text-[10px] border-yellow-500/40 text-yellow-300 bg-yellow-500/5"
        >
          {group.staleSessions} stale
        </Badge>
      )}
    </div>
  );
}

export function SessionsList({
  hostnameFor,
  pollEnabled = true,
  fetcher,
}: SessionsListProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [scope, setScope] = useState<ListSessionsScope>(() => readStoredScope());
  const [tenantScope, setTenantScope] = useState<ListSessionsTenantScope>(
    () => readStoredTenantScope()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const { tenants, isMultiTenant } = useTenant();
  const doFetch = fetcher ?? listSessions;

  // For single-tenant operators the tenant-breadth control is
  // structurally hidden; force `tenant_scope=active` over the wire so
  // a stale localStorage entry from a multi-tenant session can't leak
  // a `tenant_scope=all` call.
  const effectiveTenantScope: ListSessionsTenantScope = isMultiTenant
    ? tenantScope
    : "active";

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await doFetch({
          scope,
          tenantScope: effectiveTenantScope,
          signal,
        });
        setSessions(data.sessions ?? []);
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "failed to load sessions"
        );
      } finally {
        setLoading(false);
      }
    },
    [doFetch, scope, effectiveTenantScope]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    if (!pollEnabled) {
      return () => ctrl.abort();
    }
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [refresh, pollEnabled]);

  const onScopeChange = useCallback((next: string) => {
    const nextScope: ListSessionsScope = next === "all" ? "all" : "active";
    setScope(nextScope);
    writeStoredScope(nextScope);
    setLoading(true);
  }, []);

  const onTenantScopeChange = useCallback((next: string) => {
    const nextScope: ListSessionsTenantScope = next === "all" ? "all" : "active";
    setTenantScope(nextScope);
    writeStoredTenantScope(nextScope);
    setLoading(true);
  }, []);

  // Tenant name lookup for the per-card chip (only renders when the
  // user is multi-tenant AND viewing the union).
  const tenantNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tenants) {
      m.set(t.id, t.name || t.slug || t.id.slice(0, 8));
    }
    return m;
  }, [tenants]);

  const machineGroups = useMemo(
    () => buildMachineGroups(sessions, hostnameFor),
    [sessions, hostnameFor]
  );

  const totalSessions = sessions.length;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="space-y-4"
        data-ui-bridge-id="sessions.list"
        data-session-count={totalSessions}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={scope} onValueChange={onScopeChange}>
              <TabsList data-ui-bridge-id="sessions.scope-tabs">
                <TabsTrigger
                  value="active"
                  data-ui-bridge-id="sessions.scope-active"
                >
                  Active
                </TabsTrigger>
                <TabsTrigger
                  value="all"
                  data-ui-bridge-id="sessions.scope-all"
                >
                  All sessions
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {isMultiTenant && (
              <Tabs
                value={tenantScope}
                onValueChange={onTenantScopeChange}
              >
                <TabsList data-ui-bridge-id="sessions.tenant-scope-tabs">
                  <TabsTrigger
                    value="active"
                    data-ui-bridge-id="sessions.tenant-scope-active"
                  >
                    Active tenant
                  </TabsTrigger>
                  <TabsTrigger
                    value="all"
                    data-ui-bridge-id="sessions.tenant-scope-all"
                  >
                    All my tenants
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline" data-ui-bridge-id="sessions.count-badge">
              {totalSessions}{" "}
              {totalSessions === 1 ? "session" : "sessions"}
            </Badge>
            {error && (
              <Badge
                variant="destructive"
                className="gap-1"
                data-ui-bridge-id="sessions.error-badge"
              >
                <WifiOff className="h-3 w-3" />
                error
              </Badge>
            )}
            <span>
              Updated{" "}
              {lastUpdated ? relativeTime(lastUpdated.toISOString()) : "--"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
              data-ui-bridge-id="sessions.refresh-button"
              aria-label="Refresh sessions"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {loading && totalSessions === 0 ? (
          <div
            className="flex items-center justify-center py-16 text-muted-foreground gap-2"
            data-ui-bridge-id="sessions.loading"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading sessions…</span>
          </div>
        ) : error && totalSessions === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground"
            data-ui-bridge-id="sessions.error-state"
          >
            <WifiOff className="h-10 w-10 opacity-40" />
            <p className="text-sm font-medium">Sessions API unreachable</p>
            <p className="text-xs max-w-md text-center">{error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
            >
              Retry
            </Button>
          </div>
        ) : totalSessions === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground"
            data-ui-bridge-id="sessions.empty"
          >
            <p className="text-sm font-medium">No active sessions</p>
            <p className="text-xs max-w-md text-center">
              Start a coord-native session from any runner (Terminal,
              Claude, agentic, workflow) and it will surface here.
            </p>
          </div>
        ) : (
          <div className="space-y-6" data-ui-bridge-id="sessions.grouped">
            <CrossMachineSummary sessions={sessions} />

            {machineGroups.map((group) => (
              <div key={group.deviceId} className="space-y-3">
                <MachineHeader group={group} />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      hostnameFor={hostnameFor}
                      tenantNameFor={
                        isMultiTenant && effectiveTenantScope === "all"
                          ? (id) => tenantNameById.get(id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
