"use client";

import { cn } from "@/lib/utils";
import { captionEntry, captionPlainText } from "../captions";
import { TOUR_LABELS } from "../captions/tourCaptions";
import { TourLink } from "./TourLink";
import { isReachableStop, type TourStop, type TourView } from "./tourModel";

const NOT_PRESENTABLE = captionEntry("tour.not-presentable");

const ITEM = "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm";

/** The UI Bridge id of a stop's link in the strip. */
export function tourStopBridgeId(stop: TourStop): string {
  return `tour-bar-stop-${stop.surface.id}`;
}

/**
 * The tour bar's progress strip: EVERY stop, in tour order (plan
 * `2026-10-23-console-presentation-spaces` D5, Phase 8).
 *
 * - the stop on screen is marked `aria-current="step"` and is not a link;
 * - a presentable stop is a tour link (`TourLink`), carrying the
 *   presentation and the tour;
 * - a stop that is not presentable stays in the strip, in its place, labelled
 *   "Not yet presentable" — never a link, never styled as one.
 *
 * No numbers: the bar's "Stop k of N" counts the presentable stops, and a
 * second numbering over every stop would give one stop two numbers.
 */
export function TourProgress({ view }: { view: TourView }) {
  return (
    <ol
      aria-label={TOUR_LABELS.progress}
      className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0"
      data-testid="tour-bar-progress"
    >
      {view.stops.map((stop) => (
        <li
          key={stop.surface.id}
          data-tour-stop={stop.surface.id}
          data-tour-stop-state={isReachableStop(stop) ? "ready" : "not-presentable"}
        >
          <ProgressItem stop={stop} current={view.current === stop} />
        </li>
      ))}
    </ol>
  );
}

function ProgressItem({ stop, current }: { stop: TourStop; current: boolean }) {
  const title = stop.surface.title;
  const notPresentable = isReachableStop(stop) ? null : (
    <span className="text-xs" data-tour-stop-note="">
      · {NOT_PRESENTABLE.title}
    </span>
  );
  if (current) {
    return (
      <span
        aria-current="step"
        className={cn(ITEM, "bg-primary font-medium text-primary-foreground")}
        data-testid="tour-bar-current-stop"
      >
        {title}
        {notPresentable}
      </span>
    );
  }
  if (isReachableStop(stop)) {
    return (
      <TourLink
        bridgeId={tourStopBridgeId(stop)}
        bridgeLabel={`Tour: go to the ${title} stop`}
        href={stop.href}
        className={cn(
          ITEM,
          "text-foreground underline-offset-4 hover:bg-muted hover:underline"
        )}
        data-testid={`tour-bar-stop-${stop.surface.id}`}
      >
        {title}
      </TourLink>
    );
  }
  return (
    <span
      className={cn(
        ITEM,
        "border border-dashed border-border text-muted-foreground"
      )}
      title={captionPlainText(NOT_PRESENTABLE.oneLiner)}
      data-testid={`tour-bar-stop-${stop.surface.id}`}
    >
      {title}
      {notPresentable}
    </span>
  );
}
