"use client";

/**
 * PlanCard — render a single coord work-unit row in list views.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2);
 * the rows are now coord work-units (`coord.work_units`). The fields the
 * card reads (slug / title / status / updated_at) are common to both; the
 * plan-only `current_phase` / `shipped_at` are optional and simply absent
 * for work-units.
 *
 * Wave 4 (Phase 4) adds the per-row cross-link button into the
 * /admin/coord/spawn flow — clicking it routes to the spawn page with
 * the plan pre-selected. Operators frequently triage on /plans and
 * spawn directly from there.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Rocket } from "lucide-react";
import { formatRelative } from "@/components/admin/coord/QuestionCard";
import {
  describePlanStatus,
  PLAN_TONE_CLASS,
} from "@/components/admin/coord/planStatus";

export interface CoordPlanRow {
  slug: string;
  title?: string;
  status?: string;
  current_phase?: string | null;
  /** coord `work_units.created_at` — the sort key operators asked for. */
  created_at?: string | null;
  updated_at?: string | null;
  shipped_at?: string | null;
}

export function PlanCard({ plan }: { plan: CoordPlanRow }) {
  const router = useRouter();
  return (
    <Card
      className="hover:bg-muted/50 transition-colors"
      data-testid="coord-plan-card"
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-2">
          <Link
            href={`/admin/coord/plans/${encodeURIComponent(plan.slug)}`}
            className="flex-1 min-w-0 space-y-1.5"
            data-testid="coord-plan-card-link"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-mono text-sm font-medium truncate">
                {plan.slug}
              </span>
              {(() => {
                const tag = describePlanStatus(plan.status);
                return (
                  <Badge
                    variant="outline"
                    className={PLAN_TONE_CLASS[tag.tone]}
                    title={tag.title}
                    data-testid="coord-plan-status-tag"
                    data-tone={tag.tone}
                    data-recognised={tag.recognised ? "true" : "false"}
                  >
                    {tag.label}
                  </Badge>
                );
              })()}
              {plan.current_phase && (
                <Badge variant="outline" className="text-xs">
                  phase: {plan.current_phase}
                </Badge>
              )}
            </div>
            {plan.title && (
              <p className="text-sm text-foreground">{plan.title}</p>
            )}
            {(plan.created_at || plan.updated_at || plan.shipped_at) && (
              <p
                className="text-xs text-muted-foreground flex flex-wrap gap-x-3"
                data-testid="coord-plan-card-dates"
              >
                {plan.created_at && (
                  <span title={`Created ${plan.created_at}`}>
                    created {formatRelative(plan.created_at)}
                  </span>
                )}
                {plan.shipped_at ? (
                  <span title={`Shipped ${plan.shipped_at}`}>
                    shipped {formatRelative(plan.shipped_at)}
                  </span>
                ) : (
                  plan.updated_at && (
                    <span title={`Updated ${plan.updated_at}`}>
                      updated {formatRelative(plan.updated_at)}
                    </span>
                  )
                )}
              </p>
            )}
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push("/admin/coord/spawn");
            }}
            data-testid="coord-plan-card-spawn-btn"
            title="Spawn an agent from this plan"
          >
            <Rocket className="h-3 w-3 mr-1" />
            Spawn
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
