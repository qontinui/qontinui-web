/**
 * The live snapshot's element-type counts: ranked, tie-broken, and never
 * losing an element it cannot classify.
 */

import { describe, expect, it } from "vitest";
import { elementTypeCounts } from "./snapshotReading";

describe("elementTypeCounts", () => {
  it("is empty for a snapshot that holds no elements", () => {
    expect(elementTypeCounts([])).toEqual([]);
  });

  it("counts one element under its type", () => {
    expect(elementTypeCounts([{ id: "save", type: "button" }])).toEqual([
      { type: "button", count: 1 },
    ]);
  });

  it("ranks the types most first, breaking a tie alphabetically", () => {
    const elements = [
      { type: "link" },
      { type: "button" },
      { type: "input" },
      { type: "button" },
      { type: "link" },
      { type: "button" },
    ];
    expect(elementTypeCounts(elements)).toEqual([
      { type: "button", count: 3 },
      { type: "link", count: 2 },
      { type: "input", count: 1 },
    ]);
    // Ties stay in one order whatever order the runner listed them in.
    expect(
      elementTypeCounts([
        { type: "tab" },
        { type: "heading" },
        { type: "card" },
      ])
    ).toEqual([
      { type: "card", count: 1 },
      { type: "heading", count: 1 },
      { type: "tab", count: 1 },
    ]);
  });

  it("counts an element with no readable type as untyped instead of dropping it", () => {
    const counts = elementTypeCounts([
      { type: "button" },
      { id: "no-type" },
      { type: "   " },
      { type: 7 },
      "not an element",
      null,
      ["also", "not"],
    ]);
    expect(counts).toEqual([
      { type: "untyped", count: 6 },
      { type: "button", count: 1 },
    ]);
    // Every element read is in the counts.
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(7);
  });

  it("reads a type with surrounding space as that type", () => {
    expect(
      elementTypeCounts([{ type: " button " }, { type: "button" }])
    ).toEqual([{ type: "button", count: 2 }]);
  });
});
