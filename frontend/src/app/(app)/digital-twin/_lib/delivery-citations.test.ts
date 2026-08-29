import { describe, expect, it } from "vitest";

import { citationCounts, isRetiredCitation } from "./delivery-citations";
import type { DeliveryComponents, DeliveryPr } from "./types";

const merged = (repo: string, pr: number): DeliveryPr => ({
  repo,
  pr,
  merged: true,
  branch: null,
});

const open = (repo: string, pr: number): DeliveryPr => ({
  repo,
  pr,
  merged: false,
  branch: null,
});

const retired = (repo: string, pr: number): DeliveryPr => ({
  ...open(repo, pr),
  terminal_unlanded: true,
});

describe("citationCounts", () => {
  it("prefers coord's counts over the lists", () => {
    // The lists are the TRUNCATED half here: coord served the numbers and only
    // a sample of the citations. Reading a length would understate every bucket.
    const counts = citationCounts({
      prs: [merged("qontinui-web", 1)],
      unmerged_prs: [],
      terminal_unlanded_prs: [],
      landed_count: 4,
      blocking_unmerged_count: 2,
      terminal_unlanded_count: 3,
    });
    expect(counts).toEqual({
      landed: 4,
      blocking: 2,
      retired: 3,
      total: 1,
    });
  });

  it("falls back to the bucket lists when the counts are absent", () => {
    const counts = citationCounts({
      prs: [merged("qontinui-web", 1), open("qontinui-coord", 2)],
      unmerged_prs: [open("qontinui-coord", 2)],
      terminal_unlanded_prs: [],
    });
    expect(counts).toEqual({ landed: 1, blocking: 1, retired: 0, total: 2 });
  });

  it("derives every bucket from `prs` alone when nothing else is served", () => {
    // The shape an older coord build serves: the citation list and nothing
    // aggregate. A literal breakdown is still available and should be used.
    const counts = citationCounts({
      prs: [
        merged("qontinui-web", 1),
        open("qontinui-coord", 2),
        retired("qontinui-runner", 3),
      ],
    });
    expect(counts).toEqual({ landed: 1, blocking: 1, retired: 1, total: 3 });
  });

  it("never counts one citation as both blocking and retired", () => {
    // Coord retired #2 in the LIST and stamped no per-item flag, and served no
    // blocking count. Deriving the blocking bucket off the flag alone puts the
    // same dead citation in both buckets — "1 still unmerged, 1 closed without
    // landing" over a single PR that blocks nothing.
    const counts = citationCounts({
      prs: [merged("qontinui-web", 1), open("qontinui-coord", 2)],
      terminal_unlanded_prs: [open("qontinui-coord", 2)],
    });
    expect(counts).toEqual({ landed: 1, blocking: 0, retired: 1, total: 2 });
  });

  it("reads an explicit zero rather than falling through it", () => {
    // `?? ` on a count would be a bug here only if it were `||` — pin it, since
    // "coord says zero blocking" and "coord said nothing" are different facts.
    const counts = citationCounts({
      prs: [open("qontinui-web", 1)],
      blocking_unmerged_count: 0,
      terminal_unlanded_count: 0,
      landed_count: 0,
    });
    expect(counts).toEqual({ landed: 0, blocking: 0, retired: 0, total: 1 });
  });

  it("returns zeroes for an absent or empty components object", () => {
    expect(citationCounts(undefined)).toEqual({
      landed: 0,
      blocking: 0,
      retired: 0,
      total: 0,
    });
    expect(citationCounts({})).toEqual({
      landed: 0,
      blocking: 0,
      retired: 0,
      total: 0,
    });
  });

  it("ignores a non-numeric count and a non-array list", () => {
    const wire = {
      prs: [merged("qontinui-web", 1)],
      landed_count: "4",
      unmerged_prs: null,
      terminal_unlanded_count: Number.NaN,
    } as unknown as DeliveryComponents;
    expect(citationCounts(wire)).toEqual({
      landed: 1,
      blocking: 0,
      retired: 0,
      total: 1,
    });
  });
});

describe("isRetiredCitation", () => {
  const components: DeliveryComponents = {
    prs: [merged("qontinui-coord", 249), open("qontinui-claude-config", 257)],
    terminal_unlanded_prs: [open("qontinui-claude-config", 257)],
  };

  it("retires a citation coord listed in `terminal_unlanded_prs`", () => {
    // The gap this closes: coord marked the retirement only in the list, so a
    // card reading the per-item flag alone still showed the amber badge the
    // retirement rendering exists to remove.
    expect(
      isRetiredCitation(open("qontinui-claude-config", 257), components),
    ).toBe(true);
  });

  it("retires a citation carrying only the per-item flag", () => {
    expect(isRetiredCitation(retired("qontinui-web", 900), {})).toBe(true);
  });

  it("does not retire a blocking citation", () => {
    expect(isRetiredCitation(open("qontinui-coord", 500), components)).toBe(
      false,
    );
  });

  it("never retires a merged citation", () => {
    expect(isRetiredCitation(merged("qontinui-coord", 249), components)).toBe(
      false,
    );
  });

  it("does not match a same-repo citation with a different number", () => {
    expect(
      isRetiredCitation(open("qontinui-claude-config", 258), components),
    ).toBe(false);
  });

  it("matches a numberless citation on its own flag only", () => {
    // `repo` cannot tell two numberless citations apart, so retiring by repo
    // would mark the wrong one — worse than missing the mark.
    const numberless: DeliveryPr = {
      repo: "qontinui-claude-config",
      pr: null,
      merged: false,
      branch: null,
    };
    expect(isRetiredCitation(numberless, components)).toBe(false);
    expect(
      isRetiredCitation({ ...numberless, terminal_unlanded: true }, components),
    ).toBe(true);
  });
});
