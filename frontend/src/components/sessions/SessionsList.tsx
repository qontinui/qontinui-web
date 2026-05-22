"use client";

/**
 * SessionsList — Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Renders the live grid of `coord.sessions` rows for the operator's
 * tenant. Polls `GET /api/v1/operations/sessions` on a 5s interval
 * (Phase 5 deliberately punts on fleet-wide SSE — coord exposes SSE
 * per-session, not fleet-wide, and a polling cadence matched to the
 * 15s heartbeat is structurally sufficient for the dashboard's
 * "what's active right now" need).
 *
 * The scope toggle (Active tenant only | All my tenants) sticks
 * per-operator in localStorage. Server-side scope is currently the
 * scope sent to coord; once coord-side multi-tenant operator
 * scoping lands (Phase 7), "All my tenants" becomes a real-deal
 * cross-tenant view.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, WifiOff } from "lucide-react";
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
  ListSessionsOptions,
} from "./api";
import type { SessionRow } from "./types";
import { relativeTime } from "@/components/operations/utils";

const SCOPE_STORAGE_KEY = "qontinui.sessions.scope";
const POLL_INTERVAL_MS = 5_000;

/**
 * Map device_id → hostname using the existing `useDeviceStatusStream`
 * data source. We accept this as a prop so callers can substitute
 * mocks for testing without dragging the WS in.
 */
interface SessionsListProps {
  hostnameFor?: (deviceId: string) => string | undefined;
  /**
   * When true, the initial fetch is performed synchronously on mount
   * (default). Tests pass false + drive state via the `fetcher` hook
   * directly to avoid the polling timer.
   */
  pollEnabled?: boolean;
  /** Override the fetcher for tests / storybook. */
  fetcher?: (opts: ListSessionsOptions) => Promise<{
    count: number;
    scope: string;
    sessions: SessionRow[];
  }>;
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

export function SessionsList({
  hostnameFor,
  pollEnabled = true,
  fetcher,
}: SessionsListProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [scope, setScope] = useState<ListSessionsScope>(() => readStoredScope());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const doFetch = fetcher ?? listSessions;

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await doFetch({ scope, signal });
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
    [doFetch, scope]
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

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        // Active first, then newest started_at first.
        const aActive = a.state === "active" ? 0 : 1;
        const bActive = b.state === "active" ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        const aStarted = a.started_at ? new Date(a.started_at).getTime() : 0;
        const bStarted = b.started_at ? new Date(b.started_at).getTime() : 0;
        return bStarted - aStarted;
      }),
    [sessions]
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="space-y-4"
        data-ui-bridge-id="sessions.list"
        data-session-count={sortedSessions.length}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={scope} onValueChange={onScopeChange}>
            <TabsList data-ui-bridge-id="sessions.scope-tabs">
              <TabsTrigger
                value="active"
                data-ui-bridge-id="sessions.scope-active"
              >
                Active tenant only
              </TabsTrigger>
              <TabsTrigger
                value="all"
                data-ui-bridge-id="sessions.scope-all"
              >
                All my tenants
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline" data-ui-bridge-id="sessions.count-badge">
              {sortedSessions.length}{" "}
              {sortedSessions.length === 1 ? "session" : "sessions"}
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

        {loading && sortedSessions.length === 0 ? (
          <div
            className="flex items-center justify-center py-16 text-muted-foreground gap-2"
            data-ui-bridge-id="sessions.loading"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading sessions…</span>
          </div>
        ) : error && sortedSessions.length === 0 ? (
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
        ) : sortedSessions.length === 0 ? (
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
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
            data-ui-bridge-id="sessions.grid"
          >
            {sortedSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                hostnameFor={hostnameFor}
              />
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
