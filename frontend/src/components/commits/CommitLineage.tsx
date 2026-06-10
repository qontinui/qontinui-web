"use client";

// ============================================================================
// CommitLineage — the /commits page body.
//
// Renders the same three sections the dev-only supervisor Lineage tab showed,
// now in the customer-facing app: stats tiles, a "top sessions" table, and the
// recent-commits feed. Each session is a clickable chip that drills into that
// session's commits. Data comes from the web backend's commit-lineage proxy
// (`/api/v1/operations/lineage/*` → coord); the operator credential is
// forwarded server-side, so there is no JWT-paste step.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DatabaseZap,
  ExternalLink,
  GitCommitHorizontal,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommitSessionChip } from "./CommitSessionChip";
import {
  getLineageStats,
  getRecentCommits,
  isSchemaMigrationPending,
} from "./api";
import type { LineageRow, LineageStats } from "./types";
import { commitUrl, formatTs, shortSha } from "./format";

// Stable module-level empty array (identity-memo safety).
const EMPTY_ROWS: LineageRow[] = [];

// Refresh cadence. Commit lineage changes at merge/push cadence (minutes),
// so a 30s poll is fresh enough without hot-looping coord through the proxy.
const POLL_INTERVAL_MS = 30_000;

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub != null && (
          <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function CommitLineage() {
  const [stats, setStats] = useState<LineageStats | null>(null);
  const [rows, setRows] = useState<LineageRow[]>(EMPTY_ROWS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Coord answered 503 schema_migration_pending: a required column is mid-
  // migration. Transient + self-healing (the poll keeps retrying), so it gets
  // a friendly "feature updating" panel instead of the destructive error card.
  const [migrationPending, setMigrationPending] = useState(false);
  // The `coord.<table>.<column>` coord reported missing — surfaced as a
  // subdued operator breadcrumb under the friendly panel.
  const [migrationMissing, setMigrationMissing] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        getLineageStats(signal),
        getRecentCommits(100, signal),
      ]);
      if (signal?.aborted) return;
      setStats(s);
      setRows(r.length > 0 ? r : EMPTY_ROWS);
      setMigrationPending(false);
      setMigrationMissing(null);
      setLastFetchedAt(new Date().toISOString());
      hasFetched.current = true;
    } catch (e) {
      if (signal?.aborted) return;
      if (isSchemaMigrationPending(e)) {
        setMigrationPending(true);
        setMigrationMissing(e.missing ?? null);
      } else {
        setMigrationPending(false);
        setMigrationMissing(null);
        setError(e instanceof Error ? e.message : String(e));
      }
      hasFetched.current = true;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  // Initial load + polling.
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    const id = window.setInterval(() => {
      // Each tick gets its own controller so a slow request can't be
      // aborted by the next tick's cleanup; the interval is cleared on
      // unmount which aborts the in-flight initial load.
      load();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      ctrl.abort();
    };
  }, [load]);

  const totals = stats?.totals;
  const attributionPct =
    totals && totals.commits > 0
      ? Math.round((totals.attributed / totals.commits) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {lastFetchedAt ? `Updated ${formatTs(lastFetchedAt)}` : "—"}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {migrationPending && (
        <Card>
          <CardContent className="flex items-start gap-3 p-4">
            <DatabaseZap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">
                This feature is updating
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                A database migration is in progress. Check back in a few minutes
                — this page refreshes automatically.
              </div>
              {migrationMissing && (
                <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                  waiting on: {migrationMissing}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <div className="text-sm font-medium text-destructive">
              Could not load commit lineage
            </div>
            <div className="mt-1 break-words font-mono text-xs text-destructive/80">
              {error}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Coord may be unreachable or your operator session may have
              expired. Try Refresh; if it persists, re-authenticate.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Commits"
          value={totals?.commits ?? "—"}
          sub={
            totals
              ? `${totals.attributed} attributed (${attributionPct}%)`
              : "no data"
          }
        />
        <StatTile label="Sessions" value={totals?.sessions ?? "—"} />
        <StatTile label="Repos" value={totals?.repos ?? "—"} />
        <StatTile
          label="By source"
          value={
            <div className="flex flex-wrap gap-1">
              {stats && stats.by_source.length > 0 ? (
                stats.by_source.map((s) => (
                  <Badge
                    key={s.source}
                    variant="outline"
                    className="font-normal"
                    title={`${s.commits} commits`}
                  >
                    {s.source}: {s.commits}
                  </Badge>
                ))
              ) : (
                <span className="text-2xl text-muted-foreground">—</span>
              )}
            </div>
          }
        />
      </div>

      {/* Top sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {stats && stats.top_sessions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Commits</TableHead>
                  <TableHead>Last commit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.top_sessions.map((s) => (
                  <TableRow key={s.agent_session_id}>
                    <TableCell>
                      <CommitSessionChip
                        sessionId={s.agent_session_id}
                        sessionName={s.session_name}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">{s.commits}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatTs(s.last_commit_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-sm text-muted-foreground">
              No session attribution yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent commits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <GitCommitHorizontal className="h-4 w-4" />
            Recent commits
            <Badge variant={rows.length > 0 ? "success" : "warning"}>
              {rows.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commit</TableHead>
                  <TableHead>Repo</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>PR</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.commit_sha}>
                    <TableCell className="font-mono">
                      <a
                        href={commitUrl(r.repo, r.commit_sha)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {shortSha(r.commit_sha)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.repo}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.branch ?? "—"}
                    </TableCell>
                    <TableCell>
                      {r.pr_number != null ? `#${r.pr_number}` : "—"}
                    </TableCell>
                    <TableCell>
                      <CommitSessionChip
                        sessionId={r.agent_session_id}
                        sessionName={r.session_name}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {r.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatTs(r.recorded_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-sm text-muted-foreground">
              {loading
                ? "Loading…"
                : migrationPending
                  ? "Feature updating — a database migration is in progress."
                  : error
                    ? "Could not load lineage — see the banner above."
                    : hasFetched.current
                      ? "No commit lineage recorded yet."
                      : "Loading…"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default CommitLineage;
