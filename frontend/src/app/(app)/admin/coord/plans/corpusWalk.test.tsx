/**
 * `/admin/coord/plans` reads the WHOLE corpus and says what it shows — plan
 * `2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost`
 * Phases 1–2, pinned on the rendered page.
 *
 * The defect: one `limit=500` read of an `updated_at DESC` list, so a plan
 * quiet for longer than the window was not on the page, and the caveat said
 * "capped at 500" without saying WHICH 500. Each case here asserts the rows an
 * operator would look for AND the sentence that tells them how complete the
 * page is, per coord version.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();

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

const LIMIT = 500;

function unit(slug: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    title: `Title ${slug}`,
    status: "shipped",
    authored_at: `${slug.slice(0, 10)}T00:00:00Z`,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-09-19T12:00:00Z",
    ...extra,
  };
}

/** 500 dated units for page one; the quiet target plan lives on page two. */
const PAGE_ONE = Array.from({ length: LIMIT }, (_, i) =>
  unit(`2026-09-1${i % 9}-page-one-${i}`)
);
const QUIET_TARGET = unit(
  "2026-09-10-the-plan-scanner-reads-a-parked-working-tree-not-a-ref",
  // Its `updated_at` is far older than anything on page one — the exact shape
  // that hid it behind the old updated_at-ordered cap.
  { updated_at: "2026-09-15T23:24:03Z", authored_at: "2026-09-01T00:00:00Z" }
);

const OVERVIEW = {
  row_count: 2400,
  distinct_status_count: 1,
  facets: {
    by_status_class: {},
    by_status: { shipped: 2400 },
    by_status_truncated: false,
    by_status_omitted: 0,
  },
  corpus_complete: true,
};

function listCalls(): string[] {
  return get.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/operations/plans?"));
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Fetch window"));
}

beforeEach(() => {
  get.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe("/admin/coord/plans — corpus walk", () => {
  it("walks next_cursor to the end, shows the quiet plan, and says ALL are shown", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      if (url.includes("after_slug=")) {
        return {
          order: "authored_desc",
          work_units: [QUIET_TARGET],
          next_cursor: null,
        };
      }
      return {
        order: "authored_desc",
        work_units: PAGE_ONE,
        next_cursor: {
          after_authored_at: "2026-09-10T00:00:00Z",
          after_slug: PAGE_ONE[LIMIT - 1].slug,
        },
      };
    });
    const user = userEvent.setup();
    render(<CoordPlansListPage />);

    await screen.findByText(new RegExp(QUIET_TARGET.title));
    expect(listCalls()).toHaveLength(2);
    expect(listCalls()[0]).toContain("order=authored_desc");
    expect(listCalls()[1]).toContain(`after_slug=${PAGE_ONE[LIMIT - 1].slug}`);

    expect(screen.getByText(`all ${LIMIT + 1} shown`)).toBeInTheDocument();
    await openPanel(user);
    const complete = screen.getByTestId("coord-plans-walk-complete");
    expect(complete).toHaveTextContent(`All ${LIMIT + 1} work units`);
    // The overview is compared, and the unlike-sets difference is STATED.
    expect(complete).toHaveTextContent("counts 2400 work units in total");
    expect(complete).toHaveTextContent("measured over different sets");
    expect(screen.queryByTestId("coord-plans-truncated-notice")).toBeNull();
    expect(screen.queryByTestId("coord-plans-walk-partial")).toBeNull();
  });

  it("says the count is not cross-checked when the overview cannot be read", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) throw new Error("HTTP 404");
      return {
        order: "authored_desc",
        work_units: [QUIET_TARGET],
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordPlansListPage />);

    await screen.findByText(new RegExp(QUIET_TARGET.title));
    await openPanel(user);
    expect(screen.getByTestId("coord-plans-walk-complete")).toHaveTextContent(
      "not cross-checked"
    );
  });

  it("a page failing mid-walk keeps the rows and says INCOMPLETE, never complete", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      if (url.includes("after_slug=")) throw new Error("HTTP 502");
      return {
        order: "authored_desc",
        work_units: PAGE_ONE,
        next_cursor: {
          after_authored_at: "2026-09-10T00:00:00Z",
          after_slug: PAGE_ONE[LIMIT - 1].slug,
        },
      };
    });
    const user = userEvent.setup();
    render(<CoordPlansListPage />);

    await screen.findByText(`INCOMPLETE — ${LIMIT} shown`);
    expect(screen.queryByText(/all \d+ shown/)).toBeNull();
    await openPanel(user);
    const partial = screen.getByTestId("coord-plans-walk-partial");
    expect(partial).toHaveTextContent("NOT the whole corpus");
    expect(partial).toHaveTextContent("a page read failed (HTTP 502)");
    // The authored_at range actually covered is named.
    expect(partial).toHaveTextContent(
      "authored 2026-09-18 00:00Z back to 2026-09-10 00:00Z"
    );
    expect(screen.queryByTestId("coord-plans-walk-complete")).toBeNull();
    expect(screen.queryByText(new RegExp(QUIET_TARGET.title))).toBeNull();
  });

  it("an older coord (no order echo) gets ONE read and the truncated notice names its updated_at span", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      // The pre-walk coord ignores `order` and the cursor: no echo, no cursor.
      return {
        work_units: PAGE_ONE.map((u, i) => ({
          ...u,
          updated_at: `2026-09-19T12:${String(i % 60).padStart(2, "0")}:00Z`,
        })),
      };
    });
    const user = userEvent.setup();
    render(<CoordPlansListPage />);

    await screen.findByText(`capped at ${LIMIT}`);
    // Let any (wrong) follow-up read get issued before counting.
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    expect(get.mock.calls.some((c) => String(c[0]).endsWith("/overview"))).toBe(
      false
    );
    await openPanel(user);
    const notice = screen.getByTestId("coord-plans-truncated-notice");
    expect(notice).toHaveTextContent(
      "updated 2026-09-19 12:00Z to 2026-09-19 12:59Z"
    );
    expect(notice).toHaveTextContent("predates the authored-order walk");
  });

  it("'Recently updated' asks for order=updated_desc once and never walks", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      if (url.includes("order=updated_desc")) {
        return {
          order: "updated_desc",
          work_units: PAGE_ONE,
          next_cursor: { after_authored_at: null, after_slug: "ignored" },
        };
      }
      return {
        order: "authored_desc",
        work_units: [QUIET_TARGET],
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    await user.click(screen.getByTestId("coord-plans-sort-select"));
    await user.click(
      await screen.findByRole("option", { name: "Recently updated" })
    );

    await screen.findByText(`capped at ${LIMIT}`);
    const updatedCalls = listCalls().filter((u) =>
      u.includes("order=updated_desc")
    );
    expect(updatedCalls).toHaveLength(1);
    expect(updatedCalls[0]).not.toContain("after_slug");
    await openPanel(user);
    expect(
      screen.getByTestId("coord-plans-truncated-notice")
    ).toHaveTextContent("single page by design");
  });

  it("switching between two walked sorts re-sorts without re-reading", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      return {
        order: "authored_desc",
        work_units: [QUIET_TARGET],
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordPlansListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));
    const before = listCalls().length;

    await user.click(screen.getByTestId("coord-plans-sort-select"));
    await user.click(await screen.findByRole("option", { name: "Slug A→Z" }));

    expect(
      screen.getByText(new RegExp(QUIET_TARGET.title))
    ).toBeInTheDocument();
    expect(listCalls()).toHaveLength(before);
  });
});
