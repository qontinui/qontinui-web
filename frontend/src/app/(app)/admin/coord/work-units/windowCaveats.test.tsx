/**
 * `/admin/coord/work-units` — the truncation notice is a MEASUREMENT, not a
 * disclaimer.
 *
 * Phase 3 of plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store`.
 * The notice this replaced said *"Showing the 500 most-recently-updated work
 * units — coord caps this list"*, which is true and still does not tell a
 * reader they are looking at 43 hours of a 3,268-row store. Two things were
 * missing and both are pinned here:
 *
 *   - a **denominator** — 500 of *what*? — which is rendered when the upstream
 *     envelope carries a `total` and rendered as an explicit UNKNOWN when it
 *     does not. It is never substituted from `count`, the size of the PAGE,
 *     which would print "500 of 500" over a window that is nothing of the sort;
 *   - a **boundary value** — how old the oldest row in the window is — so an
 *     operator can tell "not here" from "out of window".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

vi.mock("./usePlanDifficulty", () => ({
  usePlanDifficulty: () => ({
    index: { state: "pending" },
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordWorkUnitsListPage from "./page";

/** The page's own `FETCH_LIMIT`. A shorter window is not truncated at all. */
const FETCH_LIMIT = 500;

/** `FETCH_LIMIT` rows, newest first, one hour apart — coord's own ordering. */
function fullWindow(extra: Record<string, unknown> = {}) {
  const start = Date.parse("2026-09-17T18:48:00Z");
  return {
    work_units: Array.from({ length: FETCH_LIMIT }, (_, i) => ({
      slug: `2026-09-1${i % 9}-unit-${i}`,
      status: "vetted",
      updated_at: new Date(start - i * 3_600_000).toISOString(),
    })),
    ...extra,
  };
}

async function openCaveats() {
  // R7 — the panel is collapsed by default and unmounts its children, so the
  // notice has to be opened before it can be read.
  // "Fetch window", not "Fetch-window caveats": since the corpus walk the
  // panel also carries the COMPLETE verdict, which is not a caveat.
  const trigger = await screen.findByText("Fetch window");
  trigger.click();
}

beforeEach(() => {
  get.mockReset();
  // `<CollapsiblePanel storageKey=…>` persists its open/closed state, and
  // jsdom's localStorage is shared across the file — so without this, one
  // test's open leaks into the next one's toggle and CLOSES the panel.
  window.localStorage.clear();
});

describe("/admin/coord/work-units fetch-window caveats", () => {
  it("states the denominator when coord serves a total", async () => {
    get.mockResolvedValue(fullWindow({ total: 3268 }));
    render(<CoordWorkUnitsListPage />);
    await openCaveats();

    const notice = await screen.findByTestId(
      "coord-work-units-truncated-notice"
    );
    // "were READ", not "Showing": the count is the read, taken before any
    // client-side filter narrows what is rendered (the corpus walk's
    // "read, never shown" rule).
    expect(notice).toHaveTextContent(
      "500 most-recently-updated work units were READ, of 3268 matching this question"
    );
    expect(notice).not.toHaveTextContent("Showing");
  });

  it("says the denominator is UNKNOWN rather than inventing one", async () => {
    // The shipped envelope: `{work_units, limit, offset}` plus `count`, the
    // size of the PAGE. `count` must not be promoted into the denominator.
    get.mockResolvedValue(fullWindow({ count: FETCH_LIMIT }));
    render(<CoordWorkUnitsListPage />);
    await openCaveats();

    const notice = await screen.findByTestId(
      "coord-work-units-truncated-notice"
    );
    expect(notice).toHaveTextContent("unknown");
    expect(notice).not.toHaveTextContent("of 500");
  });

  it("names the boundary — the oldest row in the window", async () => {
    get.mockResolvedValue(fullWindow({ total: 3268 }));
    render(<CoordWorkUnitsListPage />);
    await openCaveats();

    const boundary = await screen.findByTestId(
      "coord-work-units-window-boundary"
    );
    // 500 rows an hour apart back from 2026-09-17T18:48Z.
    expect(boundary.textContent).toMatch(/2026/);
    expect(boundary.textContent).not.toMatch(/unknown/i);
  });

  it("says the boundary is unknown when no row carries a readable timestamp", async () => {
    get.mockResolvedValue({
      work_units: Array.from({ length: FETCH_LIMIT }, (_, i) => ({
        slug: `2026-09-10-unit-${i}`,
        status: "vetted",
      })),
      total: 3268,
    });
    render(<CoordWorkUnitsListPage />);
    await openCaveats();

    expect(
      await screen.findByTestId("coord-work-units-window-boundary")
    ).toHaveTextContent("how far back it reaches is unknown");
  });

  it("renders no truncation notice for a window coord did not fill", async () => {
    get.mockResolvedValue({
      work_units: [
        {
          slug: "2026-09-10-a",
          status: "vetted",
          updated_at: "2026-09-10T00:00:00Z",
        },
      ],
      total: 1,
    });
    render(<CoordWorkUnitsListPage />);

    await screen.findAllByTestId("coord-plan-card");
    expect(
      screen.queryByTestId("coord-work-units-truncated-notice")
    ).toBeNull();
  });
});
