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
 *
 * ## Console style (Phase 3 Wave 4) — D2, on a NATIVE `<table>`
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` files this
 * route as Family C and keeps both tables — an eight-column activity feed is a
 * legitimate dense form. What it gains:
 *
 * - **R1** — the four `<Card>` stat tiles become one `<StatCluster>` line.
 * - **R5** — the feed rows had NO detail at all, so every id was truncated on
 *   the row itself and the full commit message lived only in a `title`
 *   attribute. Clicking a row now expands a full-width `<tr><td colSpan={8}>`
 *   `<RecordDetail>` carrying the untruncated message, the full sha and the
 *   raw ids.
 * - **R3** — `gitOpStatus.ts` replaces the inline `OP_KIND_VARIANT` map, whose
 *   red `reset` and amber `merge`/`rebase` were chosen for how alarming the
 *   word sounds. See that module for why this table is entirely calm.
 * - **R7** — "Current branch per device" is infrastructural material sitting
 *   between the operator and the feed they came for, so it moves into a
 *   `<CollapsiblePanel>` that keeps its count visible while closed. **It costs
 *   no poll either way** (it rides the same `fetchData` as the feed), so this
 *   is presentation only — D5 holds.
 * - **R9** — both page-level `<Card><CardHeader><CardTitle>` wrappers are gone.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Fragment } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitVertical,
  RefreshCw,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";
import {
  CollapsiblePanel,
  RecordDetail,
  StatCluster,
  StatusBadge,
  type Stat,
} from "@/components/console";
import { deriveGitOpStatus, GIT_OP_STATUS_PALETTE } from "./gitOpStatus";

const API = "/api/v1/operations";
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
// MOVED to `./gitOpStatus.ts` (R8 — status derivation lives in a pure,
// unit-tested module, not inline in JSX; R3 — one audited kind→attention table
// decides the hue). The map that used to live here painted `reset` red and
// `merge`/`rebase` amber, which is the "how alarming does the word sound"
// palette R3 exists to remove: nothing on a feed of ALREADY-COMPLETED
// operations is anybody's move.

// ---- Summary tiles --------------------------------------------------------

function SummaryTiles({ ops }: { ops: GitOpRecord[] }) {
  const total = ops.length;
  const pushes = ops.filter((o) => o.op_kind === "push").length;
  const commits = ops.filter((o) => o.op_kind === "commit").length;
  const devices = new Set(ops.map((o) => o.device_id)).size;

  // R1's count-cluster opening. No tone is `attention`: this surface has
  // nothing an operator must act on (see `gitOpStatus.ts`), and a red count
  // nobody must act on is the same bug as a red badge nobody must act on.
  const stats: Stat[] = [
    {
      key: "operations",
      label: "ops ",
      value: total,
      "data-testid": "git-ops-tile-operations",
    },
    {
      key: "pushes",
      label: "pushes ",
      value: pushes,
      "data-testid": "git-ops-tile-pushes",
    },
    {
      key: "commits",
      label: "commits ",
      value: commits,
      "data-testid": "git-ops-tile-commits",
    },
    {
      key: "devices",
      label: "devices ",
      value: devices,
      "data-testid": "git-ops-tile-devices",
    },
  ];

  return <StatCluster stats={stats} data-testid="git-ops-summary" />;
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
    // R7 — infrastructural material collapses, but its SIGNAL does not: the
    // device count stays on the header while closed. Closing it costs no
    // polling change either way (this data rides the feed's own fetch), so
    // the panel is presentation only.
    <CollapsiblePanel
      title="Current branch per device"
      icon={<GitBranch className="h-4 w-4" />}
      titleAs="h2"
      defaultOpen
      storageKey="coord-git-ops-branches"
      summary={
        <Badge variant="outline" className="font-mono text-[11px]">
          <span className="font-normal text-muted-foreground">devices&nbsp;</span>
          {branches.length}
        </Badge>
      }
      contentClassName="p-0"
    >
      <>
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
      </>
    </CollapsiblePanel>
  );
}

// ---- Expanded feed-row detail ---------------------------------------------

/**
 * R5's detail, in the shared host and the fixed slot order. Everything the row
 * had to truncate lives here at full length — the commit message (the row cuts
 * it at 60 chars), the full sha, and the raw device/session ids (R8: raw ids
 * appear HERE and nowhere else).
 */
function GitOpDetail({ op }: { op: GitOpRecord }) {
  return (
    <RecordDetail
      className="rounded-none border-x-0 border-b-0"
      data-testid="git-ops-row-detail"
      why={
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {op.message || <span className="italic">No message recorded.</span>}
        </p>
      }
      history={
        op.metadata && Object.keys(op.metadata).length > 0 ? (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Observed with:</p>
            <pre className="max-h-48 overflow-x-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(op.metadata, null, 2)}
            </pre>
          </div>
        ) : undefined
      }
      raw={
        <div className="break-all font-mono text-[10px] text-muted-foreground/60">
          sha: {op.sha || "—"} · device: {op.device_id} · session:{" "}
          {op.session_id} · op: {op.op_id}
        </div>
      }
    />
  );
}

// ---- Main page component --------------------------------------------------

export default function CoordGitOpsPage() {
  const [ops, setOps] = useState<GitOpRecord[]>([]);
  const [branches, setBranches] = useState<DeviceBranchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  // R5 — one row open at a time, the same model `<RecordList>` holds for a row
  // list, spelled out here because a `<tbody>` cannot host that primitive.
  const [expandedOpId, setExpandedOpId] = useState<string | null>(null);

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

      const [listBody, branchesBody] = await Promise.all([
        httpClient.get<GitOpsListResponse>(
          `${API}/git-ops/list?${qs.toString()}`
        ),
        httpClient.get<GitOpsBranchesResponse>(`${API}/git-ops/branches`),
      ]);
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
        {/* The feed count the retired "Fleet activity feed" CardTitle carried,
            kept on the one chrome line R9 allows. */}
        <Badge variant="outline" className="ml-auto font-mono text-[11px]">
          <GitCommitVertical className="mr-1 h-3 w-3 text-muted-foreground" />
          <span className="font-normal text-muted-foreground">ops&nbsp;</span>
          {filtered.length}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
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
        <Skeleton className="h-7 w-full max-w-md" />
      ) : (
        <SummaryTiles ops={ops} />
      )}

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

      {/* Activity feed table — R9: no page-level Card/CardHeader/CardTitle.
          The row count the retired CardTitle carried rides the chrome line. */}
      {loading && ops.length === 0 ? (
        <Skeleton className="h-32 w-full" />
      ) : filtered.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm italic text-muted-foreground">
          No git operations match the current filters / time range.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
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
              {filtered.map((o) => {
                const isExpanded = expandedOpId === o.op_id;
                const status = deriveGitOpStatus(o.op_kind);
                return (
                  <Fragment key={o.op_id}>
                    <tr
                      data-testid="git-ops-row"
                      data-expanded={isExpanded ? "true" : "false"}
                      className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/30"
                      onClick={() =>
                        setExpandedOpId(isExpanded ? null : o.op_id)
                      }
                    >
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <StatusBadge
                            status={status}
                            palette={GIT_OP_STATUS_PALETTE}
                          />
                        </span>
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
                        className="max-w-xs truncate px-4 py-2"
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
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {formatTime(o.recorded_at)}
                      </td>
                    </tr>
                    {isExpanded && (
                      // D2 — full-width cell beneath the row it belongs to.
                      <tr className="border-b border-border last:border-b-0">
                        <td colSpan={8} className="p-0">
                          <GitOpDetail op={o} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Current branch per device — R7, and BELOW the feed on purpose.
          This is the secondary surface: an operator comes to this route for
          the activity feed, and a six-row device table sitting above it cost
          ~276px of the fold. Ordering it after the feed lets the panel stay
          OPEN (so nothing it renders is hidden behind a click) while costing
          the feed nothing. It rides the feed's own fetch either way, so the
          poll cadence is untouched — D5 holds. */}
      <BranchesPanel branches={branches} loading={loading} />
    </div>
  );
}
