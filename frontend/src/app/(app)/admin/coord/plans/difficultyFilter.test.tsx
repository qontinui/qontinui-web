/**
 * `/admin/coord/plans` — the difficulty chip and filter, end to end on the page.
 *
 * Plan `2026-09-18-plan-library-difficulty-field`. Pinned:
 *   - each row carries the plan library's rating, joined by slug, and a plan
 *     the library holds no body for reads `unrated` — never `low`;
 *   - the difficulty filter is DISABLED until the ratings load, so it can
 *     never empty the list on ratings the page does not have;
 *   - a failed ratings read is said above the list, and every row's chip
 *     reads unknown (`?`) rather than unrated;
 *   - a filter that removes every fetched row names itself, not the status
 *     filter.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DifficultyIndex } from "@/components/admin/coord/planDifficulty";
import { indexDifficulty } from "@/components/admin/coord/planDifficulty";

const get = vi.fn();
let difficultyIndex: DifficultyIndex = { state: "pending" };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plans",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("./usePlanDifficulty", () => ({
  usePlanDifficulty: () => ({
    index: difficultyIndex,
    refresh: () => Promise.resolve(),
  }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordPlansListPage from "./page";

const UNITS = {
  work_units: [
    { slug: "2026-09-10-hard-one", status: "vetted" },
    { slug: "2026-09-11-easy-one", status: "vetted" },
    { slug: "2026-09-12-no-body", status: "draft" },
  ],
};

function loaded(): DifficultyIndex {
  const base = {
    source_repo: "qontinui-dev-notes/plans",
    difficulty_source: "computed" as const,
    difficulty_rubric_version: 1,
  };
  return indexDifficulty({
    items: [
      {
        ...base,
        id: "1",
        slug: "2026-09-10-hard-one",
        work_unit_slug: "2026-09-10-hard-one",
        difficulty: "high",
        difficulty_conceptual: "high",
        difficulty_implementation: "high",
      },
      {
        ...base,
        id: "2",
        slug: "2026-09-11-easy-one",
        work_unit_slug: "2026-09-11-easy-one",
        difficulty: "low",
        difficulty_conceptual: "low",
        difficulty_implementation: "low",
      },
    ],
    count: 2,
    rerated: 0,
    rerate_pending: 0,
    rerate_failed_reason: null,
    rubric_version: 1,
    model_tiers: { high: "Fable 5.1", medium: "Opus 5", low: "Fast tier" },
  });
}

function chipFor(slug: string): HTMLElement {
  const row = screen
    .getAllByTestId("coord-plan-card")
    .find((el) => el.getAttribute("data-row-key") === slug);
  if (!row) throw new Error(`no row for ${slug}`);
  return within(row).getByTestId("coord-plan-difficulty");
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue(UNITS);
  difficultyIndex = { state: "pending" };
});

describe("/admin/coord/plans difficulty", () => {
  it("chips every row by slug, and an uncaptured plan reads unrated", async () => {
    difficultyIndex = loaded();
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-card");

    expect(chipFor("2026-09-10-hard-one")).toHaveAttribute(
      "data-difficulty",
      "high"
    );
    expect(chipFor("2026-09-10-hard-one")).toHaveAttribute(
      "title",
      expect.stringContaining("route to Fable 5.1")
    );
    expect(chipFor("2026-09-11-easy-one")).toHaveAttribute(
      "data-difficulty",
      "low"
    );
    expect(chipFor("2026-09-12-no-body")).toHaveAttribute(
      "data-difficulty",
      "unrated"
    );
    expect(chipFor("2026-09-12-no-body")).toHaveTextContent("unrated");
  });

  it("disables the filter while the ratings are pending", async () => {
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-card");
    expect(screen.getByTestId("coord-plans-difficulty-select")).toBeDisabled();
    expect(chipFor("2026-09-10-hard-one")).toHaveAttribute(
      "data-difficulty",
      "unknown"
    );
  });

  it("says a failed ratings read, and reads every chip unknown, not unrated", async () => {
    difficultyIndex = { state: "failed", reason: "HTTP 503" };
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-card");
    expect(
      screen.getByTestId("coord-plans-difficulty-unknown")
    ).toHaveTextContent("HTTP 503");
    expect(screen.getByTestId("coord-plans-difficulty-select")).toBeDisabled();
    for (const chip of screen.getAllByTestId("coord-plan-difficulty")) {
      expect(chip).toHaveAttribute("data-difficulty", "unknown");
      expect(chip).toHaveTextContent("?");
    }
  });

  it("enables the filter once the ratings load", async () => {
    difficultyIndex = loaded();
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-card");
    expect(
      screen.getByTestId("coord-plans-difficulty-select")
    ).not.toBeDisabled();
  });

  it("filters the fetched rows by level, and unrated is its own bucket", async () => {
    difficultyIndex = loaded();
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-card");

    const keys = () =>
      screen
        .getAllByTestId("coord-plan-card")
        .map((el) => el.getAttribute("data-row-key"));

    await user.click(screen.getByTestId("coord-plans-difficulty-select"));
    await user.click(
      await screen.findByRole("option", { name: "High difficulty" })
    );
    expect(keys()).toEqual(["2026-09-10-hard-one"]);

    await user.click(screen.getByTestId("coord-plans-difficulty-select"));
    await user.click(await screen.findByRole("option", { name: "Unrated" }));
    expect(keys()).toEqual(["2026-09-12-no-body"]);
  });

  it("names the difficulty filter when it empties the list", async () => {
    difficultyIndex = loaded();
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-card");

    await user.click(screen.getByTestId("coord-plans-difficulty-select"));
    await user.click(
      await screen.findByRole("option", { name: "Medium difficulty" })
    );
    expect(
      screen.getByTestId("coord-plans-difficulty-empty")
    ).toHaveTextContent("None of the 3 fetched plans is rated medium.");
    expect(screen.queryByTestId("coord-plans-empty")).toBeNull();
  });

  it("names the difficulty filter over a STALE list too, not the stale copy", async () => {
    difficultyIndex = loaded();
    get.mockReset();
    get.mockResolvedValueOnce(UNITS).mockRejectedValue(new Error("HTTP 502"));
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    await screen.findAllByTestId("coord-plan-card");

    await user.click(screen.getByTestId("coord-plans-difficulty-select"));
    await user.click(
      await screen.findByRole("option", { name: "Medium difficulty" })
    );
    // A later read fails: the page keeps its rows (stale), and the filter
    // still hides all of them.
    await user.click(screen.getByTestId("coord-plans-refresh"));
    await screen.findByText(/Failed to load/);
    expect(
      screen.getByTestId("coord-plans-difficulty-empty")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("coord-plans-stale")).toBeNull();
  });
});
