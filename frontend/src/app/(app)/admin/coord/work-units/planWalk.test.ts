/**
 * The corpus walk, at the wire — plan
 * `2026-09-12-admin-coord-plans-shows-a-rotating-3-minute-slice-so-plans-get-lost`.
 *
 * Each outcome is pinned against the request sequence that produces it, so a
 * walk that silently stopped after page one (the old behaviour) or looped on a
 * coord that never sent a cursor cannot go green.
 */

import { describe, expect, it, vi } from "vitest";
import type { CoordPlanRow } from "@/components/admin/coord/planStatus";
import {
  WALK_MAX_PAGES,
  WALK_PAGE_LIMIT,
  overviewTotalFor,
  serverOrderFor,
  timeSpan,
  walkWorkUnits,
  type PlansListResponse,
} from "./planWalk";

function row(slug: string, authored_at: string | null = null): CoordPlanRow {
  return { slug, authored_at, updated_at: "2026-09-19T00:00:00Z" };
}

function fullPage(prefix: string): CoordPlanRow[] {
  return Array.from({ length: WALK_PAGE_LIMIT }, (_, i) =>
    row(`${prefix}-${i}`, "2026-09-01T00:00:00Z")
  );
}

function base() {
  const qs = new URLSearchParams();
  qs.set("exclude_slug_prefix", "shepherd-");
  return qs;
}

/** Route each call by its cursor, and record every URL asked. */
function scripted(pages: Record<string, PlansListResponse | Error>) {
  const urls: string[] = [];
  const get = vi.fn(async (url: string) => {
    urls.push(url);
    const q = new URL(url, "http://x").searchParams;
    const key = q.get("after_slug") ?? "first";
    const answer = pages[key];
    if (answer === undefined) throw new Error(`unscripted page ${key}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return {
    get: get as unknown as <T>(u: string) => Promise<T>,
    urls,
    spy: get,
  };
}

const always = () => true;

describe("serverOrderFor", () => {
  it("walks every sort except the two updated_* views", () => {
    expect(serverOrderFor("authored_desc")).toBe("authored_desc");
    expect(serverOrderFor("authored_asc")).toBe("authored_desc");
    expect(serverOrderFor("created_asc")).toBe("authored_desc");
    expect(serverOrderFor("slug_asc")).toBe("authored_desc");
    expect(serverOrderFor("updated_desc")).toBe("updated_desc");
    expect(serverOrderFor("updated_asc")).toBe("updated_desc");
  });
});

describe("walkWorkUnits", () => {
  it("follows next_cursor until it is null, accumulating every page", async () => {
    const { get, urls } = scripted({
      first: {
        order: "authored_desc",
        work_units: fullPage("a"),
        next_cursor: {
          after_authored_at: "2026-09-01T00:00:00Z",
          after_slug: "a-499",
        },
      },
      "a-499": {
        order: "authored_desc",
        work_units: fullPage("b"),
        // Into the NULL-authored tail: the cursor carries no timestamp.
        next_cursor: { after_authored_at: null, after_slug: "b-499" },
      },
      "b-499": {
        order: "authored_desc",
        work_units: [row("undated-plan")],
        next_cursor: null,
      },
    });

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );

    expect(out?.kind).toBe("complete");
    expect(out?.rows).toHaveLength(2 * WALK_PAGE_LIMIT + 1);
    expect(out?.kind === "complete" && out.pages).toBe(3);
    expect(urls).toHaveLength(3);
    for (const u of urls) {
      expect(u).toContain("order=authored_desc");
      expect(u).toContain(`limit=${WALK_PAGE_LIMIT}`);
      expect(u).toContain("exclude_slug_prefix=shepherd-");
      expect(u).not.toContain("offset=");
    }
    expect(urls[0]).not.toContain("after_");
    expect(urls[1]).toContain("after_authored_at=2026-09-01T00%3A00%3A00Z");
    expect(urls[1]).toContain("after_slug=a-499");
    // A null `after_authored_at` means "inside the NULL tail": slug alone.
    expect(urls[2]).toContain("after_slug=b-499");
    expect(urls[2]).not.toContain("after_authored_at");
  });

  it("does NOT loop on an older coord that sends no order echo", async () => {
    const { get, urls } = scripted({
      // Full page, no `order`, no `next_cursor` — the pre-walk coord.
      first: { work_units: fullPage("old") },
    });

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );

    expect(urls).toHaveLength(1);
    expect(out).toMatchObject({
      kind: "single_page",
      truncated: true,
      legacyCoord: true,
    });
  });

  it("an older coord's short page is single-page and not truncated", async () => {
    const { get } = scripted({ first: { work_units: [row("x")] } });
    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );
    expect(out).toMatchObject({ kind: "single_page", truncated: false });
  });

  it("keeps the rows and reports PARTIAL when a later page fails", async () => {
    const { get } = scripted({
      first: {
        order: "authored_desc",
        work_units: fullPage("a"),
        next_cursor: {
          after_authored_at: "2026-09-01T00:00:00Z",
          after_slug: "a-499",
        },
      },
      "a-499": new Error("HTTP 502"),
    });

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );

    expect(out).toMatchObject({
      kind: "partial",
      reason: "error",
      error: "HTTP 502",
      pages: 1,
    });
    expect(out?.rows).toHaveLength(WALK_PAGE_LIMIT);
  });

  it("throws when the FIRST page fails — nothing was read", async () => {
    const { get } = scripted({ first: new Error("HTTP 503") });
    await expect(
      walkWorkUnits(get, "/api/plans", base(), "authored_desc", always)
    ).rejects.toThrow("HTTP 503");
  });

  it("stops at the page cap and says so rather than claiming completeness", async () => {
    let n = 0;
    const get = vi.fn(async () => {
      n += 1;
      return {
        order: "authored_desc",
        work_units: [row(`p${n}`, "2026-09-01T00:00:00Z")],
        next_cursor: {
          after_authored_at: "2026-09-01T00:00:00Z",
          after_slug: `p${n}`,
        },
      };
    }) as unknown as <T>(u: string) => Promise<T>;

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );

    expect(out).toMatchObject({
      kind: "partial",
      reason: "page_cap",
      pages: WALK_MAX_PAGES,
    });
    expect(n).toBe(WALK_MAX_PAGES);
  });

  it("reports a cursor that does not advance as partial, not a loop", async () => {
    const stuck = {
      after_authored_at: "2026-09-01T00:00:00Z",
      after_slug: "s",
    };
    const get = vi.fn(async () => ({
      order: "authored_desc",
      work_units: [row("s", "2026-09-01T00:00:00Z")],
      next_cursor: stuck,
    })) as unknown as <T>(u: string) => Promise<T>;

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );
    expect(out).toMatchObject({ kind: "partial", reason: "stalled", pages: 2 });
  });

  it("calls a longer cursor CYCLE stalled too, rather than blaming the page cap", async () => {
    // A → B → A → B: every step "advances" against the immediately previous
    // cursor, so a one-step comparison burned all 20 pages and reported
    // `page_cap` — "the corpus is bigger than the cap", about a coord that was
    // not paginating at all. The two reasons send an operator in different
    // directions, so the label has to be the true one.
    const A = { after_authored_at: "2026-09-02T00:00:00Z", after_slug: "a" };
    const B = { after_authored_at: "2026-09-01T00:00:00Z", after_slug: "b" };
    let n = 0;
    const get = vi.fn(async () => {
      n += 1;
      return {
        order: "authored_desc",
        work_units: [row(`p${n}`, "2026-09-01T00:00:00Z")],
        // first page → A, then B, A, B, …
        next_cursor: n === 1 ? A : n % 2 === 0 ? B : A,
      };
    }) as unknown as <T>(u: string) => Promise<T>;

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );

    expect(out).toMatchObject({ kind: "partial", reason: "stalled" });
    expect(out?.kind === "partial" && out.pages).toBe(3);
    // It stopped at the repeat, nowhere near the cap.
    expect(n).toBe(3);
  });

  it("a cursor into the NULL-authored tail is not confused with a dated one", async () => {
    // `after_authored_at: null` is a real, distinct position (the NULL tail),
    // so the same slug with and without a timestamp must be two cursors — or
    // an ordinary crossing into the tail would be reported as a cycle.
    const urls: string[] = [];
    const get = (async (url: string) => {
      urls.push(url);
      const q = new URL(url, "http://x").searchParams;
      const slug = q.get("after_slug");
      const at = q.get("after_authored_at");
      if (!slug) {
        return {
          order: "authored_desc",
          work_units: [row("t", "2026-09-01T00:00:00Z")],
          next_cursor: {
            after_authored_at: "2026-09-01T00:00:00Z",
            after_slug: "t",
          },
        };
      }
      // Same slug, now without a timestamp: the walk has crossed into the
      // NULL-authored tail. A key built from the slug alone would call this a
      // repeat and stop one page into the tail.
      if (at) {
        return {
          order: "authored_desc",
          work_units: [row("u")],
          next_cursor: { after_authored_at: null, after_slug: "t" },
        };
      }
      return {
        order: "authored_desc",
        work_units: [row("v")],
        next_cursor: null,
      };
    }) as <T>(u: string) => Promise<T>;

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );

    expect(out).toMatchObject({ kind: "complete", pages: 3 });
    expect(out?.rows.map((r) => r.slug)).toEqual(["t", "u", "v"]);
    expect(urls).toHaveLength(3);
  });

  it("stops issuing pages once superseded, and lands nothing", async () => {
    let current = true;
    const { get, urls } = scripted({
      first: {
        order: "authored_desc",
        work_units: fullPage("a"),
        next_cursor: {
          after_authored_at: "2026-09-01T00:00:00Z",
          after_slug: "a-499",
        },
      },
    });
    const wrapped = (async (u: string) => {
      const body = await get(u);
      current = false; // a newer question arrived while page one was out
      return body;
    }) as <T>(u: string) => Promise<T>;

    const out = await walkWorkUnits(
      wrapped,
      "/api/plans",
      base(),
      "authored_desc",
      () => current
    );
    expect(out).toBeNull();
    expect(urls).toHaveLength(1);
  });

  it("the updated_desc view is one read, even from a walking coord", async () => {
    const { get, urls } = scripted({
      first: {
        order: "updated_desc",
        work_units: fullPage("u"),
        next_cursor: { after_authored_at: null, after_slug: "u-499" },
      },
    });

    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "updated_desc",
      always
    );

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("order=updated_desc");
    expect(out).toMatchObject({
      kind: "single_page",
      truncated: true,
      legacyCoord: false,
    });
  });

  it("carries the single page's own total, and never substitutes count", async () => {
    const full = Array.from({ length: WALK_PAGE_LIMIT }, (_, i) =>
      row(`r${i}`)
    );
    const served = await walkWorkUnits(
      async <T>() => ({ work_units: full, total: 3268 }) as T,
      "/api/plans",
      base(),
      "updated_desc",
      always
    );
    expect(served).toMatchObject({ kind: "single_page", total: 3268 });

    const unserved = await walkWorkUnits(
      async <T>() => ({ work_units: full, count: WALK_PAGE_LIMIT }) as T,
      "/api/plans",
      base(),
      "updated_desc",
      always
    );
    expect(unserved).toMatchObject({ kind: "single_page", total: null });
  });
});

describe("timeSpan", () => {
  it("ignores null and unparseable values", () => {
    expect(
      timeSpan(
        [
          row("a", "2026-09-03T00:00:00Z"),
          row("b", null),
          row("c", "junk"),
          row("d", "2026-09-01T00:00:00Z"),
        ],
        (r) => r.authored_at
      )
    ).toEqual({
      oldest: "2026-09-01T00:00:00Z",
      newest: "2026-09-03T00:00:00Z",
    });
    expect(timeSpan([row("a")], (r) => r.authored_at)).toBeNull();
  });
});

describe("overviewTotalFor", () => {
  const overview = {
    row_count: 1800,
    facets: {
      by_status: { shipped: 1500, draft: 300 },
      by_status_truncated: false,
    },
  };
  it("uses row_count for any, by_status for a filter", () => {
    expect(overviewTotalFor(overview, "any", true)?.total).toBe(1800);
    expect(overviewTotalFor(overview, "draft", true)?.total).toBe(300);
  });
  it("an absent status is zero only when the facet was not truncated", () => {
    expect(overviewTotalFor(overview, "blocked", true)?.total).toBe(0);
    expect(
      overviewTotalFor(
        {
          ...overview,
          facets: { ...overview.facets, by_status_truncated: true },
        },
        "blocked",
        true
      )
    ).toBeNull();
  });
  it("says the overview counts rows the page excluded ONLY when it excluded them", () => {
    // The overview takes no filters, so it always counts `shepherd-*` rows.
    // `/work-units` includes them by default, and then the two totals ARE
    // over the same set — the copy may compare them like with like.
    expect(overviewTotalFor(overview, "any", false)).toEqual({
      total: 1800,
      includesExcluded: false,
    });
    expect(overviewTotalFor(overview, "any", true)).toEqual({
      total: 1800,
      includesExcluded: true,
    });
  });
  it("an unread overview is UNKNOWN, not zero", () => {
    expect(overviewTotalFor(null, "any", true)).toBeNull();
    expect(overviewTotalFor({}, "any", true)).toBeNull();
  });
});

/**
 * The corpus walk and the body signals (plan
 * `2026-09-02-bodyless-work-units-are-listed-and-spawnable-as-plans`) ship in
 * the same page and have to compose. The proxy computes ONE `body_signal`
 * block per REQUEST, and a walk is several requests, so the outcome has to
 * carry a fold rather than page one's answer — otherwise a dial read that
 * failed on page three would be invisible behind a page-one success.
 */
describe("walkWorkUnits — the per-page body_signal blocks", () => {
  const readable = {
    capture_level: "record",
    capture_resolved_scope: "tenant",
    capture_readable: true,
    artifact_surface_readable: true,
    org_plan_artifact_count: 1400,
    miss_reason: null,
  } as const;

  it("carries a single page's block through untouched", async () => {
    const { get } = scripted({
      first: { work_units: [row("a")], body_signal: { ...readable } },
    });
    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "updated_desc",
      always
    );
    expect(out).toMatchObject({ kind: "single_page" });
    // `miss_scope` is the fold's own field — a single page with no miss has
    // nothing to scope, so it folds to the block plus a null scope.
    expect(out?.bodySignal).toEqual({ ...readable, miss_scope: null });
  });

  it("folds every page's block, and a later page's failure wins", async () => {
    const { get } = scripted({
      first: {
        order: "authored_desc",
        work_units: fullPage("a"),
        body_signal: { ...readable },
        next_cursor: {
          after_authored_at: "2026-09-01T00:00:00Z",
          after_slug: "a-499",
        },
      },
      "a-499": {
        order: "authored_desc",
        work_units: [row("b", "2026-08-01T00:00:00Z")],
        // The dial read failed on this page only. Page one said it was fine.
        body_signal: {
          ...readable,
          capture_readable: false,
          miss_reason: "capture_unreadable",
        },
        next_cursor: null,
      },
    });
    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );
    expect(out).toMatchObject({ kind: "complete", pages: 2 });
    // ANDed, not last-write-wins and not first-page-wins.
    expect(out?.bodySignal?.capture_readable).toBe(false);
    expect(out?.bodySignal?.artifact_surface_readable).toBe(true);
    expect(out?.bodySignal?.miss_reason).toBe("capture_unreadable");
  });

  it("a partial walk still reports the pages it DID read", async () => {
    const { get } = scripted({
      first: {
        order: "authored_desc",
        work_units: fullPage("a"),
        body_signal: { ...readable, miss_reason: "capture_off" },
        next_cursor: {
          after_authored_at: "2026-09-01T00:00:00Z",
          after_slug: "a-499",
        },
      },
      "a-499": new Error("coord blipped"),
    });
    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "authored_desc",
      always
    );
    expect(out).toMatchObject({ kind: "partial", reason: "error" });
    expect(out?.bodySignal?.miss_reason).toBe("capture_off");
  });

  it("a backend that predates the signals reports null, never a block of falses", async () => {
    const { get } = scripted({ first: { work_units: [row("a")] } });
    const out = await walkWorkUnits(
      get,
      "/api/plans",
      base(),
      "updated_desc",
      always
    );
    expect(out?.bodySignal).toBeNull();
  });
});
