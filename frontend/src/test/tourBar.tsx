/**
 * tourBar — shared fixtures for the tour bar's tests: the
 * readiness registry the tests state, and a render of the bar in a given mode
 * over a given tab state.
 *
 * Each test file mocks `next/navigation` to read `window.location`, and the
 * readiness registry to read the routes the test states, BEFORE importing
 * this module (vitest hoists `vi.mock`), so the bar here runs on both.
 */

import { render } from "@testing-library/react";
import {
  FixedPresentationMode,
  TOUR_SURFACE,
  TourBar,
  createTourStore,
  type PresentationReadyRoute,
  type TourStore,
} from "@/components/presentation";

export const ready = (...routes: string[]): PresentationReadyRoute[] =>
  routes.map((route) => ({ route, provenBy: "x.test.tsx" }));

/** Today's shape: the twin, the UI Bridge and Dev Ops presentable; the overview and agentic activity not. */
export const TODAY = ready(
  "/digital-twin",
  "/admin/coord/ui-bridge",
  "/admin/coord/devops",
  TOUR_SURFACE.route
);

/** Go to `url` in this window, as a navigation would. */
export function visit(url: string): void {
  window.history.replaceState(null, "", url);
}

/** The bar in a fixed mode over `store` (a fresh tab's, by default). */
export function renderBar(
  presenting: boolean,
  store: TourStore = createTourStore()
) {
  const view = render(
    <FixedPresentationMode presenting={presenting}>
      <TourBar store={store} />
    </FixedPresentationMode>
  );
  return { ...view, store };
}

/** A tab that is on the tour, already. */
export function onTourStore(): TourStore {
  const store = createTourStore();
  store.startTour();
  return store;
}
