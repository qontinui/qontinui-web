/**
 * tourModel — the tour's stops, and where the tour stands on the page on
 * screen, as pure functions (plan `2026-10-23-console-presentation-spaces`
 * D1, D5 and Phase 8).
 *
 * ## The stops are the lens surfaces, and only the presentable ones are reached
 *
 * The tour keeps no list of its own: its stops are `LENS_SURFACES`, in that
 * order, each titled from the caption registry. A stop is REACHABLE only when
 * its page can be presented — inside a lens tree and registered in
 * `PRESENTATION_READY_ROUTES` — which is `lensLinkTarget`'s decision, the
 * same one every `LensLink` makes. A stop that is not reachable stays in the
 * list, labelled, and is never linked: previous and next skip it. So a page
 * joins the tour by itself the day its phase registers it, and no tour link
 * can lead, while presenting, to the withheld placeholder or out of the lens
 * (D3 fails closed).
 *
 * ## Where the tour stands is read from the path, never stored
 *
 * {@link tourView} derives the place from the pathname, so what the tour bar
 * says cannot disagree with the page on screen:
 *
 * - `start` — the tour page itself, before the first stop;
 * - `stop` — a stop's own route, EXACTLY. A page below a stop's route (a
 *   detail page) is not that stop: it is not registered presentation-ready
 *   by the stop's registration (`routeMatches` is exact), so presentation
 *   mode withholds it, and calling it the stop would be the bar contradicting
 *   the placeholder under it;
 * - `off-route` — any other lens page. The way back is the last presentable
 *   stop the tab visited (`lastStopId`, the one thing the tour remembers), or
 *   the tour's start when there is none.
 *
 * Every link the tour makes carries `?present=1` (a tab opened from it still
 * presents) and the tour marker `?tour=1` (the tab it opens is on the tour).
 */

import {
  LENS_SURFACES,
  TOUR_SURFACE,
  type LensSurface,
  type LensSurfaceId,
} from "../lensSurfaces";
import { lensLinkTarget } from "../presentationLinks";
import {
  PRESENTATION_READY_ROUTES,
  normalizePath,
  type PresentationReadyRoute,
} from "../presentationReadiness";

/** The URL key that marks a tour link, beside `present`. */
export const TOUR_PARAM = "tour";

/** The marker's one value. */
export const TOUR_MARKER = "1";

/** Whether a `?tour=` value marks a tab arriving on the tour. */
export function isTourMarker(raw: string | null | undefined): boolean {
  return raw === TOUR_MARKER;
}

/** `href` with the tour marker added beside its query, before its hash. */
function withTourMarker(href: string): string {
  const [beforeHash, hash] = href.split("#", 2);
  const base = beforeHash ?? "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${TOUR_PARAM}=${TOUR_MARKER}${
    hash === undefined ? "" : `#${hash}`
  }`;
}

/**
 * Where a tour link to `route` leads: `route` presenting and on the tour —
 * or `null` when its page cannot be presented (outside the lens trees, or
 * not registered presentation-ready), so no link is made.
 */
export function tourHref(
  route: string,
  routes: readonly PresentationReadyRoute[] = PRESENTATION_READY_ROUTES
): string | null {
  const target = lensLinkTarget(route, true, routes);
  return target === null ? null : withTourMarker(target);
}

export interface TourStop {
  readonly surface: LensSurface;
  /** Where the stop's page is linked from the tour; `null` while it cannot be presented. */
  readonly href: string | null;
}

/** A stop whose page can be presented now. */
export type ReachableTourStop = TourStop & { readonly href: string };

export function isReachableStop(stop: TourStop): stop is ReachableTourStop {
  return stop.href !== null;
}

/** Every stop, in tour order, each with its tour link or `null`. */
export function tourStops(
  routes: readonly PresentationReadyRoute[] = PRESENTATION_READY_ROUTES,
  surfaces: readonly LensSurface[] = LENS_SURFACES
): TourStop[] {
  return surfaces.map((surface) => ({
    surface,
    href: tourHref(surface.route, routes),
  }));
}

/** Where a previous or next control leads: a stop, or the tour's start. */
export interface TourTarget {
  readonly kind: "stop" | "start";
  readonly title: string;
  readonly href: string;
  /** The stop's id; `null` for the start. */
  readonly stopId: LensSurfaceId | null;
}

/**
 * The tour page as a target, or `null` when it cannot be presented — then
 * nothing links back to the start.
 */
export function tourStart(
  routes: readonly PresentationReadyRoute[] = PRESENTATION_READY_ROUTES
): TourTarget | null {
  const href = tourHref(TOUR_SURFACE.route, routes);
  return href === null
    ? null
    : { kind: "start", title: TOUR_SURFACE.title, href, stopId: null };
}

/** Why a previous or next control leads nowhere, for its accessible name. */
export type TourMissingReason =
  /** The tour page: nothing comes before the start. */
  | "start-of-tour"
  /** The first presentable stop. */
  | "first-stop"
  /** No presentable stop before this page. */
  | "no-earlier-stop"
  /** No presentable stop after this page, and no start to go back to. */
  | "no-later-stop"
  /** No stop can be presented at all. */
  | "no-presentable-stop";

export type TourPlace = "start" | "stop" | "off-route";

export interface TourView {
  readonly place: TourPlace;
  /** Every stop, in tour order. */
  readonly stops: readonly TourStop[];
  /** The stop whose own route is on screen; `null` at the start and off the route. */
  readonly current: TourStop | null;
  /** The current stop's place among the presentable stops (1-based); `null` unless it is one. */
  readonly ordinal: number | null;
  /** How many stops can be presented. */
  readonly presentable: number;
  readonly previous: TourTarget | null;
  /** Set exactly when `previous` is `null`. */
  readonly previousMissing: TourMissingReason | null;
  readonly next: TourTarget | null;
  /** Set exactly when `next` is `null`. */
  readonly nextMissing: TourMissingReason | null;
}

function stopTarget(stop: ReachableTourStop): TourTarget {
  return {
    kind: "stop",
    title: stop.surface.title,
    href: stop.href,
    stopId: stop.surface.id,
  };
}

/**
 * Where the tour stands on `pathname`. `lastStopId` is the last presentable
 * stop the tab visited — read only off the route, as the way back.
 */
export function tourView(
  pathname: string,
  lastStopId: LensSurfaceId | null,
  stops: readonly TourStop[] = tourStops(),
  start: TourTarget | null = tourStart()
): TourView {
  const path = normalizePath(pathname);
  const reachable = stops.filter(isReachableStop);
  const before = (stop: TourStop): ReachableTourStop | null =>
    reachable.filter((s) => stops.indexOf(s) < stops.indexOf(stop)).at(-1) ??
    null;
  const after = (stop: TourStop): ReachableTourStop | null =>
    reachable.find((s) => stops.indexOf(s) > stops.indexOf(stop)) ?? null;
  const missingNext = (): TourMissingReason =>
    reachable.length === 0 ? "no-presentable-stop" : "no-later-stop";
  const common = { stops, presentable: reachable.length };

  if (path === normalizePath(TOUR_SURFACE.route)) {
    const first = reachable[0] ?? null;
    return {
      ...common,
      place: "start",
      current: null,
      ordinal: null,
      previous: null,
      previousMissing: "start-of-tour",
      next: first === null ? null : stopTarget(first),
      nextMissing: first === null ? "no-presentable-stop" : null,
    };
  }

  const current =
    stops.find((s) => normalizePath(s.surface.route) === path) ?? null;
  if (current !== null) {
    const earlier = before(current);
    const later = after(current);
    // At the last presentable stop the way on is back to the start.
    const next = later === null ? start : stopTarget(later);
    return {
      ...common,
      place: "stop",
      current,
      ordinal: isReachableStop(current) ? reachable.indexOf(current) + 1 : null,
      previous: earlier === null ? null : stopTarget(earlier),
      previousMissing:
        earlier !== null
          ? null
          : isReachableStop(current)
            ? "first-stop"
            : "no-earlier-stop",
      next,
      nextMissing: next === null ? missingNext() : null,
    };
  }

  // Off the route: back to where the tour left off — the last presentable
  // stop this tab visited, or the start — and on from there.
  const anchor =
    lastStopId === null
      ? null
      : (reachable.find((s) => s.surface.id === lastStopId) ?? null);
  const previous = anchor === null ? start : stopTarget(anchor);
  const following = anchor === null ? (reachable[0] ?? null) : after(anchor);
  const next =
    following !== null
      ? stopTarget(following)
      : anchor === null
        ? null
        : start;
  return {
    ...common,
    place: "off-route",
    current: null,
    ordinal: null,
    previous,
    previousMissing: previous === null ? "no-earlier-stop" : null,
    next,
    nextMissing: next === null ? missingNext() : null,
  };
}
