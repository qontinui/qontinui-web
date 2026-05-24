"use client";

/**
 * Agent-claims observability dashboard.
 *
 * Plan `2026-05-18-agent-spawn-coordination.md` Phase 5.
 *
 * Four sections:
 *  1. Active claims — filter by kind + resource_key prefix.
 *  2. Recent conflicts — in-memory ring buffer (coord-side).
 *  3. Recent steals — `event='admin_stolen'` audit rows.
 *  4. Stale-claim alerts — `coord.alerts` rows whose key starts `claim-`.
 *
 * All sections poll every 10s through the web backend's
 * `/api/v1/operations/claims/*` proxy (the browser can't speak directly
 * to coord because coord has no CORS layer).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Filter,
  Layers,
  RefreshCw,
  ShieldOff,
  TimerOff,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiConfig } from "@/services/api-config";

const POLL_INTERVAL_MS = 10_000;
const API = `${ApiConfig.API_BASE_URL}/api/v1/operations/claims`;

const KIND_OPTIONS = [
  { value: "phase", label: "phase" },
  { value: "file_glob", label: "file_glob" },
  { value: "branch_name", label: "branch_name" },
  { value: "worktree", label: "worktree" },
  { value: "alembic_revision", label: "alembic_revision" },
  { value: "ci_wait", label: "ci_wait" },
];

const ALERT_FILTER_OPTIONS = [
  { value: "__all__", label: "all alerts" },
  { value: "vercel-recovery-", label: "vercel recovery" },
  { value: "vercel-deploy-stale", label: "vercel deploy stale" },
  { value: "vercel-build-failed", label: "vercel build failed" },
  { value: "ecs-image-stale", label: "ecs image stale" },
];

// ---------------------------------------------------------------------------
// Wire shapes — mirror the coord JSON exactly
// ---------------------------------------------------------------------------

interface ActiveClaim {
  kind: string;
  resource_key: string;
  machine_id: string;
  ttl_seconds: number;
  // Agent-self-reported free-text status + blocker (coord claim metadata,
  // surfaced by /coord/claims/list). Optional — older claims have none.
  status_text?: string | null;
  blocked_on?: string | null;
}

interface ActiveClaimsResponse {
  kind: string;
  prefix: string;
  holders: ActiveClaim[];
  truncated: boolean;
}

interface ConflictEntry {
  recorded_at: string;
  requesting_machine_id: string;
  current_holder: string;
  kind: string;
  resource_key: string;
}

interface StealRow {
  occurred_at: string;
  claim_kind: string;
  resource_key: string;
  stolen_from_machine_id: string | null;
  stolen_by_machine_id: string | null;
  steal_reason: string | null;
}

interface AlertRow {
  id?: number;
  alert_key: string;
  severity: string;
  kind?: string;
  machine_id?: string | null;
  summary: string;
  detail?: Record<string, unknown>;
  first_seen_at?: string;
  last_seen_at?: string;
  occurrences?: number;
}

// ---------------------------------------------------------------------------
// Tiny helpers
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

function severityVariant(
  sev: string
): "default" | "destructive" | "secondary" | "outline" {
  switch (sev.toLowerCase()) {
    case "critical":
      return "destructive";
    case "warning":
      return "default";
    case "info":
      return "secondary";
    default:
      return "outline";
  }
}

// ---------------------------------------------------------------------------
// Section 1 — Active claims
// ---------------------------------------------------------------------------

function ActiveClaimsSection() {
  const [kind, setKind] = useState("phase");
  const [prefix, setPrefix] = useState("");
  const [data, setData] = useState<ActiveClaimsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL(`${API}/list`);
      url.searchParams.set("kind", kind);
      if (prefix) url.searchParams.set("prefix", prefix);
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
      }
      const body: ActiveClaimsResponse = await res.json();
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, prefix]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <Card data-testid="claims-active-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Active claims
          {data && (
            <Badge variant="outline" className="ml-2">
              {data.holders.length}
              {data.truncated ? "+" : ""}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger
              className="w-[180px]"
              data-testid="claims-active-kind-select"
            >
              <SelectValue placeholder="kind" />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="resource_key prefix (e.g. plan:my-plan:)"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            className="max-w-md"
            data-testid="claims-active-prefix-input"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            data-testid="claims-active-refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {error && (
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        )}

        {loading && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : data && data.holders.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>resource_key</TableHead>
                <TableHead>machine_id</TableHead>
                <TableHead className="w-[120px] text-right">
                  ttl_seconds
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.holders.map((h) => (
                <TableRow
                  key={`${h.kind}:${h.resource_key}`}
                  data-testid="claims-active-row"
                >
                  <TableCell className="font-mono text-xs">
                    {h.resource_key}
                    {h.status_text ? (
                      <div
                        className="mt-1 font-sans text-xs italic text-muted-foreground whitespace-normal"
                        data-testid="claims-status-text"
                      >
                        {h.status_text}
                      </div>
                    ) : null}
                    {h.blocked_on ? (
                      <div
                        className="mt-1 font-sans text-xs font-medium text-amber-600 dark:text-amber-400 whitespace-normal"
                        data-testid="claims-blocked-on"
                      >
                        ⛔ blocked: {h.blocked_on}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(h.machine_id)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {h.ttl_seconds}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No active claims for kind={kind}
            {prefix ? `, prefix=${prefix}` : ""}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Recent conflicts
// ---------------------------------------------------------------------------

function RecentConflictsSection() {
  const [entries, setEntries] = useState<ConflictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/recent-conflicts?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setEntries(Array.isArray(body.entries) ? body.entries : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <Card data-testid="claims-conflicts-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <XCircle className="h-4 w-4 text-amber-500" />
          Recent conflicts
          <Badge variant="outline" className="ml-2">
            {entries.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        )}
        {loading && entries.length === 0 ? (
          <Skeleton className="h-16 w-full" />
        ) : entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">when</TableHead>
                <TableHead className="w-[100px]">kind</TableHead>
                <TableHead>resource_key</TableHead>
                <TableHead>requesting</TableHead>
                <TableHead>current_holder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => (
                <TableRow
                  key={`${e.recorded_at}-${i}`}
                  data-testid="claims-conflict-row"
                >
                  <TableCell className="text-xs text-muted-foreground">
                    {relativeTime(e.recorded_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.kind}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.resource_key}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(e.requesting_machine_id)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(e.current_holder)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No conflicts in the last 200 events.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Recent steals
// ---------------------------------------------------------------------------

function RecentStealsSection() {
  const [rows, setRows] = useState<StealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/steals?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setRows(Array.isArray(body.rows) ? body.rows : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <Card data-testid="claims-steals-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldOff className="h-4 w-4 text-orange-500" />
          Recent steals (last 24h)
          <Badge variant="outline" className="ml-2">
            {rows.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        )}
        {loading && rows.length === 0 ? (
          <Skeleton className="h-16 w-full" />
        ) : rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">when</TableHead>
                <TableHead className="w-[100px]">kind</TableHead>
                <TableHead>resource_key</TableHead>
                <TableHead>from</TableHead>
                <TableHead>by</TableHead>
                <TableHead>reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow
                  key={`${r.occurred_at}-${i}`}
                  data-testid="claims-steal-row"
                >
                  <TableCell className="text-xs text-muted-foreground">
                    {relativeTime(r.occurred_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.claim_kind}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.resource_key}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(r.stolen_from_machine_id)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(r.stolen_by_machine_id)}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.steal_reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No steal events in the last 24h.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Stale-claim alerts
// ---------------------------------------------------------------------------

function StaleClaimAlertsSection() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState("__all__");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/alerts`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      // Tolerate both `{alerts: [...]}` and bare list shapes.
      const list: AlertRow[] = Array.isArray(body)
        ? body
        : Array.isArray(body.alerts)
        ? body.alerts
        : [];
      setAlerts(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const sorted = useMemo(
    () =>
      [...alerts]
        .filter(
          (a) =>
            alertFilter === "__all__" ||
            a.alert_key.startsWith(alertFilter)
        )
        .sort((a, b) => {
          const order = { critical: 0, warning: 1, info: 2 } as Record<
            string,
            number
          >;
          const ao = order[a.severity.toLowerCase()] ?? 99;
          const bo = order[b.severity.toLowerCase()] ?? 99;
          return ao - bo;
        }),
    [alerts, alertFilter]
  );

  return (
    <Card data-testid="claims-alerts-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-red-500" />
          Stale-claim alerts
          <Badge variant="outline" className="ml-2">
            {sorted.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={alertFilter} onValueChange={setAlertFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="filter by alert_key" />
            </SelectTrigger>
            <SelectContent>
              {ALERT_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error && (
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        )}
        {loading && sorted.length === 0 ? (
          <Skeleton className="h-16 w-full" />
        ) : sorted.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">severity</TableHead>
                <TableHead>alert_key</TableHead>
                <TableHead>summary</TableHead>
                <TableHead className="w-[100px]">last_seen</TableHead>
                <TableHead className="w-[80px] text-right">count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((a) => (
                <TableRow key={a.alert_key} data-testid="claims-alert-row">
                  <TableCell>
                    <Badge variant={severityVariant(a.severity)}>
                      {a.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {a.alert_key}
                  </TableCell>
                  <TableCell className="text-xs">{a.summary}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {relativeTime(a.last_seen_at)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {a.occurrences ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No active stale-claim alerts.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Composed dashboard
// ---------------------------------------------------------------------------

export default function AgentClaimsDashboard() {
  return (
    <div
      className="space-y-6"
      data-testid="agent-claims-dashboard"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <TimerOff className="h-3 w-3" />
        Polls every {POLL_INTERVAL_MS / 1000}s · backed by{" "}
        <code className="rounded bg-muted px-1">
          /api/v1/operations/claims/*
        </code>
      </div>
      <ActiveClaimsSection />
      <RecentConflictsSection />
      <RecentStealsSection />
      <StaleClaimAlertsSection />
    </div>
  );
}
