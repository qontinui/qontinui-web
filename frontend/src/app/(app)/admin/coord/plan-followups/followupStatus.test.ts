/**
 * `followupStatus` — the follow-up queue's three properties.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4c.
 */

import { describe, expect, it } from "vitest";
import {
  EXPECTED_ORDERING,
  type OpenFollowupResponse,
  deriveFollowupHealth,
  describeFollowupWindow,
} from "./followupStatus";

function response(
  over: Partial<OpenFollowupResponse> = {}
): OpenFollowupResponse {
  return {
    items: [
      {
        edge_id: "e1",
        from_id: "a1",
        from_kind: "plan",
        from_slug: "2026-08-16-plan-corpus-authority",
        from_title: "Plan corpus authority",
        note: "A long finding that has no other home.",
        created_at: "2026-08-20T00:00:00Z",
        age_days: 31,
      },
    ],
    count: 1,
    total: 9,
    offset: 0,
    limit: 50,
    ordering: "oldest_first",
    ...over,
  };
}

describe("the window reports the declared ordering", () => {
  it("carries it, and does not flag the expected value", () => {
    const w = describeFollowupWindow(response());
    expect(w.ordering).toBe(EXPECTED_ORDERING);
    expect(w.orderingUnexpected).toBe(false);
    expect(w.hasMore).toBe(true);
  });

  it("flags an ordering this build does not expect", () => {
    // Not an error — a statement that "the first row is the oldest" is no
    // longer warranted by anything the route said.
    const w = describeFollowupWindow(response({ ordering: "newest_first" }));
    expect(w.orderingUnexpected).toBe(true);
  });

  it("does not flag an ABSENT ordering as a changed one", () => {
    const w = describeFollowupWindow(response({ ordering: undefined }));
    expect(w.ordering).toBeNull();
    expect(w.orderingUnexpected).toBe(false);
  });

  it("reads an unserved total as UNKNOWN, never as items.length", () => {
    const w = describeFollowupWindow(response({ total: undefined }));
    expect(w.total).toBeNull();
    // A full page still infers "more"; a short one does not.
    expect(w.hasMore).toBe(false);
  });
});

describe("the strip", () => {
  it("dashes both counts before the route answers", () => {
    const health = deriveFollowupHealth(null, false, true);
    expect(health.headline).toMatch(/unknown, not empty/i);
    expect(health.badges.map((b) => b.label)).toEqual(["open –", "oldest –"]);
  });

  it("never goes red — a deferred follow-up is not an incident", () => {
    expect(
      deriveFollowupHealth(response({ total: 400 }), true, false).level
    ).toBe("green");
  });

  it("says an empty queue means nothing is UNOWNED", () => {
    const health = deriveFollowupHealth(
      response({ items: [], count: 0, total: 0 }),
      true,
      false
    );
    expect(health.detail).toMatch(/not deleted/);
    expect(health.detail).toMatch(/nothing is UNOWNED/);
  });

  it("withdraws the oldest reading when the route declares another ordering", () => {
    // The page already renders "nothing here warrants reading the first row
    // as the oldest" for this response. The strip used to print `oldest 31d`
    // beside it — one half of the page retracting the claim the other makes.
    const health = deriveFollowupHealth(
      response({ ordering: "newest_first" }),
      true,
      false
    );
    const oldest = health.badges.find((b) => b.key === "oldest");
    expect(oldest?.label).toBe("oldest –");
    expect(oldest?.title).toMatch(/newest_first/);
  });

  it("keeps the reading when the ordering is ABSENT — absence is not a change", () => {
    const health = deriveFollowupHealth(
      response({ ordering: undefined }),
      true,
      false
    );
    expect(health.badges.find((b) => b.key === "oldest")?.label).toBe(
      "oldest 31d"
    );
  });

  it("is not green on a failed refresh, whatever the detail says", () => {
    const health = deriveFollowupHealth(response(), true, true);
    expect(health.level).toBe("amber");
    expect(health.detail).toMatch(/stale/i);
  });

  it("measures the oldest row only on the first page", () => {
    expect(
      deriveFollowupHealth(response(), true, false).badges.find(
        (b) => b.key === "oldest"
      )?.label
    ).toBe("oldest 31d");
    expect(
      deriveFollowupHealth(response({ offset: 50 }), true, false).badges.find(
        (b) => b.key === "oldest"
      )?.label
    ).toBe("oldest –");
  });
});
