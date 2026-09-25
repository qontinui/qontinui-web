/**
 * /admin/coord/pipeline — what the page is, and what it no longer does.
 *
 * Plan `2026-08-25-coord-console-intent-and-devops-sections` Phase 4,
 * Verification 8 in particular. Two properties are asserted here and nowhere
 * else:
 *
 *  1. **The page makes ZERO requests to `/operations/fleet/health` and
 *     `/operations/fleet/resource-samples`.** Those two polls ran on the old
 *     `/admin/coord/fleet` unconditionally — 10 s and 30 s, whether or not the
 *     `System details` drawer was open — because the alarm counts had to keep
 *     ticking on the collapsed header. The drawer is deleted, the alarm moved
 *     to the `Dev Ops ▾` nav trigger, and the polls went with it. A future
 *     "just show the machine count here too" would silently reinstate both;
 *     this test is what stops that.
 *  2. **`CiStatusPanel` is NOT on the page** — reversed from Phase 4 by the
 *     2026-09-19 redesign, deliberately and with a reason, so the assertion is
 *     inverted rather than deleted. Phase 4 put it here on the reasoning that
 *     "CI results are why PRs are stuck". That reasoning is right; the
 *     placement was wrong three ways (`CiRepoStrip`'s module header has all
 *     three), and the decisive one is mechanical rather than aesthetic: it
 *     owned its stream ABOVE its own `<CollapsiblePanel>`, so every visitor to
 *     this route paid a REST seed, a WebSocket and a polling fallback whether
 *     or not they opened it. It now lives on the Train tab and owns its
 *     transport there.
 *
 * The heavy children are stubbed: each has its own tests, and what is under
 * test here is the page's composition and its request footprint.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const httpGet = vi.fn();
const httpFetch = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    fetch: (...args: unknown[]) => httpFetch(...args),
  },
}));

// Every operations export the page imports. The panels fetch on mount and
// have their own tests; the request-footprint assertion below would otherwise
// be measuring THEIR reads rather than the page's.
// `CiRepoStrip` is exported from this barrel and stubbed here on purpose even
// though the page no longer imports it: the mock is what would let a
// re-import render, so the "it is not on this page" assertions below measure
// the page rather than the absence of a stub.
vi.mock("@/components/operations", () => ({
  CiRepoStrip: () => <div data-testid="stub-ci-repo-strip" />,
  MergePipeline: () => <div data-testid="stub-merge-pipeline" />,
  StuckPrRecoveryPanel: () => <div data-testid="stub-stuck-pr-recovery" />,
}));

import CoordPipelinePage from "./page";

const PAGE_SRC = readFileSync(join(__dirname, "page.tsx"), "utf8");
/**
 * The page's CODE, with its leading docblock stripped. That docblock names
 * every relocated panel on purpose — it is the record of where each one went —
 * so a source assertion that swept the whole file would fail on the
 * documentation instead of on an import.
 */
const PAGE_CODE = PAGE_SRC.slice(PAGE_SRC.indexOf("*/") + 2);

describe("/admin/coord/pipeline structure", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpFetch.mockReset();
    httpGet.mockResolvedValue({});
    window.localStorage.clear();
  });

  it("is the recovery panel and the hero — and nothing else", () => {
    render(<CoordPipelinePage />);

    const page = screen.getByTestId("coord-pipeline-page");
    const order = Array.from(page.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid")
    );
    // Exact, not a subset: the failure mode this page keeps having is a new
    // section appended because it was locally reasonable, until the page
    // answers one question five times. A third entry here is a decision that
    // should have to argue for itself in a diff.
    expect(order).toEqual(["stub-stuck-pr-recovery", "stub-merge-pipeline"]);
  });

  it("does not mount per-repo CI status — the Train tab owns it now", () => {
    render(<CoordPipelinePage />);

    // Runtime: the stub would render if the page still composed it.
    expect(screen.queryByTestId("stub-ci-repo-strip")).not.toBeInTheDocument();
    // Source: the stronger of the two, and the one that catches a re-import
    // that renders nothing under test. Both spellings, because the reason to
    // keep it off this page survives a rename.
    expect(PAGE_CODE).not.toMatch(/\bCiStatusPanel\b/);
    expect(PAGE_CODE).not.toMatch(/\bCiRepoStrip\b/);
    // And it must not come back by its transport either: the R7 violation
    // being fixed was the STREAM running for every visitor here, so a page
    // that reached for the hook directly would reinstate the cost without
    // reinstating the component.
    expect(PAGE_SRC).not.toContain("useCiStatusStream");
  });

  it("mounts no System details drawer", () => {
    render(<CoordPipelinePage />);

    expect(
      screen.queryByTestId("coord-system-details")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("System details")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Verification 8 — the two deleted polls.
  // ---------------------------------------------------------------------------

  it("makes zero requests to fleet/health and fleet/resource-samples", async () => {
    render(<CoordPipelinePage />);

    // Give any mount effect a chance to fire before asserting an absence:
    // asserting "no request" on a synchronous tick would pass vacuously.
    await waitFor(() =>
      expect(screen.getByTestId("coord-pipeline-page")).toBeInTheDocument()
    );
    await Promise.resolve();

    const urls = [...httpGet.mock.calls, ...httpFetch.mock.calls].map((c) =>
      String(c[0])
    );
    expect(urls.filter((u) => u.includes("fleet/health"))).toEqual([]);
    expect(urls.filter((u) => u.includes("fleet/resource-samples"))).toEqual(
      []
    );
    // Stronger than the runtime check, and the one that survives a future
    // refactor into a child component: the page's source names neither hook.
    expect(PAGE_SRC).not.toContain("useFleetHealth");
    expect(PAGE_SRC).not.toContain("useFleetResourceSamples");
    expect(PAGE_SRC).not.toContain("summarizeFleetAdmission");
  });

  it("keeps every relocated panel off this page", () => {
    // The delete list, asserted at the source so a re-import is caught even
    // when the component would render nothing in a test.
    for (const gone of [
      "FleetOverview",
      "FleetResourcesSection",
      "FleetTestTargetsPanel",
      "MigrationQueueTile",
      "DevActionsTile",
      "GatesPanel",
      "LandedFeaturesPanel",
      "HealthSummaryCard",
    ]) {
      expect(PAGE_CODE).not.toMatch(new RegExp(`\\b${gone}\\b`));
    }
  });

  it("no longer carries the #merge-dep-graph anchor", () => {
    render(<CoordPipelinePage />);
    expect(document.getElementById("merge-dep-graph")).toBeNull();
    expect(PAGE_SRC).not.toContain("merge-dep-graph");
  });
});
