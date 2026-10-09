/**
 * Ratchet: no file outside the typed `/operations` client may type the
 * `/api/v1/operations` URL by hand or import `OPERATIONS_API`.
 *
 * Plan `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 7. `known-operations-literal-files.txt` is the baseline of files that
 * still did; it is now EMPTY, so this test is a permanent guard: any file
 * outside `lib/api/operations` that gains a literal or an `OPERATIONS_API`
 * import reds the first test. (The baseline file stays, zero lines, so a
 * regression that must be pinned has a place to be listed; the second test
 * reds a listed file that no longer has a marker.)
 *
 * Comment-only mentions do not count, and neither do the two files that name
 * the prefix for reasons that are not a call: `services/http-client.ts` (the
 * tenant-scoping matcher) and `lib/api/route-walker.ts` (the contract walker's
 * own tables).
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../..");
const BASELINE = path.resolve(__dirname, "known-operations-literal-files.txt");

const NOT_A_CALL = new Set([
  "services/http-client.ts",
  "lib/api/route-walker.ts",
]);

const MARKER = /OPERATIONS_API|\/api\/v1\/operations/;

function isTestFile(rel: string): boolean {
  return (
    /\.test\.[tj]sx?$/.test(rel) ||
    rel.includes("__tests__/") ||
    rel.startsWith("lib/api/operations/")
  );
}

function hasNonCommentMarker(source: string): boolean {
  let inBlock = false;
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inBlock = true;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*")) continue;
    if (MARKER.test(line)) return true;
  }
  return false;
}

function filesWithHandTypedOperationsUrl(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(SRC, { recursive: true }) as string[]) {
    const rel = entry.split(path.sep).join("/");
    if (!/\.tsx?$/.test(rel) || isTestFile(rel) || NOT_A_CALL.has(rel)) {
      continue;
    }
    if (hasNonCommentMarker(readFileSync(path.join(SRC, rel), "utf8"))) {
      found.push(rel);
    }
  }
  return found.sort();
}

function baseline(): string[] {
  return readFileSync(BASELINE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

describe("hand-typed /operations URLs ratchet", () => {
  const current = filesWithHandTypedOperationsUrl();
  const pinned = new Set(baseline());

  it("no file outside lib/api/operations gains a hand-typed /operations URL", () => {
    const added = current.filter((f) => !pinned.has(f));
    expect(
      added,
      "route these through src/lib/api/operations/* instead of typing the URL"
    ).toEqual([]);
  });

  it("every listed file still has one (delete the line when you migrate a file)", () => {
    const now = new Set(current);
    const stale = [...pinned].filter((f) => !now.has(f));
    expect(stale).toEqual([]);
  });

  it("keeps the baseline sorted and free of duplicates", () => {
    const lines = baseline();
    expect(lines).toEqual([...new Set(lines)].sort());
  });
});
