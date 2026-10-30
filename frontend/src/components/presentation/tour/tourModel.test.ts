/**
 * The tour's pure model (plan `2026-10-23-console-presentation-spaces` D5,
 * Phase 8): its stops are `LENS_SURFACES` in order, reached only where the
 * readiness registry lets a page be presented; and where the tour stands is
 * read from the path — at the start, at a stop, or off the route — with
 * previous and next skipping every stop it cannot present.
 *
 * Readiness is injected (`routes`), so each case states the registry it
 * reads rather than inheriting whatever is registered today.
 */

import { describe, expect, it } from "vitest";
import { CAPTIONS } from "../captions";
import { LENS_SURFACES, TOUR_SURFACE, type LensSurface } from "../lensSurfaces";
import {
  PRESENTATION_READY_ROUTES,
  type PresentationReadyRoute,
} from "../presentationReadiness";
import {
  TOUR_PARAM,
  isTourMarker,
  tourHref,
  tourStart,
  tourStops,
  tourView,
  type TourTarget,
} from "./tourModel";

const ready = (...routes: string[]): PresentationReadyRoute[] =>
  routes.map((route) => ({ route, provenBy: "x.test.tsx" }));

/** Today's shape: the twin, the UI Bridge and Dev Ops ready; the overview and agentic activity not. */
const TODAY = ready(
  "/digital-twin",
  "/admin/coord/ui-bridge",
  "/admin/coord/devops",
  TOUR_SURFACE.route
);
const ALL = ready(...LENS_SURFACES.map((s) => s.route), TOUR_SURFACE.route);

function viewAt(
  pathname: string,
  routes: readonly PresentationReadyRoute[] = TODAY,
  lastStopId: Parameters<typeof tourView>[1] = null
) {
  return tourView(pathname, lastStopId, tourStops(routes), tourStart(routes));
}

const href = (route: string) => `${route}?present=1&tour=1`;
const stopTarget = (route: string): TourTarget => {
  const surface = LENS_SURFACES.find((s) => s.route === route)!;
  return {
    kind: "stop",
    title: surface.title,
    href: href(route),
    stopId: surface.id,
  };
};
const START: TourTarget = {
  kind: "start",
  title: TOUR_SURFACE.title,
  href: href(TOUR_SURFACE.route),
  stopId: null,
};

describe("the tour's links", () => {
  it("carry the presentation and the tour marker, keeping a query and a hash", () => {
    expect(tourHref("/admin/coord/devops", TODAY)).toBe(
      "/admin/coord/devops?present=1&tour=1"
    );
    expect(
      tourHref("/admin/coord/devops?window=24h#rows", ready("/admin/coord/devops"))
    ).toBe("/admin/coord/devops?window=24h&present=1&tour=1#rows");
  });

  it("are never made to a page that cannot be presented — unregistered, or outside the lens trees", () => {
    expect(tourHref("/admin/coord/spawns", TODAY)).toBeNull();
    // Registered or not, a page outside the lens trees has no presentation
    // mode: one click would leave the lens.
    expect(tourHref("/sessions", ready("/sessions"))).toBeNull();
    expect(tourHref("/admin/coord/devops", [])).toBeNull();
  });

  it("reads the marker only as `1`", () => {
    expect(TOUR_PARAM).toBe("tour");
    expect(isTourMarker("1")).toBe(true);
    for (const raw of [null, undefined, "", "0", "true", "yes"]) {
      expect(isTourMarker(raw)).toBe(false);
    }
  });
});

describe("tourStops", () => {
  it("is LENS_SURFACES in order, titled from the caption registry", () => {
    const stops = tourStops(TODAY);
    expect(stops.map((s) => s.surface)).toEqual(LENS_SURFACES);
    for (const stop of stops) {
      expect(stop.surface.title).toBe(CAPTIONS[stop.surface.captionKey].title);
    }
  });

  it("reaches exactly the stops the registry lets it present", () => {
    expect(
      tourStops(TODAY).map((s) => [s.surface.id, s.href])
    ).toEqual([
      ["digital-twin", href("/digital-twin")],
      ["coordination-overview", null],
      ["agentic-activity", null],
      ["ui-bridge", href("/admin/coord/ui-bridge")],
      ["dev-ops", href("/admin/coord/devops")],
    ]);
  });

  it("joins a stop the day its page is registered, with no tour edit", () => {
    const later = [...TODAY, ...ready("/admin/coord/home")];
    expect(
      tourStops(later).find((s) => s.surface.id === "coordination-overview")
        ?.href
    ).toBe(href("/admin/coord/home"));
  });

  it("never reaches a surface outside the lens trees, even registered", () => {
    const outside: LensSurface = {
      ...LENS_SURFACES[0]!,
      route: "/sessions",
    };
    expect(tourStops(ready("/sessions"), [outside])[0]?.href).toBeNull();
  });

  it("reads the real registry by default", () => {
    expect(tourStops().map((s) => s.href)).toEqual(
      tourStops(PRESENTATION_READY_ROUTES).map((s) => s.href)
    );
  });
});

describe("tourView — at a stop", () => {
  it("counts the stop among the presentable ones, and skips the rest both ways", () => {
    const view = viewAt("/admin/coord/ui-bridge");
    expect(view.place).toBe("stop");
    expect(view.current?.surface.id).toBe("ui-bridge");
    expect([view.ordinal, view.presentable]).toEqual([2, 3]);
    // Previous skips the overview and agentic activity, which it cannot present.
    expect(view.previous).toEqual(stopTarget("/digital-twin"));
    expect(view.next).toEqual(stopTarget("/admin/coord/devops"));
    expect([view.previousMissing, view.nextMissing]).toEqual([null, null]);
  });

  it("has no previous at the first presentable stop, and says why", () => {
    const view = viewAt("/digital-twin");
    expect(view.ordinal).toBe(1);
    expect(view.previous).toBeNull();
    expect(view.previousMissing).toBe("first-stop");
    expect(view.next).toEqual(stopTarget("/admin/coord/ui-bridge"));
  });

  it("goes back to the tour's start after the last presentable stop", () => {
    const view = viewAt("/admin/coord/devops");
    expect([view.ordinal, view.presentable]).toEqual([3, 3]);
    expect(view.next).toEqual(START);
    expect(view.nextMissing).toBeNull();
  });

  it("has no next after the last stop when the start cannot be presented", () => {
    const routes = ready("/digital-twin", "/admin/coord/devops");
    const view = viewAt("/admin/coord/devops", routes);
    expect(view.next).toBeNull();
    expect(view.nextMissing).toBe("no-later-stop");
  });

  it("reads the stop from the path, ignoring the query, the hash and a trailing slash", () => {
    expect(viewAt("/admin/coord/devops/?present=1&tour=1#x").current?.surface.id).toBe(
      "dev-ops"
    );
  });

  it("marks a stop it cannot present as the stop on screen, uncounted, with its neighbours", () => {
    const view = viewAt("/admin/coord/spawns");
    expect(view.place).toBe("stop");
    expect(view.current?.surface.id).toBe("agentic-activity");
    expect(view.ordinal).toBeNull();
    expect(view.previous).toEqual(stopTarget("/digital-twin"));
    expect(view.next).toEqual(stopTarget("/admin/coord/ui-bridge"));
  });

  it("says no earlier stop can be presented before an unpresentable first stop", () => {
    const view = viewAt("/digital-twin", ready("/admin/coord/devops"));
    expect(view.ordinal).toBeNull();
    expect(view.previous).toBeNull();
    expect(view.previousMissing).toBe("no-earlier-stop");
  });

  it("counts over every stop when every one can be presented", () => {
    const view = viewAt("/admin/coord/spawns", ALL);
    expect([view.ordinal, view.presentable]).toEqual([3, 5]);
    expect(view.previous).toEqual(stopTarget("/admin/coord/home"));
  });
});

describe("tourView — at the start", () => {
  it("leads to the first presentable stop, with nothing before it", () => {
    const view = viewAt(TOUR_SURFACE.route);
    expect(view.place).toBe("start");
    expect(view.current).toBeNull();
    expect(view.previous).toBeNull();
    expect(view.previousMissing).toBe("start-of-tour");
    expect(view.next).toEqual(stopTarget("/digital-twin"));
  });

  it("leads nowhere, and says so, when no stop can be presented", () => {
    const view = viewAt(TOUR_SURFACE.route, ready(TOUR_SURFACE.route));
    expect(view.presentable).toBe(0);
    expect(view.next).toBeNull();
    expect(view.nextMissing).toBe("no-presentable-stop");
  });
});

describe("tourView — off the route", () => {
  it("is a detail page below a stop's route, not the stop", () => {
    // `/admin/coord/devops/x` is not registered by `/admin/coord/devops`'s
    // entry, so presentation mode withholds it; the bar must not call it
    // the Dev Ops stop.
    const view = viewAt("/admin/coord/devops/machines/x", TODAY, "dev-ops");
    expect(view.place).toBe("off-route");
    expect(view.current).toBeNull();
  });

  it("leads back to the last presentable stop shown, and on from there", () => {
    const view = viewAt("/admin/coord/work-units/abc", TODAY, "digital-twin");
    expect(view.place).toBe("off-route");
    expect(view.previous).toEqual(stopTarget("/digital-twin"));
    expect(view.next).toEqual(stopTarget("/admin/coord/ui-bridge"));
  });

  it("leads back to the start, and on to the first stop, with no last stop", () => {
    const view = viewAt("/admin/coord/pipeline", TODAY, null);
    expect(view.previous).toEqual(START);
    expect(view.next).toEqual(stopTarget("/digital-twin"));
  });

  it("does not lead back to a remembered stop that can no longer be presented", () => {
    const view = viewAt("/admin/coord/pipeline", TODAY, "agentic-activity");
    expect(view.previous).toEqual(START);
  });

  it("goes on to the start after the last stop", () => {
    const view = viewAt("/admin/coord/pipeline", TODAY, "dev-ops");
    expect(view.previous).toEqual(stopTarget("/admin/coord/devops"));
    expect(view.next).toEqual(START);
  });

  it("with no presentable stop, offers the start and nothing after it", () => {
    const view = viewAt("/admin/coord/pipeline", ready(TOUR_SURFACE.route));
    expect(view.previous).toEqual(START);
    expect(view.next).toBeNull();
    expect(view.nextMissing).toBe("no-presentable-stop");
  });

  it("offers nothing back when neither a stop nor the start can be presented", () => {
    const view = viewAt("/admin/coord/pipeline", []);
    expect(view.previous).toBeNull();
    expect(view.previousMissing).toBe("no-earlier-stop");
    expect(view.next).toBeNull();
  });
});
