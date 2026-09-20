/**
 * The `shepherd-*` population: excluded on `/spawn`, a CONTROL on
 * `/admin/coord/work-units` — and that control DEFAULTS TO INCLUDED.
 *
 * This file used to pin one rule for both pages: never surface coord's own
 * merge-escalation work units. Phase 3 of plan
 * `2026-09-20-the-operator-plans-page-reads-the-wrong-store` split it, because
 * the two pages no longer ask the same question:
 *
 *   - `/admin/coord/spawn` still lists PLANS to spawn agents on, so a shepherd
 *     unit is still noise there and the exclusion stays hard-coded at the wire.
 *   - `/admin/coord/work-units` lists coord's WORK UNITS, and the escalations
 *     are the population it exists to triage. Carrying the exclusion across the
 *     move would have left those ~1,264 rows with no consumer on either page —
 *     the `capability-ships-enabled` failure the plan opens by naming.
 *
 * Pinned at the wire in both directions, because "defaults to included" is a
 * claim about the FIRST fetch, not about what some later filter change sends.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/work-units",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordWorkUnitsListPage from "./page";
import CoordSpawnPage from "../spawn/page";

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ work_units: [] });
});

/** Every URL this test's mocked client was asked for, in call order. */
function urls(): string[] {
  return get.mock.calls.map((call) => String(call[0]));
}

/** The work-unit list reads only — the difficulty read shares the mock. */
function workUnitUrls(): string[] {
  return urls().filter((u) => u.includes("/operations/plans"));
}

describe("/admin/coord/spawn excludes shepherd rows", () => {
  it("asks coord to exclude shepherd-* on the first fetch", async () => {
    render(<CoordSpawnPage />);

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("exclude_slug_prefix=shepherd-")
    );
  });
});

describe("/admin/coord/work-units includes shepherd rows by default", () => {
  it("sends NO exclude_slug_prefix on the first fetch", async () => {
    render(<CoordWorkUnitsListPage />);

    await waitFor(() => expect(workUnitUrls().length).toBeGreaterThan(0));
    // Every work-unit read, not just the first: a default that only holds
    // until the first poll is not a default.
    for (const url of workUnitUrls()) {
      expect(url).not.toContain("exclude_slug_prefix");
    }
  });

  it("offers the exclusion as a control, and asks coord for it when chosen", async () => {
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);

    await waitFor(() => expect(workUnitUrls().length).toBeGreaterThan(0));

    await user.click(screen.getByTestId("coord-work-units-shepherd-select"));
    await user.click(
      await screen.findByRole("option", { name: "Excl. merge escalations" })
    );

    await waitFor(() =>
      expect(
        workUnitUrls().some((u) => u.includes("exclude_slug_prefix=shepherd-"))
      ).toBe(true)
    );
  });
});
