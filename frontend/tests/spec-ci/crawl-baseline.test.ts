import { describe, expect, it } from "vitest";
import {
  GLOBAL_SERVER_WAIVERS,
  applyCrawlWaivers,
  isGloballyWaivedServerUrl,
} from "./crawl-baseline";
import type { ServerErrorEntry } from "./server-error-policy";

/**
 * The global same-origin-5xx waivers decide what the Spec CI gate lets
 * through for every PR, so the matcher is tested in BOTH directions: what it
 * waives, and — the half that matters more — what it still lets gate.
 *
 * A waiver that exists because an upstream is absent in CI must not become a
 * waiver for a real bug on the same URLs. A URL substring cannot tell those
 * apart; a status can.
 */

const OVERVIEW = "http://localhost:3001/api/v1/overview/settings";
const OVERVIEW_ESTIMATES = "http://localhost:3001/api/v1/overview/estimates";
/** A pattern-only entry, predating `statuses`. */
const OPERATIONS = "http://localhost:3001/api/v1/operations/plans";

function entry(url: string, status: number): ServerErrorEntry {
  return {
    specId: "crawl",
    transitionId: null,
    url,
    status,
    method: "GET",
    ts: 0,
  };
}

describe("isGloballyWaivedServerUrl — a status-scoped entry", () => {
  it("waives the statuses a missing coord produces", () => {
    // coord_identity._fetch_identity: connect error -> 502, timeout -> 504.
    expect(isGloballyWaivedServerUrl(OVERVIEW, 502)).toBe(true);
    expect(isGloballyWaivedServerUrl(OVERVIEW, 504)).toBe(true);
    expect(isGloballyWaivedServerUrl(OVERVIEW_ESTIMATES, 502)).toBe(true);
  });

  it("still GATES a 500 on the same URL", () => {
    // The point of the field. A 500 here is a crash in first-party code,
    // not an absent upstream, and a blanket substring waiver would hide it.
    expect(isGloballyWaivedServerUrl(OVERVIEW, 500)).toBe(false);
    expect(isGloballyWaivedServerUrl(OVERVIEW_ESTIMATES, 500)).toBe(false);
  });

  it("still gates every other 5xx not listed", () => {
    for (const status of [501, 503, 505, 599]) {
      expect(isGloballyWaivedServerUrl(OVERVIEW, status), String(status)).toBe(
        false
      );
    }
  });
});

describe("isGloballyWaivedServerUrl — the overview pattern is anchored", () => {
  it("matches the API path on any same-origin host and port", () => {
    for (const url of [
      "http://localhost:3001/api/v1/overview/settings",
      "http://127.0.0.1:3013/api/v1/overview/estimates/abc/rollup",
      "https://qontinui.io/api/v1/overview/estimates",
    ]) {
      expect(isGloballyWaivedServerUrl(url, 502), url).toBe(true);
    }
  });

  it("does not match the path when it only appears in a query value", () => {
    // A bare substring would: `fetch` does not encode `/` inside a query.
    expect(
      isGloballyWaivedServerUrl(
        "http://localhost:3001/api/v1/projects?next=/api/v1/overview/settings",
        502
      )
    ).toBe(false);
  });

  it("does not match the page route or a different API family", () => {
    for (const url of [
      "http://localhost:3001/overview/team",
      "http://localhost:3001/api/v1/admin-dev/overview",
      "http://localhost:3001/api/v2/overview/settings",
    ]) {
      expect(isGloballyWaivedServerUrl(url, 502), url).toBe(false);
    }
  });
});

describe("isGloballyWaivedServerUrl — a pattern-only entry", () => {
  it("waives ANY 5xx, exactly as before the field existed", () => {
    // No existing entry was changed; absent `statuses` keeps the old
    // behaviour.
    for (const status of [500, 502, 503, 504]) {
      expect(
        isGloballyWaivedServerUrl(OPERATIONS, status),
        String(status)
      ).toBe(true);
    }
  });
});

describe("isGloballyWaivedServerUrl — no waiver at all", () => {
  it("gates a 5xx on a URL no entry covers", () => {
    expect(
      isGloballyWaivedServerUrl("http://localhost:3001/api/v1/projects", 502)
    ).toBe(false);
  });
});

describe("applyCrawlWaivers — the crawl lane uses the same rule", () => {
  it("keeps a 500 and drops a 502 on the same overview route", () => {
    // Both lanes (the spec lane via isGloballyWaivedServerUrl, the crawl lane
    // via applyCrawlWaivers) must agree, or a real bug gates in one and not
    // the other.
    const { unwaivedServer } = applyCrawlWaivers(
      "/overview/team",
      [],
      [
        entry(OVERVIEW, 502),
        entry(OVERVIEW_ESTIMATES, 504),
        entry(OVERVIEW, 500),
      ]
    );
    expect(unwaivedServer.map((e) => e.status)).toEqual([500]);
  });

  it("still drops any 5xx from a pattern-only entry", () => {
    const { unwaivedServer } = applyCrawlWaivers(
      "/admin/coord/plans",
      [],
      [entry(OPERATIONS, 500), entry(OPERATIONS, 502)]
    );
    expect(unwaivedServer).toEqual([]);
  });
});

describe("GLOBAL_SERVER_WAIVERS — the registry itself", () => {
  it("lists only server-error statuses in any `statuses` field", () => {
    // A 4xx here would be dead: the gate only ever records same-origin 5xx.
    for (const waiver of GLOBAL_SERVER_WAIVERS) {
      for (const status of waiver.statuses ?? []) {
        expect(status >= 500 && status <= 599, waiver.pattern).toBe(true);
      }
    }
  });

  it("never lists an empty `statuses`, which would waive nothing", () => {
    // `statuses: []` reads like a restriction and silently waives no status
    // at all — an entry that looks active and is not.
    for (const waiver of GLOBAL_SERVER_WAIVERS) {
      if (waiver.statuses !== undefined) {
        expect(waiver.statuses.length, waiver.pattern).toBeGreaterThan(0);
      }
    }
  });

  it("scopes the overview entry to exactly 502 and 504", () => {
    const overview = GLOBAL_SERVER_WAIVERS.find((w) =>
      w.pattern.includes("/api/v1/overview/")
    );
    expect(overview?.statuses).toEqual([502, 504]);
  });
});
