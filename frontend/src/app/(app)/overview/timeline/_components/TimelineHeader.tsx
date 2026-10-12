"use client";

/**
 * The four facts a reader opens the Timeline for: when the project was
 * planned to run, where it is now, when it is now expected to finish, and the
 * next gate it has to pass.
 *
 * Every figure is the server's (`GET /estimates/{id}/forecast`). A slip is
 * WORDED — "3 weeks late", "4 days early", "On plan" — and never shown as a
 * signed number, so a negative can never read as normal. A figure the server
 * could not produce says "Not known" and the reason is listed below.
 */

import { formatDecimal } from "@/components/overview/money";
import { UnavailableNotes } from "@/components/overview/UnavailableNotes";
import type { TimelineForecast } from "../../_lib/timeline-api";
import { describeSlip, formatDay } from "../../_lib/timeline";

function Fact({
  label,
  value,
  detail,
  uiBridgeId,
  children,
}: {
  label: string;
  /** `null` renders as an explicit "Not known", never as a blank. */
  value: string | null;
  detail?: string | null;
  uiBridgeId: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-ui-bridge-id={uiBridgeId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-overview-serif)] text-xl leading-tight text-foreground sm:text-2xl">
        {value ?? (
          <span className="text-lg text-muted-foreground">Not known</span>
        )}
      </dd>
      {children}
      {detail && (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
    </div>
  );
}

const TONE: Record<string, string> = {
  late: "border-red-600/40 text-red-700 dark:text-red-400",
  early: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  on_plan: "border-border text-muted-foreground",
};

function where(forecast: TimelineForecast): { value: string; detail: string } {
  const named = (p: { code: string; name: string }) => `${p.code} ${p.name}`;
  switch (forecast.position) {
    case "in_progress":
      return {
        value: named(forecast.current_phase!),
        detail: "The phase under way now.",
      };
    case "between_phases":
      return {
        value: `Between phases`,
        detail: forecast.next_phase
          ? `${named(forecast.next_phase)} is next and has not started.`
          : "",
      };
    case "not_started":
      return {
        value: "Not started",
        detail: forecast.next_phase
          ? `${named(forecast.next_phase)} comes first.`
          : "",
      };
    case "finished":
      return { value: "Finished", detail: "Every phase has ended." };
    default:
      return { value: "No phases", detail: "The estimate has no phases yet." };
  }
}

export function TimelineHeader({ forecast }: { forecast: TimelineForecast }) {
  const planned =
    forecast.planned_start && forecast.planned_finish
      ? `${formatDay(forecast.planned_start)} → ${formatDay(forecast.planned_finish)}`
      : null;
  const weeks = [
    forecast.calendar_weeks
      ? `${formatDecimal(forecast.calendar_weeks, 1)} calendar weeks`
      : null,
    forecast.working_weeks
      ? `${formatDecimal(forecast.working_weeks, 1)} working weeks`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  const now = where(forecast);
  const slip = describeSlip(forecast.slip_days);

  return (
    <section data-ui-bridge-id="overview.timeline.header">
      <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <Fact
          label="Planned"
          value={planned}
          detail={weeks || null}
          uiBridgeId="overview.timeline.header.planned"
        />
        <Fact
          label="Where it is now"
          value={now.value}
          detail={now.detail || null}
          uiBridgeId="overview.timeline.header.now"
        />
        <Fact
          label="Expected to finish"
          value={formatDay(forecast.forecast_finish)}
          detail={
            forecast.position === "finished"
              ? "When the last phase ended."
              : "From the phases as recorded so far, against the plan."
          }
          uiBridgeId="overview.timeline.header.forecast"
        >
          {slip && (
            <span
              className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[slip.tone]}`}
              data-ui-bridge-id="overview.timeline.header.slip"
              data-tone={slip.tone}
            >
              {slip.text}
            </span>
          )}
        </Fact>
        <Fact
          label="Next gate"
          value={
            forecast.next_gate
              ? `${forecast.next_gate.code} ${forecast.next_gate.name}`
              : forecast.position === "no_phases"
                ? null
                : "All gates decided"
          }
          detail={forecast.next_gate?.criteria || null}
          uiBridgeId="overview.timeline.header.next-gate"
        />
      </dl>
      <div className="mt-6">
        <UnavailableNotes
          items={forecast.unavailable}
          uiBridgeId="overview.timeline.unavailable"
          heading="What the forecast can’t say yet"
        />
      </div>
    </section>
  );
}
