"use client";

/**
 * /admin/coord/policies — coordination + design policy surface.
 *
 * Two parts:
 *  - Design Policies (EDITABLE): tenant-scoped, user-authored UX/design
 *    policies backed by `project.design_policies` and read tool-agnostically
 *    by AI agents over `GET /api/v1/design-policies`. Writes gated server-side
 *    by tenant admin.
 *  - Autonomous next-step state (READ-ONLY): platform master-flag
 *    (master_enabled) + fleet table of tenants with non-default
 *    autonomy_level opt-ins. Plan `2026-05-30-decision-engine-tenant-ui.md`
 *    Phase 2 (§6.4).
 *
 * Page gated by is_superuser via the coord admin layout.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Scale } from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { DesignPoliciesSection } from "./_components/DesignPoliciesSection";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────────────────

type AutonomyLevel = "always_escalate" | "guidance_only" | "auto_decide";

interface TenantPolicySetting {
  tenant_id: string;
  slug: string;
  autonomy_level: AutonomyLevel;
  effective: boolean;
  updated_at: string;
}

interface FleetResponse {
  master_enabled: boolean;
  tenants: TenantPolicySetting[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function autonomyBadge(level: AutonomyLevel) {
  switch (level) {
    case "auto_decide":
      return (
        <Badge
          variant="default"
          className="bg-green-600 text-white hover:bg-green-700"
          data-testid="autonomy-auto-decide"
        >
          auto_decide
        </Badge>
      );
    case "guidance_only":
      return (
        <Badge variant="secondary" data-testid="autonomy-guidance-only">
          guidance_only
        </Badge>
      );
    case "always_escalate":
      return (
        <Badge variant="outline" data-testid="autonomy-always-escalate">
          always_escalate
        </Badge>
      );
    default:
      return <Badge variant="outline">{level}</Badge>;
  }
}

function effectiveBadge(effective: boolean) {
  return effective ? (
    <Badge
      variant="default"
      className="bg-green-600 text-white hover:bg-green-700"
    >
      Yes
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      No
    </Badge>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CoordPoliciesPage() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const body = await httpClient.get<FleetResponse>(
        `${API}/coord/next-step-settings/fleet`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const tenants = data?.tenants ?? [];

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-policies-page">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Scale className="h-5 w-5 text-muted-foreground" />
            Coordination Policies
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            User-defined design policies, plus a read-only view of autonomous
            next-step state.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          data-testid="coord-policies-refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" data-testid="coord-policies-error">
          Failed to load: {error}
        </p>
      )}

      {/* Design policies — user-editable, tool-agnostic source of truth */}
      <DesignPoliciesSection />

      {/* Master flag panel */}
      <Card data-testid="coord-policies-master-flag">
        <CardHeader>
          <CardTitle className="text-base">Platform autonomous dispatch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && !data ? (
            <Skeleton className="h-8 w-64" />
          ) : data ? (
            <>
              {data.master_enabled ? (
                <Badge
                  variant="default"
                  className="bg-green-600 text-white hover:bg-green-700 text-sm px-3 py-1"
                  data-testid="master-flag-enabled"
                >
                  Platform autonomous dispatch: ENABLED
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-amber-500 text-amber-600 text-sm px-3 py-1"
                  data-testid="master-flag-disabled"
                >
                  Platform autonomous dispatch: DISABLED
                </Badge>
              )}
              <p className="text-xs text-muted-foreground">
                Controlled by the{" "}
                <code className="font-mono bg-muted px-1 rounded">
                  COORD_NEXT_STEP_AUTODISPATCH_ENABLED
                </code>{" "}
                env flag — not editable here.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Fleet table */}
      <Card data-testid="coord-policies-fleet-table">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Tenant opt-ins
            {data && (
              <Badge variant="outline" className="ml-2">
                {tenants.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <Skeleton className="h-24 w-full" />
          ) : tenants.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Autonomy</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((t) => (
                  <TableRow key={t.tenant_id} data-testid={`policy-row-${t.slug}`}>
                    <TableCell>
                      <div className="font-medium">{t.slug}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {t.tenant_id}
                      </div>
                    </TableCell>
                    <TableCell>{autonomyBadge(t.autonomy_level)}</TableCell>
                    <TableCell>{effectiveBadge(t.effective)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(t.updated_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground italic" data-testid="coord-policies-empty">
              No tenants have opted into autonomous next-step.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
