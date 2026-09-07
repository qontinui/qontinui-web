/**
 * The `loosening` mark and its ordering (plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`, Phase 4).
 *
 * The field is served by a coord change that lands separately from this page,
 * so the ABSENT case is the shipping case for a while — and absent must behave
 * as "this server does not classify", never as an authoritative `false`. Those
 * two readings look identical until the surface tries to say "nothing here
 * widens authority", which is a claim only the first one earns.
 */

import { describe, it, expect } from "vitest";
import {
  isLoosening,
  countLooseningVerdicts,
  hasLooseningVerdict,
  looseningClassificationPresent,
  notificationHref,
  sortWritesForFeed,
} from "./writes";

describe("isLoosening", () => {
  it("marks only an explicit true", () => {
    expect(isLoosening({ loosening: true })).toBe(true);
  });

  it("does not mark false, null or an ABSENT field", () => {
    expect(isLoosening({ loosening: false })).toBe(false);
    expect(isLoosening({ loosening: null })).toBe(false);
    expect(isLoosening({})).toBe(false);
    expect(isLoosening({ loosening: undefined })).toBe(false);
  });
});

describe("hasLooseningVerdict", () => {
  it("is true for BOTH explicit verdicts — it asks whether coord answered", () => {
    // The distinction from `isLoosening`, which asks which way coord answered.
    expect(hasLooseningVerdict({ loosening: true })).toBe(true);
    expect(hasLooseningVerdict({ loosening: false })).toBe(true);
  });

  it("is false for null and for an ABSENT field", () => {
    // `null` is forwarded verbatim by the proxy and is explicitly not a
    // verdict — the one spelling that looks like it agrees with the layer
    // below and does not.
    expect(hasLooseningVerdict({ loosening: null })).toBe(false);
    expect(hasLooseningVerdict({})).toBe(false);
    expect(hasLooseningVerdict({ loosening: undefined })).toBe(false);
  });
});

describe("countLooseningVerdicts", () => {
  it("counts both verdicts and nothing else", () => {
    expect(
      countLooseningVerdicts([
        { loosening: true },
        { loosening: false },
        { loosening: null },
        {},
      ])
    ).toBe(2);
  });

  it("is 0 on the pre-classification feed", () => {
    expect(countLooseningVerdicts([{}, {}])).toBe(0);
  });

  it("agrees with looseningClassificationPresent by construction", () => {
    // They are one predicate, not two: the count is what the boolean is built
    // from, so a page cannot decide whether to speak off one and what to say
    // off the other.
    const mixed = [{}, { loosening: false }, { loosening: null }];
    expect(countLooseningVerdicts(mixed) > 0).toBe(
      looseningClassificationPresent(mixed)
    );
    expect(countLooseningVerdicts([])).toBe(0);
    expect(looseningClassificationPresent([])).toBe(false);
  });
});

describe("looseningClassificationPresent", () => {
  it("is false when NO row carries the field — the pre-coord-deploy shape", () => {
    // The distinction that matters: this must not be reported as "classified,
    // and none was a loosening".
    expect(looseningClassificationPresent([{}, {}, {}])).toBe(false);
    expect(
      looseningClassificationPresent([{ loosening: undefined }, {}])
    ).toBe(false);
  });

  it("is true when a row carries an explicit FALSE", () => {
    // A classifier-aware coord saying "not a loosening" is a served verdict,
    // and the surface may then say so.
    expect(looseningClassificationPresent([{}, { loosening: false }])).toBe(
      true
    );
  });

  it("is true when a row carries an explicit true", () => {
    expect(looseningClassificationPresent([{ loosening: true }])).toBe(true);
  });

  it("is false for an empty feed — nothing was served either way", () => {
    expect(looseningClassificationPresent([])).toBe(false);
  });
});

describe("sortWritesForFeed", () => {
  it("lifts flagged rows to the top", () => {
    const sorted = sortWritesForFeed([
      { id: "a", loosening: false },
      { id: "b", loosening: true },
      { id: "c" },
      { id: "d", loosening: true },
    ]);
    expect(sorted.map((w) => w.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("preserves the server's newest-first order INSIDE each group", () => {
    // The backend already sorted by `created_at` descending. Re-sorting here
    // would re-derive an ordering the server owns; the partition must be
    // stable so the two groups each stay newest-first.
    const sorted = sortWritesForFeed([
      { id: "newest" },
      { id: "middle" },
      { id: "oldest" },
    ]);
    expect(sorted.map((w) => w.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("leaves an unclassified feed in exactly the order it arrived", () => {
    // The shipping case until coord's half lands: no field anywhere, so the
    // sort must be a no-op rather than a shuffle.
    const input = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(sortWritesForFeed(input).map((w) => w.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [{ id: "a" }, { id: "b", loosening: true }];
    sortWritesForFeed(input);
    expect(input.map((w) => w.id)).toEqual(["a", "b"]);
  });
});

describe("notificationHref", () => {
  it("returns null for an absent or blank ref — no link, not a broken one", () => {
    expect(notificationHref(undefined)).toBeNull();
    expect(notificationHref(null)).toBeNull();
    expect(notificationHref("")).toBeNull();
    expect(notificationHref("   ")).toBeNull();
  });

  it("deep links into the EXISTING notifications feed, encoded", () => {
    expect(notificationHref("abc-123")).toBe(
      "/admin/coord/notifications?ref=abc-123"
    );
    // A ref carrying a `&` or `#` must address the param, not reshape the URL.
    expect(notificationHref("a&b#c")).toBe(
      "/admin/coord/notifications?ref=a%26b%23c"
    );
  });
});
