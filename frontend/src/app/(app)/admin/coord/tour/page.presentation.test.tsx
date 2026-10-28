/**
 * /admin/coord/tour in presentation mode — the proof that registers it
 * presentation-ready (plan `2026-10-23-console-presentation-spaces` Phase 8;
 * `presentationReadiness.ts` names this file).
 *
 * The REAL page over the REAL readiness registry, rendered with Phase 1's
 * helper under the real UI Bridge provider. The page reads nothing, so there
 * is no data source to mock; and every expectation below is derived from
 * `PRESENTATION_READY_ROUTES`, so a stop whose phase registers its page joins
 * the tour — and this proof keeps passing — with no edit here.
 *
 * `expectPresentationSafe` fails on an enabled control that is not
 * navigation-only, a lens link without `?present=1`, a write or undeclared
 * UI Bridge registration, a cost, a missing caption, or an identity. Beyond
 * it, this file pins what the tour page promises: every stop in tour order
 * with its state; no link to a stop that cannot be presented; one way in,
 * the start link, carrying the presentation and the tour marker; and that
 * link registered with the UI Bridge as navigation-only.
 */

import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LENS_SURFACES,
  TOUR_LINK_ACTION_DESCRIPTION,
  isPresentationReady,
  presentationHref,
  type CaptionKey,
} from "@/components/presentation";
import {
  expectPresentationSafe,
  renderInPresentationMode,
  type UiBridgeRegistryView,
} from "@/test/presentation";
import TourPage from "./page";

/** Each stop and whether the real registry lets the tour reach it. */
const STOPS = LENS_SURFACES.map((surface) => ({
  surface,
  ready: isPresentationReady(surface.route),
}));
const FIRST_READY = STOPS.find((stop) => stop.ready) ?? null;

/** Every caption the page renders over the real registry. */
const CAPTIONS: CaptionKey[] = [
  "tour.page",
  "tour.stops",
  ...(FIRST_READY === null
    ? (["tour.no-stops"] as const)
    : (["tour.start"] as const)),
  ...(STOPS.some((s) => s.ready) ? (["tour.ready"] as const) : []),
  ...(STOPS.some((s) => !s.ready) ? (["tour.not-presentable"] as const) : []),
  ...LENS_SURFACES.map((s) => s.captionKey),
];

function registryOf(view: { uiBridge: unknown }): UiBridgeRegistryView {
  const observed = view.uiBridge as { registry?: UiBridgeRegistryView };
  if (!observed.registry) throw new Error("no UI Bridge registry was read");
  return observed.registry;
}

describe("/admin/coord/tour in presentation mode", () => {
  it("is safe to show: its captions, every stop, no control but a tour link, no cost, no identity", () => {
    const view = renderInPresentationMode(<TourPage />);
    expect(screen.getByTestId("coord-tour-page")).toBeTruthy();
    // Not vacuous: the registry this proof reads has a stop the tour reaches.
    expect(FIRST_READY).not.toBeNull();
    expectPresentationSafe(view, { captions: CAPTIONS });
  });

  it("lists every stop in tour order, each with its state from the registry", () => {
    renderInPresentationMode(<TourPage />);
    const items = within(
      screen.getByTestId("coord-tour-stop-list")
    ).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-tour-stop"))).toEqual(
      LENS_SURFACES.map((s) => s.id)
    );
    items.forEach((li, i) => {
      const stop = STOPS[i]!;
      expect(li).toHaveTextContent(stop.surface.title);
      expect(li.getAttribute("data-tour-stop-state")).toBe(
        stop.ready ? "ready" : "not-presentable"
      );
      expect(li).toHaveTextContent(
        stop.ready ? "Ready to present" : "Not yet presentable"
      );
    });
    const ready = STOPS.filter((s) => s.ready).length;
    expect(screen.getByTestId("coord-tour-ready-count")).toHaveTextContent(
      `${ready} of ${STOPS.length} stops ${ready === 1 ? "is" : "are"} ready to present.`
    );
  });

  it("links into the tour once — the start, to the first stop it can present — and never to a stop it cannot", () => {
    const view = renderInPresentationMode(<TourPage />);
    const links = [...view.container.querySelectorAll("a[href]")];
    expect(links).toHaveLength(1);
    const start = screen.getByTestId("coord-tour-start-link");
    expect(links[0]).toBe(start);
    expect(start).toHaveTextContent("Start the tour");
    expect(start.getAttribute("href")).toBe(
      `${presentationHref(FIRST_READY!.surface.route)}&tour=1`
    );
    for (const stop of STOPS.filter((s) => !s.ready)) {
      const item = view.container.querySelector(
        `[data-tour-stop="${stop.surface.id}"]`
      );
      expect(item?.querySelector("a")).toBeNull();
    }
  });

  it("registers the start link with the UI Bridge as navigation-only", () => {
    const view = renderInPresentationMode(<TourPage />);
    const element = registryOf(view)
      .getAllElements()
      .find((e) => e.id === "coord-tour-start");
    expect(element?.element).toBe(screen.getByTestId("coord-tour-start-link"));
    expect(Object.values(element?.customActions ?? {})).toEqual([
      expect.objectContaining({ id: "open", effect: "read" }),
    ]);
    const action = Object.values(element?.customActions ?? {})[0] as {
      description?: string;
    };
    expect(action.description).toBe(TOUR_LINK_ACTION_DESCRIPTION);
  });
});
