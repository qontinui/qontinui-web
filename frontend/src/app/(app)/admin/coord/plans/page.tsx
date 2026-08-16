"use client";

/**
 * /admin/coord/plans — list coord work-units, filter by status.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2);
 * repointed onto the generic work-unit primitive
 * (`2026-06-18-coord-generic-work-unit-primitive`).
 *
 * Operators still author markdown plans; coord now stores them as generic
 * slug-keyed work-units (`coord.work_units`). The operator UX stays "Plans"
 * — this is a data-source repoint, not a rename. The web proxy still serves
 * `/api/v1/operations/plans*`; only the coord upstream moved to
 * `/coord/work-units*`, whose list envelope is `{work_units: [...]}`.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowDownUp, FileText, Filter, RefreshCw } from "lucide-react";
import { PlanCard, type CoordPlanRow } from "@/components/admin/coord/PlanCard";
import { httpClient } from "@/services/service-factory";
import { sortPlans, SORTS, type SortKey } from "./planSort";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 10_000;

/**
 * Ask for coord's maximum page.
 *
 * Sorting happens client-side, so the window we sort over is the window we
 * fetched. coord's list is `ORDER BY updated_at DESC LIMIT $3` with a default
 * of 100 and a hard clamp of 500 (`work_unit_registry.rs` `list_work_units`),
 * and the proxy forwards no sort parameter — so requesting the clamp is the
 * widest honest window available. When the result fills it, the corpus is
 * larger than what is sorted and the page says so; see `truncated` below.
 */
const FETCH_LIMIT = 500;

// Work-unit lifecycle statuses (coord stores status as an opaque string;
// these are the canonical lifecycle words the filter offers as a convenience
// — an exact-match `status=` filter on the coord list).
const STATUS_FILTERS = [
  { value: "any", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "vetted", label: "Vetted" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "ready", label: "Ready" },
  { value: "shipped", label: "Shipped" },
  { value: "superseded", label: "Superseded" },
  { value: "obsolete", label: "Obsolete" },
];

interface PlansListResponse {
  // coord `/coord/work-units` returns rows under `work_units`. `plans` is
  // kept for backwards-tolerance during the cutover (harmless if absent).
  work_units?: CoordPlanRow[];
  plans?: CoordPlanRow[];
  limit?: number;
  offset?: number;
  count?: number;
}

export default function CoordPlansListPage() {
  const [status, setStatus] = useState("any");
  const [sort, setSort] = useState<SortKey>("created_desc");
  const [data, setData] = useState<PlansListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (status && status !== "any") qs.set("status", status);
      qs.set("limit", String(FETCH_LIMIT));
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

  const plans = data?.work_units ?? data?.plans ?? [];
  const sorted = sortPlans(plans, sort);
  // coord returned a full page, so there are almost certainly more work units
  // than we sorted. Say so: with the list capped at `updated_at DESC`, an
  // "oldest created" answer drawn from this window can be wrong.
  const truncated = plans.length >= FETCH_LIMIT;
  const missingCreated = plans.filter((p) => !p.created_at).length;

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-plans-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Plans
            {data && (
              <Badge variant="outline" className="ml-2">
                {plans.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger
                className="w-[180px]"
                data-testid="coord-plans-status-select"
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
            <ArrowDownUp className="h-4 w-4 text-muted-foreground ml-1" />
            <Select
              value={sort}
              onValueChange={(v) => setSort(v as SortKey)}
            >
              <SelectTrigger
                className="w-[200px]"
                data-testid="coord-plans-sort-select"
              >
                <SelectValue placeholder="sort" />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((opt) => (
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
              data-testid="coord-plans-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {truncated && (
            <p
              className="text-xs text-amber-300/90"
              data-testid="coord-plans-truncated-notice"
            >
              Showing the {FETCH_LIMIT} most-recently-updated work units — coord
              caps this list. Sorting applies to these only, so a
              &ldquo;{SORTS.find((s) => s.value === sort)?.label}&rdquo; result
              may not be the corpus-wide answer.
            </p>
          )}
          {missingCreated > 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="coord-plans-missing-created-notice"
            >
              {missingCreated} of {plans.length} have no creation date recorded;
              they sort last rather than being treated as oldest.
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          )}

          {loading && !data ? (
            <Skeleton className="h-24 w-full" />
          ) : sorted.length > 0 ? (
            <div className="space-y-2">
              {sorted.map((p) => (
                <PlanCard key={p.slug} plan={p} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No plans matching status={status === "any" ? "any" : status}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
