/**
 * Every page-owned selector in the COMMITTED Spec-CI spec for `/lands`, run
 * against the migrated markup.
 *
 * Modelled on `trees/page.specSelectors.test.tsx` (Wave 1). It READS
 * `specs/pages/coord-lands/state-machine.derived.json` at test time and
 * asserts every page-owned `target.criteria` resolves against the real
 * rendered page, using the spec's own `metadata.routeStubs` bodies as the
 * data — so it cannot drift from the spec, because it holds no copy of it.
 *
 * ## Why this one mattered most
 *
 * `coord-lands` is the richest committed coord spec (18 assertions) and it
 * declares **no transitions**, so every criterion is evaluated with nothing
 * expanded and nothing collapsed. Three separate migration decisions were
 * forced by that and are checked here rather than argued:
 *
 * 1. `coord-land-crossrepo-badge`, `-outcome-badge`, `-settled-badge` and
 *    `-verdicts` had to stay on the COLLAPSED `<LandRow>`;
 * 2. both `<CollapsiblePanel>`s on the page default to OPEN, because the
 *    panel unmounts its children and the preview form and the precision table
 *    are both asserted on load;
 * 3. `coord-land-precision-table` had to keep its `<table>` element — the spec
 *    also asserts three of its header CELLS by the derivation's own
 *    `cell-r0-cN-<table-testid>` ids, which are generated from the table's
 *    structure by the UI-Bridge instrumentation rather than authored in
 *    `src/`. Those three are the ONE place §0.3's "every criterion is an
 *    authored testid" reading is not literally true, and they are reported
 *    separately below rather than quietly skipped.
 *
 * ## What it deliberately does NOT cover
 *
 * - `coord-lands-chrome`'s first two assertions (`heading-1-coord-operator-console`,
 *   `coord-nav-lands-active`) belong to `admin/coord/layout.tsx` and
 *   `CoordNav`, not mounted by rendering the page in isolation.
 * - the three `cell-r0-cN-…` criteria, which are instrumentation-generated
 *   rather than authored; jsdom has no UI-Bridge instrumentation, so this file
 *   asserts the invariant they DEPEND on (the table renders, with ≥3 header
 *   cells in row 0) instead of pretending to resolve the generated ids.
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

vi.mock("@/components/operations/useTenantDefaultRepo", () => ({
  useTenantDefaultRepo: () => ({ defaultRepo: null, loading: false }),
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
    routeStubs?: { urlPattern: string; body: Record<string, unknown> }[];
  };
}

const SPEC: DerivedSpec = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../specs/pages/coord-lands/state-machine.derived.json"
    ),
    "utf-8"
  )
);

function stubBody(suffix: string): Record<string, unknown> {
  const hit = SPEC.metadata?.routeStubs?.find((s) =>
    s.urlPattern.includes(`/operations/lands${suffix}`)
  );
  if (!hit) throw new Error(`spec has no route stub for /lands${suffix}`);
  return hit.body;
}

/** The canned bodies the spec itself stubs each endpoint with. */
const STUB_LANDS = stubBody("**");
const STUB_PRECISION = stubBody("/precision");

/**
 * Criteria that are NOT authored `data-testid`s. Two shell ids owned by the
 * layout, and the three instrumentation-generated table-cell ids. Listed by
 * exact string so a spec re-derivation that changes them fails loudly here.
 */
const NOT_PAGE_OWNED = new Set([
  "heading-1-coord-operator-console",
  "coord-nav-lands-active",
  "cell-r0-c0-coord-land-precision-table",
  "cell-r0-c1-coord-land-precision-table",
  "cell-r0-c2-coord-land-precision-table",
]);

import CoordLandsPage from "./page";

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    // Order matters exactly as it does in the spec's own stub precedence: the
    // specific sub-paths are matched BEFORE the broad lands-list pattern.
    if (url.includes("/lands/precision")) return STUB_PRECISION;
    if (url.includes("/lands/preview")) return stubBody("/preview");
    if (url.includes("/lands/verifications")) return stubBody("/verifications");
    if (url.includes("/lands")) return STUB_LANDS;
    return {};
  });
});

describe("coord-lands Spec-CI selectors survive the Wave 2 migration", () => {
  it("covers the states the page owns, and says which criteria it does not", () => {
    // Guards the filters above against a spec that grows a state or renames a
    // generated id: if either moves and nobody extends this file, this fails.
    expect(SPEC.states.map((s) => s.id)).toEqual([
      "coord-lands-chrome",
      "coord-lands-preview-form",
      "coord-lands-recent-populated",
      "coord-lands-precision-table",
    ]);
    const all = SPEC.states.flatMap((s) =>
      s.assertions.map((a) => a.target?.criteria?.id)
    );
    expect(all).toHaveLength(18);
    expect(all.filter((id) => id && NOT_PAGE_OWNED.has(id))).toHaveLength(5);
  });

  it("resolves every page-owned `id` criterion against the rendered page", async () => {
    render(<CoordLandsPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("coord-land-card").length).toBeGreaterThan(0);
    });

    const missing: string[] = [];
    const checked: string[] = [];
    for (const state of SPEC.states) {
      for (const a of state.assertions) {
        const id = a.target?.criteria?.id;
        if (!id || NOT_PAGE_OWNED.has(id)) continue;
        checked.push(`${a.id} → #${id}`);
        if (screen.queryAllByTestId(id).length === 0) {
          missing.push(`${a.id} → ${id}`);
        }
      }
    }

    // 18 criteria minus the 5 the page does not own.
    expect(checked).toHaveLength(13);
    expect(missing).toEqual([]);
  });

  it("keeps the collapsed row carrying the four static-state badges", async () => {
    render(<CoordLandsPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId("coord-land-card")).toHaveLength(1);
    });
    // Nothing has been clicked. These four are asserted by the spec in a state
    // with no transitions, so they must be here WITHOUT an expansion.
    const row = screen.getByTestId("coord-land-card");
    expect(row.querySelector("[data-testid='coord-land-crossrepo-badge']")).not.toBeNull();
    expect(row.querySelector("[data-testid='coord-land-outcome-badge']")).not.toBeNull();
    expect(row.querySelector("[data-testid='coord-land-settled-badge']")).not.toBeNull();
    expect(row.querySelector("[data-testid='coord-land-verdicts']")).not.toBeNull();
    // ...and the detail is genuinely absent until it is asked for (R5).
    expect(
      screen.queryByTestId("coord-land-crossrepo-panel")
    ).not.toBeInTheDocument();
  });

  it("renders the precision TABLE with the header cells the generated ids index", async () => {
    render(<CoordLandsPage />);
    const table = await screen.findByTestId("coord-land-precision-table");
    // `cell-r0-c0/c1/c2-coord-land-precision-table` are derived by the
    // UI-Bridge instrumentation from this table's row 0. jsdom has no such
    // instrumentation, so the honest check is the STRUCTURE those three ids
    // index: a real <table> whose first row has at least three header cells,
    // rendered without any interaction.
    expect(table.tagName.toLowerCase()).toBe("table");
    const headerCells = table.querySelectorAll("thead tr:first-child th");
    expect(headerCells.length).toBeGreaterThanOrEqual(3);
    expect(headerCells[0]).toHaveTextContent("Dimension");
    expect(headerCells[1]).toHaveTextContent("Precision");
    expect(headerCells[2]).toHaveTextContent("Recall");
  });
});
