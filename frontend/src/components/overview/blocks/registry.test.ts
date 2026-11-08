/**
 * The block registry keeps itself honest (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2):
 * every block the plan's D3 table names has an entry, no entry is missing
 * from that table, and every entry has its component and a test file that
 * renders it the way a reader meets it — through a fence, in a page.
 *
 * The D3 table is written out here by hand, from the plan, on purpose: a
 * test that read the names back from the registry would agree with any
 * registry at all.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCKS,
  BLOCK_NAME_PREFIXES,
  CODE_LANGUAGES_WITH_BLOCK_PREFIX,
  findBlock,
  isBlockName,
} from "./registry";

/** Plan D3, "The vocabulary: Phase 9 realised, then extended". */
const D3_TABLE = [
  "overview-kpi",
  "overview-timeline",
  "overview-plan-vs-actual",
  "overview-risks",
  "report-timeline",
  "report-scorecard",
  "report-figures",
  "report-items",
  "report-changes",
  "objective-checkpoints",
];

const HERE = __dirname;

describe("the block registry", () => {
  it("has an entry for every block in the plan's D3 table, and no other", () => {
    expect([...BLOCKS.map((b) => b.name)].sort()).toEqual([...D3_TABLE].sort());
  });

  it("names each block once", () => {
    const names = BLOCKS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(BLOCKS.map((b) => [b.name, b] as const))(
    "%s has its component, and a test file that renders it through a fence in a page",
    (name, entry) => {
      expect(existsSync(join(HERE, `${entry.module}.tsx`))).toBe(true);
      const testFile = join(HERE, `${entry.module}.test.tsx`);
      expect(existsSync(testFile), `${entry.module}.test.tsx`).toBe(true);
      const source = readFileSync(testFile, "utf8");
      // Entered the way a reader meets a block: a fence naming it, rendered
      // by a page — never through LiveBlock directly.
      expect(source).toMatch(new RegExp(`fence\\(\\s*"${name}"`));
      expect(source).toMatch(/<(InPageBody|InIntentSection)\b/);
      expect(source).not.toMatch(/<LiveBlock\b/);
    }
  );

  it("gives every block a strict schema, and every report block a report setting", () => {
    for (const entry of BLOCKS) {
      // A strict object refuses a setting it does not declare.
      expect(entry.args.safeParse({ "not-a-setting": "x" }).success).toBe(
        false
      );
      if (entry.kind === "report") {
        expect(Object.keys(entry.args.shape)).toContain("report");
      }
      expect(
        entry.name.startsWith(entry.kind === "report" ? "report-" : "")
      ).toBe(true);
    }
  });

  it("names a positional setting only when the block declares that setting", () => {
    for (const entry of BLOCKS) {
      if (entry.positional) {
        expect(Object.keys(entry.args.shape)).toContain(entry.positional);
      }
    }
  });
});

describe("which fences are blocks", () => {
  it("is every registered name, and every name with a block prefix", () => {
    for (const entry of BLOCKS) expect(isBlockName(entry.name)).toBe(true);
    for (const prefix of BLOCK_NAME_PREFIXES) {
      expect(isBlockName(`${prefix}not-built`)).toBe(true);
      expect(findBlock(`${prefix}not-built`)).toBeUndefined();
    }
  });

  it("is no other language", () => {
    for (const language of [
      "ts",
      "mermaid",
      "reports-timeline",
      "overviewkpi",
      "",
    ]) {
      expect(isBlockName(language)).toBe(false);
    }
  });

  it("is never a code language that shares a block prefix, in any case", () => {
    for (const language of [
      "objective-c",
      "Objective-C",
      "objective-c++",
      "objective-C++",
      "objective-cpp",
      "OBJECTIVE-CPP",
      "objective-j",
      "objective-J",
    ]) {
      expect(isBlockName(language), language).toBe(false);
    }
  });

  it("exempts only real prefix clashes, and no block's own name", () => {
    for (const language of CODE_LANGUAGES_WITH_BLOCK_PREFIX) {
      expect(BLOCK_NAME_PREFIXES.some((p) => language.startsWith(p))).toBe(
        true
      );
      expect(findBlock(language)).toBeUndefined();
    }
    // A name that only starts like one is still meant as a block.
    expect(isBlockName("objective-checkpointz")).toBe(true);
    expect(isBlockName("objective-csv")).toBe(true);
  });
});
