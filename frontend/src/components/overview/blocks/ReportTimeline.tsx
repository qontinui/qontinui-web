"use client";

/**
 * `report-timeline` — a report's stops, one per snapshot, and the stepper that
 * chooses which stop every other block of that report on the page shows (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3).
 *
 * - Each stop is a tab: its date, its label, and how it was measured, in
 *   words ("Full review", "Light check"). The arrow keys move between stops,
 *   Home and End go to the first and the last, and the choice is kept in the
 *   URL as `?at.<slug>=<seq>` (`ReportContext`).
 * - Between two stops, the item events dated in that interval.
 * - The panel under the stops says what the chosen stop says, in its own
 *   plain words.
 * - What the view could not show is said, never dropped: a capped page, and
 *   stops the server withheld whole.
 *
 * Choosing a stop changes only what THIS reader sees, so the stepper is
 * navigation: tabs for the presentation oracle, and a UI Bridge registration
 * whose every action declares `effect: "read"`.
 */

import { useId, useMemo, useRef, type KeyboardEvent } from "react";
import { useUIComponent } from "@qontinui/ui-bridge/react";
import { formatDay } from "@/app/(app)/overview/_lib/timeline";
import { cn } from "@/lib/utils";
import type { ReportBlockProps, ReportTimelineArgs } from "./blockArgs";
import {
  BlockFrame,
  BlockNotice,
  ReportContextLine,
  ReportNotReady,
  StopProvenance,
} from "./blockChrome";
import {
  snapshotDoc,
  stopsWithheldWhole,
  useReport,
  type ReadyReport,
  type ViewSnapshot,
} from "./ReportContext";
import { Served } from "./served";
import { methodWords } from "./vocabulary";

function stopDate(stop: ViewSnapshot): string {
  return formatDay(stop.as_of.slice(0, 10)) ?? "date unknown";
}

/** Why the server withheld whole stops, in words. */
function withheldWhy(reasons: string[], count: number): string {
  const one = count === 1;
  return reasons.every((r) => r === "confidential_term")
    ? `${one ? "it names" : "they name"} something this project keeps confidential`
    : `${one ? "it no longer passes" : "they no longer pass"} the checks every report must pass`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Stepper({
  report,
  uiBridgeId,
}: {
  report: ReadyReport;
  uiBridgeId: string;
}) {
  const { stops, selected, select } = report;
  const prefix = useId();
  const panelId = `${prefix}-panel`;
  const tabs = useRef(new Map<number, HTMLButtonElement>());
  const index = selected ? stops.findIndex((s) => s.seq === selected.seq) : -1;

  const choose = (position: number) => {
    const stop = stops[position];
    if (!stop) return;
    tabs.current.get(stop.seq)?.focus();
    select(stop.seq);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: stops.length - 1,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    choose(Math.min(Math.max(to, 0), stops.length - 1));
  };

  // The stepper as an automated walk drives it: every action only changes
  // which stop this reader sees.
  const actions = useMemo(
    () => [
      {
        id: "select-stop",
        label: "Show a stop",
        description:
          "Show the stop with this seq in every block of this report",
        effect: "read" as const,
        handler: (params?: unknown) => {
          const seq = Number((params as { seq?: unknown } | undefined)?.seq);
          if (!stops.some((s) => s.seq === seq)) return false;
          select(seq);
          return true;
        },
      },
      {
        id: "next-stop",
        label: "Next stop",
        effect: "read" as const,
        handler: () => {
          const next = stops[index + 1];
          if (!next) return false;
          select(next.seq);
          return true;
        },
      },
      {
        id: "previous-stop",
        label: "Previous stop",
        effect: "read" as const,
        handler: () => {
          const previous = stops[index - 1];
          if (!previous) return false;
          select(previous.seq);
          return true;
        },
      },
    ],
    [stops, index, select]
  );
  useUIComponent({
    id: uiBridgeId,
    name: "Report timeline",
    description: "Chooses which stop of the report this page shows",
    actions,
    state: () => ({ selected: selected?.seq ?? null }),
  });

  const doc = snapshotDoc(selected);
  const changes = selected?.changes_since_previous ?? null;
  const itemLabel = (id: string) =>
    doc?.items.find((i) => i.id === id)?.label ?? null;

  return (
    <>
      <div
        role="tablist"
        aria-label="Stops in this report"
        aria-orientation="horizontal"
        className="flex flex-wrap items-stretch gap-1"
        onKeyDown={onKeyDown}
        data-ui-bridge-id={`${uiBridgeId}.stops`}
      >
        {stops.map((stop, position) => {
          const active = stop.seq === selected?.seq;
          const events = stop.changes_since_previous?.events.length ?? 0;
          return (
            <span
              key={stop.seq}
              role="presentation"
              className="flex items-stretch gap-1"
            >
              {position > 0 && (
                <span
                  aria-hidden
                  className="flex items-center px-1 text-xs text-muted-foreground"
                  data-ui-bridge-id={`${uiBridgeId}.between.${stop.seq}`}
                >
                  {events > 0
                    ? `· ${plural(events, "event", "events")} ·`
                    : "→"}
                </span>
              )}
              <button
                ref={(el) => {
                  if (el) tabs.current.set(stop.seq, el);
                  else tabs.current.delete(stop.seq);
                }}
                type="button"
                role="tab"
                id={`${prefix}-stop-${stop.seq}`}
                aria-selected={active}
                aria-controls={panelId}
                tabIndex={active ? 0 : -1}
                onClick={() => select(stop.seq)}
                className={cn(
                  "min-h-11 rounded-md border px-3 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
                data-ui-bridge-id={`${uiBridgeId}.stop.${stop.seq}`}
                data-selected={active ? "true" : "false"}
              >
                <span className="block text-xs">{stopDate(stop)}</span>{" "}
                <span className="block font-medium">
                  <Served text={stop.label} />
                </span>{" "}
                <span className="block text-xs">
                  {methodWords(stop.method_kind)}
                </span>
              </button>
            </span>
          );
        })}
      </div>

      {selected && (
        <div
          role="tabpanel"
          id={panelId}
          aria-labelledby={`${prefix}-stop-${selected.seq}`}
          className="mt-4 space-y-2"
          data-ui-bridge-id={`${uiBridgeId}.panel`}
        >
          <p className="text-foreground">
            <span className="font-medium">
              <Served text={selected.label} />
            </span>
            {` — measured ${stopDate(selected)}, by ${methodWords(selected.method_kind).toLowerCase()}`}
            {": "}
            <Served text={selected.method_label} />
          </p>
          {doc?.method.note && (
            <p className="text-muted-foreground">
              <Served text={doc.method.note} />
            </p>
          )}
          {doc?.summary && (
            <p
              className="text-[15px] leading-relaxed text-foreground"
              data-ui-bridge-id={`${uiBridgeId}.panel.summary`}
            >
              <Served text={doc.summary} />
            </p>
          )}
          {doc === null && (
            <p className="text-muted-foreground">
              This stop&rsquo;s details can&rsquo;t be read.
            </p>
          )}
          {changes === null ? (
            <p className="text-muted-foreground">
              This is the report&rsquo;s first stop, so there is nothing earlier
              to compare it with.
            </p>
          ) : changes.events.length > 0 ? (
            <div data-ui-bridge-id={`${uiBridgeId}.panel.events`}>
              <p className="text-muted-foreground">
                What happened since the stop before:
              </p>
              <ul className="mt-1 space-y-0.5">
                {changes.events.map((event, i) => {
                  const label = itemLabel(event.item_id);
                  return (
                    <li key={`${event.item_id}:${event.at}:${i}`}>
                      <span className="text-muted-foreground">
                        {formatDay(event.at) ?? event.at}
                      </span>{" "}
                      <Served text={event.label} />
                      {label && (
                        <span className="text-muted-foreground">
                          {" ("}
                          <Served text={label} />
                          {")"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Nothing dated happened between the stop before and this one.
            </p>
          )}
          <StopProvenance stop={selected} />
        </div>
      )}
      <Caveats report={report} uiBridgeId={uiBridgeId} />
    </>
  );
}

/** What the view did not show, said rather than dropped. */
function Caveats({
  report,
  uiBridgeId,
}: {
  report: ReadyReport;
  uiBridgeId: string;
}) {
  const { view, unmatchedSeq } = report;
  const whole = stopsWithheldWhole(view);
  const reasons = view.withheld
    .filter((w) => whole.includes(w.seq))
    .map((w) => w.reason);
  if (!view.truncated && whole.length === 0 && unmatchedSeq === null) {
    return null;
  }
  return (
    <ul
      className="mt-3 space-y-1 text-xs text-muted-foreground"
      data-ui-bridge-id={`${uiBridgeId}.caveats`}
    >
      {view.truncated && (
        <li data-ui-bridge-id={`${uiBridgeId}.caveats.truncated`}>
          Showing the newest {view.shown} of {view.total} stops.
        </li>
      )}
      {whole.length > 0 && (
        <li data-ui-bridge-id={`${uiBridgeId}.caveats.withheld`}>
          {plural(whole.length, "stop", "stops")}{" "}
          {whole.length === 1 ? "isn't" : "aren't"} shown: the server withheld{" "}
          {whole.length === 1 ? "it" : "them"} because{" "}
          {withheldWhy(reasons, whole.length)}.
        </li>
      )}
      {unmatchedSeq !== null && (
        <li data-ui-bridge-id={`${uiBridgeId}.caveats.unmatched`}>
          The stop this link named isn&rsquo;t shown here, so the newest stop is
          selected.
        </li>
      )}
    </ul>
  );
}

export function ReportTimeline({
  report: slug,
}: ReportBlockProps<ReportTimelineArgs>) {
  const state = useReport(slug);
  const uiBridgeId = `overview.report.${slug}.timeline`;
  return (
    <BlockFrame
      name="report-timeline"
      uiBridgeId={uiBridgeId}
      label="Report timeline"
    >
      {state.status !== "ready" ? (
        <ReportNotReady state={state} uiBridgeId={uiBridgeId} />
      ) : (
        <>
          <ReportContextLine title={state.view.report.title} stop={null} />
          {state.stops.length === 0 ? (
            <>
              <BlockNotice
                title={
                  state.view.total === 0
                    ? "No stops have been published for this report yet."
                    : "None of this report's stops can be shown."
                }
                uiBridgeId={`${uiBridgeId}.empty`}
              />
              <Caveats report={state} uiBridgeId={uiBridgeId} />
            </>
          ) : (
            <Stepper report={state} uiBridgeId={uiBridgeId} />
          )}
        </>
      )}
    </BlockFrame>
  );
}
