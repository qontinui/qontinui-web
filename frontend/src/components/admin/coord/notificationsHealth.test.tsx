/**
 * The `/admin/coord/notifications` health strip, audited.
 *
 * Phase 3 Wave 5 (qontinui-web#1036) shipped three derivation modules and gave
 * two of them a sibling unit test — `clearanceRuleStatus.test.ts` and
 * `proposalStatus.test.ts`. `notificationsHealth.tsx` is the third, and it is
 * the one whose contract is hardest to see from the page test: every claim it
 * makes is a SENTENCE, and a sentence that is confidently wrong looks exactly
 * like a sentence that is right.
 *
 * The two things pinned here, both stated by that module's own doc and neither
 * previously covered:
 *
 * 1. **A backlog is never amber or red.** This is an append-only EVENT feed, so
 *    an unread row blocks nobody and decays into nothing. Amber would promise
 *    something else clears it; red would claim "act now". Both are false, and
 *    the instinct to paint N-unread amber is strong enough that only a test
 *    stops it coming back.
 *
 * 2. **Every unknown is amber, and says which one it is** — including the one
 *    the first cut of the module got wrong: a read that SUCCEEDED without
 *    carrying `unread_count`. `loaded && unreadCount === null` is reachable
 *    (`page.tsx`'s `applyEnvelope` only writes a scalar `if (typeof … ===
 *    "number")` while `setLoaded(true)` fires on any successful GET), and the
 *    original `unreadCount ?? 0` turned it into a green "Nothing unread"
 *    headline beside a `–` badge.
 *
 * The badges are asserted through the FROZEN authored testids
 * (`coord-notifications-unread-count`, `coord-notifications-total`, D4a) rather
 * than by array position, so a reordering is not a failure and a dropped testid
 * is.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { HealthStrip } from "@/components/console";
import {
  deriveNotificationsHealth,
  type NotificationsHealthInput,
} from "./notificationsHealth";

/** The healthy baseline: coord answered, with both scalars. */
function input(
  over: Partial<NotificationsHealthInput> = {}
): NotificationsHealthInput {
  return {
    unreadCount: 0,
    total: 0,
    loaded: true,
    migrationPending: false,
    failed: false,
    ...over,
  };
}

/**
 * Both badge labels as an operator reads them.
 *
 * Rendered rather than read off the object: `label` is a ReactNode, and what
 * this module promises is what is on SCREEN — including that `<>– unread</>`
 * produces a real en dash rather than an empty string. One render per call, and
 * one call per test, so two lookups never collide on the same testid.
 */
function badgesOf(result: ReturnType<typeof deriveNotificationsHealth>): {
  unread: string;
  total: string;
} {
  render(
    <HealthStrip
      level={result.level}
      headline={result.headline}
      detail={result.detail}
      badges={result.badges}
      data-testid="coord-notifications-health"
    />
  );
  return {
    unread:
      screen.getByTestId("coord-notifications-unread-count").textContent ?? "",
    total: screen.getByTestId("coord-notifications-total").textContent ?? "",
  };
}

describe("deriveNotificationsHealth — a backlog is not an emergency", () => {
  it("stays GREEN with a large unread backlog", () => {
    // The whole point of the module. An event nobody is blocked on does not get
    // to spend amber, however many of them there are.
    const h = deriveNotificationsHealth(input({ unreadCount: 137, total: 900 }));
    expect(h.level).toBe("green");
    expect(h.headline).toBe("137 unread events");
    expect(h.detail).toMatch(/nothing is blocked by these/);
  });

  it("says 'event' not 'events' for exactly one", () => {
    expect(deriveNotificationsHealth(input({ unreadCount: 1 })).headline).toBe(
      "1 unread event"
    );
  });

  it("is GREEN and explicit when there is genuinely nothing unread", () => {
    const h = deriveNotificationsHealth(input({ unreadCount: 0, total: 42 }));
    expect(h.level).toBe("green");
    expect(h.headline).toBe("Nothing unread");
    // `0` is a real answer — "we looked and there is nothing" — and is allowed
    // to be stated confidently. `–` is what the module owes for a count it
    // does not have.
    const badges = badgesOf(h);
    expect(badges.unread).toBe("0 unread");
    expect(badges.total).toBe("42 total");
  });
});

describe("deriveNotificationsHealth — every unknown is amber, and says which", () => {
  it("AMBER while coord has the routes but not the table", () => {
    const h = deriveNotificationsHealth(
      input({ migrationPending: true, loaded: false })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/not available yet/);
    expect(h.detail).toMatch(/not an error/);
  });

  it("AMBER after a failed read, and never a count", () => {
    const h = deriveNotificationsHealth(input({ failed: true, loaded: false }));
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/Could not read/);
    expect(badgesOf(h).unread).toBe("– unread");
  });

  it("AMBER before the first answer", () => {
    const h = deriveNotificationsHealth(
      input({ loaded: false, unreadCount: null, total: null })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/Waiting for coord/);
  });

  it("holds the dash even when a STALE count is still in state", () => {
    // `page.tsx` keeps the previous scalars when a poll fails — deliberately,
    // so the list does not blank. The strip must not re-report them as current:
    // "137 unread" beside "Could not read the feed" is a claim about a read
    // that did not happen.
    const h = deriveNotificationsHealth(
      input({ failed: true, loaded: false, unreadCount: 137, total: 900 })
    );
    const badges = badgesOf(h);
    expect(badges.unread).toBe("– unread");
    expect(badges.total).toBe("– total");
  });

  it("AMBER when the read SUCCEEDED but carried no unread count", () => {
    // The regression this test exists for. `unreadCount ?? 0` made this state
    // render green with "Nothing unread" / "you have seen everything coord
    // recorded" — beside a badge that correctly said `–`. Two claims, one
    // strip, and the confident one was false.
    const h = deriveNotificationsHealth(
      input({ loaded: true, unreadCount: null, total: 900 })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).not.toMatch(/Nothing unread/);
    expect(h.detail).toMatch(/UNKNOWN, not zero/);
  });

  it("still reports the total it DOES hold when only unread is missing", () => {
    // The two scalars are independent. Falling back to a shared "both unknown"
    // badge pair would throw away a number coord actually sent.
    const h = deriveNotificationsHealth(
      input({ loaded: true, unreadCount: null, total: 900 })
    );
    const badges = badgesOf(h);
    expect(badges.total).toBe("900 total");
    expect(badges.unread).toBe("– unread");
  });

  it("reports the unread count it DOES hold when only the total is missing", () => {
    // The mirror. A missing `total` is not a reason to disclaim the unread
    // count, and it does not cost the strip its green.
    const h = deriveNotificationsHealth(
      input({ loaded: true, unreadCount: 3, total: null })
    );
    expect(h.level).toBe("green");
    const badges = badgesOf(h);
    expect(badges.unread).toBe("3 unread");
    expect(badges.total).toBe("– total");
  });
});

describe("the strip's contract with the page", () => {
  it("emits BOTH frozen testids in every branch, unknown ones included", () => {
    // D4a: these two ids moved off the deleted `<CardTitle>` badges onto the
    // strip. A branch that omits one answers "there is no such count", which is
    // a third answer this page is not allowed to give.
    const branches: NotificationsHealthInput[] = [
      input({ migrationPending: true, loaded: false }),
      input({ failed: true, loaded: false }),
      input({ loaded: false, unreadCount: null, total: null }),
      input({ loaded: true, unreadCount: null, total: null }),
      input({ unreadCount: 137, total: 900 }),
      input({ unreadCount: 0, total: 0 }),
    ];
    for (const branch of branches) {
      const keys = deriveNotificationsHealth(branch).badges.map(
        (b) => b["data-testid"]
      );
      expect(keys).toEqual([
        "coord-notifications-unread-count",
        "coord-notifications-total",
      ]);
    }
  });

  it("renders through <HealthStrip> under the page's own testid", () => {
    // `coord-notifications-health` is the handle the page hangs on the strip;
    // nothing asserted it before. `data-health-level` is what makes the
    // green/amber decisions above observable from a page or e2e test.
    const h = deriveNotificationsHealth(input({ unreadCount: 137, total: 900 }));
    render(
      <HealthStrip
        level={h.level}
        headline={h.headline}
        detail={h.detail}
        badges={h.badges}
        data-testid="coord-notifications-health"
      />
    );
    expect(screen.getByTestId("coord-notifications-health")).toHaveAttribute(
      "data-health-level",
      "green"
    );
  });
});
