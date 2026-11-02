"use client";

/**
 * /admin/coord/tour — where the presentation tour starts (plan
 * `2026-10-23-console-presentation-spaces` D1, D5, Phase 8).
 *
 * The tour walks the REAL pages: each stop is a lens surface's own route
 * (`LENS_SURFACES`, in that order), opened in presentation mode — never
 * embedded, re-rendered or forked here. This page shows the walk before it
 * starts: the tour's caption, "Start the tour" (a tour link to the first stop
 * that can be presented), and every stop in order with its own page's
 * caption and whether it can be presented yet. A stop's state is read from
 * `PRESENTATION_READY_ROUTES`, so a page joins the tour by itself the day its
 * phase registers it. Once started, the tour bar `PresentationLens` mounts
 * above every lens page carries the tour from stop to stop.
 *
 * It renders in operator mode too — the operator starts the tour here — and
 * every link on it carries `?present=1` and the tour marker whichever mode it
 * is in. It reads nothing: the stops and their states come from the code, so
 * the page has no unknown to report.
 *
 * Registered presentation-ready (`presentationReadiness.ts`), proven by
 * `page.presentation.test.tsx`. Console style (`console-ui-style-guide.md`
 * §3.12): in operator mode the console header's crumb is the page's title
 * (R9), and while presenting the tour's caption opens the page, as on the UI
 * Bridge dashboard.
 */

import { Caption, tourStops } from "@/components/presentation";
import { TourStart } from "./_components/TourStart";
import { TourStopList } from "./_components/TourStopList";

export default function TourPage() {
  const stops = tourStops();
  return (
    <div
      className="max-w-3xl space-y-4 p-3 sm:p-6"
      data-testid="coord-tour-page"
    >
      <Caption id="tour.page" level={2} />
      <TourStart stops={stops} />
      <TourStopList stops={stops} />
    </div>
  );
}
