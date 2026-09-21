/**
 * `/admin/coord/work-units` reads the WHOLE store and says what it shows — plan
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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/work-units",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordWorkUnitsListPage from "./page";

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

/** The page-level explanation the proxy attaches beside annotated rows. */
const BODY_SIGNAL = {
  capture_level: "off",
  capture_resolved_scope: "tenant",
  capture_readable: true,
  artifact_surface_readable: true,
  org_plan_artifact_count: 1400,
  miss_reason: "capture_off",
};

/**
 * The plan library's difficulty ratings — a SECOND read on its own endpoint,
 * un-parameterised and whole-corpus, so nothing about it rides on a walk page.
 * The map keys off `work_unit_slug` (`indexDifficulty`).
 */
const DIFFICULTY = {
  items: [
    {
      id: "0d1f0000-0000-4000-8000-000000000001",
      slug: QUIET_TARGET.slug,
      work_unit_slug: QUIET_TARGET.slug,
      source_repo: "qontinui-dev-notes/plans",
      difficulty: "high",
      difficulty_conceptual: "high",
      difficulty_implementation: "medium",
      difficulty_source: "computed",
      difficulty_rubric_version: 1,
      difficulty_signals: {},
    },
  ],
  count: 1,
  rerated: 0,
  rerate_pending: 0,
  rerate_failed_reason: null,
  rubric_version: 1,
  model_tiers: { high: "Fable 5.1", medium: "Opus 5", low: "a fast tier" },
};

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

describe("/admin/coord/work-units — corpus walk", () => {
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
    render(<CoordWorkUnitsListPage />);

    await screen.findByText(new RegExp(QUIET_TARGET.title));
    expect(listCalls()).toHaveLength(2);
    expect(listCalls()[0]).toContain("order=authored_desc");
    expect(listCalls()[1]).toContain(`after_slug=${PAGE_ONE[LIMIT - 1].slug}`);

    // `read*`, not `shown`: the panel is collapsed by default, so its summary
    // may not make the unqualified whole-corpus claim while the one bound the
    // walk cannot close sits behind the disclosure (R2 of round 3).
    expect(screen.getByText(`all ${LIMIT + 1} read*`)).toBeInTheDocument();
    await openPanel(user);
    const complete = screen.getByTestId("coord-work-units-walk-complete");
    expect(complete).toHaveTextContent(`All ${LIMIT + 1} work units`);
    // ...and it says what that count IS: the rows this walk read. The number
    // is `plans.length`, taken before the client-side document filters, so
    // "are shown" was false the moment a chip was selected (F2 of round 4).
    expect(complete).toHaveTextContent(
      "were READ — the whole list, in authoring order (2 pages)"
    );
    expect(complete).not.toHaveTextContent("are shown");
    // The overview is compared. The shepherd control DEFAULTS TO INCLUDED on
    // `/work-units`, so the walk and the overview are over the same set here,
    // and the difference is stated as a difference — not excused as unlike
    // sets. The excluded arm is pinned in its own test below.
    expect(complete).toHaveTextContent("counts 2400 work units in total");
    expect(complete).toHaveTextContent("over the same set — a difference of");
    expect(complete).not.toHaveTextContent("measured over different sets");
    expect(
      screen.queryByTestId("coord-work-units-truncated-notice")
    ).toBeNull();
    expect(screen.queryByTestId("coord-work-units-walk-partial")).toBeNull();
    // A whole list IS a whole-corpus verdict, so the strip claims one.
    expect(screen.getByTestId("coord-work-units-health")).not.toHaveTextContent(
      "INCOMPLETE"
    );
  });

  /**
   * The bound on "complete" — F1 of this change's review. The walk orders by
   * `authored_at`, coord heals a NULL one on the row's next upsert and the
   * plan scanner re-upserts about once a minute, so a row can move behind the
   * cursor mid-walk and be on neither page while the walk still ends on a null
   * `next_cursor`. The page may not assert more than the walk can know.
   */
  it("says on the complete panel that a row re-dated mid-walk can be missed", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      return {
        order: "authored_desc",
        work_units: [QUIET_TARGET],
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));
    await openPanel(user);

    expect(
      screen.getByTestId("coord-work-units-walk-complete")
    ).toHaveTextContent(
      "A work unit whose authoring date changed while the list was being read can be missed; reload to re-check."
    );
  });

  it("names when the list was read, and how often it re-reads itself", async () => {
    // The walked cadence is 60 s, not 10 s, so "how old is this?" stops being
    // answerable by assuming the page is a few seconds fresh.
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      return {
        order: "authored_desc",
        work_units: [QUIET_TARGET],
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));
    await openPanel(user);

    const readAt = screen.getByTestId("coord-work-units-read-at");
    expect(readAt).toHaveTextContent(/^Read \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z; /);
    expect(readAt).toHaveTextContent("re-reads itself every 60 s");
  });

  /**
   * R1 of round 3 — the read stamp may not depend on there being a CAVEAT.
   *
   * The stamp used to live inside the collapsible fetch-window panel, which
   * renders only when `truncated || walkComplete || walkPartial ||
   * missingAuthored > 0`. This arm satisfies none of those and is perfectly
   * reachable: an authored sort (so the 60 s cadence is in force) against a
   * coord that PREDATES the walk — no `order` echo, so `single_page` — over a
   * corpus under `WALK_PAGE_LIMIT` rows, every row dated. The panel is absent,
   * and before the fix nothing on the page said when the list was read or that
   * it only re-reads once a minute, so a 59-second-old list was presented as
   * current.
   */
  it("legacy coord, small corpus, authored sort: no panel, and the read stamp is still on screen", async () => {
    const SMALL = [
      QUIET_TARGET,
      unit("2026-09-08-a-second-dated-plan"),
      unit("2026-09-07-a-third-dated-plan"),
    ];
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      // A pre-walk coord: no `order` echo, no `next_cursor`, and the page is
      // nowhere near full so nothing is truncated either.
      return { work_units: SMALL };
    });
    render(<CoordWorkUnitsListPage />);

    await screen.findByText(new RegExp(QUIET_TARGET.title));
    // One read, no walk, no overview — and NO caveat, so no panel at all.
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    expect(screen.queryByText("Fetch window")).toBeNull();
    expect(screen.queryByTestId("coord-work-units-window-caveats")).toBeNull();
    expect(
      screen.queryByTestId("coord-work-units-truncated-notice")
    ).toBeNull();
    expect(screen.queryByTestId("coord-work-units-walk-complete")).toBeNull();
    expect(
      screen.queryByTestId("coord-work-units-missing-authored-notice")
    ).toBeNull();

    // The age of the list is on screen anyway — this is the whole point.
    const readAt = screen.getByTestId("coord-work-units-read-at");
    expect(readAt).toHaveTextContent(/^Read \d{4}-\d{2}-\d{2} \d{2}:\d{2}Z; /);
    expect(readAt).toHaveTextContent("re-reads itself every 60 s");
  });

  /**
   * R2 of round 3 — the part every operator sees may not overstate the read.
   *
   * The panel is `defaultOpen={false}`, so its summary is always visible while
   * the bound on a keyset walk is behind the disclosure. "all N shown" there
   * was the unqualified whole-corpus claim in the one place that is never
   * folded away.
   */
  it("the collapsed summary says `read*`, not `shown`, and the open panel resolves the marker", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      return {
        order: "authored_desc",
        work_units: [QUIET_TARGET],
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    // Collapsed: the summary is on screen and the caveat is NOT.
    expect(screen.getByText("all 1 read*")).toBeInTheDocument();
    expect(screen.queryByText(/all 1 shown/)).toBeNull();
    expect(screen.queryByTestId("coord-work-units-walk-complete")).toBeNull();

    await openPanel(user);
    expect(
      screen.getByTestId("coord-work-units-walk-complete")
    ).toHaveTextContent(
      "* A work unit whose authoring date changed while the list was being read can be missed"
    );
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
    render(<CoordWorkUnitsListPage />);

    await screen.findByText(new RegExp(QUIET_TARGET.title));
    await openPanel(user);
    expect(
      screen.getByTestId("coord-work-units-walk-complete")
    ).toHaveTextContent("not cross-checked");
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
    render(<CoordWorkUnitsListPage />);

    // `read`, not `shown`: this count is `plans.length`, taken before the
    // client-side document filters (F2 of round 4).
    await screen.findByText(`INCOMPLETE — ${LIMIT} read`);
    expect(screen.queryByText(/all \d+ read/)).toBeNull();
    // F5 — the strip is derived from the rows fetched so far, so it says so
    // rather than rendering a partial read as a whole-corpus verdict. These
    // 500 rows are all `shipped`; unqualified, the strip would paint the green
    // "No plan is blocked" all-clear over a list that stopped before the end.
    const strip = screen.getByTestId("coord-work-units-health");
    expect(strip).toHaveTextContent("list INCOMPLETE");
    // F6 of round 4 — `not.toHaveTextContent(/^No plan is blocked$/)` could
    // never fail: jest-dom matches the regex against the ELEMENT's whole
    // normalized textContent, which here also carries the badge cluster, so
    // the anchored pattern passed with the bug present. `getByText` compares
    // each element's own text, so the headline span is what answers — and the
    // pair discriminates. Which line REPORTS is worth stating exactly, because
    // the two headlines are exclusive arms of one ternary
    // (`plansHealth.tsx`): make `derivePlansHealth` emit the unqualified
    // headline on the `incomplete` arm and the FIRST line throws — `getByText`
    // finds no node carrying the qualified sentence — which aborts the test
    // before line 2 runs. Both would fail if reached, so neither line is the
    // spare one; line 2 is what catches the converse mutation, a build that
    // renders both.
    expect(
      within(strip).getByText(
        "No work unit is blocked in the part of the list that was read"
      )
    ).toBeInTheDocument();
    expect(within(strip).queryByText("No work unit is blocked")).toBeNull();
    await openPanel(user);
    const partial = screen.getByTestId("coord-work-units-walk-partial");
    expect(partial).toHaveTextContent("NOT the whole corpus");
    expect(partial).toHaveTextContent("a page read failed (HTTP 502)");
    // The authored_at range actually covered is named.
    expect(partial).toHaveTextContent(
      "authored 2026-09-18 00:00Z back to 2026-09-10 00:00Z"
    );
    expect(screen.queryByTestId("coord-work-units-walk-complete")).toBeNull();
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
    render(<CoordWorkUnitsListPage />);

    await screen.findByText(`capped at ${LIMIT}`);
    // Let any (wrong) follow-up read get issued before counting.
    await waitFor(() => expect(listCalls()).toHaveLength(1));
    expect(get.mock.calls.some((c) => String(c[0]).endsWith("/overview"))).toBe(
      false
    );
    await openPanel(user);
    const notice = screen.getByTestId("coord-work-units-truncated-notice");
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
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    await user.click(screen.getByTestId("coord-work-units-sort-select"));
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
      screen.getByTestId("coord-work-units-truncated-notice")
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
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));
    const before = listCalls().length;

    await user.click(screen.getByTestId("coord-work-units-sort-select"));
    await user.click(await screen.findByRole("option", { name: "Slug A→Z" }));

    expect(
      screen.getByText(new RegExp(QUIET_TARGET.title))
    ).toBeInTheDocument();
    expect(listCalls()).toHaveLength(before);
  });
  /**
   * F2 of round 4 — the fetch-window counts are pre-filter, so every one of
   * them says "read". With a chip selected the pre-filter count is not the
   * number of rows on screen, and three sentences here used to call it
   * "shown". The fourth, the single-page arm, is the case below.
   */
  it("a selected document chip does not make the pre-filter count read as a rendered one", async () => {
    const ANNOTATED = PAGE_ONE.map((u, i) => ({
      ...u,
      body_provenance: "never_scanned",
      has_body: i === 0,
      body_unknown_reason: null,
    }));
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      if (url.includes("after_slug=")) throw new Error("HTTP 502");
      return {
        order: "authored_desc",
        work_units: ANNOTATED,
        body_signal: BODY_SIGNAL,
        next_cursor: {
          after_authored_at: "2026-09-10T00:00:00Z",
          after_slug: PAGE_ONE[LIMIT - 1].slug,
        },
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);

    await screen.findByText(`INCOMPLETE — ${LIMIT} read`);
    await user.click(
      screen.getByTestId("coord-work-units-has-body-filter-yes")
    );
    // One row is rendered; 500 were read. The always-visible summary states
    // the read, and states it as a read.
    await waitFor(() =>
      expect(screen.queryAllByTestId("coord-plan-card")).toHaveLength(1)
    );
    expect(screen.getByText(`INCOMPLETE — ${LIMIT} read`)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${LIMIT} shown`))).toBeNull();

    await openPanel(user);
    const partial = screen.getByTestId("coord-work-units-walk-partial");
    expect(partial).toHaveTextContent(`${LIMIT} work units were read`);
    // ...and where the RENDERED count is stated, it is the filtered one and it
    // is labelled as such.
    expect(partial).toHaveTextContent(
      "1 of them is shown under the document and scanner filters."
    );
  });

  /**
   * F3 of round 5 — the FOURTH count arm, which the round-4 "read, never
   * shown" pass did not reach.
   *
   * The single-page notice (a legacy coord, or the "Recently updated" sort)
   * said "Showing the 500 most-recently-updated work units" — a rendered-count
   * claim over the read cap, false the moment a chip narrowed the list, and
   * the one arm `shownUnderFilter` was never appended to.
   */
  it("the single-page arm states a READ, and names the rendered count when a chip is up", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      // A pre-walk coord: no `order` echo and no cursor, so the page takes the
      // one full page as `single_page` + `truncated`.
      return {
        work_units: PAGE_ONE.map((u, i) => ({
          ...u,
          body_provenance: "never_scanned",
          has_body: i === 0,
          body_unknown_reason: null,
        })),
        body_signal: BODY_SIGNAL,
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);

    await screen.findByText(`capped at ${LIMIT}`);
    await user.click(
      screen.getByTestId("coord-work-units-has-body-filter-yes")
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("coord-plan-card")).toHaveLength(1)
    );

    await openPanel(user);
    const notice = screen.getByTestId("coord-work-units-truncated-notice");
    expect(notice).toHaveTextContent(
      `The ${LIMIT} most-recently-updated work units were READ`
    );
    // The denominator this page's peer (Phase 3 of plan
    // `2026-09-20-the-operator-plans-page-reads-the-wrong-store`) added: this
    // envelope serves no `total`, so it is UNKNOWN — never the page size.
    expect(notice).toHaveTextContent("an unknown total");
    expect(notice).not.toHaveTextContent("Showing");
    expect(notice).toHaveTextContent(
      "1 of them is shown under the document and scanner filters."
    );
  });

  /**
   * F5 of round 5 — `bodyFiltered` is EITHER strip, so the sentence may not
   * attribute the narrowing to the `document` one alone. A scanner chip is the
   * case that used to read as a document filter nobody had touched.
   */
  it("names both strips when only the SCANNER chip is selected", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      return {
        order: "authored_desc",
        work_units: [
          { ...QUIET_TARGET, body_provenance: "never_scanned", has_body: true },
          {
            ...unit("2026-09-08-a-second-dated-plan"),
            body_provenance: "scanned",
            has_body: true,
          },
        ],
        body_signal: BODY_SIGNAL,
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    await user.click(
      screen.getByTestId("coord-work-units-provenance-filter-never_scanned")
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("coord-plan-card")).toHaveLength(1)
    );
    await openPanel(user);
    expect(
      screen.getByTestId("coord-work-units-walk-complete")
    ).toHaveTextContent(
      "1 of them is shown under the document and scanner filters."
    );
  });

  /**
   * F8 of round 4 — the `walkComplete` arm of the body-filtered empty state.
   * "in this window" was pinned by the peer's own test; "read — the whole
   * list —" was pinned by nothing, and it is the arm that makes the stronger
   * claim.
   */
  it("a complete walk emptied by a chip says the filter ran over the WHOLE list", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      return {
        order: "authored_desc",
        work_units: [
          {
            ...QUIET_TARGET,
            body_provenance: "never_scanned",
            has_body: false,
          },
          {
            ...unit("2026-09-08-a-second-dated-plan"),
            body_provenance: "never_scanned",
            has_body: false,
          },
        ],
        body_signal: BODY_SIGNAL,
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    await user.click(
      screen.getByTestId("coord-work-units-has-body-filter-yes")
    );
    const empty = await screen.findByTestId(
      "coord-work-units-body-filtered-empty"
    );
    expect(empty).toHaveTextContent(
      "None of the 2 work units read — the whole list — match the document and scanner filters."
    );
  });

  /**
   * F1 of round 4 — the `document` strip's tooltip states of the whole read
   * what may be true of one page of it.
   *
   * The fold reports `miss_reason` as the FIRST arm any page hit, so a 4-page
   * walk whose page-1 dial read landed while `plan_capture` was off — the
   * operator then flipping it to `record` — settles `has_body` for every row
   * on the later pages while the tooltip still said nothing could be
   * established. The claim now names the scope the fold measured.
   */
  it("qualifies the miss tooltip when only SOME pages of the walk missed", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      if (url.includes("after_slug=")) {
        return {
          order: "authored_desc",
          work_units: [
            { ...QUIET_TARGET, body_provenance: "scanned", has_body: true },
          ],
          // Page 2 read the dial and settled its rows.
          body_signal: {
            ...BODY_SIGNAL,
            capture_level: "record",
            miss_reason: null,
          },
          next_cursor: null,
        };
      }
      return {
        order: "authored_desc",
        work_units: [
          {
            ...unit("2026-09-19-page-one-row"),
            body_provenance: "never_scanned",
            has_body: "unknown",
            body_unknown_reason: "capture_off",
          },
        ],
        body_signal: BODY_SIGNAL,
        next_cursor: {
          after_authored_at: "2026-09-19T00:00:00Z",
          after_slug: "2026-09-19-page-one-row",
        },
      };
    });
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    const strip = await screen.findByTestId("coord-work-units-has-body-filter");
    const title = strip.getAttribute("title") ?? "";
    expect(title).toContain("Some pages of this read could not establish");
    expect(title).not.toContain("This read could not establish");
    // F3 — the reason is the sentence, never the wire enum.
    expect(title).toContain("plan capture is switched off for this tenant");
    expect(title).not.toContain("capture_off");
  });

  it("states the miss of the whole read when EVERY page missed", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      return {
        order: "authored_desc",
        work_units: [
          {
            ...QUIET_TARGET,
            body_provenance: "never_scanned",
            has_body: "unknown",
            body_unknown_reason: "capture_never_configured",
          },
        ],
        body_signal: {
          ...BODY_SIGNAL,
          miss_reason: "capture_never_configured",
        },
        next_cursor: null,
      };
    });
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    const title =
      (
        await screen.findByTestId("coord-work-units-has-body-filter")
      ).getAttribute("title") ?? "";
    expect(title).toContain("This read could not establish");
    expect(title).not.toContain("Some pages");
    expect(title).toContain(
      "no plan_capture policy row has ever been written for this tenant"
    );
    expect(title).not.toContain("capture_never_configured");
  });

  /**
   * The DIFFICULTY select (peer feature `2026-09-18-plan-library-difficulty-field`)
   * is a THIRD client-side narrowing over the same rows, so the rendered-count
   * sentence has to count it.
   *
   * It needs no walk wiring — `usePlanDifficulty` issues one
   * un-parameterised whole-corpus `GET /plan-library/difficulty`, so there is
   * no per-page parameter to carry and no per-request envelope to fold. But it
   * DOES narrow what is on screen, and a panel appending `shownUnderFilter`
   * only when a body chip was up restated the pre-filter number as the
   * rendered one for every difficulty-only selection — the same defect as F2
   * of round 4, in the arm the peer feature added.
   */
  it("counts the difficulty filter in the rendered count, with no chip up", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/plans/overview")) return OVERVIEW;
      if (url.includes("/plan-library/difficulty")) return DIFFICULTY;
      return {
        order: "authored_desc",
        work_units: [QUIET_TARGET, unit("2026-09-08-a-second-dated-plan")],
        next_cursor: null,
      };
    });
    const user = userEvent.setup();
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));

    // The ratings read is its own call — it carries no cursor parameters and
    // is not one of the walk's pages.
    const ratingCalls = get.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("/plan-library/difficulty"));
    expect(ratingCalls).toHaveLength(1);
    expect(ratingCalls[0]).not.toContain("?");
    expect(listCalls()).toHaveLength(1);

    await user.click(screen.getByTestId("coord-work-units-difficulty-select"));
    await user.click(
      await screen.findByRole("option", { name: "High difficulty" })
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("coord-plan-card")).toHaveLength(1)
    );

    // The always-visible summary still states the READ, un-narrowed.
    expect(screen.getByText("all 2 read*")).toBeInTheDocument();
    await openPanel(user);
    const complete = screen.getByTestId("coord-work-units-walk-complete");
    expect(complete).toHaveTextContent("All 2 work units");
    expect(complete).toHaveTextContent(
      "1 of them is shown under the difficulty filter."
    );
  });
});

/**
 * The walk composed with the `shepherd-*` control that Phase 3 of plan
 * `2026-09-20-the-operator-plans-page-reads-the-wrong-store` added when this
 * route moved to `/admin/coord/work-units`. The control is SERVER-side, so it
 * has to ride on EVERY page of a walk — a filter set on page one alone would
 * return shepherd rows from page two on while the copy said they were
 * excluded. And the overview takes no filters, so only under "exclude" are the
 * two totals over different sets.
 */
describe("/admin/coord/work-units — corpus walk × shepherd control", () => {
  it("sends exclude_slug_prefix on every page of the walk once chosen, and says the totals then differ in kind", async () => {
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
    render(<CoordWorkUnitsListPage />);
    await screen.findByText(new RegExp(QUIET_TARGET.title));
    // The default includes them: no page of the first walk carries it.
    expect(listCalls()).toHaveLength(2);
    for (const u of listCalls()) expect(u).not.toContain("exclude_slug_prefix");

    const before = listCalls().length;
    await user.click(screen.getByTestId("coord-work-units-shepherd-select"));
    await user.click(
      await screen.findByRole("option", { name: "Excl. merge escalations" })
    );
    await screen.findByText(new RegExp(QUIET_TARGET.title));
    await waitFor(() => expect(listCalls().length).toBe(before + 2));
    const walk = listCalls().slice(before);
    expect(walk[1]).toContain("after_slug=");
    for (const u of walk) {
      expect(u).toContain("exclude_slug_prefix=shepherd-");
    }

    await openPanel(user);
    const complete = await screen.findByTestId(
      "coord-work-units-walk-complete"
    );
    expect(complete).toHaveTextContent(
      "excluding coord's shepherd-* merge escalations"
    );
    expect(complete).toHaveTextContent("measured over different sets");
  });
});
