"use client";

/**
 * SpawnPlanRow — one spawnable coord work-unit, on one line, with its detail
 * behind a click and its Spawn button on the line beside it.
 *
 * Replaces the hand-rolled `coord-spawn-plan-row` div on
 * `/admin/coord/spawn`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 3;
 * conventions from `frontend/docs/console-ui-style-guide.md`, and the row
 * itself modelled on `PlanRow.tsx` (Wave 1) since both render a
 * {@link CoordPlanRow}.
 *
 * Three notes, each of which is a decision rather than an accident.
 *
 * 1. **R2/R5** — the old row was `p-3` with a stacked title line under the
 *    slug line. Slug + status + phase are now one `px-3 py-2` line and the
 *    title moved into the detail panel.
 * 2. **D1** — the per-row `detail ↗` `<Link>` moved into the detail's actions
 *    slot as "Open full page", keeping its `coord-spawn-plan-detail-link`
 *    testid. It could not stay on the line: `<RecordRow>` renders the whole
 *    line as ONE `<button>` so the expand affordance is keyboard-reachable,
 *    and an anchor nested inside a button is invalid HTML browsers silently
 *    re-parent.
 * 3. **The Spawn button stays ON the line, as a SIBLING of the row**, not in
 *    the detail's actions slot where `PlanRow` put its own Spawn button. Two
 *    independent reasons, and either alone would be enough:
 *
 *    - `tests/e2e/pages/admin-coord-spawn.spec.ts:89,170` clicks
 *      `coord-spawn-row-button` **without expanding anything first**. That
 *      testid is a frozen authored contract (D4a) and so is its reachability;
 *      burying it one click deeper reds that suite.
 *    - This route exists *because* the affordance is one click — its own
 *      module doc says so ("this page exists to make the spawn flow obvious
 *      and one-click"). `/plans` is the registry, where Spawn is a secondary
 *      action; here it is the primary one.
 *
 *    The sibling layout (`items-start` flex, row `flex-1`) keeps the button at
 *    row height when the detail expands beneath, so the line stays one line.
 *    It is outside `<RecordRow>` rather than inside it for the same
 *    nested-button reason as (2).
 */

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ExternalLink, Rocket } from "lucide-react";
import {
  RecordDetail,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import { CoordAdminOnly } from "@/components/admin/coord/CoordAdminOnly";
import {
  PLAN_STATUS_PALETTE,
  describePlanStatus,
  derivePlanStatus,
  planIdentity,
  planRest,
  type CoordPlanRow,
} from "@/components/admin/coord/planStatus";

export function SpawnPlanRow({
  plan,
  expanded,
  onToggle,
  onSpawn,
}: {
  plan: CoordPlanRow;
  expanded: boolean;
  onToggle: () => void;
  onSpawn: () => void;
}) {
  const status = derivePlanStatus(plan);
  const tag = describePlanStatus(plan.status);
  const href = `/admin/coord/plans/${encodeURIComponent(plan.slug)}`;

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <RecordRow
          data-testid="coord-spawn-plan-row"
          rowKey={plan.slug}
          expanded={expanded}
          onToggle={onToggle}
          attention={status.attention}
          identity={planIdentity(plan.slug)}
          label={
            <span
              title={plan.title ? `${plan.slug} — ${plan.title}` : plan.slug}
            >
              <span className="font-mono">{planRest(plan.slug)}</span>
              {plan.title && (
                <span className="text-muted-foreground"> — {plan.title}</span>
              )}
            </span>
          }
          status={<StatusBadge status={status} palette={PLAN_STATUS_PALETTE} />}
          reason={
            plan.current_phase ? `phase ${plan.current_phase}` : undefined
          }
          time={
            <RowTime
              at={plan.updated_at ?? plan.created_at ?? null}
              verb={plan.updated_at ? "Updated" : "Created"}
            />
          }
        >
          <RecordDetail
            why={
              <div className="text-xs">
                <span className="text-muted-foreground">Status: </span>
                <span className="text-foreground/90">{tag.title}</span>
              </div>
            }
            problems={
              plan.title ? (
                <p className="text-sm text-foreground">{plan.title}</p>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  coord holds no title for this work unit.
                </p>
              )
            }
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Link href={href} data-testid="coord-spawn-plan-detail-link">
                  <Button variant="outline" size="sm">
                    Open full page
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            }
            raw={
              <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
                work_unit slug: {plan.slug}
                {plan.status ? ` · coord status: ${plan.status}` : ""}
                {plan.current_phase ? ` · phase: ${plan.current_phase}` : ""}
              </div>
            }
          />
        </RecordRow>
      </div>
      <CoordAdminOnly>
        <Button
          size="sm"
          onClick={onSpawn}
          data-testid="coord-spawn-row-button"
          className="shrink-0"
        >
          <Rocket className="h-3 w-3 mr-1" />
          Spawn
        </Button>
      </CoordAdminOnly>
    </div>
  );
}
