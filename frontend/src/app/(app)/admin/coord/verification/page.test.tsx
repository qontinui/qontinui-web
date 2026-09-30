/**
 * /admin/coord/verification — the drill-down renders the WHOLE metrics
 * object (12-week series with throughput and per-week n, unknowns by reason,
 * pre-land review beside coverage, sampling, lane), and a degraded answer
 * renders "could not look" with no number from it.
 */

import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/service-factory", () => ({ httpClient: http }));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ activeTenantId: "t-1", loading: false, error: null }),
}));

import {
  NOW,
  REFUTATION_FINDING,
  degraded,
  populated,
} from "@/components/admin/coord/verificationMetrics.fixture";
import CoordVerificationPage from "./page";

function serve(metrics: unknown) {
  http.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes("/verification/metrics")
        ? metrics
        : { available: true, findings: [REFUTATION_FINDING] }
    )
  );
}

describe("CoordVerificationPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    http.get.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("renders every block of a populated answer", async () => {
    serve(populated());
    render(<CoordVerificationPage />);
    const series = await screen.findByTestId("coord-verification-series");
    expect(
      within(series).getAllByTestId("coord-verification-series-week")
    ).toHaveLength(12);
    expect(http.get.mock.calls[0][0]).toContain("window=28d");

    expect(
      screen
        .getByTestId("coord-verification-health")
        .getAttribute("data-health-level")
    ).toBe("green");
    expect(
      screen.getByTestId("coord-verification-unknowns").textContent
    ).toContain("no_stated_criteria: 9 · surface_unreachable: 3");
    // Pre-land review is its own block, beside coverage — never inside it.
    const coverage = screen.getByTestId("coord-verification-coverage");
    expect(coverage.textContent).toContain("38% — 20 of 52 landed units");
    expect(coverage.textContent).not.toContain("reviewed-head");
    expect(
      screen.getByTestId("coord-verification-pre-land").textContent
    ).toContain("30 of 52");
    expect(
      screen.getByTestId("coord-verification-sampling").textContent
    ).toContain("surge: a refutation 2 day(s) old");
    expect(screen.getByTestId("coord-verification-lane").textContent).toContain(
      "pass"
    );
    expect(
      await screen.findByRole("link", { name: "Widgets export to CSV" })
    ).toBeTruthy();
  });

  it("renders could-not-look for a degraded answer, and no numbers from it", async () => {
    serve(degraded());
    render(<CoordVerificationPage />);
    const msg = await screen.findByTestId("coord-verification-could-not-look");
    expect(msg.textContent).toContain("work_unit_verifications is absent");
    expect(msg.textContent).toContain("These are not zeros.");
    expect(screen.queryByTestId("coord-verification-stats")).toBeNull();
    expect(screen.queryByTestId("coord-verification-series")).toBeNull();
    expect(
      screen
        .getByTestId("coord-verification-health")
        .getAttribute("data-health-level")
    ).toBe("amber");
  });
});
