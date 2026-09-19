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
    expect(overviewTotalFor(overview, "any")?.total).toBe(1800);
    expect(overviewTotalFor(overview, "draft")?.total).toBe(300);
  });
  it("an absent status is zero only when the facet was not truncated", () => {
    expect(overviewTotalFor(overview, "blocked")?.total).toBe(0);
    expect(
      overviewTotalFor(
        {
          ...overview,
          facets: { ...overview.facets, by_status_truncated: true },
        },
        "blocked"
      )
    ).toBeNull();
  });
  it("an unread overview is UNKNOWN, not zero", () => {
    expect(overviewTotalFor(null, "any")).toBeNull();
    expect(overviewTotalFor({}, "any")).toBeNull();
  });
});
