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
  CheckCircle,
  Filter,
  Layers,
  RefreshCw,
  ShieldAlert,
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
const API_GATES = `${ApiConfig.API_BASE_URL}/api/v1/operations/gates`;

const KIND_OPTIONS = [
  { value: "phase", label: "phase" },
  { value: "file_glob", label: "file_glob" },
  { value: "branch_name", label: "branch_name" },
  { value: "worktree", label: "worktree" },
  { value: "alembic_revision", label: "alembic_revision" },
  { value: "ci_wait", label: "ci_wait" },
];

// ---------------------------------------------------------------------------
// Wire shapes — mirror the coord JSON exactly
// ---------------------------------------------------------------------------

interface ActiveClaim {
  kind: string;
  resource_key: string;
  machine_id: string;
  ttl_seconds: number;
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

interface GateEntry {
  gate_id: string;
  claim_kind: string | null;
  resource_key: string | null;
  plan_id: string | null;
  phase_name: string | null;
  predicate: Record<string, unknown>;
  verdict: "open" | "cleared" | "failed";
  verdict_reason: string | null;
  registered_by: string | null;
  created_at: string;
  evaluated_at: string | null;
  cleared_at: string | null;
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

function verdictVariant(
  verdict: string
): "default" | "destructive" | "secondary" | "outline" {
  switch (verdict) {
    case "open":
      return "default"; // yellow/warning — uses the default badge
    case "cleared":
      return "secondary"; // green/success
    case "failed":
      return "destructive"; // red
    default:
      return "outline";
  }
}

function verdictClassName(verdict: string): string {
  switch (verdict) {
    case "open":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "cleared":
      return "bg-green-100 text-green-800 border-green-300";
    case "failed":
      return "bg-red-100 text-red-800 border-red-300";
    default:
      return "";
  }
}

function formatPredicate(pred: Record<string, unknown>): string {
  switch (pred.kind) {
    case "pr_merged":
      return `PR Merged: ${pred.repo} #${pred.pr_number}`;
    case "deploy_healthy":
      return `Deploy Healthy: ${pred.service} @ ${pred.expected_rev}`;
    case "claim_terminal":
      return `Claim Terminal: ${pred.claim_kind}:${pred.resource_key}`;
    case "operator_approval":
      return `Operator Approval: ${pred.prompt}`;
    case "ci_green":
      return `CI Green: ${pred.repo} @ ${String(pred.head_sha).slice(0, 7)}`;
    case "ref_exists":
      return `Ref Exists: ${pred.repo}:${pred.ref_name}`;
    default:
      return JSON.stringify(pred);
  }
}

// ---------------------------------------------------------------------------
// Section 1 — Active claims
// ---------------------------------------------------------------------------

function ActiveClaimsSection({
  openGateCountsByAnchor,
}: {
  openGateCountsByAnchor: Map<string, number>;
}) {
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
                <TableHead className="w-[80px] text-right">
                  gates
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.holders.map((h) => {
                const gateCount =
                  openGateCountsByAnchor.get(
                    `${h.kind}:${h.resource_key}`
                  ) ?? 0;
                return (
                <TableRow
                  key={`${h.kind}:${h.resource_key}`}
                  data-testid="claims-active-row"
                >
                  <TableCell className="font-mono text-xs">
                    {h.resource_key}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {shortId(h.machine_id)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {h.ttl_seconds}
                  </TableCell>
                  <TableCell className="text-right">
                    {gateCount > 0 ? (
                      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                        {gateCount} open
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
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
      [...alerts].sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 } as Record<
          string,
          number
        >;
        const ao = order[a.severity.toLowerCase()] ?? 99;
        const bo = order[b.severity.toLowerCase()] ?? 99;
        return ao - bo;
      }),
    [alerts]
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
      <CardContent>
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
// Section 5 — Gates
// ---------------------------------------------------------------------------

function GatesSection({
  gates,
  onRefresh,
}: {
  gates: GateEntry[];
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<GateEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_GATES}/list`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list: GateEntry[] = Array.isArray(body)
        ? body
        : Array.isArray(body.gates)
        ? body.gates
        : [];
      setEntries(list);
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

  // Merge externally-provided gates with self-fetched data.
  // Use self-fetched entries as canonical (they include all gates,
  // not just those matching active claims).
  const allGates = entries.length > 0 ? entries : gates;

  const handleApprove = useCallback(
    async (gateId: string) => {
      setActionInFlight(gateId);
      try {
        const res = await fetch(`${API_GATES}/${gateId}/approve`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
        }
        // Re-fetch immediately after action
        await fetchData();
        onRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setActionInFlight(null);
      }
    },
    [fetchData, onRefresh]
  );

  const handleReject = useCallback(
    async (gateId: string) => {
      setActionInFlight(gateId);
      try {
        const res = await fetch(`${API_GATES}/${gateId}/reject`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
        }
        await fetchData();
        onRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setActionInFlight(null);
      }
    },
    [fetchData, onRefresh]
  );

  const openCount = allGates.filter((g) => g.verdict === "open").length;

  return (
    <Card data-testid="gates-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-yellow-500" />
          Gates
          <Badge variant="outline" className="ml-2">
            {allGates.length}
          </Badge>
          {openCount > 0 && (
            <Badge className="ml-1 bg-yellow-100 text-yellow-800 border-yellow-300">
              {openCount} open
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        )}
        {loading && allGates.length === 0 ? (
          <Skeleton className="h-16 w-full" />
        ) : allGates.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Predicate</TableHead>
                <TableHead>Anchor</TableHead>
                <TableHead className="w-[100px]">Verdict</TableHead>
                <TableHead className="w-[100px]">Evaluated</TableHead>
                <TableHead className="w-[100px]">Cleared</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allGates.map((g) => {
                const anchor =
                  g.claim_kind && g.resource_key
                    ? `${g.claim_kind}:${g.resource_key}`
                    : g.plan_id && g.phase_name
                    ? `plan:${g.phase_name}`
                    : g.plan_id ?? "—";
                const isOperatorApproval =
                  g.predicate?.kind === "operator_approval";

                return (
                  <TableRow key={g.gate_id} data-testid="gates-row">
                    <TableCell className="text-xs">
                      {formatPredicate(g.predicate)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {anchor}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={verdictVariant(g.verdict)}
                        className={verdictClassName(g.verdict)}
                      >
                        {g.verdict}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {relativeTime(g.evaluated_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {relativeTime(g.cleared_at)}
                    </TableCell>
                    <TableCell>
                      {isOperatorApproval && g.verdict === "open" ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                            disabled={actionInFlight === g.gate_id}
                            onClick={() => handleApprove(g.gate_id)}
                            data-testid="gate-approve-btn"
                          >
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs text-red-700 border-red-300 hover:bg-red-50"
                            disabled={actionInFlight === g.gate_id}
                            onClick={() => handleReject(g.gate_id)}
                            data-testid="gate-reject-btn"
                          >
                            <XCircle className="mr-1 h-3 w-3" />
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No gates registered.
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
  // Top-level gates state so we can cross-reference open gates
  // with active claims and pass to the GatesSection.
  const [gates, setGates] = useState<GateEntry[]>([]);

  const fetchGates = useCallback(async () => {
    try {
      const res = await fetch(`${API_GATES}/list`);
      if (!res.ok) return;
      const body = await res.json();
      const list: GateEntry[] = Array.isArray(body)
        ? body
        : Array.isArray(body.gates)
        ? body.gates
        : [];
      setGates(list);
    } catch {
      // Swallow — the GatesSection component has its own error display.
    }
  }, []);

  useEffect(() => {
    fetchGates();
    const interval = setInterval(fetchGates, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchGates]);

  // Build a map of open gate counts keyed by "claim_kind:resource_key"
  // for the active-claims badge overlay (D5.3).
  const openGateCountsByAnchor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of gates) {
      if (g.verdict !== "open") continue;
      if (g.claim_kind && g.resource_key) {
        const key = `${g.claim_kind}:${g.resource_key}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [gates]);

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
      <ActiveClaimsSection openGateCountsByAnchor={openGateCountsByAnchor} />
      <RecentConflictsSection />
      <RecentStealsSection />
      <StaleClaimAlertsSection />
      <GatesSection gates={gates} onRefresh={fetchGates} />
    </div>
  );
}
