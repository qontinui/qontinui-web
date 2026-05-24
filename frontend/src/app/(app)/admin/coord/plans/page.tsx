"use client";

/**
 * /admin/coord/plans — list `coord.plans`, filter by status.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * `coord.plans` is the canonical plan registry per resolved decision Q7
 * — status-stamps live in columns, not in fragile markdown blockquotes.
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
import { FileText, Filter, RefreshCw } from "lucide-react";
import { PlanCard, type CoordPlanRow } from "@/components/admin/coord/PlanCard";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 10_000;

const STATUS_FILTERS = [
  { value: "any", label: "All statuses" },
  { value: "drafted", label: "Drafted" },
  { value: "vetted", label: "Vetted" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "shipped", label: "Shipped" },
  { value: "archived", label: "Archived" },
];

interface PlansListResponse {
  plans?: CoordPlanRow[];
  count?: number;
}

export default function CoordPlansListPage() {
  const [status, setStatus] = useState("any");
  const [data, setData] = useState<PlansListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL(`${API}/plans`, window.location.origin);
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

  const plans = data?.plans ?? [];

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
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              data-testid="coord-plans-refresh"
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
            <div className="space-y-2">
              {plans.map((p) => (
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
