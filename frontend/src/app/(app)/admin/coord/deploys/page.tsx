"use client";

/**
 * /admin/coord/deploys — Deploy effect-signatures operator dashboard.
 *
 * Plan `2026-05-31-deploy-action-effect-signatures` — the operator read
 * surface over coord's deploy verifier: every CI deploy declares a
 * DeploySignature (deploy-coord.yml / deploy-web.yml §3.6 wiring) and gets
 * verified across the six dimensions (release/infra/schema/health/ci/config).
 * This page lists recent deploys newest-first with the composed D3 verdict,
 * the per-dimension row, coverage, and — for a settled hard terminal — the
 * on-demand rollback proposal.
 *
 * Coord base URL + operator auth are reused exactly as the lands sibling:
 * `httpClient.get` hits the web backend at `/api/v1/operations/deploys*`,
 * which forwards the operator's Cognito bearer to coord (the deploy read
 * routes are FleetPrincipal-gated — the forwarded bearer is the credential).
 * The frontend never talks to coord directly.
 *
 * The list auto-refreshes on a 30s poll (deploys legitimately sit `partial`
 * for minutes while the Ci/Config dimensions settle — the poll shows them
 * settle without a manual refresh).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Rocket } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import {
  DeployCard,
  type DeployRow,
} from "@/components/admin/coord/DeployCard";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

interface DeploysResponse {
  deploys?: DeployRow[] | null;
}

export default function CoordDeploysPage() {
  const [serviceFilter, setServiceFilter] = useState("");
  const [deploys, setDeploys] = useState<DeployRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDeploys = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (serviceFilter.trim()) qs.set("service", serviceFilter.trim());
      qs.set("limit", "25");
      const body = await httpClient.get<DeploysResponse>(
        `${API}/deploys?${qs.toString()}`
      );
      setDeploys(body.deploys ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [serviceFilter]);

  useEffect(() => {
    setLoading(true);
    fetchDeploys();
    const id = setInterval(fetchDeploys, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchDeploys]);

  // Newest-first (coord already sorts; guarded here so the contract is
  // explicit and stable regardless of coord ordering).
  const sorted = useMemo(() => {
    return [...deploys].sort((a, b) =>
      (b.signature.created_at ?? "").localeCompare(a.signature.created_at ?? "")
    );
  }, [deploys]);

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-deploys-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4" />
            Recent declared deploys
            <Badge variant="outline" className="ml-1">
              {sorted.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by service (e.g. qontinui-coord)"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="w-64"
              data-testid="coord-deploys-service-filter"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDeploys}
              data-testid="coord-deploys-refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">Failed to load: {error}</p>
          )}

          {loading && deploys.length === 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : sorted.length > 0 ? (
            <div className="space-y-2">
              {sorted.map((row) => (
                <DeployCard key={row.signature.id} row={row} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No declared deploys
              {serviceFilter.trim() ? ` for ${serviceFilter.trim()}` : ""} yet.
              Deploys declare themselves from the CI pipelines
              (deploy-coord.yml / deploy-web.yml) on every rollout.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
