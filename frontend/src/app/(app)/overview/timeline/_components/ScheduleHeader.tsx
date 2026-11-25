"use client";

/**
 * The facts a reader opens the Timeline for, from coord's schedule: where the
 * project is now, the next date that matters, when it is expected to finish,
 * and the window it runs in. A figure coord could not give reads "Not
 * available since …" with the reason (`UnknownFigure`); it is never a default
 * date, "0 days" or "On track". The header also names how many figures
 * contradict a value somebody entered, and where the forecast's inputs came
 * from.
 */

import {
  basisWord,
  countPhases,
  currentPhases,
  dayOrNotAvailable,
  nextMilestone,
  type LaneMilestone,
} from "../../_lib/schedule";
import type { ScheduleEnvelope } from "../../_lib/schedule-api";
import { describeSlip, formatDay } from "../../_lib/timeline";
import { UnknownFigure } from "./UnknownFigure";

function Fact({
  label,
  uiBridgeId,
  children,
  detail,
}: {
  label: string;
  uiBridgeId: string;
  children: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div data-ui-bridge-id={uiBridgeId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-overview-serif)] text-xl leading-tight text-foreground sm:text-2xl">
        {children}
      </dd>
      {detail && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

const SLIP_TONE: Record<string, string> = {
  late: "border-red-600/40 text-red-700 dark:text-red-400",
  early: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  on_plan: "border-border text-muted-foreground",
};

function WhereNow({ env }: { env: ScheduleEnvelope }) {
  const id = "overview.schedule.header.now";
  const phases = env.phases.value;
  if (phases === null) {
    return (
      <Fact label="Where it is now" uiBridgeId={id}>
        <UnknownFigure figure={env.phases} uiBridgeId={`${id}.unknown`} />
      </Fact>
    );
  }
  const counts = countPhases(phases);
  const under = currentPhases(phases);
  return (
    <Fact
      label="Where it is now"
      uiBridgeId={id}
      detail={
        counts.notConfirmed + counts.unavailable > 0
          ? `${counts.notConfirmed + counts.unavailable} of ${counts.total} phases have no confirmed state yet.`
          : null
      }
    >
      {under.length > 0
        ? under.map((p) => `${p.code} ${p.name}`).join(", ")
        : `${counts.done} of ${counts.total} phases done`}
    </Fact>
  );
}

function NextDate({
  env,
  lane,
  today,
}: {
  env: ScheduleEnvelope;
  lane: LaneMilestone[];
  today: string;
}) {
  const id = "overview.schedule.header.next";
  const items = env.milestones.items;
  const next = nextMilestone(lane, today);
  if (next) {
    return (
      <Fact
        label="Next date that matters"
        uiBridgeId={id}
        detail={`${next.title}. ${next.statusWord}.`}
      >
        {formatDay(next.date)}
      </Fact>
    );
  }
  if (items.state === "unknown" && lane.length === 0) {
    return (
      <Fact label="Next date that matters" uiBridgeId={id}>
        <UnknownFigure figure={items} uiBridgeId={`${id}.unknown`} />
      </Fact>
    );
  }
  return (
    <Fact label="Next date that matters" uiBridgeId={id}>
      <span className="text-lg text-muted-foreground">
        No upcoming milestone date
      </span>
    </Fact>
  );
}

function Finish({ env }: { env: ScheduleEnvelope }) {
  const id = "overview.schedule.header.forecast";
  const f = env.forecast;
  if (f.value === null) {
    return (
      <Fact label="Expected to finish" uiBridgeId={id}>
        <UnknownFigure figure={f} uiBridgeId={`${id}.unknown`} />
      </Fact>
    );
  }
  const slip = describeSlip(f.value.slip_days);
  return (
    <Fact
      label="Expected to finish"
      uiBridgeId={id}
      detail={env.basis ? `Worked out from ${basisWord(env.basis)}.` : null}
    >
      {dayOrNotAvailable(f.value.forecast_finish)}
      {slip && (
        <span
          className={`mt-2 flex w-fit rounded-full border px-2 py-0.5 font-sans text-xs font-medium ${SLIP_TONE[slip.tone]}`}
          data-ui-bridge-id={`${id}.slip`}
          data-tone={slip.tone}
        >
          {slip.text}
        </span>
      )}
    </Fact>
  );
}

function Window({ env }: { env: ScheduleEnvelope }) {
  const id = "overview.schedule.header.window";
  const { starts, ends } = env.initiative;
  if (starts.value === null || ends.value === null) {
    const missing = starts.value === null ? starts : ends;
    return (
      <Fact label="Runs from – to" uiBridgeId={id}>
        <UnknownFigure figure={missing} uiBridgeId={`${id}.unknown`} />
      </Fact>
    );
  }
  return (
    <Fact label="Runs from – to" uiBridgeId={id}>
      {formatDay(starts.value)} → {formatDay(ends.value)}
    </Fact>
  );
}

export function ScheduleHeader({
  env,
  lane,
  today,
}: {
  env: ScheduleEnvelope;
  lane: LaneMilestone[];
  /** Calendar day taken as today. */
  today: string;
}) {
  return (
    <section data-ui-bridge-id="overview.schedule.header">
      <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <WhereNow env={env} />
        <NextDate env={env} lane={lane} today={today} />
        <Finish env={env} />
        <Window env={env} />
      </dl>
      {env.disagreement_count > 0 && (
        <p
          className="mt-5 max-w-[46rem] rounded-md border border-amber-500/40 px-3 py-2 text-sm text-foreground"
          role="note"
          data-ui-bridge-id="overview.schedule.header.disagreements"
        >
          {env.disagreement_count === 1
            ? "1 figure differs from a value somebody entered."
            : `${env.disagreement_count} figures differ from values somebody entered.`}{" "}
          The project record&rsquo;s value is shown, with the entered one beside
          it.
        </p>
      )}
    </section>
  );
}
