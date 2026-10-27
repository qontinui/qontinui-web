/**
 * The UI Bridge dashboard is presentation-ready (plan
 * `2026-10-23-console-presentation-spaces` D3: a lens page is WITHHELD in
 * presentation mode until its route is registered in
 * `PRESENTATION_READY_ROUTES` with the test that proves it).
 *
 * Registering the route is the one step whose omission is silent: the page
 * tests still pass, and presentation mode would show an evaluator "Shown in
 * the operator view only" where the dashboard should be. So this file runs
 * the real gate, at the dashboard's route, and fails when it withholds.
 *
 * What PROVES the page safe is `page.presentation.test.tsx` — the registry
 * names it, and the run, not this file, decides whether it does
 * (`src/test/readinessEvidence.ts`). This file proves nothing about the page's
 * content and renders a stand-in body on purpose: it checks the registration.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ path: "/admin/coord/ui-bridge" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.path,
  useSearchParams: () => new URLSearchParams(),
}));

import {
  FixedPresentationMode,
  PRESENTATION_READY_ROUTES,
  PresentationPage,
  WITHHELD_PAGE_TITLE,
  isPresentationReady,
} from "@/components/presentation";

const DASHBOARD_ROUTE = "/admin/coord/ui-bridge";

function renderGate(presenting: boolean) {
  return render(
    <FixedPresentationMode presenting={presenting}>
      <PresentationPage>
        <div data-testid="dashboard-body">the dashboard</div>
      </PresentationPage>
    </FixedPresentationMode>
  );
}

beforeEach(() => {
  route.path = DASHBOARD_ROUTE;
});

describe("the UI Bridge dashboard is registered as presentation-ready", () => {
  it("is in the readiness registry, proven by its own presentation test", () => {
    expect(isPresentationReady(DASHBOARD_ROUTE)).toBe(true);
    expect(
      PRESENTATION_READY_ROUTES.filter(
        (entry) => entry.route === DASHBOARD_ROUTE
      )
    ).toEqual([
      {
        route: DASHBOARD_ROUTE,
        provenBy: "app/(app)/admin/coord/ui-bridge/page.presentation.test.tsx",
      },
    ]);
  });

  it("is shown, not withheld, by the gate around a lens page while presenting", () => {
    renderGate(true);
    expect(screen.getByTestId("dashboard-body")).toBeInTheDocument();
    expect(screen.queryByText(WITHHELD_PAGE_TITLE)).not.toBeInTheDocument();
  });

  it("is still withheld at a sibling route nobody registered, so the gate under test is the real one", () => {
    route.path = `${DASHBOARD_ROUTE}/anything`;
    renderGate(true);
    expect(screen.queryByTestId("dashboard-body")).not.toBeInTheDocument();
    expect(screen.getByText(WITHHELD_PAGE_TITLE)).toBeInTheDocument();
  });
});
