"use client";

/**
 * /admin/coord/git-ops -- GitOp federation feed dashboard.
 *
 * Plan `2026-05-24-federation-verify-and-gitop.md` Phase 7.
 *
 * Reads:
 *   GET /api/v1/operations/git-ops/list      (proxies coord /coord/git-ops/list)
 *   GET /api/v1/operations/git-ops/branches  (proxies coord /coord/git-ops/branches)
 *
 * Shows a fleet-wide activity feed of git operations (commit / checkout /
 * branch_create / merge / rebase / push / …) observed by each runner's
 * GitOpBridge (notify-watch + the pre-push hook), plus a "current branch
 * per device" panel. Mirrors the memory-federation dashboard UX.
 *
 * Auto-refreshes every 30s.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { GitBranch, GitCommitVertical, RefreshCw } from "lucide-react";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 30_000;

// ---- Types ----------------------------------------------------------------
//
// These local interfaces mirror coord's git-ops wire shape. The generated
// `@qontinui/shared-types` git-ops exports (GitOpRecord, DeviceBranchSummary)
// are not yet published — they regenerate via CI on merge of the schemas
// package. Swap these for the generated exports once that republishes;
// the field shapes are intentionally identical.

interface GitOpRecord {
  op_id: string;
  tenant_id: string;
  device_id: string;
  session_id: string;
  repo: string;
  branch: string;
  op_kind: string;
  sha: string;
  message: string;
  recorded_at: string;
  metadata?: Record<string, unknown>;
}

interface DeviceBranchSummary {
  device_id: string;
  repo: string;
  branch: string;
  sha: string;
  recorded_at: string;
}

interface GitOpsListResponse {
  ops?: GitOpRecord[];
  items?: GitOpRecord[];
  count?: number;
}

interface GitOpsBranchesResponse {
  branches?: DeviceBranchSummary[];
  items?: DeviceBranchSummary[];
  count?: number;
}

type TimeRange = "1h" | "24h" | "7d" | "all";

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: "Last 1h", value: "1h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7d", value: "7d" },
  { label: "All", value: "all" },
];

function sinceParam(range: TimeRange): string | undefined {
  if (range === "all") return undefined;
  const now = new Date();
  const ms: Record<TimeRange, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    all: 0, // unused — guarded above
  };
  return new Date(now.getTime() - ms[range]).toISOString();
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(s: string, len: number): string {
  if (!s) return s;
  if (s.length <= len) return s;
  return s.slice(0, len) + "…";
}

// ---- op_kind styling ------------------------------------------------------
//
// Distinct badge variants per git operation so the feed reads at a glance.
// Falls back to the neutral `secondary` for any op_kind coord adds later.

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "brand-primary"
  | "brand-secondary"
  | "brand-success";

const OP_KIND_VARIANT: Record<string, BadgeVariant> = {
  push: "brand-primary",
  commit: "success",
  checkout: "info",
  branch_create: "brand-secondary",
  merge: "warning",
  rebase: "warning",
  reset: "destructive",
  remote_update: "secondary",
};

function opKindVariant(kind: string): BadgeVariant {
  return OP_KIND_VARIANT[kind] ?? "secondary";
}

// ---- Summary tiles --------------------------------------------------------

function SummaryTiles({ ops }: { ops: GitOpRecord[] }) {
  const total = ops.length;
  const pushes = ops.filter((o) => o.op_kind === "push").length;
  const commits = ops.filter((o) => o.op_kind === "commit").length;
  const devices = new Set(ops.map((o) => o.device_id)).size;

  const tiles = [
    { label: "Operations", value: total },
    { label: "Pushes", value: pushes },
    { label: "Commits", value: commits },
    { label: "Devices", value: devices },
  ];

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
      data-testid="git-ops-summary"
    >
      {tiles.map((t) => (
        <Card
          key={t.label}
          data-testid={`git-ops-tile-${t.label.toLowerCase()}`}
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className="text-2xl font-bold tabular-nums">{t.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---- Current branch per device panel --------------------------------------

function BranchesPanel({
  branches,
  loading,
}: {
  branches: DeviceBranchSummary[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4" />
          Current branch per device
          <Badge variant="outline" className="ml-2">
            {branches.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading && branches.length === 0 ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : branches.length === 0 ? (
          <p className="text-sm text-muted-foreground italic p-4">
            No device branch state reported yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="git-ops-branches-table"
            >
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2">Device</th>
                  <th className="px-4 py-2">Repo</th>
                  <th className="px-4 py-2">Branch</th>
                  <th className="px-4 py-2">SHA</th>
                  <th className="px-4 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr
                    key={`${b.device_id}:${b.repo}`}
                    data-testid="git-ops-branch-row"
                    className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      {truncate(b.device_id, 12)}
                    </td>
                    <td className="px-4 py-2">{b.repo}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <GitBranch className="h-3 w-3 text-muted-foreground" />
                        {b.branch}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {truncate(b.sha, 8)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                      {formatTime(b.recorded_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Main page component --------------------------------------------------

export default function CoordGitOpsPage() {
  const [ops, setOps] = useState<GitOpRecord[]>([]);
  const [branches, setBranches] = useState<DeviceBranchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");

  // Filters (client-side narrowing of the fetched feed; `repo` also drives
  // the server query so the feed isn't capped by unrelated ops).
  const [repoFilter, setRepoFilter] = useState("");
  const [opKindFilter, setOpKindFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const since = sinceParam(timeRange);
      const qs = new URLSearchParams();
      if (since) qs.set("since", since);
      if (repoFilter.trim()) qs.set("repo", repoFilter.trim());
      qs.set("limit", "200");

      const [listRes, branchesRes] = await Promise.all([
        fetch(`${API}/git-ops/list?${qs.toString()}`),
        fetch(`${API}/git-ops/branches`),
      ]);
      if (!listRes.ok) throw new Error(`list HTTP ${listRes.status}`);
      if (!branchesRes.ok)
        throw new Error(`branches HTTP ${branchesRes.status}`);

      const listBody: GitOpsListResponse = await listRes.json();
      const branchesBody: GitOpsBranchesResponse = await branchesRes.json();
      setOps(listBody.ops ?? listBody.items ?? []);
      setBranches(branchesBody.branches ?? branchesBody.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [timeRange, repoFilter]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // Distinct op_kinds present in the current feed drive the select options.
  const opKinds = useMemo(() => {
    const set = new Set<string>();
    for (const o of ops) set.add(o.op_kind);
    return Array.from(set).sort();
  }, [ops]);

  const filtered = useMemo(() => {
    const dev = deviceFilter.trim().toLowerCase();
    const sess = sessionFilter.trim().toLowerCase();
    const copy = ops.filter((o) => {
      if (opKindFilter && o.op_kind !== opKindFilter) return false;
      if (dev && !o.device_id.toLowerCase().includes(dev)) return false;
      if (sess && !o.session_id.toLowerCase().includes(sess)) return false;
      return true;
    });
    copy.sort((a, b) =>
      (b.recorded_at ?? "").localeCompare(a.recorded_at ?? "")
    );
    return copy;
  }, [ops, opKindFilter, deviceFilter, sessionFilter]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-git-ops-page">
      {/* Time-range selector + refresh */}
      <div className="flex items-center gap-2 flex-wrap">
        {TIME_RANGES.map((tr) => (
          <Button
            key={tr.value}
            size="sm"
            variant={timeRange === tr.value ? "default" : "outline"}
            onClick={() => setTimeRange(tr.value)}
            data-testid={`git-ops-range-${tr.value}`}
          >
            {tr.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
          className="ml-auto"
          data-testid="git-ops-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      {/* Summary tiles */}
      {loading && ops.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <SummaryTiles ops={ops} />
      )}

      {/* Current branch per device */}
      <BranchesPanel branches={branches} loading={loading} />

      {/* Filters */}
      <div
        className="grid grid-cols-1 sm:grid-cols-4 gap-2"
        data-testid="git-ops-filters"
      >
        <Input
          placeholder="Filter by repo"
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          data-testid="git-ops-filter-repo"
        />
        <select
          className="input"
          value={opKindFilter}
          onChange={(e) => setOpKindFilter(e.target.value)}
          data-testid="git-ops-filter-op-kind"
        >
          <option value="">All op kinds</option>
          {opKinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <Input
          placeholder="Filter by device"
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
          data-testid="git-ops-filter-device"
        />
        <Input
          placeholder="Filter by session"
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          data-testid="git-ops-filter-session"
        />
      </div>

      {/* Activity feed table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCommitVertical className="h-4 w-4" />
            Fleet activity feed
            <Badge variant="outline" className="ml-2">
              {filtered.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading && ops.length === 0 ? (
            <div className="p-4">
              <Skeleton className="h-32 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground italic p-4">
              No git operations match the current filters / time range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="git-ops-table">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-2">Op</th>
                    <th className="px-4 py-2">Repo</th>
                    <th className="px-4 py-2">Branch</th>
                    <th className="px-4 py-2">SHA</th>
                    <th className="px-4 py-2">Message</th>
                    <th className="px-4 py-2">Device</th>
                    <th className="px-4 py-2">Session</th>
                    <th className="px-4 py-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => (
                    <tr
                      key={o.op_id}
                      data-testid="git-ops-row"
                      className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2">
                        <Badge variant={opKindVariant(o.op_kind)}>
                          {o.op_kind}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">{o.repo}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-3 w-3 text-muted-foreground" />
                          {o.branch}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                        {truncate(o.sha, 8)}
                      </td>
                      <td
                        className="px-4 py-2 max-w-xs truncate"
                        title={o.message}
                      >
                        {truncate(o.message, 60)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {truncate(o.device_id, 12)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {truncate(o.session_id, 12)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                        {formatTime(o.recorded_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
