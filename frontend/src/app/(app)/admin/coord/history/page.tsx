"use client";

/**
 * /admin/coord/history — shipped + archived plans (last 50).
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * MVP shape: filter `coord.plans` by status in {shipped, archived};
 * future expansion adds recent merges + PR landings via coord's
 * merge_proposals + claims_audit tables. Two parallel fetches kept
 * separate so each section degrades independently.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, RefreshCw, FileCheck, Archive } from "lucide-react";
import { PlanCard, type CoordPlanRow } from "@/components/admin/coord/PlanCard";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 30_000;

function HistorySection({
  title,
  Icon,
  status,
  testId,
}: {
  title: string;
  Icon: typeof FileCheck;
  status: "shipped" | "archived";
  testId: string;
}) {
  const [plans, setPlans] = useState<CoordPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL(`${API}/plans`);
      url.searchParams.set("status", status);
      url.searchParams.set("limit", "50");
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setPlans(body.plans ?? []);
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

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
          <Badge variant="outline" className="ml-2">
            {plans.length}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={fetchData}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <p className="text-sm text-destructive">Failed to load: {error}</p>
        )}
        {loading && plans.length === 0 ? (
          <Skeleton className="h-16 w-full" />
        ) : plans.length > 0 ? (
          plans.map((p) => <PlanCard key={p.slug} plan={p} />)
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No {status} plans.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function CoordHistoryPage() {
  return (
    <div className="p-6 space-y-4" data-testid="coord-history-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Recent shipped + archived plans. MVP view; future expansion
            adds recent PR landings + merge_proposals.
          </p>
        </CardContent>
      </Card>

      <HistorySection
        title="Shipped"
        Icon={FileCheck}
        status="shipped"
        testId="coord-history-shipped"
      />
      <HistorySection
        title="Archived"
        Icon={Archive}
        status="archived"
        testId="coord-history-archived"
      />
    </div>
  );
}
