import { describe, it, expect } from "vitest";
import { diffLines } from "./diff";

/**
 * diffLines — the version-history diff engine (plan
 * 2026-07-17-session-autonomy-fabric Phase 9).
 *
 * The operator reads this diff to decide whether to restore an old version, so
 * it must be exact, not approximate: unchanged lines stay context (an edit to
 * one paragraph must not read as a whole-document rewrite), line numbers must
 * address BOTH sides honestly, and "no changes" must be distinguishable from
 * "everything changed".
 */

function texts(lines: ReturnType<typeof diffLines>["lines"], type: string) {
  return lines.filter((l) => l.type === type).map((l) => l.text);
}

describe("diffLines", () => {
  it("reports identical bodies as identical with no add/remove", () => {
    const { lines, stats } = diffLines("a\nb\nc", "a\nb\nc");
    expect(stats).toEqual({
      added: 0,
      removed: 0,
      identical: true,
      truncated: false,
    });
    expect(lines.every((l) => l.type === "context")).toBe(true);
  });

  it("keeps untouched lines as context when one line changes", () => {
    const { lines, stats } = diffLines(
      "intro\nold middle\noutro",
      "intro\nnew middle\noutro"
    );
    expect(stats.added).toBe(1);
    expect(stats.removed).toBe(1);
    expect(texts(lines, "context")).toEqual(["intro", "outro"]);
    expect(texts(lines, "removed")).toEqual(["old middle"]);
    expect(texts(lines, "added")).toEqual(["new middle"]);
  });

  it("detects a pure insertion without rewriting the surrounding lines", () => {
    const { lines, stats } = diffLines("a\nc", "a\nb\nc");
    expect(stats).toMatchObject({ added: 1, removed: 0, identical: false });
    expect(texts(lines, "added")).toEqual(["b"]);
    expect(texts(lines, "context")).toEqual(["a", "c"]);
  });

  it("detects a pure deletion", () => {
    const { stats, lines } = diffLines("a\nb\nc", "a\nc");
    expect(stats).toMatchObject({ added: 0, removed: 1 });
    expect(texts(lines, "removed")).toEqual(["b"]);
  });

  it("numbers lines against the side they exist on", () => {
    const { lines } = diffLines("a\nc", "a\nb\nc");
    const added = lines.find((l) => l.type === "added");
    expect(added).toMatchObject({ oldNumber: null, newNumber: 2 });
    const removedOnly = diffLines("a\nb\nc", "a\nc").lines.find(
      (l) => l.type === "removed"
    );
    expect(removedOnly).toMatchObject({ oldNumber: 2, newNumber: null });
    // Context lines address both sides, and the numbers can differ.
    const last = lines[lines.length - 1];
    expect(last).toMatchObject({ type: "context", oldNumber: 2, newNumber: 3 });
  });

  it("treats a first edit from empty as all-added", () => {
    const { stats, lines } = diffLines("", "hello\nworld");
    expect(stats).toMatchObject({ added: 2, removed: 0, identical: false });
    expect(texts(lines, "added")).toEqual(["hello", "world"]);
  });

  it("ignores a trailing newline rather than showing a phantom empty line", () => {
    const { stats } = diffLines("a\nb\n", "a\nb");
    expect(stats.identical).toBe(false); // the strings differ...
    expect(stats.added + stats.removed).toBe(0); // ...but no LINE changed.
  });

  it("normalizes CRLF so a line-ending change is not a full rewrite", () => {
    const { stats } = diffLines("a\r\nb", "a\nb");
    expect(stats.added + stats.removed).toBe(0);
  });

  it("preserves blank lines inside the body as context", () => {
    const { lines } = diffLines("a\n\nb", "a\n\nb");
    expect(lines.map((l) => l.text)).toEqual(["a", "", "b"]);
  });

  it("diffs a realistic multi-paragraph edit without churn", () => {
    const before = [
      "# Escalation Bar",
      "",
      "Escalate only when:",
      "1. You need a resource you cannot obtain.",
      "2. It is a product call.",
    ].join("\n");
    const after = [
      "# Escalation Bar",
      "",
      "Escalate only when:",
      "1. You need a resource you cannot obtain yourself.",
      "2. It is a product call.",
    ].join("\n");
    const { stats, lines } = diffLines(before, after);
    expect(stats).toMatchObject({ added: 1, removed: 1 });
    expect(texts(lines, "context")).toHaveLength(4);
  });
});
