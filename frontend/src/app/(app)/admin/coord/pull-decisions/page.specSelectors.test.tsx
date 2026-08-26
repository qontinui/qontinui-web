/**
 * Every page-owned selector in the COMMITTED Spec-CI spec for
 * `/pull-decisions`, run against the migrated markup.
 *
 * Modelled on `trees/page.specSelectors.test.tsx` (Wave 1). Same reasoning,
 * same shape: it READS `specs/pages/coord-pull-decisions/state-machine.derived.json`
 * at test time and asserts every page-owned `target.criteria` resolves against
 * the real rendered page, using the spec's own `metadata.routeStubs` row as
 * the data. It cannot drift from the spec, because it holds no copy of it.
 *
 * This spec has **no transitions**, so every criterion is evaluated with
 * NOTHING expanded. That is the constraint that decided which chips stay on
 * the collapsed `<PullDecisionRow>`: `coord-pull-decision-verdict`,
 * `-autonomy`, `-timing` and `-no-outcome` are all asserted in a static state,
 * so all four had to survive on the row rather than move into the detail. This
 * file is what proves they did.
 *
 * ## What it deliberately does NOT cover
 *
 * The `coord-pull-decisions-shell` assertions (`role=heading` "Coord operator
 * console", `coord-nav`, `coord-nav-pull-decisions-active`) belong to
 * `admin/coord/layout.tsx` and `CoordNav`, which this wave does not touch and
 * which are not mounted by rendering the page in isolation. They are filtered
 * out by name rather than silently missed.
 *
 * ## What it does not replace
 *
 * A jsdom render is not a browser and is not the Spec-CI executor. The
 * authoritative check is still a live authed run; see this PR's report for why
 * one could not be captured in this session.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

const get = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn() }),
}));

interface SpecCriteria {
  id?: string;
  role?: string;
  text?: string;
}
interface SpecAssertion {
  id: string;
  target?: { criteria?: SpecCriteria };
}
interface SpecState {
  id: string;
  assertions: SpecAssertion[];
}
interface DerivedSpec {
  id: string;
  states: SpecState[];
  metadata?: {
    routeStubs?: {
      urlPattern: string;
      body: { resolutions?: unknown[] };
    }[];
  };
}

const SPEC: DerivedSpec = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../specs/pages/coord-pull-decisions/state-machine.derived.json"
    ),
    "utf-8"
  )
);

/** The canned rows the spec itself stubs the feed endpoint with. */
const STUB_ROWS = SPEC.metadata?.routeStubs?.[0]?.body?.resolutions ?? [];

/** States this page owns. `coord-pull-decisions-shell` is the layout's. */
const PAGE_OWNED_STATES = SPEC.states.filter(
  (s) => s.id !== "coord-pull-decisions-shell"
);

import CoordPullDecisionsPage from "./page";

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async () => ({ resolutions: STUB_ROWS }));
});

describe("coord-pull-decisions Spec-CI selectors survive the Wave 2 migration", () => {
  it("covers the states the page owns, and says which it does not", () => {
    // Guards the filter above against a spec that grows a state.
    expect(SPEC.states.map((s) => s.id)).toEqual([
      "coord-pull-decisions-shell",
      "coord-pull-decisions-filters",
      "coord-pull-decisions-feed",
    ]);
    expect(PAGE_OWNED_STATES).toHaveLength(2);
  });

  it("resolves every page-owned `id` criterion against the rendered page", async () => {
    render(<CoordPullDecisionsPage />);

    await waitFor(() => {
      expect(
        screen.getAllByTestId("coord-pull-decision-card").length
      ).toBeGreaterThan(0);
    });

    const missing: string[] = [];
    const checked: string[] = [];
    for (const state of PAGE_OWNED_STATES) {
      for (const a of state.assertions) {
        const id = a.target?.criteria?.id;
        if (!id) continue;
        checked.push(`${a.id} → #${id}`);
        if (screen.queryAllByTestId(id).length === 0) {
          missing.push(`${a.id} → ${id}`);
        }
      }
    }

    // Every page-owned assertion in this spec is an `id` criterion; if that
    // ever stops being true this count catches it rather than the loop
    // silently skipping the new shape.
    expect(checked).toHaveLength(
      PAGE_OWNED_STATES.reduce((n, s) => n + s.assertions.length, 0)
    );
    expect(missing).toEqual([]);
  });

  it("renders both canned rows with the verdicts the stub engineered", async () => {
    render(<CoordPullDecisionsPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("coord-pull-decision-card")).toHaveLength(
        STUB_ROWS.length
      );
    });

    // Row 1 → `pull` with a recorded outcome; row 2 → `diverged` with none.
    // The diverged row is the one that must carry the red accent AND the
    // `no-outcome` marker the spec asserts, both on the COLLAPSED row.
    const badges = screen.getAllByTestId("coord-pull-decision-verdict");
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent("Pull");
    expect(badges[1]).toHaveTextContent("Diverged");
    expect(screen.getAllByTestId("coord-pull-decision-outcome")).toHaveLength(1);
    expect(
      screen.getAllByTestId("coord-pull-decision-no-outcome")
    ).toHaveLength(1);
    // R4 — the diverged row, and only it, earns the left-edge accent.
    const rows = screen.getAllByTestId("coord-pull-decision-card");
    expect(rows[0].querySelector(".border-l-red-500\\/80")).toBeNull();
    expect(
      rows[1].querySelector(".border-l-red-500\\/80")
    ).not.toBeNull();
  });
});
