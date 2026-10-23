"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  CollapsiblePanel,
  RowTime,
  StatusBadge,
  UNKNOWN_AMBER,
} from "@/components/console";
import {
  PLAN_STATUS_PALETTE,
  PLAN_TIME_ABSENT,
  derivePlanStatus,
  describePlanStatus,
  planRowTime,
} from "@/components/admin/coord/planStatus";
import {
  RedactedText,
  redactionVerdict,
  usePresentationMode,
  usePresentationScopeState,
  type RedactionDescriptor,
} from "@/components/presentation";
import { cn } from "@/lib/utils";
import { partName } from "../_lib/twin-aspects";
import {
  planProgress,
  workUnitArea,
  workUnitHref,
  workUnitRepos,
  type GroupPlan,
} from "../_lib/twin-plans";

/** In presentation mode, how many unfinished plans a list shows before "and N more". */
export const PRESENTATION_PLAN_LIMIT = 8;

/** In operator mode, how many finished plans the collapsed list renders. */
export const FINISHED_PLAN_LIMIT = 100;

/** The status of a plan whose slug is not among the units read. */
function MissingUnitBadge({ complete }: { complete: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-semibold whitespace-nowrap",
        UNKNOWN_AMBER
      )}
      title={
        complete
          ? "coord's work-unit list holds no unit with this slug."
          : "This plan was not among the work units read, and the read was incomplete, so its status is unknown."
      }
    >
      {complete ? "Not a work unit" : "UNKNOWN"}
    </Badge>
  );
}

function PlanItem({ plan, complete }: { plan: GroupPlan; complete: boolean }) {
  const { presenting } = usePresentationMode();
  const scope = usePresentationScopeState();
  const unit = plan.unit;
  // The title, else the slug — both free text, both redacted alike.
  const text = unit?.title?.trim() || plan.slug;
  const repo = unit ? workUnitRepos(unit) : null;
  const time = unit ? planRowTime(unit) : null;
  const descriptor: RedactionDescriptor = {
    kind: "Plan",
    area: unit ? workUnitArea(unit) : null,
    status: unit ? describePlanStatus(unit.status).label : null,
    at: time?.at ?? null,
  };
  // The link's URL carries the slug, so a plan whose text the lens withholds
  // is not linked in presentation mode: the href would show what the
  // descriptor hides.
  const linkable = !presenting || redactionVerdict({ text, repo }, scope).show;
  const title = (
    <RedactedText
      text={text}
      repo={repo}
      descriptor={descriptor}
      className="truncate"
    />
  );

  return (
    <li
      data-testid="digital-twin-plan"
      data-plan-progress={planProgress(unit)}
      className="flex min-w-0 items-center gap-2 py-1.5 text-sm"
    >
      {unit ? (
        <StatusBadge
          status={derivePlanStatus(unit)}
          palette={PLAN_STATUS_PALETTE}
        />
      ) : (
        <MissingUnitBadge complete={complete} />
      )}
      {linkable ? (
        <Link
          href={workUnitHref(plan.slug)}
          data-testid="digital-twin-plan-link"
          className="min-w-0 truncate font-medium text-primary underline-offset-4 hover:underline"
        >
          {title}
        </Link>
      ) : (
        <span className="min-w-0 truncate">{title}</span>
      )}
      {!presenting && (
        <>
          <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground md:inline">
            {plan.subspaces.map(partName).join(", ")}
          </span>
          {time && (
            <RowTime
              at={time.at}
              verb={time.verb}
              absent={PLAN_TIME_ABSENT}
              className="ml-auto"
            />
          )}
        </>
      )}
    </li>
  );
}

/**
 * The plans tied to a set of parts, with their live status: the unfinished
 * ones first (in progress, blocked, queued, unknown), then the finished ones.
 *
 * Operator mode lists every unfinished plan and keeps the finished ones in a
 * collapsed panel. Presentation mode — density down — shows at most
 * {@link PRESENTATION_PLAN_LIMIT} unfinished plans and only counts the rest.
 */
export function TwinPlanList({
  plans,
  complete,
}: {
  /** Sorted (`plansForSubspaces`). */
  plans: readonly GroupPlan[];
  /** The work-unit read reached the end of coord's list. */
  complete: boolean;
}) {
  const { presenting } = usePresentationMode();
  const unfinished = plans.filter((p) => planProgress(p.unit) !== "done");
  const finished = plans.filter((p) => planProgress(p.unit) === "done");
  const shown = presenting
    ? unfinished.slice(0, PRESENTATION_PLAN_LIMIT)
    : unfinished;

  if (plans.length === 0) {
    return (
      <p
        data-testid="digital-twin-plans-empty"
        className="text-sm text-muted-foreground"
      >
        {complete
          ? "No plan is tied to these parts: none names them, and no work unit carries an area mapped to them."
          : "No plan was found among the work units read — the read was incomplete, so plans may be missing."}
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="digital-twin-plan-list">
      {shown.length > 0 ? (
        <ul className="divide-y divide-border">
          {shown.map((plan) => (
            <PlanItem key={plan.slug} plan={plan} complete={complete} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No unfinished plan — every plan tied to these parts is shipped or
          closed.
        </p>
      )}
      {unfinished.length > shown.length && (
        <p className="text-xs text-muted-foreground">
          and {unfinished.length - shown.length} more unfinished plans
        </p>
      )}
      {finished.length > 0 &&
        (presenting ? (
          <p className="text-xs text-muted-foreground">
            {finished.length} shipped or closed
          </p>
        ) : (
          <CollapsiblePanel
            title="Shipped or closed"
            titleAs="div"
            defaultOpen={false}
            summary={
              <Badge
                variant="outline"
                className="font-mono text-[11px] tabular-nums"
              >
                {finished.length}
              </Badge>
            }
            data-testid="digital-twin-plans-finished"
          >
            <ul className="divide-y divide-border">
              {finished.slice(0, FINISHED_PLAN_LIMIT).map((plan) => (
                <PlanItem key={plan.slug} plan={plan} complete={complete} />
              ))}
            </ul>
            {finished.length > FINISHED_PLAN_LIMIT && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the {FINISHED_PLAN_LIMIT} most recent of{" "}
                {finished.length}; the rest are on{" "}
                <Link
                  href="/admin/coord/work-units"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Work units
                </Link>
                .
              </p>
            )}
          </CollapsiblePanel>
        ))}
    </div>
  );
}
