"use client";

/**
 * The phases on a shared month axis — a calendar, not per-row progress bars,
 * so slips and overlaps are visible (plan
 * `2026-09-19-project-overview-for-business-leaders`, Phase 3 design
 * direction). CSS grid and `date-fns`; no gantt library.
 *
 * Per phase: the PLANNED bar above, and below it what happened — solid for
 * the actual span, dashed for what the server forecasts is still to come. A
 * gate marker sits at the phase's end, shaped and coloured by its outcome;
 * choosing it shows the gate's criteria and outcome below the chart. Calendar
 * breaks are shaded and today is a line through every lane. A milestone lane
 * closes the chart.
 *
 * The chart is the visual reading; the list view holds the same facts as
 * text, and is what a screen reader and a phone get.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { CalendarBreakRead } from "../../_lib/estimate-api";
import type { Milestone } from "../../_lib/timeline-api";
import {
  GATE,
  MILESTONE_STATUS_LABEL,
  axisMonths,
  barSpan,
  dayOffset,
  formatDay,
  isoDay,
  toDay,
  type AxisWindow,
} from "../../_lib/timeline";
import { phaseKey, type TimelinePhase } from "./model";

const LABEL_COLUMN = "grid grid-cols-[minmax(7rem,11rem)_1fr]";

function Bar({
  start,
  end,
  window,
  className,
  title,
}: {
  start: string | null;
  end: string | null;
  window: AxisWindow;
  className: string;
  title: string;
}) {
  const from = toDay(start);
  const to = toDay(end);
  if (!from || !to) return null;
  const span = barSpan(from, to, window);
  if (!span) return null;
  return (
    <span
      aria-hidden
      title={title}
      className={cn(
        "absolute h-2.5",
        className,
        span.clippedStart ? "rounded-l-none" : "rounded-l-sm",
        span.clippedEnd ? "rounded-r-none" : "rounded-r-sm"
      )}
      style={{ left: `${span.left}%`, width: `${span.width}%` }}
    />
  );
}

/** Breaks and today, drawn behind every lane so they read as one band and
 *  one line down the whole chart. */
function Backdrop({
  window,
  breaks,
  today,
}: {
  window: AxisWindow;
  breaks: CalendarBreakRead[];
  today: Date;
}) {
  const now = dayOffset(today, window);
  return (
    <>
      {breaks.map((brk) => {
        const from = toDay(brk.start_date);
        const to = toDay(brk.end_date);
        const span = from && to ? barSpan(from, to, window) : null;
        return span ? (
          <span
            key={brk.id}
            aria-hidden
            title={`${brk.label}: ${formatDay(brk.start_date)} – ${formatDay(brk.end_date)}`}
            className="absolute inset-y-0 bg-muted/70"
            style={{ left: `${span.left}%`, width: `${span.width}%` }}
          />
        ) : null;
      })}
      {now !== null && (
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-primary"
          style={{ left: `${now}%` }}
        />
      )}
    </>
  );
}

function PhaseLane({
  phase,
  window,
  breaks,
  today,
  selected,
  onSelect,
}: {
  phase: TimelinePhase;
  window: AxisWindow;
  breaks: CalendarBreakRead[];
  today: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  const p = phase.progress;
  const f = phase.forecast;
  const key = phaseKey(phase);
  const [showTasks, setShowTasks] = useState(false);
  const todayIso = isoDay(today);
  // What happened, solid (an open phase up to today); what is still to come,
  // dashed.
  const actualEnd = p.actual_end ?? (p.actual_start ? todayIso : null);
  const ahead =
    f && f.state !== "done" && f.forecast_start && f.forecast_end
      ? {
          start: f.state === "in_progress" ? todayIso : f.forecast_start,
          end: f.forecast_end,
        }
      : null;
  const gateDay = toDay(p.actual_end ?? p.planned_end);
  const gateAt = gateDay ? dayOffset(gateDay, window) : null;
  const gate = GATE[p.gate_status];

  return (
    <>
      <div
        className={cn(LABEL_COLUMN, "border-b border-border/60")}
        data-ui-bridge-id={`overview.timeline.chart.phase.${key}`}
      >
        <div className="flex min-h-12 flex-col justify-center py-1 pr-2">
          <span className="truncate text-sm text-foreground" title={p.name}>
            <span className="font-mono text-xs text-muted-foreground">
              {p.code}
            </span>{" "}
            {p.name}
          </span>
          {phase.tasks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTasks((v) => !v)}
              aria-expanded={showTasks}
              className="self-start text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-ui-bridge-id={`overview.timeline.chart.phase.${key}.tasks-toggle`}
            >
              {showTasks ? "Hide tasks" : `${phase.tasks.length} tasks`}
            </button>
          )}
        </div>
        <div className="relative min-h-12 overflow-hidden">
          <Backdrop window={window} breaks={breaks} today={today} />
          <span className="sr-only">
            Planned {formatDay(p.planned_start) ?? "with no start"} to{" "}
            {formatDay(p.planned_end) ?? "no end"}.
            {p.actual_start
              ? ` Started ${formatDay(p.actual_start)}.`
              : " Not started."}
            {p.actual_end ? ` Ended ${formatDay(p.actual_end)}.` : ""}
          </span>
          <div className="absolute inset-x-0 top-2.5">
            <Bar
              start={p.planned_start}
              end={p.planned_end}
              window={window}
              className="border border-primary/50 bg-primary/15"
              title={`Planned: ${formatDay(p.planned_start)} – ${formatDay(p.planned_end)}`}
            />
          </div>
          <div className="absolute inset-x-0 top-6">
            <Bar
              start={p.actual_start ?? p.planned_start}
              end={actualEnd}
              window={window}
              className="bg-foreground/70"
              title={`Actual: ${formatDay(p.actual_start)} – ${
                p.actual_end ? formatDay(p.actual_end) : "still running"
              }`}
            />
            {ahead && (
              <Bar
                start={ahead.start}
                end={ahead.end}
                window={window}
                className="border border-dashed border-foreground/60"
                title={`Forecast: to ${formatDay(ahead.end)}`}
              />
            )}
          </div>
          {gateAt !== null && (
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              aria-label={`Gate ${p.code}: ${gate.label}. Show the gate.`}
              title={`Gate ${p.code}: ${gate.label}`}
              className={cn(
                "absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "ring-2 ring-ring"
              )}
              style={{ left: `${gateAt}%` }}
              data-ui-bridge-id={`overview.timeline.chart.phase.${key}.gate`}
              data-gate-status={p.gate_status}
            >
              <span
                aria-hidden
                className={cn("size-3 rotate-45 border-2", gate.marker)}
              />
            </button>
          )}
        </div>
      </div>
      {showTasks &&
        phase.tasks.map((task) => (
          <div
            key={task.id}
            className={cn(LABEL_COLUMN, "border-b border-border/40")}
            data-ui-bridge-id={`overview.timeline.chart.phase.${key}.task.${task.number}`}
          >
            <div className="truncate py-1 pl-3 pr-2 text-xs text-muted-foreground">
              {task.is_critical && (
                <span
                  className="mr-1 font-semibold text-red-700 dark:text-red-400"
                  title="Critical"
                >
                  !<span className="sr-only">Critical:</span>
                </span>
              )}
              {task.number} {task.title}
            </div>
            <div className="relative min-h-7 overflow-hidden">
              <Backdrop window={window} breaks={breaks} today={today} />
              <div className="absolute inset-x-0 top-2.5">
                <Bar
                  start={task.planned_start}
                  end={task.planned_end}
                  window={window}
                  className={
                    task.is_critical
                      ? "border border-red-600/60 bg-red-600/20"
                      : "border border-primary/40 bg-primary/10"
                  }
                  title={`${task.title}: ${formatDay(task.planned_start) ?? "?"} – ${formatDay(task.planned_end) ?? "?"}`}
                />
              </div>
            </div>
          </div>
        ))}
    </>
  );
}

const MILESTONE_MARK: Record<Milestone["status"], string> = {
  planned: "border-foreground/70 bg-background",
  in_progress: "border-primary bg-primary/40",
  done: "border-emerald-600 bg-emerald-600",
  at_risk: "border-amber-500 bg-amber-500",
};

export function TimelineChart({
  phases,
  milestones,
  breaks,
  window,
  today,
  selected,
  onSelect,
}: {
  phases: TimelinePhase[];
  milestones: Milestone[];
  breaks: CalendarBreakRead[];
  window: AxisWindow;
  today: Date;
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  const months = axisMonths(window);
  const now = dayOffset(today, window);
  return (
    <div
      className="rounded-md border border-border"
      data-ui-bridge-id="overview.timeline.chart"
    >
      <div
        className={cn(LABEL_COLUMN, "border-b border-border")}
        data-ui-bridge-id="overview.timeline.chart.axis"
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
              data-ui-bridge-id="overview.timeline.chart.today"
            >
              Today
            </span>
          )}
        </div>
      </div>
      {phases.map((phase) => (
        <PhaseLane
          key={phase.progress.id}
          phase={phase}
          window={window}
          breaks={breaks}
          today={today}
          selected={selected === phaseKey(phase)}
          onSelect={() =>
            onSelect(selected === phaseKey(phase) ? null : phaseKey(phase))
          }
        />
      ))}
      <div
        className={LABEL_COLUMN}
        data-ui-bridge-id="overview.timeline.chart.milestones"
      >
        <div className="flex min-h-10 items-center pr-2 text-sm text-foreground">
          Milestones
        </div>
        <div className="relative min-h-10 overflow-hidden">
          <Backdrop window={window} breaks={breaks} today={today} />
          {milestones.map((m) => {
            const day = toDay(m.target_date);
            const at = day ? dayOffset(day, window) : null;
            if (at === null) return null;
            return (
              <span
                key={m.id}
                title={`${m.title} — ${formatDay(m.target_date)}, ${MILESTONE_STATUS_LABEL[m.status].toLowerCase()}`}
                className={cn(
                  "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
                  MILESTONE_MARK[m.status]
                )}
                style={{ left: `${at}%` }}
                data-ui-bridge-id={`overview.timeline.chart.milestone.${m.id}`}
              >
                <span className="sr-only">
                  {m.title}, {formatDay(m.target_date)},{" "}
                  {MILESTONE_STATUS_LABEL[m.status]}
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div
      className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-2 py-2 text-xs text-muted-foreground"
      data-ui-bridge-id="overview.timeline.chart.legend"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-6 rounded-sm border border-primary/50 bg-primary/15" />
        Planned
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-6 rounded-sm bg-foreground/70" />
        Actual
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-6 rounded-sm border border-dashed border-foreground/60" />
        Forecast
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-4 bg-muted/70" />
        Break
      </span>
      {(["pending", "passed", "failed", "waived"] as const).map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span
            className={cn("size-2.5 rotate-45 border-2", GATE[status].marker)}
          />
          Gate {GATE[status].label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}
