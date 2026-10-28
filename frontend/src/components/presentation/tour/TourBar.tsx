"use client";

/**
 * TourBar — the tour's chrome above every lens page while the tab is on the
 * tour (plan `2026-10-23-console-presentation-spaces` D1, D5, Phase 8).
 *
 * Mounted ONCE, by `PresentationLens`, so both lens trees (the console and
 * the digital twin) carry it, outside each layout's `PresentationPage` gate:
 * the bar stays on a withheld page, and pressing it never unmounts it.
 *
 * ## When it renders
 *
 * Only while the lens is PRESENTING and the tab is ON THE TOUR. Operator mode
 * never shows it, and neither does `?present=0` (D2: the URL wins). "On the
 * tour" is the tab's state (`tourStore.ts`): a URL carrying the tour marker
 * (`?tour=1`, beside `?present=1` on every tour link) puts the tab on it, and
 * End tour takes it off — dropping the marker from the URL too, so the URL
 * does not put it straight back. A server or hydration render reads the store
 * as off (`getServerSnapshot`), so before the client knows, only a URL
 * carrying the marker draws the bar.
 *
 * The gate reads only the mode and the search params. The body — the path,
 * the controls, the arrow keys — mounts only past it, so a tab that is not
 * on the tour carries no key listener and makes no registration.
 *
 * ## What it shows
 *
 * Where the tour stands, read from the path (`tourView`), never stored: "Stop
 * k of N" over the stops that can be presented, the stop's title, previous
 * and next (each a tour link, or a disabled control saying why), End tour,
 * and the strip of every stop (`TourProgress`). It does NOT repeat the stop's
 * one sentence: the stop page renders its own `<surface>.page` caption, and
 * that IS the stop's one sentence — one registry entry, said once on screen.
 *
 * Off the route (a detail page opened from a stop) it says so and leads back
 * to where the tour left off: the last presentable stop the tab visited,
 * which the store remembers for that alone, or the tour's start.
 *
 * Every control that does something is navigation-only (D3.2): links that
 * carry the presentation, and End tour, which changes only what this tab
 * shows. Each registers with the UI Bridge where it renders, declaring
 * `effect: "read"`. A previous or next with nowhere to go does nothing: it is
 * a disabled button, and it makes no registration (`TourStepControl`).
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { NAVIGATION_ONLY_PROPS } from "@/components/console/navigationOnly";
import { createLogger } from "@/lib/logger";
import { CaptionCopy } from "../Caption";
import { captionEntry } from "../captions";
import { TOUR_LABELS } from "../captions/tourCaptions";
import type { LensSurfaceId } from "../lensSurfaces";
import { usePresentationMode } from "../PresentationModeProvider";
import { TourProgress } from "./TourProgress";
import { TourStepControl } from "./TourStepControl";
import {
  TOUR_PARAM,
  isReachableStop,
  isTourMarker,
  tourView,
  type TourView,
} from "./tourModel";
import { decodeTourState, defaultTourStore, type TourStore } from "./tourStore";
import { useTourKeys } from "./useTourKeys";

const log = createLogger("TourBar");

const OFF_ROUTE = captionEntry("tour.off-route");

export interface TourBarProps {
  /** The tab's tour state; the module-wide store by default (a test passes its own). */
  store?: TourStore;
}

export function TourBar({ store = defaultTourStore }: TourBarProps) {
  const { presenting } = usePresentationMode();
  const searchParams = useSearchParams();
  const marked = isTourMarker(searchParams?.get(TOUR_PARAM));
  const state = decodeTourState(
    useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getServerSnapshot
    )
  );

  // A tour link brought this presenting tab here: it is on the tour from
  // now on, so a link that carries no marker keeps the bar. Out of
  // presentation mode the marker means nothing and records nothing.
  useEffect(() => {
    if (presenting && marked) store.startTour();
  }, [presenting, marked, store]);

  if (!presenting || !(marked || state.onTour)) return null;
  return <TourBarBody store={store} lastStopId={state.lastStopId} />;
}

/** Drop the tour marker from the URL, which would otherwise put the tab straight back on the tour. */
function dropTourMarker(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(TOUR_PARAM)) return;
    url.searchParams.delete(TOUR_PARAM);
    // Next's app router keeps `useSearchParams` in step with the native
    // history API, so this re-renders the bar without a navigation.
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch (err) {
    // The URL keeps its marker and still wins: the bar stays, showing the
    // state the tab is really in rather than the one that was asked for.
    log.warn("could not drop ?tour= from the URL", err);
  }
}

function TourBarBody({
  store,
  lastStopId,
}: {
  store: TourStore;
  lastStopId: LensSurfaceId | null;
}) {
  const pathname = usePathname() ?? "";
  const view = tourView(pathname, lastStopId);

  // The way back from a page off the route: the last PRESENTABLE stop shown.
  const shownStop =
    view.current !== null && isReachableStop(view.current)
      ? view.current.surface.id
      : null;
  useEffect(() => {
    if (shownStop !== null) store.recordStop(shownStop);
  }, [shownStop, store]);

  const previousLink = useRef<HTMLAnchorElement | null>(null);
  const nextLink = useRef<HTMLAnchorElement | null>(null);
  // A key follows the very link on screen, so it cannot go anywhere the
  // control does not say.
  useTourKeys((direction) => {
    const link =
      direction === "previous" ? previousLink.current : nextLink.current;
    if (link === null) return false;
    link.click();
    return true;
  });

  const endTour = useCallback(() => {
    dropTourMarker();
    store.endTour();
  }, [store]);

  return (
    <nav
      aria-label={TOUR_LABELS.bar}
      className="shrink-0 space-y-2 border-b border-border bg-card px-3 py-2 sm:px-6"
      data-testid="tour-bar"
      data-tour-place={view.place}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TourPosition view={view} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <TourStepControl
            direction="previous"
            view={view}
            linkRef={previousLink}
          />
          <TourStepControl direction="next" view={view} linkRef={nextLink} />
          <EndTourButton onEnd={endTour} />
        </div>
      </div>
      <TourProgress view={view} />
    </nav>
  );
}

/** Where the tour stands, in words — announced as it changes. */
function TourPosition({ view }: { view: TourView }) {
  const withheld = view.stops.length - view.presentable;
  return (
    <div
      aria-live="polite"
      className="min-w-0 text-base text-foreground"
      data-testid="tour-bar-position"
    >
      {view.place === "start" && (
        <span className="font-semibold">{TOUR_LABELS.atStart}</span>
      )}
      {view.place === "stop" && view.current !== null && (
        <>
          <span className="font-semibold">
            {view.ordinal !== null
              ? TOUR_LABELS.stopOf(view.ordinal, view.presentable)
              : captionEntry("tour.not-presentable").title}
          </span>{" "}
          · <span data-testid="tour-bar-title">{view.current.surface.title}</span>
          {view.ordinal !== null && withheld > 0 && (
            <span
              className="text-sm text-muted-foreground"
              data-testid="tour-bar-withheld"
            >
              {" "}
              · {TOUR_LABELS.moreNotPresentable(withheld)}
            </span>
          )}
        </>
      )}
      {view.place === "off-route" && (
        <p className="m-0" data-presentation-caption="tour.off-route">
          <span className="font-semibold">{OFF_ROUTE.title}.</span>{" "}
          <CaptionCopy text={OFF_ROUTE.oneLiner} />{" "}
          <span className="text-sm text-muted-foreground">
            <CaptionCopy text={OFF_ROUTE.whyItMatters} />
          </span>
        </p>
      )}
    </div>
  );
}

/** End tour: off the tour in this tab; the page stays in presentation mode. */
function EndTourButton({ onEnd }: { onEnd: () => void }) {
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });
  const customActions = useMemo(
    () => ({
      "end-tour": {
        id: "end-tour",
        label: TOUR_LABELS.endTour,
        description: TOUR_LABELS.endTourTitle,
        effect: "read" as const,
        handler: () => {
          onEndRef.current();
          return true;
        },
      },
    }),
    []
  );
  const { ref } = useUIElement({
    id: "tour-bar-end",
    label: TOUR_LABELS.endTour,
    type: "button",
    customActions,
  });
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      {...NAVIGATION_ONLY_PROPS}
      title={TOUR_LABELS.endTourTitle}
      onClick={onEnd}
      data-testid="tour-bar-end"
    >
      <X aria-hidden="true" />
      {TOUR_LABELS.endTour}
    </Button>
  );
}
