"use client";

/**
 * PlanRow — one coord work-unit, on one line, with its detail behind a click.
 *
 * Replaces `PlanCard` on `/admin/coord/plans`. Plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 1;
 * conventions from `frontend/docs/console-ui-style-guide.md` and from
 * `AlertRow.tsx`, this wave's reference implementation.
 *
 * Two things changed and both are the point:
 *
 * 1. **R2 — the card was three stacked lines inside `p-4`; it is now one
 *    `px-3 py-2` row.** The fields that were stacked (title, the date cluster)
 *    moved into the detail panel, which costs a click only when the operator
 *    wants them. The row keeps ONE time, chosen by {@link planRowTime}:
 *    shipped → authored → ingested, never the scanner's `updated_at`.
 * 2. **D1 — the whole card was a `<Link>` to `/admin/coord/plans/[slug]`.**
 *    Clicking a row now expands it in place; the detail route survives and is
 *    reached by the explicit "Open full page ↗" action, which keeps the
 *    `coord-plan-card-link` testid it always had. Clicking a row no longer
 *    navigates you away from your filter and scroll position by accident.
 *
 * The `Spawn` button moved into the detail's actions slot for the same reason
 * a `<Link>` could not stay on the row: `<RecordRow>` renders the whole line as
 * ONE `<button>` (so the expand affordance is keyboard-reachable), and a
 * button or an anchor nested inside a button is invalid HTML that browsers
 * silently re-parent.
 *
 * Every `data-testid` `PlanCard` authored is carried across unchanged (D4a) —
 * `coord-plan-card`, `coord-plan-card-link`, `coord-plan-card-spawn-btn`,
 * `coord-plan-card-dates`, `coord-plan-status-tag`.
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Rocket } from "lucide-react";
import { RecordDetail, RecordRow } from "@/components/console";
import { RowTime, StatusBadge } from "@/components/console";
import {
  PLAN_STATUS_PALETTE,
  PLAN_TIME_ABSENT,
  describePlanStatus,
  derivePlanStatus,
  planIdentity,
  planRest,
  planRowTime,
  type CoordPlanRow,
} from "@/components/admin/coord/planStatus";

export type { CoordPlanRow };

export function PlanRow({
  plan,
  expanded,
  onToggle,
}: {
  plan: CoordPlanRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const status = derivePlanStatus(plan);
  const tag = describePlanStatus(plan.status);
  // shipped → authored → ingested; `updated_at` is a scanner touch, not a
  // plan event, and lives in the detail panel below. See `planRowTime`.
  const { at, verb } = planRowTime(plan);
  const href = `/admin/coord/plans/${encodeURIComponent(plan.slug)}`;

  return (
    <RecordRow
      data-testid="coord-plan-card"
      rowKey={plan.slug}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={planIdentity(plan.slug)}
      label={
        <span title={plan.title ? `${plan.slug} — ${plan.title}` : plan.slug}>
          <span className="font-mono">{planRest(plan.slug)}</span>
          {plan.title && (
            <span className="text-muted-foreground"> — {plan.title}</span>
          )}
        </span>
      }
      status={
        // The badge is wrapped rather than replaced: `coord-plan-status-tag`
        // and its `data-tone` / `data-recognised` attributes are the frozen
        // authored contract (D4a), and `<StatusBadge>` — correctly — exposes
        // neither. Wrapping keeps the primitive AND the contract; forking a
        // second badge implementation to add three attributes would not.
        <span
          className="inline-flex shrink-0"
          data-testid="coord-plan-status-tag"
          data-tone={tag.tone}
          data-recognised={tag.recognised ? "true" : "false"}
          title={tag.title}
        >
          <StatusBadge status={status} palette={PLAN_STATUS_PALETTE} />
        </span>
      }
      reason={plan.current_phase ? `phase ${plan.current_phase}` : undefined}
      time={<RowTime at={at} verb={verb} absent={PLAN_TIME_ABSENT} />}
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
            <Link href={href} data-testid="coord-plan-card-link">
              <Button variant="outline" size="sm">
                Open full page
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/admin/coord/spawn")}
              data-testid="coord-plan-card-spawn-btn"
              title="Spawn an agent from this plan"
            >
              <Rocket className="h-3 w-3 mr-1" />
              Spawn
            </Button>
            {plan.current_phase && (
              <Badge variant="outline" className="text-xs">
                phase: {plan.current_phase}
              </Badge>
            )}
          </div>
        }
        history={
          <p
            className="text-xs text-muted-foreground flex flex-wrap gap-x-3"
            data-testid="coord-plan-card-dates"
          >
            {/* Three dates, three different facts, each under the word for
                what it IS: `authored` is when the plan was written (coord
                `authored_at`, slug-derived), `ingested` is when coord first
                saw the row (`created_at` — mislabelled "created" here until
                plan 2026-09-02-coord-work-units-carry-no-authoring-date),
                `updated` is the scanner's last touch, honest HERE because it
                is labelled. An absent authoring date falls through to the
                ingest date under ITS OWN name, and when that is absent too
                the cell says so: "not recorded" is a real, common state the
                page's own sort has to reason about, never a blank and never
                the ingest date wearing the authored label. */}
            {plan.authored_at ? (
              <span title={`Authored ${plan.authored_at}`}>
                authored{" "}
                <RowTime
                  at={plan.authored_at}
                  verb="Authored"
                  className="inline"
                />
              </span>
            ) : plan.created_at ? (
              <span title={`Ingested ${plan.created_at}`}>
                ingested{" "}
                <RowTime
                  at={plan.created_at}
                  verb="Ingested"
                  className="inline"
                />
              </span>
            ) : (
              <span>
                authored <span className="italic">not recorded</span>
              </span>
            )}
            {plan.first_shipped_at && (
              <span title={`Shipped ${plan.first_shipped_at}`}>
                shipped{" "}
                <RowTime
                  at={plan.first_shipped_at}
                  verb="Shipped"
                  className="inline"
                />
              </span>
            )}
            {plan.updated_at && (
              <span title={`Updated ${plan.updated_at}`}>
                updated{" "}
                <RowTime
                  at={plan.updated_at}
                  verb="Updated"
                  className="inline"
                />
              </span>
            )}
          </p>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            work_unit slug: {plan.slug}
            {plan.status ? ` · coord status: ${plan.status}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
