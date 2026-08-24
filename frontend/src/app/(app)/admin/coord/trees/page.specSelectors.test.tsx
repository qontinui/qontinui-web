/**
 * Every page-owned selector in the COMMITTED Spec-CI spec for `/trees`, run
 * against the migrated markup.
 *
 * ## Why this file exists
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` §0.3 / D4(b)
 * predicted that `specs/pages/coord-trees/state-machine.derived.json` would go
 * red "by construction" when the three-line `TreeCard` collapsed into one
 * `<TreeRow>`, because its 13 assertions "run against derivation-generated
 * positional ids".
 *
 * **Read against the file, that premise does not hold for THIS spec.** The
 * `coord-trees-populated-elem-0…4` strings are the assertion objects' OWN `id`
 * fields — labels inside the JSON, used to report which assertion failed. They
 * are not queried against the DOM. What IS queried is each assertion's
 * `target.criteria`, and every one of the 13 is either
 * `{ id: "<authored data-testid>" }` or `{ role: "heading", text: … }`. Neither
 * depends on child count or child order, so a spec whose authored testids all
 * survive the migration stays green — which is exactly the case D4(a) already
 * required us to produce.
 *
 * That is an argument, and an argument is not evidence. This file is the
 * evidence: it READS the committed spec at test time and asserts every
 * page-owned criterion resolves against the real rendered page, with the
 * spec's own `metadata.routeStubs` rows as the data. It cannot drift from the
 * spec, because it has no copy of it.
 *
 * ## What it deliberately does NOT cover
 *
 * The four `coord-trees-shell` assertions (`h1` "Coord operator console",
 * `coord-nav`, `coord-nav-trees-active`, `coord-nav-group-merge`) belong to
 * `admin/coord/layout.tsx` and `CoordNav`, which this wave does not touch and
 * which are not mounted by rendering the page in isolation. They are filtered
 * out below by name rather than silently missed.
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
  useSearchParams: () => new URLSearchParams("device_id=" + DEVICE_ID),
  useRouter: () => ({ push: vi.fn() }),
}));

const DEVICE_ID = "c1c1c1c1-0000-4000-8000-000000000001";

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
    routeStubs?: { urlPattern: string; body: { trees?: unknown[] } }[];
  };
}

const SPEC: DerivedSpec = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../specs/pages/coord-trees/state-machine.derived.json"
    ),
    "utf-8"
  )
);

/** The canned rows the spec itself stubs the by-device endpoint with. */
const STUB_TREES = SPEC.metadata?.routeStubs?.[0]?.body?.trees ?? [];

/** States this page owns. `coord-trees-shell` is the layout's, not ours. */
const PAGE_OWNED_STATES = SPEC.states.filter(
  (s) => s.id !== "coord-trees-shell"
);

import CoordTreesPage from "./page";

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.includes("/trees/by-device/")) {
      return { device_id: DEVICE_ID, trees: STUB_TREES };
    }
    if (url.includes("/trees/contention")) return { overlaps: [] };
    return {};
  });
});

describe("coord-trees Spec-CI selectors survive the Wave 1 migration", () => {
  it("covers the states the page owns, and says which it does not", () => {
    // Guards the filter above against a spec that grows a state: if a new
    // page-owned state lands and nobody extends this file, the count moves.
    expect(SPEC.states.map((s) => s.id)).toEqual([
      "coord-trees-shell",
      "coord-trees-by-device-controls",
      "coord-trees-populated",
    ]);
    expect(PAGE_OWNED_STATES).toHaveLength(2);
  });

  it("resolves every page-owned `id` criterion against the rendered page", async () => {
    render(<CoordTreesPage />);

    // The tree rows arrive from the stubbed by-device fetch.
    await waitFor(() => {
      expect(screen.getAllByTestId("coord-tree-card").length).toBeGreaterThan(0);
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

    // Every page-owned assertion in the spec is an `id` criterion; if that
    // ever stops being true this count catches it rather than the loop
    // silently skipping the new shape.
    expect(checked).toHaveLength(
      PAGE_OWNED_STATES.reduce((n, s) => n + s.assertions.length, 0)
    );
    expect(missing).toEqual([]);
  });

  it("renders the three canned rows the stub engineered, with their badges", async () => {
    render(<CoordTreesPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("coord-tree-card")).toHaveLength(
        STUB_TREES.length
      );
    });
    // Row 1 → `pull`, row 2 → `diverged` + ahead, row 3 → `up_to_date` + dirty.
    // These are the three verdicts the stub was built to exercise through the
    // real ladder; the spec asserts two of them by id.
    expect(screen.getByTestId("coord-tree-verdict-pull")).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-tree-verdict-diverged")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-tree-verdict-up_to_date")
    ).toBeInTheDocument();
    expect(screen.getByTestId("coord-tree-ahead-badge")).toBeInTheDocument();
    expect(screen.getByTestId("coord-tree-dirty-badge")).toBeInTheDocument();
  });
});
