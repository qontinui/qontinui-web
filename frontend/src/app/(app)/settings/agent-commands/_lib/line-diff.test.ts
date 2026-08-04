import { describe, expect, it } from "vitest";
import {
  collapseContext,
  computeLineDiff,
  type DiffLine,
  type ElidedRun,
} from "./line-diff";

function isElided(entry: DiffLine | ElidedRun): entry is ElidedRun {
  return "elided" in entry;
}

describe("computeLineDiff", () => {
  it("reports identical bodies with no changes", () => {
    const result = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(result.identical).toBe(true);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.lines.every((l) => l.op === "context")).toBe(true);
  });

  it("aligns an inserted line instead of shifting every later line", () => {
    const result = computeLineDiff("a\nb", "a\nX\nb");
    expect(result.added).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.lines.map((l) => l.op)).toEqual([
      "context",
      "add",
      "context",
    ]);
  });

  it("aligns a removed line", () => {
    const result = computeLineDiff("a\nX\nb", "a\nb");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(1);
    expect(result.lines.map((l) => l.op)).toEqual([
      "context",
      "remove",
      "context",
    ]);
  });

  it("renders a replacement as remove + add with the right line numbers", () => {
    const result = computeLineDiff("a\nold\nc", "a\nnew\nc");
    const change = result.lines.filter((l) => l.op !== "context");
    expect(change).toHaveLength(2);
    expect(change[0]).toMatchObject({
      op: "remove",
      leftNumber: 2,
      rightNumber: null,
      text: "old",
    });
    expect(change[1]).toMatchObject({
      op: "add",
      leftNumber: null,
      rightNumber: 2,
      text: "new",
    });
  });

  it("treats CRLF and LF bodies as the same lines", () => {
    const result = computeLineDiff("a\r\nb", "a\nb");
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("handles an empty side", () => {
    const result = computeLineDiff("", "a\nb");
    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.identical).toBe(false);
  });

  it("does not claim degradation for ordinary bodies", () => {
    const body = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    expect(computeLineDiff(body, `${body}\nextra`).degraded).toBe(false);
  });
});

describe("collapseContext", () => {
  it("elides long unchanged runs but keeps padding around a change", () => {
    const left = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const right = left.replace("line 20", "line 20 changed");

    const collapsed = collapseContext(computeLineDiff(left, right).lines, 2);

    expect(collapsed.filter(isElided)).toHaveLength(2);
    expect(collapsed.length).toBeLessThan(41);
    // The changed pair plus 2 lines of padding on each side survive.
    const kept = collapsed.filter(
      (entry): entry is DiffLine => !isElided(entry)
    );
    expect(kept.some((l) => l.text === "line 20 changed")).toBe(true);
    expect(kept.some((l) => l.text === "line 18")).toBe(true);
  });

  it("returns everything when every line changed", () => {
    const collapsed = collapseContext(computeLineDiff("a", "b").lines, 3);
    expect(collapsed.filter(isElided)).toHaveLength(0);
  });
});
