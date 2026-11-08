"use client";

/**
 * `overview-plan-vs-actual` — each phase's planned start and finish against
 * what actually happened or is now forecast, with the slip in words (plan
 * `2026-09-19-project-overview-for-business-leaders` Phase 9; plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * The Timeline's own reads (`useTimelineData`) and its own words
 * (`describeSlip`, `formatDay`, the phase states): a slip reads "3 weeks
 * late" or "On plan", never a bare negative number, and a slip the forecast
 * cannot give reads "not measured — <reason>".
 */

import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/components/overview/LoadFailure";
import { Provenance } from "@/components/presentation/Provenance";
import { useOverviewProject } from "@/app/(app)/overview/_hooks/useOverviewProject";
import { useTimelineData } from "@/app/(app)/overview/_hooks/useTimelineData";
import {
  PHASE_STATE_LABEL,
  describeSlip,
  formatDay,
} from "@/app/(app)/overview/_lib/timeline";
import type { TimelinePhase } from "@/app/(app)/overview/timeline/_components/model";
import type { DataBlockProps, OverviewPlanVsActualArgs } from "./blockArgs";
import { BlockFrame, BlockNotice } from "./blockChrome";
import { NotMeasured } from "./served";

const ID = "overview.block.plan-vs-actual";
const SOURCE = "the project's estimate and its recorded progress";

function span(start: string | null, end: string | null): string {
  return `${formatDay(start) ?? "no start"} – ${formatDay(end) ?? "no end"}`;
}

/** What happened, or what the forecast now expects. */
function actualOrForecast(phase: TimelinePhase, forecastUnread: boolean) {
  const p = phase.progress;
  const f = phase.forecast;
  if (p.actual_end) {
    return `Ran ${span(p.actual_start, p.actual_end)}`;
  }
  if (p.actual_start) {
    return f?.forecast_end
      ? `Started ${formatDay(p.actual_start)}, expected to end ${formatDay(f.forecast_end)}`
      : `Started ${formatDay(p.actual_start)}, still running`;
  }
  if (f?.forecast_start && f.forecast_end) {
    return `Expected ${span(f.forecast_start, f.forecast_end)}`;
  }
  return (
    <NotMeasured
      reason={
        forecastUnread
          ? "the forecast can't be read right now"
          : "not started, and the forecast gives no dates for it"
      }
    />
  );
}

function slip(phase: TimelinePhase, forecastUnread: boolean) {
  const words = describeSlip(phase.forecast?.finish_slip_days ?? null);
  if (words) return words.text;
  return (
    <NotMeasured
      reason={
        forecastUnread
          ? "the forecast can't be read right now"
          : "the forecast can't say for this phase"
      }
    />
  );
}

function Body() {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const t = useTimelineData(projectId, hold);
  const failed = (what: string, message: string) => (
    <BlockNotice
      tone="problem"
      title={`${what} can't be read right now.`}
      detail={describeFailure(message)}
      uiBridgeId={`${ID}.error`}
    />
  );
  const loading = (
    <div className="space-y-2" aria-hidden data-ui-bridge-id={`${ID}.loading`}>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
  if (tenantsError) return failed("The schedule", tenantsError);
  if (t.estimates.list.state === "loading") return loading;
  if (t.estimates.list.state === "error") {
    return failed("The schedule", t.estimates.list.message);
  }
  if (!t.estimate) {
    return (
      <BlockNotice
        title="This project has no schedule yet"
        detail="Phases are planned in the project's estimate, and no estimate has been entered."
        uiBridgeId={`${ID}.no-estimate`}
      />
    );
  }
  if (t.progress.list.state === "loading") return loading;
  if (t.progress.list.state === "error") {
    return failed("The phases", t.progress.list.message);
  }
  if (t.phases.length === 0) {
    return (
      <BlockNotice
        title="The estimate has no phases yet."
        uiBridgeId={`${ID}.empty`}
      />
    );
  }
  const forecastUnread = t.forecast.state === "error";
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="mb-2 text-left text-foreground">
            Phases of {t.estimate.name}: planned, against what happened
          </caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Phase
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Planned
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Actual or expected
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Against plan
              </th>
            </tr>
          </thead>
          <tbody>
            {t.phases.map((phase) => (
              <tr
                key={phase.progress.id}
                className="border-t border-border/60"
                data-ui-bridge-id={`${ID}.phase.${phase.progress.code}`}
              >
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  <span className="font-mono text-xs text-muted-foreground">
                    {phase.progress.code}
                  </span>{" "}
                  {phase.progress.name}
                  {phase.forecast && (
                    <span className="block text-xs text-muted-foreground">
                      {PHASE_STATE_LABEL[phase.forecast.state]}
                    </span>
                  )}
                </th>
                <td className="px-2 py-1.5">
                  {span(
                    phase.progress.planned_start,
                    phase.progress.planned_end
                  )}
                </td>
                <td className="px-2 py-1.5">
                  {actualOrForecast(phase, forecastUnread)}
                </td>
                <td
                  className="px-2 py-1.5"
                  data-ui-bridge-id={`${ID}.phase.${phase.progress.code}.slip`}
                >
                  {slip(phase, forecastUnread)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <Provenance
          persistent
          source={SOURCE}
          asOf={t.forecast.state === "ready" ? t.forecast.forecast.today : null}
        />
      </div>
    </>
  );
}

export function OverviewPlanVsActual(
  _props: DataBlockProps<OverviewPlanVsActualArgs>
) {
  return (
    <BlockFrame
      name="overview-plan-vs-actual"
      uiBridgeId={ID}
      label="Plan against actual"
    >
      <Body />
    </BlockFrame>
  );
}
