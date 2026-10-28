"use client";

import { INERT } from "@/components/console";
import { Badge } from "@/components/ui/badge";
import {
  Caption,
  TOUR_LABELS,
  captionEntry,
  isReachableStop,
  type CaptionKey,
  type TourStop,
} from "@/components/presentation";
import { cn } from "@/lib/utils";

/** A stop's state on the tour page: its page can be presented, or not yet. */
export type TourStopState = "ready" | "not-presentable";

/** Each state's caption: the badge is its title, the key below the list its sentences. */
const STATE_CAPTION: Readonly<Record<TourStopState, CaptionKey>> = {
  ready: "tour.ready",
  "not-presentable": "tour.not-presentable",
};

/**
 * Both states are calm (R3: neither is anyone's move now) and say what they
 * are in words; the dashed edge is the `draft` treatment — provisional, not
 * wrong.
 */
const STATE_CLASS: Readonly<Record<TourStopState, string>> = {
  ready: INERT,
  "not-presentable": cn(INERT, "border-dashed"),
};

export function tourStopState(stop: TourStop): TourStopState {
  return isReachableStop(stop) ? "ready" : "not-presentable";
}

function StopStateBadge({ state }: { state: TourStopState }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[11px] font-semibold whitespace-nowrap",
        STATE_CLASS[state]
      )}
      data-tour-state-badge={state}
    >
      {captionEntry(STATE_CAPTION[state]).title}
    </Badge>
  );
}

/**
 * The tour page's ordered stop list (plan
 * `2026-10-23-console-presentation-spaces` D5, Phase 8): every stop in tour
 * order, each with its own page's caption — title, one-liner and, while
 * presenting, why it matters — and its state. A stop that is not presentable
 * keeps its place, labelled, and its caption is BRIEF: why its page matters
 * would describe content the tour does not show (the rule
 * `PresentationPage`'s placeholder follows). Under the list, what each state
 * that occurs means.
 *
 * Nothing here is a link: the one way into the tour is "Start the tour", and
 * the tour bar moves between stops from there.
 */
export function TourStopList({ stops }: { stops: readonly TourStop[] }) {
  const ready = stops.filter(isReachableStop).length;
  const states = (["ready", "not-presentable"] as const).filter((state) =>
    stops.some((stop) => tourStopState(stop) === state)
  );
  return (
    <section className="space-y-3" data-testid="coord-tour-stops">
      <Caption id="tour.stops" level={2} persistent />
      <p
        className="m-0 text-sm text-foreground"
        data-testid="coord-tour-ready-count"
      >
        {TOUR_LABELS.readyCount(ready, stops.length)}
      </p>
      <ol
        className="m-0 list-none divide-y divide-border p-0"
        data-testid="coord-tour-stop-list"
      >
        {stops.map((stop) => {
          const state = tourStopState(stop);
          return (
            <li
              key={stop.surface.id}
              className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3"
              data-tour-stop={stop.surface.id}
              data-tour-stop-state={state}
            >
              <Caption
                id={stop.surface.captionKey}
                level={3}
                persistent
                brief={state !== "ready"}
                className="min-w-0 flex-1"
              />
              <StopStateBadge state={state} />
            </li>
          );
        })}
      </ol>
      <div className="space-y-2" data-testid="coord-tour-state-key">
        {states.map((state) => (
          <div key={state} className="flex flex-wrap items-start gap-2">
            <StopStateBadge state={state} />
            <Caption
              id={STATE_CAPTION[state]}
              untitled
              persistent
              className="min-w-0 flex-1"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
