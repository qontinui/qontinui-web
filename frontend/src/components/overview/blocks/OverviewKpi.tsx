"use client";

/**
 * `overview-kpi <figure>` — one headline figure with its source and as-of
 * (plan `2026-09-19-project-overview-for-business-leaders` Phase 9; plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * The figures are a closed list over reads the overview already makes, read
 * the way the pages that own them read them:
 *
 * - `forecast-finish`, `slip`, `current-phase`, `next-gate` — the Timeline's
 *   forecast (`GET /estimates/{id}/forecast`) for the project's baseline
 *   estimate, through the Timeline's own hooks, worded as the Timeline's
 *   header words them (a slip is "3 weeks late", never a signed number);
 * - `work-done`, `work-in-progress`, `work-planned` — coord's project-state
 *   count, through the Summary's own loader and buckets, labelled with the
 *   Summary's words.
 *
 * A figure that cannot be produced reads "not measured — <reason>", never a
 * `0` or a blank.
 */

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/components/overview/LoadFailure";
import { Provenance } from "@/components/presentation/Provenance";
import { useOverviewProject } from "@/app/(app)/overview/_hooks/useOverviewProject";
import { loadWorkCounts } from "@/app/(app)/overview/_hooks/useSummaryData";
import {
  useBaselineEstimate,
  useForecast,
} from "@/app/(app)/overview/_hooks/useTimelineData";
import {
  PROGRESS_BUCKETS,
  type ProgressBucket,
  type ProgressReading,
} from "@/app/(app)/overview/_lib/progress";
import type { TimelineForecast } from "@/app/(app)/overview/_lib/timeline-api";
import { describeSlip, formatDay } from "@/app/(app)/overview/_lib/timeline";
import { positionWords } from "@/app/(app)/overview/timeline/_components/TimelineHeader";
import type { DataBlockProps, KpiFigure, OverviewKpiArgs } from "./blockArgs";
import { BlockFrame, BlockNotice } from "./blockChrome";
import { NotMeasured } from "./served";

/** One figure, ready to show: a value, or the reason there is none. */
interface Reading {
  value: string | null;
  reason: string;
  detail: string | null;
}

type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | ({ state: "ready" } & T);

const FORECAST_SOURCE = "the project's estimate and its recorded progress";
const WORK_SOURCE = "coord's count of the project's work";

const WORK_BUCKET: Record<string, ProgressBucket> = {
  "work-done": "done",
  "work-in-progress": "in_progress",
  "work-planned": "planned",
};

const FORECAST_LABEL: Record<string, string> = {
  "forecast-finish": "Expected to finish",
  slip: "Against plan",
  "current-phase": "Where it is now",
  "next-gate": "Next gate",
};

function kpiLabel(figure: KpiFigure): string {
  const bucket = WORK_BUCKET[figure];
  if (bucket) {
    return PROGRESS_BUCKETS.find((b) => b.key === bucket)?.label ?? figure;
  }
  return FORECAST_LABEL[figure] ?? figure;
}

/** Why the forecast has no finish: the server's own sentence, if it gave one. */
function forecastReason(forecast: TimelineForecast): string {
  return (
    forecast.unavailable.find((u) => u.figure === "forecast")?.detail ??
    "the forecast can't say yet"
  );
}

function forecastReading(
  figure: KpiFigure,
  forecast: TimelineForecast
): Reading {
  switch (figure) {
    case "forecast-finish":
      return {
        value: formatDay(forecast.forecast_finish),
        reason: forecastReason(forecast),
        detail:
          forecast.position === "finished"
            ? "When the last phase ended."
            : "From the phases as recorded so far, against the plan.",
      };
    case "slip":
      return {
        value: describeSlip(forecast.slip_days)?.text ?? null,
        reason: forecastReason(forecast),
        detail: null,
      };
    case "current-phase": {
      const now = positionWords(forecast);
      return { value: now.value, reason: "", detail: now.detail || null };
    }
    default:
      return {
        value: forecast.next_gate
          ? `${forecast.next_gate.code} ${forecast.next_gate.name}`
          : forecast.position === "no_phases"
            ? null
            : "All gates decided",
        reason: "the estimate has no phases yet",
        detail: forecast.next_gate?.criteria || null,
      };
  }
}

function workReading(figure: KpiFigure, reading: ProgressReading): Reading {
  if (!reading.counted) {
    return { value: null, reason: reading.reason, detail: null };
  }
  const bucket = WORK_BUCKET[figure]!;
  return {
    value: String(reading.progress.counts[bucket]),
    reason: "",
    detail: `of ${reading.progress.total} pieces of work counted`,
  };
}

function useWorkCounts(projectId: string | null, hold: boolean) {
  const [state, setState] = useState<
    Loaded<{ reading: ProgressReading; asOf: string | null }>
  >({ state: "loading" });
  useEffect(() => {
    if (hold) return;
    let live = true;
    setState({ state: "loading" });
    loadWorkCounts().then(
      (loaded) => live && setState({ state: "ready", ...loaded }),
      (err: unknown) =>
        live &&
        setState({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [projectId, hold]);
  return state;
}

function Figure({
  figure,
  state,
  source,
  uiBridgeId,
}: {
  figure: KpiFigure;
  state: Loaded<{ reading: Reading; asOf: string | null }>;
  source: string;
  uiBridgeId: string;
}) {
  const label = kpiLabel(figure);
  return (
    <BlockFrame name="overview-kpi" uiBridgeId={uiBridgeId} label={label}>
      <p className="text-sm text-muted-foreground">{label}</p>
      {state.state === "loading" && (
        <Skeleton className="mt-2 h-8 w-32" aria-hidden />
      )}
      {state.state === "error" && (
        <BlockNotice
          tone="problem"
          title="This figure can't be read right now."
          detail={describeFailure(state.message)}
          uiBridgeId={`${uiBridgeId}.error`}
        />
      )}
      {state.state === "ready" && (
        <>
          <p
            className="mt-1 font-[family-name:var(--font-overview-serif)] text-2xl text-foreground"
            data-ui-bridge-id={`${uiBridgeId}.value`}
          >
            {state.reading.value ?? (
              <NotMeasured
                reason={state.reading.reason}
                className="text-base"
              />
            )}
          </p>
          {state.reading.detail && (
            <p className="mt-1 text-xs text-muted-foreground">
              {state.reading.detail}
            </p>
          )}
          <div className="mt-2">
            <Provenance persistent source={source} asOf={state.asOf} />
          </div>
        </>
      )}
    </BlockFrame>
  );
}

function WorkFigure({ figure }: { figure: KpiFigure }) {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const counts = useWorkCounts(projectId, hold);
  const state: Loaded<{ reading: Reading; asOf: string | null }> = tenantsError
    ? { state: "error", message: tenantsError }
    : counts.state === "ready"
      ? {
          state: "ready",
          reading: workReading(figure, counts.reading),
          asOf: counts.asOf,
        }
      : counts;
  return (
    <Figure
      figure={figure}
      state={state}
      source={WORK_SOURCE}
      uiBridgeId={`overview.block.kpi.${figure}`}
    />
  );
}

function ForecastFigure({ figure }: { figure: KpiFigure }) {
  const { projectId, hold, tenantsError } = useOverviewProject();
  const { estimates, estimate } = useBaselineEstimate(projectId, hold);
  const forecast = useForecast(estimate?.id ?? null, hold, 0);
  let state: Loaded<{ reading: Reading; asOf: string | null }>;
  if (tenantsError) {
    state = { state: "error", message: tenantsError };
  } else if (estimates.list.state !== "ready") {
    state = estimates.list;
  } else if (estimate === null) {
    state = {
      state: "ready",
      reading: {
        value: null,
        reason: "this project has no schedule yet",
        detail: null,
      },
      asOf: null,
    };
  } else if (forecast.state !== "ready") {
    state = forecast;
  } else {
    state = {
      state: "ready",
      reading: forecastReading(figure, forecast.forecast),
      asOf: forecast.forecast.today,
    };
  }
  return (
    <Figure
      figure={figure}
      state={state}
      source={FORECAST_SOURCE}
      uiBridgeId={`overview.block.kpi.${figure}`}
    />
  );
}

export function OverviewKpi({ args }: DataBlockProps<OverviewKpiArgs>) {
  return args.figure in WORK_BUCKET ? (
    <WorkFigure figure={args.figure} />
  ) : (
    <ForecastFigure figure={args.figure} />
  );
}
