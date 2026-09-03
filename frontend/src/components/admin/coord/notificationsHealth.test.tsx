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
 * 2. **Every unknown is amber, and says which one it is** — including the two
 *    the first cut of the module got wrong, in opposite directions:
 *
 *      - a read that SUCCEEDED without carrying `unread_count`.
 *        `loaded && unreadCount === null` is reachable (`page.tsx`'s
 *        `applyEnvelope` only writes a scalar `if (typeof … === "number")`
 *        while `setLoaded(true)` fires on any successful GET), and the original
 *        `unreadCount ?? 0` turned it into a green "Nothing unread" headline
 *        beside a `–` badge — a FABRICATED fact;
 *      - counts left standing by a poll that stopped succeeding. The old input
 *        said `failed` only when nothing had ever loaded, so the common case on
 *        a 10s poller — good first load, then failures — kept a green
 *        "137 unread events" above the page's own "Failed to load…" line: a
 *        STALE fact reported as current.
 *
 * The badges are asserted through the FROZEN authored testids
 * (`coord-notifications-unread-count`, `coord-notifications-total`, D4a), so a
 * dropped or renamed testid fails here rather than silently in a spec nobody
 * runs. The one place order IS asserted says so at its call site.
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
    // Spelled out rather than left to the `Partial` spread: TypeScript accepts
    // the omission (a spread of a Partial widens the result), so an unstated
    // field would sit here as `undefined` and pass every test by being falsy —
    // a baseline nobody chose.
    scalarStale: false,
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

  it("dashes both counts when NOTHING was ever read, whatever is in state", () => {
    // Defensive: the page cannot currently reach `failed && !loaded` with
    // scalars set, because both are only ever written beside `setLoaded(true)`.
    // The arm is still asserted with them populated, because "nothing was ever
    // read" must not depend on a caller having also cleared its state — the
    // dash is owed by THIS branch, not by the page's bookkeeping.
    const h = deriveNotificationsHealth(
      input({ failed: true, loaded: false, unreadCount: 137, total: 900 })
    );
    expect(h.headline).toMatch(/Could not read/);
    const badges = badgesOf(h);
    expect(badges.unread).toBe("– unread");
    expect(badges.total).toBe("– total");
  });

  it("AMBER, with the REAL numbers, when a poll fails after a good load", () => {
    // The second half of the unknown-vs-stale split, and the state a 10s
    // poller spends most of its bad time in. These counts are real — they came
    // from a read that worked — so they are shown; what they are not is
    // CURRENT, and only the strip can say so. Reporting them under a green
    // light beside the page's own "Failed to load…" line is the same
    // over-claim as `?? 0`, made with a stale fact instead of a made-up one.
    const h = deriveNotificationsHealth(
      input({ failed: true, loaded: true, unreadCount: 137, total: 900 })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/stopped updating/);
    expect(h.detail).toMatch(/UNKNOWN/);
    const badges = badgesOf(h);
    expect(badges.unread).toBe("137 unread");
    expect(badges.total).toBe("900 total");
  });

  it("un-stales itself when the poll recovers", () => {
    // `failed` is the state of the LAST read, not a latch. A recovered poll
    // must return the strip to green without a reload, or the amber becomes
    // background noise operators learn to ignore.
    const h = deriveNotificationsHealth(
      input({ failed: false, loaded: true, unreadCount: 137, total: 900 })
    );
    expect(h.level).toBe("green");
    expect(h.headline).toBe("137 unread events");
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

describe("which unknown wins when several are true at once", () => {
  // Order is a real decision, not an artefact of how the guards were typed:
  // each arm names a DIFFERENT cause, and naming the wrong one sends the
  // operator to the wrong place. These pin the order so a later insertion
  // cannot quietly re-rank them.

  it("migration-pending outranks everything — it explains all the rest", () => {
    // If coord has no table, then of course nothing was read and no count came
    // back. Reporting "the unread count did not come back" here would be true
    // and useless.
    const h = deriveNotificationsHealth(
      input({
        migrationPending: true,
        failed: true,
        loaded: true,
        unreadCount: null,
      })
    );
    expect(h.headline).toMatch(/not available yet/);
  });

  it("a failed read outranks a missing scalar", () => {
    // Both are true after a first read that answered without `unread_count`
    // and a second that failed. The failure is the actionable one — it names
    // something that stopped working, where the missing scalar names a shape.
    const h = deriveNotificationsHealth(
      input({ failed: true, loaded: true, unreadCount: null, total: 900 })
    );
    expect(h.headline).toMatch(/stopped updating/);
    // …and it still refuses to invent the count it does not have.
    expect(badgesOf(h).unread).toBe("– unread");
  });

  it("treats an undefined count exactly like a null one", () => {
    // The prop is typed `number | null`, so this is defensive — but the guard
    // and the badge helper must not disagree about what "absent" means, or the
    // original defect returns through the one spelling that slipped past.
    const h = deriveNotificationsHealth(
      input({ loaded: true, unreadCount: undefined as unknown as null })
    );
    expect(h.level).toBe("amber");
    expect(h.headline).not.toMatch(/Nothing unread/);
  });
});

describe("the strip's contract with the page", () => {
  it("will not call counts current when the feed stopped carrying them", () => {
    // The THIRD way a scalar goes uncurrent, and the one this module shipped
    // blind to. `failed` covers a read that did not land; the `unreadCount ==
    // null` arm covers a scalar that never arrived. Neither covers the pair in
    // between — a read that SUCCEEDED and brought no scalar while an earlier
    // one did — which `page.tsx` produces on its own, and which left the strip
    // painting green over a frozen number.
    const health = deriveNotificationsHealth(
      input({ unreadCount: 7, total: 900, scalarStale: true })
    );
    expect(health.level).toBe("amber");
    expect(health.headline).toBe("These counts stopped updating");
    // Its own sentence, not the failed read's: nothing here is failing, and
    // "the feed could not be re-read" would send an operator after an outage
    // that is not happening.
    expect(health.detail).toContain("the counts are no longer being refreshed");
    // Deliberately NOT "the feed no longer carries them": the scalar can also
    // have been delivered by the mark-read door, in which case the feed never
    // carried it at all and that phrasing presupposes a delivery that never
    // happened.
    expect(health.detail).not.toContain("the feed is answering");
    expect(health.detail).not.toContain("could not be re-read");
    // The number is real, so it is still shown — and not quotable elsewhere.
    expect(health.readIsCurrent).toBe(false);
    expect(badgesOf(health)).toEqual({ unread: "7 unread", total: "900 total" });
  });

  it("keeps the first scalar-less read CURRENT, which is what the name promises", () => {
    // The arm the `scalarStale` audit nearly deleted by shadowing, and the one
    // the `countsAreCurrent` -> `readIsCurrent` rename is argued from: a read
    // can be perfectly current and still carry a null scalar. If this returns
    // false, the published justification for the rename stops being true and
    // the sentence an operator sees changes to one presupposing an earlier
    // good read.
    const health = deriveNotificationsHealth(
      input({ unreadCount: null, total: 900 })
    );
    expect(health.readIsCurrent).toBe(true);
    expect(health.headline).toBe("The unread count did not come back");
    // One missing scalar does not make the other unknown.
    expect(badgesOf(health)).toEqual({ unread: "– unread", total: "900 total" });
  });

  it("ranks a FAILED read above a scalar-less one when both are true", () => {
    // Both are "the counts are frozen", and they want different sentences and
    // different remedies. A read that did not land is the bigger truth: the
    // feed being down subsumes the field being absent from an answer it never
    // gave.
    const health = deriveNotificationsHealth(
      input({ unreadCount: 7, total: 900, failed: true, scalarStale: true })
    );
    expect(health.detail).toContain("could not be re-read");
  });

  it("emits BOTH frozen testids in every branch, unknown ones included", () => {
    // D4a: these two ids moved off the deleted `<CardTitle>` badges onto the
    // strip. A branch that omits one answers "there is no such count", which is
    // a third answer this page is not allowed to give.
    const branches: NotificationsHealthInput[] = [
      input({ migrationPending: true, loaded: false }),
      input({ failed: true, loaded: false }),
      input({ failed: true, loaded: true, unreadCount: 137, total: 900 }),
      input({ scalarStale: true, loaded: true, unreadCount: 137, total: 900 }),
      // The combination that shipped the wrong sentence: reachable only if a
      // writer raises the flag on a FIRST scalar-less read, which is what the
      // page briefly did.
      input({ scalarStale: true, loaded: true, unreadCount: null, total: 900 }),
      input({ loaded: false, unreadCount: null, total: null }),
      input({ loaded: true, unreadCount: null, total: null }),
      input({ unreadCount: 137, total: 900 }),
      input({ unreadCount: 0, total: 0 }),
    ];
    for (const branch of branches) {
      const keys = deriveNotificationsHealth(branch).badges.map(
        (b) => b["data-testid"]
      );
      // Order IS asserted here, deliberately: unread reads before total on
      // every surface that shows both, and the strip is the only place left
      // that decides it.
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

  /**
   * `readIsCurrent` — the strip publishing what it already decided.
   *
   * The strip is the surface that decides whether coord's scalars may be quoted
   * as fact: it is what dashes the badges and what says "these counts stopped
   * updating". Other surfaces used to re-derive that with their own boolean —
   * the mark-all tooltip spelled it `!readFailed`, which is three of the four
   * ways a count can be unquotable — so the answer is published on the health
   * object instead. Pinned here as a truth table because the failure mode is a
   * consumer and the strip disagreeing while both look right.
   */
  describe("readIsCurrent", () => {
    it("is false in every arm where the badges are a dash", () => {
      // The three unknowns: no table, nothing ever read, and nothing read YET.
      expect(
        deriveNotificationsHealth(input({ migrationPending: true }))
          .readIsCurrent
      ).toBe(false);
      expect(
        deriveNotificationsHealth(input({ loaded: false, failed: true }))
          .readIsCurrent
      ).toBe(false);
      expect(
        deriveNotificationsHealth(input({ loaded: false })).readIsCurrent
      ).toBe(false);
    });

    it("is false for counts that are REAL but frozen", () => {
      // The stale arm renders coord's actual numbers — and still must not let
      // anything else spend them as current. Shown is not the same as quotable.
      const h = deriveNotificationsHealth(
        input({ unreadCount: 137, total: 900, failed: true })
      );
      expect(h.headline).toMatch(/stopped updating/i);
      expect(h.readIsCurrent).toBe(false);
    });

    it("stays false while the table is absent even after a good read", () => {
      // The arm the first cut missed. `migrationPending` after a successful
      // load leaves a real `unreadCount` standing with `failed` FALSE, so a
      // guard spelled `!failed` says "current" about a count the strip is
      // rendering as `–` two elements away.
      const h = deriveNotificationsHealth(
        input({ unreadCount: 137, total: 900, migrationPending: true })
      );
      expect(h.headline).toMatch(/not available yet/i);
      expect(badgesOf(h)).toEqual({ unread: "– unread", total: "– total" });
      expect(h.readIsCurrent).toBe(false);
    });

    it("is true once coord has answered, including without an unread count", () => {
      expect(
        deriveNotificationsHealth(input({ unreadCount: 137, total: 900 }))
          .readIsCurrent
      ).toBe(true);
      // A gap in the ENVELOPE is not a failure of the read: the count is
      // `null`, which already stops a consumer quoting it, and blaming the read
      // for it would report an outage that did not happen.
      expect(
        deriveNotificationsHealth(input({ unreadCount: null, total: 900 }))
          .readIsCurrent
      ).toBe(true);
    });
  });
});
