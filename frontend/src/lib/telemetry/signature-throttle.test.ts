import { describe, expect, it } from "vitest";

import { createSignatureThrottle } from "./signature-throttle";

describe("createSignatureThrottle", () => {
  it("admits a signature once per window", () => {
    const t = createSignatureThrottle({ windowMs: 1_000, max: 10 });
    expect(t.admit("a", 0)).toBe(true);
    expect(t.admit("a", 999)).toBe(false);
    expect(t.admit("a", 1_000)).toBe(true);
  });

  it("never remembers more than `max` signatures, evicting the oldest", () => {
    const t = createSignatureThrottle({ windowMs: 60_000, max: 200 });
    for (let i = 0; i <= 200; i++) expect(t.admit(`sig-${i}`, i)).toBe(true);
    expect(t.size()).toBe(200);
    // sig-0 was the oldest and was evicted, so it is admitted again…
    expect(t.admit("sig-0", 300)).toBe(true);
    // …while a recent one is still throttled.
    expect(t.admit("sig-200", 300)).toBe(false);
    expect(t.size()).toBe(200);
  });

  it("evicts expired entries before live ones", () => {
    const t = createSignatureThrottle({ windowMs: 100, max: 3 });
    t.admit("old", 0);
    t.admit("b", 150);
    t.admit("c", 160);
    t.admit("d", 170); // over the bound: "old" has expired and goes first
    expect(t.size()).toBe(3);
    expect(t.admit("b", 171)).toBe(false);
  });
});
