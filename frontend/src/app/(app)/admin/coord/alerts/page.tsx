"use client";

/**
 * /admin/coord/alerts — full `coord.alerts` rollup.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 *
 * Filters: severity (info/warning/critical), kind (claim/conflict/
 * stale_wip/health), include_resolved toggle.
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Filter, RefreshCw } from "lucide-react";
import { AlertCard, type CoordAlertRow } from "@/components/admin/coord/AlertCard";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 10_000;

const SEVERITIES = [
  { value: "any", label: "All severities" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
];

const KINDS = [
  { value: "any", label: "All kinds" },
  { value: "claim", label: "Claim" },
  { value: "conflict", label: "Conflict" },
  { value: "stale_wip", label: "Stale WIP" },
  { value: "health", label: "Health" },
];

interface AlertsResponse {
  alerts?: CoordAlertRow[];
}

export default function CoordAlertsPage() {
  const [severity, setSeverity] = useState("any");
  const [kind, setKind] = useState("any");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL(`${API}/alerts`);
      url.searchParams.set("include_resolved", String(includeResolved));
      if (severity !== "any") url.searchParams.set("severity", severity);
      if (kind !== "any") url.searchParams.set("kind", kind);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      // Tolerate both `{alerts: [...]}` and bare list shapes.
      if (Array.isArray(body)) {
        setData({ alerts: body });
      } else {
        setData(body);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [severity, kind, includeResolved]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const alerts = data?.alerts ?? [];

  return (
    <div className="p-6 space-y-4" data-testid="coord-alerts-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            Alerts
            <Badge variant="outline" className="ml-2">
              {alerts.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger
                className="w-[160px]"
                data-testid="coord-alerts-severity-select"
              >
                <SelectValue placeholder="severity" />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger
                className="w-[160px]"
                data-testid="coord-alerts-kind-select"
              >
                <SelectValue placeholder="kind" />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5 ml-2">
              <Switch
                id="include-resolved"
                checked={includeResolved}
                onCheckedChange={setIncludeResolved}
                data-testid="coord-alerts-include-resolved"
              />
              <label
                htmlFor="include-resolved"
                className="text-xs text-muted-foreground"
              >
                include resolved
              </label>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              data-testid="coord-alerts-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          )}

          {loading && !data ? (
            <Skeleton className="h-24 w-full" />
          ) : alerts.length > 0 ? (
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <AlertCard key={a.id ?? `${a.alert_key}-${i}`} alert={a} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No alerts matching filters.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
