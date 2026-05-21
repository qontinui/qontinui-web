import { describe, it, expect } from "vitest";
import { groupAndCapSymbolClaims } from "./useSymbolClaimsStream";
import type { SymbolClaim } from "./types";

function claim(
  machine_id: string,
  resource_key: string,
  ttl_seconds: number,
): SymbolClaim {
  return { kind: "symbol", machine_id, resource_key, ttl_seconds };
}

/**
 * Unit tests for the group+cap+sort core of `useSymbolClaimsStream`.
 * The polling pump is thin glue; this pure function is where the
 * top-5-by-TTL-desc invariant lives (plan Phase 4.4).
 */
describe("groupAndCapSymbolClaims", () => {
  it("groups holders by machine_id", () => {
    const out = groupAndCapSymbolClaims([
      claim("m-a", "r:f:foo", 100),
      claim("m-b", "r:f:bar", 90),
      claim("m-a", "r:f:baz", 80),
    ]);
    expect(out.size).toBe(2);
    expect(out.get("m-a")).toHaveLength(2);
    expect(out.get("m-b")).toHaveLength(1);
  });

  it("sorts each group by ttl_seconds descending (freshest first)", () => {
    const out = groupAndCapSymbolClaims([
      claim("m-a", "r:f:low", 10),
      claim("m-a", "r:f:high", 290),
      claim("m-a", "r:f:mid", 150),
    ]);
    const ttls = out.get("m-a")!.map((c) => c.ttl_seconds);
    expect(ttls).toEqual([290, 150, 10]);
  });

  it("caps each group to top-5 by default", () => {
    const holders = Array.from({ length: 8 }, (_, i) =>
      claim("m-a", `r:f:sym${i}`, i * 10),
    );
    const out = groupAndCapSymbolClaims(holders);
    const list = out.get("m-a")!;
    expect(list).toHaveLength(5);
    // The 5 retained are the highest-TTL ones (70,60,50,40,30).
    expect(list.map((c) => c.ttl_seconds)).toEqual([70, 60, 50, 40, 30]);
  });

  it("respects a custom topN", () => {
    const holders = Array.from({ length: 4 }, (_, i) =>
      claim("m-a", `r:f:sym${i}`, i),
    );
    const out = groupAndCapSymbolClaims(holders, 2);
    expect(out.get("m-a")).toHaveLength(2);
  });

  it("returns an empty map for no holders", () => {
    expect(groupAndCapSymbolClaims([]).size).toBe(0);
  });
});
