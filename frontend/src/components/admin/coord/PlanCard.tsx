"use client";

/**
 * PlanCard — render a single `coord.plans` row in list views.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 */

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";

export interface CoordPlanRow {
  slug: string;
  title?: string;
  status?: string;
  current_phase?: string | null;
  updated_at?: string | null;
  shipped_at?: string | null;
}

function statusVariant(
  status?: string
): "default" | "destructive" | "secondary" | "outline" {
  switch ((status ?? "").toLowerCase()) {
    case "shipped":
      return "default";
    case "archived":
      return "secondary";
    case "blocked":
      return "destructive";
    case "in_progress":
    case "in-progress":
      return "default";
    case "drafted":
    case "vetted":
      return "outline";
    default:
      return "outline";
  }
}

export function PlanCard({ plan }: { plan: CoordPlanRow }) {
  return (
    <Link
      href={`/admin/coord/plans/${encodeURIComponent(plan.slug)}`}
      data-testid="coord-plan-card"
      className="block"
    >
      <Card className="hover:bg-muted/50 transition-colors">
        <CardContent className="p-4 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-sm font-medium truncate">
              {plan.slug}
            </span>
            {plan.status && (
              <Badge variant={statusVariant(plan.status)}>{plan.status}</Badge>
            )}
            {plan.current_phase && (
              <Badge variant="outline" className="text-xs">
                phase: {plan.current_phase}
              </Badge>
            )}
          </div>
          {plan.title && (
            <p className="text-sm text-foreground">{plan.title}</p>
          )}
          {(plan.updated_at || plan.shipped_at) && (
            <p className="text-xs text-muted-foreground">
              {plan.shipped_at
                ? `shipped at ${plan.shipped_at}`
                : `updated ${plan.updated_at}`}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
