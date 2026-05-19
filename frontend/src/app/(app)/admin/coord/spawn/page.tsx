"use client";

/**
 * /admin/coord/spawn — spawn-from-plan operator surface.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 4 (Wave 4).
 *
 * Mirrors `/admin/coord/plans` (the canonical plan registry) and adds a
 * "Spawn" button per row. Clicking it opens the SpawnModal pre-seeded
 * with the plan's slug + current_phase so the operator only types the
 * variable inputs (device + repos + intent + initial prompt).
 *
 * The plans list is read-only here (cross-link to /admin/coord/plans
 * for transition / history actions). This page exists to make the
 * spawn flow obvious and one-click — the same affordance exists as a
 * per-row button on the Plans page, but having a dedicated tab in
 * CoordNav means the spawn flow is at most one click from anywhere.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Filter, RefreshCw, Rocket } from "lucide-react";
import { SpawnModal } from "@/components/admin/coord/SpawnModal";
import type { CoordPlanRow } from "@/components/admin/coord/PlanCard";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 15_000;

const STATUS_FILTERS = [
  { value: "any", label: "All statuses" },
  { value: "drafted", label: "Drafted" },
  { value: "vetted", label: "Vetted" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
];

interface PlansListResponse {
  plans?: CoordPlanRow[];
}

function statusBadgeVariant(
  status?: string
): "default" | "destructive" | "secondary" | "outline" {
  switch ((status ?? "").toLowerCase()) {
    case "shipped":
      return "default";
    case "blocked":
      return "destructive";
    case "in_progress":
    case "in-progress":
      return "default";
    case "archived":
      return "secondary";
    default:
      return "outline";
  }
}

export default function CoordSpawnPage() {
  const [status, setStatus] = useState("in_progress");
  const [data, setData] = useState<PlansListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [spawnTarget, setSpawnTarget] = useState<CoordPlanRow | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL(`${API}/plans`);
      if (status && status !== "any") url.searchParams.set("status", status);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: PlansListResponse = await res.json();
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const plans = useMemo(() => data?.plans ?? [], [data]);

  return (
    <div className="p-6 space-y-4" data-testid="coord-spawn-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" />
            Spawn from plan
            {data && (
              <Badge variant="outline" className="ml-2">
                {plans.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pick a plan, hit Spawn, fill in device + repos + intent + the
            initial prompt. Coord acquires claims and ships the prompt on
            first tick.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger
                className="w-[180px]"
                data-testid="coord-spawn-status-select"
              >
                <SelectValue placeholder="status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              data-testid="coord-spawn-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          )}

          {loading && !data ? (
            <Skeleton className="h-24 w-full" />
          ) : plans.length > 0 ? (
            <div className="space-y-2" data-testid="coord-spawn-plans-list">
              {plans.map((p) => (
                <div
                  key={p.slug}
                  data-testid="coord-spawn-plan-row"
                  className="flex items-center gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium truncate">
                        {p.slug}
                      </span>
                      {p.status && (
                        <Badge variant={statusBadgeVariant(p.status)}>
                          {p.status}
                        </Badge>
                      )}
                      {p.current_phase && (
                        <Badge variant="outline" className="text-xs">
                          phase: {p.current_phase}
                        </Badge>
                      )}
                    </div>
                    {p.title && (
                      <p className="text-xs text-muted-foreground truncate">
                        {p.title}
                      </p>
                    )}
                  </div>
                  <Link
                    href={`/admin/coord/plans/${encodeURIComponent(p.slug)}`}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                    data-testid="coord-spawn-plan-detail-link"
                  >
                    detail <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Button
                    size="sm"
                    onClick={() => setSpawnTarget(p)}
                    data-testid="coord-spawn-row-button"
                  >
                    <Rocket className="h-3 w-3 mr-1" />
                    Spawn
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-spawn-plans-empty"
            >
              No plans matching status={status === "any" ? "any" : status}.
            </p>
          )}
        </CardContent>
      </Card>

      {spawnTarget && (
        <SpawnModal
          open={spawnTarget !== null}
          onClose={() => setSpawnTarget(null)}
          planSlug={spawnTarget.slug}
          initialPhase={spawnTarget.current_phase ?? ""}
        />
      )}
    </div>
  );
}
