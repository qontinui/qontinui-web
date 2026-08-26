"use client";

/**
 * /admin/coord/spawn — the operator's spawn surface. TWO entry points:
 *
 *  1. **New session** (unanchored) — the header button opens `SpawnModal`
 *     with NO plan seeded. The operator picks a machine, names at least one
 *     repo, writes a prompt, and submits. Nothing invents a plan slug: the
 *     anchor keys are omitted from the wire body entirely, so the resulting
 *     `coord.sessions` row has a NULL `work_unit_slug` and appears under no
 *     plan. Plan
 *     `2026-08-25-general-purpose-session-spawn-machine-account-prompt`
 *     Phase 1.
 *  2. **Spawn from plan** (anchored) — the per-row button below, which
 *     opens the same modal pre-seeded with that plan's slug +
 *     current_phase.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 4 (Wave 4)
 * built the anchored half; the plan list below mirrors
 * `/admin/coord/plans` (the canonical plan registry).
 *
 * The two lists are deliberately independent — a plan can exist with no
 * session and a session can run with no plan — so the unanchored spawn is a
 * normal state here, not an exception.
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
import { ExternalLink, Filter, Plus, RefreshCw, Rocket } from "lucide-react";
import { SpawnModal } from "@/components/admin/coord/SpawnModal";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import { httpClient } from "@/services/service-factory";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 15_000;

const STATUS_FILTERS = [
  { value: "any", label: "All statuses" },
  { value: "drafted", label: "Drafted" },
  { value: "vetted", label: "Vetted" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
];

interface PlansListResponse {
  // `/operations/plans` now proxies coord work-units (envelope
  // `{work_units: [...]}`); `plans` kept for cutover tolerance.
  work_units?: CoordPlanRow[];
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
  /** Unanchored spawn — the modal opens with no plan seeded at all. Kept
   *  as its own flag rather than a sentinel `spawnTarget`, so nothing can
   *  mistake it for a plan row with an empty slug. */
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (status && status !== "any") qs.set("status", status);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const body = await httpClient.get<PlansListResponse>(
        `${API}/plans${suffix}`
      );
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

  const plans = useMemo(() => data?.work_units ?? data?.plans ?? [], [data]);

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
            <CoordAdminOnly>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => setNewSessionOpen(true)}
                data-testid="coord-spawn-new-session-button"
              >
                <Plus className="h-3 w-3 mr-1" />
                New session
              </Button>
            </CoordAdminOnly>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pick a plan, hit Spawn, fill in device + repos + the initial prompt.
            Coord acquires claims and ships the prompt on first tick.
          </p>
          <p className="text-xs text-muted-foreground">
            No plan? <span className="font-medium">New session</span> spawns an
            unanchored agent — a machine, at least one repo (coord derives the
            tenant and the worktree from it) and a prompt. It is listed on{" "}
            <span className="font-mono">/sessions</span> and under no plan.
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
                  <CoordAdminOnly>
                    <Button
                      size="sm"
                      onClick={() => setSpawnTarget(p)}
                      data-testid="coord-spawn-row-button"
                    >
                      <Rocket className="h-3 w-3 mr-1" />
                      Spawn
                    </Button>
                  </CoordAdminOnly>
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

      {newSessionOpen && (
        // No `planSlug` — the prop is optional and its absence is what makes
        // the spawn unanchored. Passing `""` would be the same thing to the
        // modal, but naming the omission keeps the intent readable.
        <SpawnModal
          open={newSessionOpen}
          onClose={() => setNewSessionOpen(false)}
        />
      )}
    </div>
  );
}
