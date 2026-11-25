"use client";

/**
 * Coord's phases on the shared month axis, for a project whose schedule is
 * derived rather than estimated. It places what the schedule says and nothing
 * else: a bar is drawn only from a start coord (or a person) gave, a phase
 * with no readable dates draws no bar and says why in words, and a
 * milestone with no available date is not placed at all (the list below the
 * chart holds it). Nothing here invents a date to draw.
 *
 * Reuses the Timeline's placement (`barSpan`, `dayOffset`, `axisMonths`) and
 * its milestone lane.
 */

import { cn } from "@/lib/utils";
import {
  figureDay,
  phaseStateWord,
  type LaneMilestone,
  type LaneTone,
} from "../../_lib/schedule";
import type { PhaseView } from "../../_lib/schedule-api";
import {
  axisMonths,
  barSpan,
  dayOffset,
  formatDay,
  toDay,
  type AxisWindow,
} from "../../_lib/timeline";
import { UnknownFigure } from "./UnknownFigure";

export const LABEL_COLUMN = "grid grid-cols-[minmax(7rem,11rem)_1fr]";

const LANE_MARK: Record<LaneTone, string> = {
  planned: "border-foreground/70 bg-background",
  in_progress: "border-primary bg-primary/40",
  done: "border-emerald-600 bg-emerald-600",
  at_risk: "border-amber-500 bg-amber-500",
  // Dated, not confirmed: an outline with a dashed edge, never "done" and
  // never "late".
  unconfirmed: "border-dashed border-muted-foreground bg-background",
  // Status not available: dotted, distinct from "dated, not confirmed".
  unknown: "border-dotted border-muted-foreground bg-muted",
};

const STATE_CHIP: Record<string, string> = {
  done: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  in_progress: "border-primary/50 text-foreground",
  planned: "border-border text-muted-foreground",
  not_confirmed: "border-dashed border-border text-muted-foreground",
};

function TodayLine({ window, today }: { window: AxisWindow; today: Date }) {
  const now = dayOffset(today, window);
  return now === null ? null : (
    <span
      aria-hidden
      className="absolute inset-y-0 w-px bg-primary"
      style={{ left: `${now}%` }}
    />
  );
}

/** The milestone lane: one marker per dated milestone. Shared by both charts. */
export function MilestoneLane({
  lane,
  window,
  today,
  uiPrefix,
  backdrop,
}: {
  lane: LaneMilestone[];
  window: AxisWindow;
  today: Date;
  uiPrefix: string;
  /** Replaces the today line (the estimate chart also shades its breaks). */
  backdrop?: React.ReactNode;
}) {
  return (
    <div className={LABEL_COLUMN} data-ui-bridge-id={`${uiPrefix}.milestones`}>
      <div className="flex min-h-10 items-center pr-2 text-sm text-foreground">
        Milestones
      </div>
      <div className="relative min-h-10 overflow-hidden">
        {backdrop ?? <TodayLine window={window} today={today} />}
        {lane.map((m) => {
          const day = toDay(m.date);
          const at = day ? dayOffset(day, window) : null;
          if (at === null) return null;
          return (
            <span
              key={m.key}
              title={`${m.title} — ${formatDay(m.date)}, ${m.statusWord.toLowerCase()}`}
              className={cn(
                "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
                LANE_MARK[m.tone]
              )}
              style={{ left: `${at}%` }}
              data-ui-bridge-id={`${uiPrefix}.milestone.${m.uiId}`}
            >
              <span className="sr-only">
                {m.title}, {formatDay(m.date)}, {m.statusWord}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PhaseRow({
  phase,
  window,
  today,
}: {
  phase: PhaseView;
  window: AxisWindow;
  today: Date;
}) {
  const id = `overview.schedule.chart.phase.${phase.code}`;
  const state = phase.state.value;
  const start = figureDay(phase.actual_start);
  const end = figureDay(phase.actual_end);
  const planned = figureDay(phase.planned_end);
  const from = toDay(start.day);
  // A bar needs a real start, and a real end — or a state that says the phase
  // is still running, in which case it runs to today. A finished phase with
  // no recorded end draws no bar rather than an invented one.
  const to = toDay(end.day) ?? (state === "in_progress" ? today : null);
  const span = from && to ? barSpan(from, to, window) : null;
  const plannedAt = planned.day ? toDay(planned.day) : null;
  const plannedPos = plannedAt ? dayOffset(plannedAt, window) : null;
  return (
    <div
      className={cn(LABEL_COLUMN, "border-b border-border/60")}
      data-ui-bridge-id={id}
      data-phase-state={state ?? "unknown"}
    >
      <div className="flex min-h-12 flex-col justify-center gap-0.5 py-1 pr-2">
        <span className="truncate text-sm text-foreground" title={phase.name}>
          {phase.name}
        </span>
        <span
          className={cn(
            "w-fit rounded-full border px-2 text-xs",
            state ? STATE_CHIP[state] : "border-dashed text-muted-foreground"
          )}
          data-ui-bridge-id={`${id}.state`}
        >
          {state ? phaseStateWord(state) : "Not available"}
        </span>
      </div>
      <div className="relative min-h-12 overflow-hidden">
        <TodayLine window={window} today={today} />
        {span && (
          <span
            aria-hidden
            title={`${formatDay(start.day)} – ${end.day ? formatDay(end.day) : "still running"}`}
            className={cn(
              "absolute top-4 h-2.5 bg-foreground/70",
              span.clippedStart ? "rounded-l-none" : "rounded-l-sm",
              span.clippedEnd ? "rounded-r-none" : "rounded-r-sm"
            )}
            style={{ left: `${span.left}%`, width: `${span.width}%` }}
            data-ui-bridge-id={`${id}.bar`}
          />
        )}
        {plannedPos !== null && (
          <span
            aria-hidden
            title={`Planned to end ${formatDay(planned.day)}`}
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-muted-foreground bg-background"
            style={{ left: `${plannedPos}%` }}
            data-ui-bridge-id={`${id}.planned-end`}
          />
        )}
        {!span && (
          <span className="absolute inset-y-0 left-2 flex items-center text-xs">
            {start.kind === "unknown" ? (
              <UnknownFigure
                figure={phase.actual_start}
                uiBridgeId={`${id}.dates`}
              />
            ) : (
              <span className="text-muted-foreground">
                Started {formatDay(start.day)}
                {end.kind === "unknown" && (
                  <>
                    {" "}
                    ·{" "}
                    <UnknownFigure
                      figure={phase.actual_end}
                      uiBridgeId={`${id}.end`}
                    />
                  </>
                )}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function ScheduleChart({
  phases,
  lane,
  window,
  today,
}: {
  phases: PhaseView[];
  lane: LaneMilestone[];
  window: AxisWindow;
  today: Date;
}) {
  const months = axisMonths(window);
  const now = dayOffset(today, window);
  return (
    <div
      className="rounded-md border border-border"
      data-ui-bridge-id="overview.schedule.chart"
    >
      <div
        className={cn(LABEL_COLUMN, "border-b border-border")}
        data-ui-bridge-id="overview.schedule.chart.axis"
      >
        <div className="px-2 py-1.5 text-xs text-muted-foreground">Phase</div>
        <div className="relative h-8 overflow-hidden">
          {months.map((month) => (
            <span
              key={month.key}
              className="absolute inset-y-0 truncate border-l border-border/70 pl-1 pt-1.5 text-xs text-muted-foreground"
              style={{ left: `${month.left}%`, width: `${month.width}%` }}
            >
              {month.label}
            </span>
          ))}
          {now !== null && (
            <span
              className="absolute bottom-0 -translate-x-1/2 rounded-sm bg-primary px-1 text-[10px] leading-4 text-primary-foreground"
              style={{ left: `${now}%` }}
              data-ui-bridge-id="overview.schedule.chart.today"
            >
              Today
            </span>
          )}
        </div>
      </div>
      {phases.map((phase) => (
        <PhaseRow
          key={`${phase.index}:${phase.code}`}
          phase={phase}
          window={window}
          today={today}
        />
      ))}
      <MilestoneLane
        lane={lane}
        window={window}
        today={today}
        uiPrefix="overview.schedule.chart"
      />
      <div
        className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-2 py-2 text-xs text-muted-foreground"
        data-ui-bridge-id="overview.schedule.chart.legend"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-6 rounded-sm bg-foreground/70" />
          Under way or done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 border-2 border-muted-foreground" />
          Planned end
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border-2 border-emerald-600 bg-emerald-600" />
          Milestone met
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border-2 border-dashed border-muted-foreground" />
          Dated, not confirmed
        </span>
      </div>
    </div>
  );
}
