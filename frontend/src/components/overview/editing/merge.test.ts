import { describe, expect, it } from "vitest";
import { threeWayMerge } from "./merge";

const KEYS = ["a", "b", "c", "d"] as const;
type Rec = { a: string; b: string; c: string; d: string[] };

describe("threeWayMerge", () => {
  const base: Rec = { a: "base", b: "base", c: "base", d: ["x"] };

  it("takes theirs where I changed nothing, mine where only I did", () => {
    const mine: Rec = { ...base, a: "mine" };
    const theirs: Rec = { ...base, b: "theirs" };
    expect(threeWayMerge(base, mine, theirs, KEYS)).toEqual({
      merged: { a: "mine", b: "theirs", c: "base", d: ["x"] },
      mineOnly: ["a"],
      both: [],
    });
  });

  it("keeps mine where we both changed a field, and names it", () => {
    const mine: Rec = { ...base, c: "mine", d: ["y"] };
    const theirs: Rec = { ...base, c: "theirs", d: ["y"] };
    const result = threeWayMerge(base, mine, theirs, KEYS);
    expect(result.merged.c).toBe("mine");
    // The same change on both sides is no conflict, and nothing to write.
    expect(result.both).toEqual(["c"]);
    expect(result.mineOnly).toEqual([]);
  });

  it("leaves fields outside `keys` as theirs", () => {
    const mine: Rec = { ...base, a: "mine" };
    const theirs: Rec = { ...base, a: "theirs" };
    expect(threeWayMerge(base, mine, theirs, ["b"]).merged.a).toBe("theirs");
  });
});
