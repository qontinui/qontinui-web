/**
 * `/admin/coord/plans` — the two body-signal filter strips.
 *
 * Plan `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`.
 * The predicates are unit-tested in
 * `components/admin/coord/planBodySignal.test.ts`; what is pinned here is the
 * WIRING, which is where the three things that would quietly break it live:
 *
 *   1. the strips render at all only once a backend has actually served the
 *      fields — offering a filter over a vocabulary no row carries lets an
 *      operator click a chip and empty the list, answering "none" to a
 *      question nobody was told the answer to;
 *   2. the counts describe the WINDOW, not the filtered result, or every count
 *      but the selected one collapses to 0 on the first click;
 *   3. an empty result under a CLIENT-side filter is a statement about the
 *      window, not about coord — "No plans matching status=any" over a window
 *      of three rows blames the wrong control.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();

// `<PlanRow>` opens the detail route from a `useRouter()`, which has no app
// router mounted under `render()`. The navigation is not what is under test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plans",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordPlansListPage from "./page";

const ANNOTATED = {
  work_units: [
    {
      slug: "2026-09-01-bodyless-and-unscanned",
      title: "Filed by a discovering session",
      status: "in_progress",
      body_provenance: "never_scanned",
      has_body: false,
      body_unknown_reason: null,
    },
    {
      slug: "2026-08-16-has-a-document",
      title: "Scanned and captured",
      status: "draft",
      body_provenance: "scanned",
      has_body: true,
      body_unknown_reason: null,
    },
    {
      slug: "2026-09-02-one-machine-only",
      title: "Only inside a worktree",
      status: "draft",
      body_provenance: "scanned_locally",
      has_body: "unknown",
      body_unknown_reason: "capture_off",
    },
  ],
  limit: 500,
  offset: 0,
  body_signal: {
    capture_level: "off",
    capture_resolved_scope: "tenant",
    capture_readable: true,
    artifact_surface_readable: true,
    org_plan_artifact_count: 12,
    miss_reason: "capture_off",
  },
};

/** The same window from a backend that predates the signals. */
const UNANNOTATED = {
  work_units: ANNOTATED.work_units.map(
    ({ body_provenance, has_body, body_unknown_reason, ...rest }) => {
      void body_provenance;
      void has_body;
      void body_unknown_reason;
      return rest;
    }
  ),
  limit: 500,
  offset: 0,
};

async function renderPage(payload: unknown) {
  get.mockResolvedValue(payload);
  render(<CoordPlansListPage />);
  await waitFor(() =>
    expect(screen.queryAllByTestId("coord-plan-card").length).toBeGreaterThan(0)
  );
}

function visibleSlugs(): string[] {
  return screen
    .queryAllByTestId("coord-plan-card")
    .map((el) => el.getAttribute("data-row-key") ?? "");
}

describe("/plans body-signal filters", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("renders both strips once the backend serves the fields", async () => {
    await renderPage(ANNOTATED);
    expect(screen.getByTestId("coord-plans-body-filters")).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-plans-has-body-filter")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-plans-provenance-filter")
    ).toBeInTheDocument();
  });

  it("renders NEITHER strip when no row carries a signal", async () => {
    await renderPage(UNANNOTATED);
    expect(screen.queryByTestId("coord-plans-body-filters")).toBeNull();
    // ...and the rows themselves still render, unfiltered.
    expect(visibleSlugs()).toHaveLength(3);
  });

  it("counts the WINDOW, and keeps counting it after a click", async () => {
    const user = userEvent.setup();
    await renderPage(ANNOTATED);

    const unknownChip = screen.getByTestId(
      "coord-plans-has-body-filter-unknown"
    );
    expect(unknownChip).toHaveTextContent("1");
    await user.click(unknownChip);

    // The other chips must still report the window's counts — a strip whose
    // unselected counts collapse to 0 on click cannot be used to navigate.
    await waitFor(() => expect(visibleSlugs()).toEqual(["2026-09-02-one-machine-only"]));
    expect(screen.getByTestId("coord-plans-has-body-filter-yes")).toHaveTextContent(
      "1"
    );
    expect(screen.getByTestId("coord-plans-has-body-filter-no")).toHaveTextContent(
      "1"
    );
  });

  it("filters on provenance, and clears back to the whole window", async () => {
    const user = userEvent.setup();
    await renderPage(ANNOTATED);

    await user.click(
      screen.getByTestId("coord-plans-provenance-filter-never_scanned")
    );
    await waitFor(() =>
      expect(visibleSlugs()).toEqual(["2026-09-01-bodyless-and-unscanned"])
    );

    await user.click(
      within(screen.getByTestId("coord-plans-provenance-filter")).getByTestId(
        "coord-plans-provenance-filter-all"
      )
    );
    await waitFor(() => expect(visibleSlugs()).toHaveLength(3));
  });

  it("ANDs the two strips", async () => {
    const user = userEvent.setup();
    await renderPage(ANNOTATED);

    await user.click(
      screen.getByTestId("coord-plans-provenance-filter-never_scanned")
    );
    await user.click(screen.getByTestId("coord-plans-has-body-filter-yes"));
    await waitFor(() => expect(visibleSlugs()).toHaveLength(0));
  });

  it("blames the FILTER, not coord, when the client-side filter empties the list", async () => {
    const user = userEvent.setup();
    await renderPage(ANNOTATED);

    await user.click(
      screen.getByTestId("coord-plans-provenance-filter-never_scanned")
    );
    await user.click(screen.getByTestId("coord-plans-has-body-filter-yes"));

    const empty = await screen.findByTestId("coord-plans-body-filtered-empty");
    expect(empty).toHaveTextContent(/3 work units in this window/);
    // The status-filter copy would name the wrong control entirely.
    expect(screen.queryByTestId("coord-plans-empty")).toBeNull();
  });
});
