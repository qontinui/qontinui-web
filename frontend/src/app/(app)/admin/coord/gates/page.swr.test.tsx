/**
 * Component test for /admin/coord/gates — stale-while-revalidate banner states.
 *
 * Plan 2026-06-29-coord-dashboard-deploy-resilience Phase 2. A coord rolling
 * deploy causes a transient coord-down; the backend then serves last-known-good
 * data flagged `coord_reconnecting`. This page must render a SUBTLE reconnecting
 * hint over the live data (never the hard "unavailable" banner), and reserve the
 * hard banner for a true cold-start outage (empty envelope, no reconnecting).
 *
 * The three states under test:
 *   1. healthy        → neither banner
 *   2. reconnecting   → `gates-coord-reconnecting` only (data still shown)
 *   3. cold-start down → `gates-coord-unavailable` only
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const getOverview = vi.fn();

vi.mock("@/services/admin-dev-service", () => ({
  adminDevService: {
    getOverview: (...args: unknown[]) => getOverview(...args),
  },
}));

// Heavyweight child components are out of scope — the banner wiring under test
// lives in the page itself. Stub them so the render is isolated and fast.
vi.mock("./_components/SummaryCards", () => ({ SummaryCards: () => null }));
vi.mock("./_components/GatesTable", () => ({ GatesTable: () => null }));
vi.mock("./_components/RolloutPanel", () => ({ RolloutPanel: () => null }));
vi.mock("./_components/ShadowReap", () => ({ ShadowReapGroups: () => null }));

import CoordGatesPage from "./page";

const EMPTY_COUNTS = {
  total: 0,
  open: 0,
  cleared: 0,
  cleared_today: 0,
  failed: 0,
  stale: 0,
  muted: 0,
  snoozed: 0,
  archived: 0,
  would_reap: 0,
};
const EMPTY_ROLLOUTS = {
  auto_merge: { live: [], shadow: [], dry_run: [] },
  features: [],
};

function healthy() {
  return {
    generated_at: "2026-06-29T12:00:00+00:00",
    gates: [],
    counts: EMPTY_COUNTS,
    rollouts: EMPTY_ROLLOUTS,
  };
}

describe("/admin/coord/gates stale-while-revalidate banners", () => {
  beforeEach(() => {
    getOverview.mockReset();
  });

  it("healthy fetch shows neither banner", async () => {
    getOverview.mockResolvedValue(healthy());
    render(<CoordGatesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("coord-gates-page")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("gates-coord-reconnecting")).toBeNull();
    expect(screen.queryByTestId("gates-coord-unavailable")).toBeNull();
  });

  it("reconnecting (last-known-good) shows the subtle hint, NOT the hard banner", async () => {
    getOverview.mockResolvedValue({
      ...healthy(),
      coord_error: "timeout waiting for coord",
      coord_reconnecting: true,
      stale_since: "2026-06-29T12:00:30+00:00",
      last_good_generated_at: "2026-06-29T12:00:00+00:00",
    });
    render(<CoordGatesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("gates-coord-reconnecting")).toBeInTheDocument(),
    );
    // The hard "unavailable" banner must be suppressed while reconnecting.
    expect(screen.queryByTestId("gates-coord-unavailable")).toBeNull();
    expect(screen.getByTestId("gates-coord-reconnecting").textContent).toMatch(
      /Reconnecting to coord/i,
    );
  });

  it("cold-start outage (no last-known-good) shows the hard unavailable banner", async () => {
    getOverview.mockResolvedValue({
      ...healthy(),
      coord_error: "timeout waiting for coord",
      // no coord_reconnecting → cold start
    });
    render(<CoordGatesPage />);
    await waitFor(() =>
      expect(screen.getByTestId("gates-coord-unavailable")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("gates-coord-reconnecting")).toBeNull();
  });
});
