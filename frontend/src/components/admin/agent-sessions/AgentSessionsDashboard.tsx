"use client";

/**
 * Agent-sessions observability dashboard.
 *
 * Plan `D:/qontinui-root/plans/coord-agent-session-id-tracking.md`
 * Side D / Phase 4.
 *
 * Three sections:
 *  1. Per-user rollup — sessions grouped by user with counts +
 *     most-recent activity.
 *  2. Sessions table — filtered (live / user_id / since) list of
 *     `coord.agent_sessions` rows. Click a row to expand the
 *     lineage panel.
 *  3. Lineage panel (per expanded row) — UNION ALL timeline of
 *     agent_worktrees / claims_audit / build_events /
 *     merge_proposals rows for that session, grouped by kind under
 *     collapsible headers.
 *
 * Polling: full session list refreshes every 10s; the lineage of a
 * currently-expanded LIVE session refreshes every 5s. SSE is a
 * tracked follow-up — no coord-events SSE surface exists in
 * qontinui-web yet, so we poll.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Filter,
  GitBranch,
  Hammer,
  Layers,
  Lock,
  RefreshCw,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";

const SESSIONS_POLL_MS = 10_000;
const LIVE_LINEAGE_POLL_MS = 5_000;
const API = `${ApiConfig.API_BASE_URL}/api/v1/admin/agent-sessions`;

// ---------------------------------------------------------------------------
// Wire shapes — mirror the FastAPI route JSON exactly.
// ---------------------------------------------------------------------------

interface AgentSession {
  id: string;
  user_id: string | null;
  device_id: string | null;
  first_seen: string | null;
  last_seen: string | null;
  label: string | null;
  closed_at: string | null;
}

interface SessionsResponse {
  sessions: AgentSession[];
  count: number;
}

type ActionKind =
  | "agent_worktree"
  | "claim_event"
  | "build_event"
  | "merge_proposal";

interface LineageAction {
  kind: ActionKind;
  handle: string;
  occurred_at: string | null;
}

interface LineageResponse {
  session_id: string;
  actions: LineageAction[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function shortId(id?: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function kindIcon(kind: ActionKind) {
  switch (kind) {
    case "agent_worktree":
      return <GitBranch className="h-3.5 w-3.5" />;
    case "claim_event":
      return <Lock className="h-3.5 w-3.5" />;
    case "build_event":
      return <Hammer className="h-3.5 w-3.5" />;
    case "merge_proposal":
      return <Layers className="h-3.5 w-3.5" />;
  }
}

function kindLabel(kind: ActionKind): string {
  switch (kind) {
    case "agent_worktree":
      return "Worktree spawn";
    case "claim_event":
      return "Claim event";
    case "build_event":
      return "Build event";
    case "merge_proposal":
      return "Merge proposal";
  }
}

// ---------------------------------------------------------------------------
// Per-user rollup
// ---------------------------------------------------------------------------

interface UserRollup {
  user_id: string | null;
  session_count: number;
  live_count: number;
  most_recent: string | null;
}

function rollupByUser(sessions: AgentSession[]): UserRollup[] {
  const map = new Map<string, UserRollup>();
  for (const s of sessions) {
    const key = s.user_id ?? "__unknown__";
    const entry = map.get(key) ?? {
      user_id: s.user_id,
      session_count: 0,
      live_count: 0,
      most_recent: null,
    };
    entry.session_count += 1;
    if (!s.closed_at) entry.live_count += 1;
    if (
      s.last_seen &&
      (!entry.most_recent || s.last_seen > entry.most_recent)
    ) {
      entry.most_recent = s.last_seen;
    }
    map.set(key, entry);
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.most_recent ?? "").localeCompare(a.most_recent ?? "")
  );
}

function PerUserRollup({ sessions }: { sessions: AgentSession[] }) {
  const rollups = useMemo(() => rollupByUser(sessions), [sessions]);
  if (rollups.length === 0) return null;
  return (
    <Card data-testid="agent-sessions-user-rollup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Per-user rollup
          <Badge variant="outline" className="ml-2">
            {rollups.length} users
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>user</TableHead>
              <TableHead className="w-[100px] text-right">sessions</TableHead>
              <TableHead className="w-[80px] text-right">live</TableHead>
              <TableHead className="w-[160px]">most recent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rollups.map((r) => (
              <TableRow key={r.user_id ?? "__unknown__"}>
                <TableCell className="font-mono text-xs">
                  {shortId(r.user_id) || <em>unknown</em>}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {r.session_count}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {r.live_count > 0 ? (
                    <Badge variant="default">{r.live_count}</Badge>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {relativeTime(r.most_recent)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lineage panel — fetches lineage for a single session id.
// ---------------------------------------------------------------------------

function LineagePanel({
  sessionId,
  isLive,
}: {
  sessionId: string;
  isLive: boolean;
}) {
  const [data, setData] = useState<LineageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await httpClient.fetch(`${API}/${sessionId}/lineage`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
      }
      const body: LineageResponse = await res.json();
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    if (!isLive) return;
    const interval = setInterval(fetchData, LIVE_LINEAGE_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchData, isLive]);

  const grouped = useMemo(() => {
    if (!data) return new Map<ActionKind, LineageAction[]>();
    const m = new Map<ActionKind, LineageAction[]>();
    for (const a of data.actions) {
      const arr = m.get(a.kind) ?? [];
      arr.push(a);
      m.set(a.kind, arr);
    }
    return m;
  }, [data]);

  if (loading && !data) {
    return <Skeleton className="h-24 w-full" data-testid="lineage-loading" />;
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" data-testid="lineage-error">
        Failed to load lineage: {error}
      </p>
    );
  }
  if (!data || data.actions.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="lineage-empty"
      >
        No coord-mediated actions recorded for this session.
      </p>
    );
  }

  const kinds: ActionKind[] = [
    "agent_worktree",
    "claim_event",
    "build_event",
    "merge_proposal",
  ];

  return (
    <div className="space-y-2" data-testid="lineage-panel">
      {kinds
        .filter((k) => (grouped.get(k) ?? []).length > 0)
        .map((kind) => {
          const actions = grouped.get(kind) ?? [];
          return (
            <Collapsible key={kind} defaultOpen>
              <CollapsibleTrigger
                className="flex w-full items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60"
                data-testid={`lineage-group-${kind}`}
              >
                <ChevronDown className="h-3 w-3" />
                {kindIcon(kind)}
                {kindLabel(kind)}
                <Badge variant="outline" className="ml-auto">
                  {actions.length}
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>handle</TableHead>
                      <TableHead className="w-[160px]">when</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {actions.map((a, idx) => (
                      <TableRow key={`${a.kind}:${a.handle}:${idx}`}>
                        <TableCell className="font-mono text-xs">
                          {a.handle}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {relativeTime(a.occurred_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions table with expansion to the LineagePanel
// ---------------------------------------------------------------------------

interface SessionFilters {
  live: boolean;
  user_id: string;
  since: string;
}

function SessionsTable({
  filters,
  sessions,
  loading,
  error,
  onRefresh,
}: {
  filters: SessionFilters;
  sessions: AgentSession[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card data-testid="agent-sessions-table-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Sessions
          <Badge variant="outline" className="ml-2">
            {sessions.length}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onRefresh}
            data-testid="agent-sessions-refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive" data-testid="sessions-error">
            Failed to load: {error}
          </p>
        )}
        {loading && sessions.length === 0 ? (
          <Skeleton className="h-32 w-full" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No sessions matching
            {filters.live ? " live=true" : " current filters"}.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]"></TableHead>
                <TableHead>session id</TableHead>
                <TableHead>user</TableHead>
                <TableHead>device</TableHead>
                <TableHead>label</TableHead>
                <TableHead>first seen</TableHead>
                <TableHead>last seen</TableHead>
                <TableHead className="w-[80px]">status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => {
                const isExpanded = expanded === s.id;
                const isLive = !s.closed_at;
                return (
                  <Fragment key={s.id}>
                    <TableRow
                      data-testid="agent-sessions-row"
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        setExpanded((cur) => (cur === s.id ? null : s.id))
                      }
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortId(s.id)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortId(s.user_id)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {shortId(s.device_id)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.label ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {relativeTime(s.first_seen)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {relativeTime(s.last_seen)}
                      </TableCell>
                      <TableCell>
                        {isLive ? (
                          <Badge variant="default">LIVE</Badge>
                        ) : (
                          <Badge variant="secondary">CLOSED</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow data-testid="agent-sessions-lineage-row">
                        <TableCell colSpan={8} className="bg-muted/10 p-4">
                          <LineagePanel sessionId={s.id} isLive={isLive} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top-level dashboard
// ---------------------------------------------------------------------------

export default function AgentSessionsDashboard() {
  const [filters, setFilters] = useState<SessionFilters>({
    live: true,
    user_id: "",
    since: "",
  });
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      // window.location.origin base resolves a same-origin relative API path
      // (empty API_BASE_URL); ignored when API is already absolute.
      const url = new URL(API, window.location.origin);
      if (filters.live) url.searchParams.set("live", "true");
      if (filters.user_id.trim())
        url.searchParams.set("user_id", filters.user_id.trim());
      if (filters.since.trim())
        url.searchParams.set("since", filters.since.trim());
      url.searchParams.set("limit", "200");
      const res = await httpClient.fetch(url.toString());
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
      }
      const body: SessionsResponse = await res.json();
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    fetchSessions();
    const interval = setInterval(fetchSessions, SESSIONS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const sessions = data?.sessions ?? [];

  return (
    <div className="space-y-6">
      <Card data-testid="agent-sessions-filters">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={filters.live}
                onCheckedChange={(v) =>
                  setFilters((f) => ({ ...f, live: Boolean(v) }))
                }
                data-testid="agent-sessions-live-toggle"
              />
              Live only (closed_at IS NULL)
            </label>
            <Input
              placeholder="user_id (UUID)"
              value={filters.user_id}
              onChange={(e) =>
                setFilters((f) => ({ ...f, user_id: e.target.value }))
              }
              className="max-w-xs font-mono text-xs"
              data-testid="agent-sessions-user-input"
            />
            <Input
              type="datetime-local"
              value={filters.since}
              onChange={(e) =>
                setFilters((f) => ({ ...f, since: e.target.value }))
              }
              className="max-w-xs"
              data-testid="agent-sessions-since-input"
            />
          </div>
        </CardContent>
      </Card>

      <PerUserRollup sessions={sessions} />

      <SessionsTable
        filters={filters}
        sessions={sessions}
        loading={loading}
        error={error}
        onRefresh={fetchSessions}
      />
    </div>
  );
}
