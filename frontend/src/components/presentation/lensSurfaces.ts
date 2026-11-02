/**
 * lensSurfaces — the five pages the presentation lens is built for, in tour
 * order (plan `2026-10-23-console-presentation-spaces` D4, D5).
 *
 * | # | surface | route |
 * |---|---|---|
 * | 1 | digital twin | `/digital-twin` |
 * | 2 | coordination overview | `/admin/coord/home` |
 * | 3 | agentic activity | `/admin/coord/spawns` |
 * | 4 | UI Bridge | `/admin/coord/ui-bridge` |
 * | 5 | dev-ops | `/admin/coord/devops` |
 *
 * Each names its route, its page caption key and its title. The title is READ
 * from the caption registry rather than written twice, so the tour, the nav
 * and the page heading cannot name a surface three ways. The tour (Phase 8)
 * walks {@link LENS_SURFACES} in order; per-page tests read it; and
 * `lensSurfaces.test.ts` fails when a lens route is not under a layout that
 * mounts the lens — a page added here inherits that check with no new test.
 */

import { captionEntry, type CaptionKey } from "./captions";
import { PRESENT_PARAM, encodeChoice } from "./presentationModeResolution";

export type LensSurfaceId =
  | "digital-twin"
  | "coordination-overview"
  | "agentic-activity"
  | "ui-bridge"
  | "dev-ops";

export interface LensSurface {
  readonly id: LensSurfaceId;
  /** The app route, no query string. */
  readonly route: string;
  /** Its page caption — always `<id>.page`. */
  readonly captionKey: CaptionKey;
  /** The caption's title. */
  readonly title: string;
}

interface SurfaceRoute {
  readonly id: LensSurfaceId;
  readonly route: string;
  readonly captionKey: CaptionKey;
}

const ROUTES: readonly SurfaceRoute[] = [
  {
    id: "digital-twin",
    route: "/digital-twin",
    captionKey: "digital-twin.page",
  },
  {
    id: "coordination-overview",
    route: "/admin/coord/home",
    captionKey: "coordination-overview.page",
  },
  {
    id: "agentic-activity",
    route: "/admin/coord/spawns",
    captionKey: "agentic-activity.page",
  },
  {
    id: "ui-bridge",
    route: "/admin/coord/ui-bridge",
    captionKey: "ui-bridge.page",
  },
  { id: "dev-ops", route: "/admin/coord/devops", captionKey: "dev-ops.page" },
];

/** The five lens surfaces, in tour order. */
export const LENS_SURFACES: readonly LensSurface[] = ROUTES.map((s) => ({
  ...s,
  title: captionEntry(s.captionKey).title,
}));

/** The tour itself (Phase 8): not a lens surface, but captioned and lens-mounted. */
export const TOUR_SURFACE = {
  id: "tour",
  route: "/admin/coord/tour",
  captionKey: "tour.page",
  title: captionEntry("tour.page").title,
} as const satisfies {
  id: string;
  route: string;
  captionKey: CaptionKey;
  title: string;
};

/** The lens surface a pathname is on (its route or below it), or `null`. */
export function lensSurfaceForPath(pathname: string): LensSurface | null {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return (
    LENS_SURFACES.find(
      (s) => path === s.route || path.startsWith(`${s.route}/`)
    ) ?? null
  );
}

/** `route` with `?present=1` (or `=0`) — the URL a tour stop links to. */
export function presentationHref(route: string, presenting = true): string {
  const [beforeHash, hash] = route.split("#", 2);
  const base = beforeHash ?? "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${PRESENT_PARAM}=${encodeChoice(presenting)}${
    hash === undefined ? "" : `#${hash}`
  }`;
}
