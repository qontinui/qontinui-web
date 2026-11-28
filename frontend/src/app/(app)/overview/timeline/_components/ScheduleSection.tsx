"use client";

/**
 * The schedule coord holds, as one section: header, phases (chart on a wide
 * screen, list on a narrow one), decision gates, the milestone list and
 * the provenance line.
 *
 * This is the whole of what every tenant sees on the Timeline, and the unit a
 * report block reuses: it takes the envelope and nothing else (derived only,
 * plan D5), so wherever it is placed it reads the same words and carries the
 * same provenance line.
 *
 * Plain language only in the body (plan
 * `2026-11-25-overview-timeline-and-milestones-derive-from-coord`, D6): no
 * identifiers, no raw state names. Technical detail sits in the provenance
 * disclosure.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  figureDay,
  gateVerdictWord,
  milestoneLane,
  phaseEndWord,
  phaseStateWord,
  scheduleDays,
  type LaneMilestone,
} from "../../_lib/schedule";
import type {
  GateView,
  PhaseView,
  ScheduleEnvelope,
} from "../../_lib/schedule-api";
import {
  formatDay,
  isoDay,
  projectWindow,
  zoomWindow,
} from "../../_lib/timeline";
import { ProvenanceLine } from "./ProvenanceLine";
import { ScheduleChart } from "./ScheduleChart";
import { ScheduleHeader } from "./ScheduleHeader";
import { UnknownFigure } from "./UnknownFigure";

const CHIP = "rounded-full border px-2 py-0.5 text-xs";

/** The milestones as text: every one, dated or not, with its status and where
 *  it is held. The accessible twin of the chart's lane. */
export function MilestoneList({
  lane,
  env,
  uiPrefix,
}: {
  lane: LaneMilestone[];
  env: ScheduleEnvelope | null;
  uiPrefix: string;
}) {
  const items = env?.milestones.items;
  return (
    <div data-ui-bridge-id={uiPrefix}>
      {items?.state === "unknown" && (
        <p className="mb-2 text-sm" data-ui-bridge-id={`${uiPrefix}.unknown`}>
          Milestones from the project record:{" "}
          <UnknownFigure
            figure={items}
            uiBridgeId={`${uiPrefix}.unknown.figure`}
          />
        </p>
      )}
      {lane.length === 0 && items?.state !== "unknown" ? (
        <p className="text-sm text-muted-foreground">
          No milestones are recorded for this project.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {lane.map((m) => (
            <li key={m.key} data-ui-bridge-id={`${uiPrefix}.item.${m.uiId}`}>
              <span className="text-foreground">{m.title}</span>{" "}
              <span className="text-muted-foreground">
                · {m.date ? formatDay(m.date) : "Date not available"} ·{" "}
                {m.statusWord}
              </span>
            </li>
          ))}
        </ul>
      )}
      {env && env.milestones.unreadable_rows.length > 0 && (
        <div
          className="mt-3 border-l-2 border-amber-500/60 pl-3 text-sm"
          data-ui-bridge-id={`${uiPrefix}.unreadable`}
        >
          <p className="text-foreground">
            The project record holds{" "}
            {env.milestones.unreadable_rows.length === 1
              ? "a milestone"
              : "milestones"}{" "}
            that could not be read:
          </p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {env.milestones.unreadable_rows.map((row, i) => (
              <li key={`${i}:${row}`}>{row}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const GATE_MARK: Record<GateView["verdict"], { symbol: string; pill: string }> =
  {
    pending: {
      symbol: "◇",
      pill: "border-border text-muted-foreground",
    },
    passed: {
      symbol: "✓",
      pill: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
    },
    failed: {
      symbol: "✕",
      pill: "border-red-600/40 text-red-700 dark:text-red-400",
    },
  };

function Gates({ env }: { env: ScheduleEnvelope }) {
  const gates = env.gates.items;
  if (gates.value === null) {
    return (
      <p
        className="text-sm"
        data-ui-bridge-id="overview.schedule.gates.unknown"
      >
        <UnknownFigure
          figure={gates}
          uiBridgeId="overview.schedule.gates.unknown.figure"
        />
      </p>
    );
  }
  if (gates.value.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-ui-bridge-id="overview.schedule.gates.none"
      >
        No decision gates are recorded for this project.
      </p>
    );
  }
  return (
    <ul
      className="space-y-2 text-sm"
      data-ui-bridge-id="overview.schedule.gates.list"
    >
      {gates.value.map((g, i) => {
        const day = formatDay(g.decided_at?.slice(0, 10));
        return (
          <li
            key={`${i}:${g.title}`}
            className="flex flex-wrap items-center gap-2"
            data-ui-bridge-id={`overview.schedule.gates.item.${i}`}
            data-verdict={g.verdict}
          >
            <span
              className={cn(
                CHIP,
                "inline-flex items-center gap-1 font-medium",
                GATE_MARK[g.verdict]?.pill
              )}
            >
              <span aria-hidden>{GATE_MARK[g.verdict]?.symbol}</span>
              {gateVerdictWord(g.verdict)}
            </span>
            <span className="text-foreground">{g.title}</span>
            {day && <span className="text-muted-foreground">· {day}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Coord phases as text: the narrow-screen layout. */
export function SchedulePhaseList({ phases }: { phases: PhaseView[] }) {
  return (
    <ol className="space-y-3" data-ui-bridge-id="overview.schedule.list">
      {phases.map((p) => {
        const start = figureDay(p.actual_start);
        const end = figureDay(p.actual_end);
        const state = p.state.value;
        return (
          <li
            key={`${p.index}:${p.code}`}
            data-ui-bridge-id={`overview.schedule.list.phase.${p.code}`}
          >
            <p className="text-sm text-foreground">
              {p.name}{" "}
              <span className="text-xs text-muted-foreground">
                · {state ? phaseStateWord(state) : "Not available"}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {start.kind === "unknown" ? (
                <>
                  <UnknownFigure
                    figure={p.actual_start}
                    uiBridgeId={`overview.schedule.list.phase.${p.code}.start`}
                  />
                  {end.kind !== "unknown" && (
                    <span
                      data-ui-bridge-id={`overview.schedule.list.phase.${p.code}.end`}
                    >
                      {" · "}
                      {phaseEndWord(p.actual_end_basis)} {formatDay(end.day)}
                    </span>
                  )}
                </>
              ) : (
                <>
                  Started {formatDay(start.day)}
                  {end.kind === "unknown" ? (
                    <>
                      {" · "}
                      <UnknownFigure
                        figure={p.actual_end}
                        uiBridgeId={`overview.schedule.list.phase.${p.code}.end`}
                      />
                    </>
                  ) : (
                    <>
                      {" · "}
                      {phaseEndWord(p.actual_end_basis)} {formatDay(end.day)}
                    </>
                  )}
                </>
              )}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Heading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mb-3 font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
    >
      {children}
    </h2>
  );
}

export function ScheduleSection({
  env,
  today,
}: {
  env: ScheduleEnvelope;
  today?: Date;
}) {
  const now = useMemo(() => today ?? new Date(), [today]);
  const lane = useMemo(
    () => milestoneLane(env.milestones.items.value),
    [env.milestones.items.value]
  );
  const phases = env.phases.value;
  const axis = useMemo(() => {
    const span = projectWindow(scheduleDays(env, lane));
    return span ? zoomWindow(span, "project", now) : null;
  }, [env, lane, now]);
  const todayDay = isoDay(now);

  return (
    <div className="space-y-12" data-ui-bridge-id="overview.schedule">
      <ScheduleHeader env={env} lane={lane} today={todayDay} />

      <section
        aria-labelledby="overview.schedule.phases-heading"
        data-ui-bridge-id="overview.schedule.phases"
      >
        <Heading id="overview.schedule.phases-heading">Phases</Heading>
        {phases === null ? (
          <p
            className="text-[15px]"
            data-ui-bridge-id="overview.schedule.phases.unknown"
          >
            <UnknownFigure
              figure={env.phases}
              uiBridgeId="overview.schedule.phases.unknown.figure"
            />
          </p>
        ) : phases.length === 0 ? (
          <p
            className="text-[15px] text-muted-foreground"
            data-ui-bridge-id="overview.schedule.phases.none"
          >
            The project record declares no phases yet.
          </p>
        ) : (
          <>
            {axis && (
              <div className="hidden overflow-x-auto md:block">
                <div className="min-w-[40rem]">
                  <ScheduleChart
                    phases={phases}
                    lane={lane}
                    window={axis}
                    today={now}
                  />
                </div>
              </div>
            )}
            <div className={axis ? "md:hidden" : undefined}>
              <SchedulePhaseList phases={phases} />
            </div>
          </>
        )}
        {env.unreadable_phases.length > 0 && (
          <div
            className="mt-3 border-l-2 border-amber-500/60 pl-3 text-sm"
            data-ui-bridge-id="overview.schedule.phases.unreadable"
          >
            <p className="text-foreground">
              The project record holds phases that could not be read:
            </p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {env.unreadable_phases.map((row, i) => (
                <li key={`${i}:${row}`}>{row}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section
        aria-labelledby="overview.schedule.gates-heading"
        data-ui-bridge-id="overview.schedule.gates"
      >
        <Heading id="overview.schedule.gates-heading">Decisions</Heading>
        <Gates env={env} />
      </section>

      <section
        aria-labelledby="overview.schedule.milestones-heading"
        data-ui-bridge-id="overview.schedule.milestones"
      >
        <Heading id="overview.schedule.milestones-heading">
          Milestones, from the project record
        </Heading>
        <MilestoneList
          lane={lane}
          env={env}
          uiPrefix="overview.schedule.milestones.list"
        />
      </section>

      <ProvenanceLine
        observedAt={env.observed_at}
        stale={env.stale}
        sources={env.sources}
        uiBridgeId="overview.schedule.provenance"
        detail={
          <ul className="mt-1 space-y-0.5">
            <li>
              Automated checks not shown:{" "}
              {env.gates.other_checks_not_shown.total}
              {env.gates.other_checks_not_shown.truncated ? " or more" : ""};
              withdrawn: {env.gates.withdrawn_not_shown}
            </li>
            <li>
              Work read: {env.work_units.read}
              {env.work_units.truncated ? " (truncated)" : ""}; gate sources
              read: {env.gates.read.read}
              {env.gates.read.total !== null
                ? ` of ${env.gates.read.total}`
                : ""}
            </li>
            {env.gates.items.value?.map((g) => (
              <li key={g.id}>
                Gate {g.id}
                {g.unit_slug ? ` on ${g.unit_slug}` : ""}
              </li>
            ))}
          </ul>
        }
      />
    </div>
  );
}
