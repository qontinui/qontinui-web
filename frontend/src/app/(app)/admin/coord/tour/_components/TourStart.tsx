"use client";

import { Play } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Caption,
  TourLink,
  captionEntry,
  isReachableStop,
  type TourStop,
} from "@/components/presentation";

const START = captionEntry("tour.start");

/**
 * The tour page's start (plan `2026-10-23-console-presentation-spaces`
 * Phase 8): a tour link to the first stop that can be presented — presenting
 * and on the tour, in operator mode too, since this is where the operator
 * starts it — with what starting does beneath it.
 *
 * With no presentable stop there is nowhere to start, and the page says so in
 * a labelled line (`tour.no-stops`): never an empty list, never a button that
 * leads nowhere.
 */
export function TourStart({ stops }: { stops: readonly TourStop[] }) {
  const first = stops.find(isReachableStop) ?? null;
  if (first === null) {
    return (
      <div
        role="status"
        className="max-w-2xl rounded-md border border-border bg-card px-4 py-3"
        data-testid="coord-tour-no-stops"
      >
        <Caption id="tour.no-stops" level={3} persistent />
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="coord-tour-start">
      <TourLink
        bridgeId="coord-tour-start"
        bridgeLabel={`Start the tour at the ${first.surface.title} stop`}
        href={first.href}
        className={buttonVariants({ size: "lg" })}
        data-testid="coord-tour-start-link"
      >
        <Play aria-hidden="true" />
        {START.title}
      </TourLink>
      <Caption id="tour.start" untitled persistent />
    </div>
  );
}
