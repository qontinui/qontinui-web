"use client";

/**
 * /admin/coord/pull-decisions — the `repo_pull` decision activity feed.
 *
 * Plan `2026-05-30-coord-pull-decision-ui.md` Phase 2 (Feature A).
 *
 * Renders a reverse-chronological feed of `PullDecisionRow`s polled from
 * coord (via the web backend proxy) every 10s. Optional `?device_id=` and
 * `?repo=` filters seed the view from cross-links (e.g. the TreeCard verdict
 * badge links here).
 *
 * Empty-state note (plan §4.3): resolution rows are written ONLY when a
 * runner/agent requests the `repo_pull` verdict (the executor path, off by
 * default via `COORD_PULL_EXECUTOR_ENABLED`) or via a manual
 * `coord_request_policy` call. The pull-decision *watcher* emits
 * `repo_pull_hold` *alerts* (see /admin/coord/alerts), not resolution rows —
 * so an empty feed alongside active hold alerts is expected until the
 * executor runs.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { GitPullRequest, RefreshCw } from "lucide-react";
import {
  PullDecisionCard,
  type PullDecisionRow,
} from "@/components/admin/coord/PullDecisionCard";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 10_000;

interface PullDecisionsResponse {
  resolutions?: PullDecisionRow[];
  count?: number;
}

export default function CoordPullDecisionsPage() {
  const searchParams = useSearchParams();
  const initialDeviceId = searchParams?.get("device_id") ?? "";
  const initialRepo = searchParams?.get("repo") ?? "";

  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [repo, setRepo] = useState(initialRepo);
  const [data, setData] = useState<PullDecisionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (deviceId) qs.set("device_id", deviceId);
      if (repo) qs.set("repo", repo);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await fetch(`${API}/coord/pull-decisions${suffix}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Tolerate both the `{resolutions: [...]}` envelope and a bare array.
      const body = await res.json();
      const normalized: PullDecisionsResponse = Array.isArray(body)
        ? { resolutions: body as PullDecisionRow[] }
        : (body as PullDecisionsResponse);
      setData(normalized);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [deviceId, repo]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const rows = data?.resolutions ?? [];

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-pull-decisions-page">
      <Card data-testid="coord-pull-decisions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitPullRequest className="h-4 w-4" />
            Pull decisions
            <Badge variant="outline" className="ml-2">
              {rows.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="device_id (UUID)"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value.trim())}
              className="max-w-xs font-mono text-xs"
              data-testid="coord-pull-decisions-device-input"
            />
            <Input
              placeholder="repo (owner/name)"
              value={repo}
              onChange={(e) => setRepo(e.target.value.trim())}
              className="max-w-xs font-mono text-xs"
              data-testid="coord-pull-decisions-repo-input"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              data-testid="coord-pull-decisions-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          )}

          {loading && !data ? (
            <Skeleton className="h-24 w-full" />
          ) : rows.length > 0 ? (
            <div className="space-y-2">
              {rows.map((r) => (
                <PullDecisionCard key={r.resolution_id} row={r} />
              ))}
            </div>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-pull-decisions-empty"
            >
              No pull decisions recorded yet — a resolution row is written only
              when a runner/agent requests the <code>repo_pull</code> verdict
              (<code>POST /coord/trees/pull-decision</code>, the executor path,
              off by default via <code>COORD_PULL_EXECUTOR_ENABLED</code>) or
              via a manual <code>coord_request_policy</code> call. The
              pull-decision <em>watcher</em> emits <code>repo_pull_hold</code>{" "}
              alerts (see{" "}
              <a className="underline" href="/admin/coord/alerts">
                /admin/coord/alerts
              </a>
              ), not resolution rows — so an empty feed with active hold alerts
              is expected until the executor runs.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
