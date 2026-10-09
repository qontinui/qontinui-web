import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The migration ratchet for the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7).
 *
 * Every file under `frontend/src` that still hand-types an `/operations` URL —
 * a non-comment `/api/v1/operations` literal, an import of the absolute
 * `OPERATIONS_API`, or a use of `OPERATIONS_BASE` outside the client — is a file not yet moved onto `lib/api/operations/`. The
 * count may only fall: each migration PR lowers `PINNED_COUNT` to what it
 * leaves, and a change that adds a hand-typed URL somewhere new goes red.
 *
 * Out of the scan, by design: the client itself (`lib/api/operations/`), tests
 * (they pin literal URLs on purpose), and the two infrastructure files that
 * must name the prefix (`services/http-client.ts`, the active-tenant prefix;
 * `lib/api/route-walker.ts`, the contract checker).
 *
 * Resume point: when the pin reaches 0 the migration is done, and
 * `components/operations/utils.ts` exports no URL.
 */
const PINNED_COUNT = 70;

const SRC_ROOT = path.resolve(__dirname, "../../..");

const EXCLUDED_FILES = new Set([
  "services/http-client.ts",
  "lib/api/route-walker.ts",
]);

const NEEDLE = /OPERATIONS_API|OPERATIONS_BASE|\/api\/v1\/operations/;

function isTestOrExcluded(rel: string): boolean {
  return (
    rel.startsWith("lib/api/operations/") ||
    EXCLUDED_FILES.has(rel) ||
    /\.test\.tsx?$/.test(rel) ||
    rel.split("/").includes("__tests__")
  );
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** A line that is only a comment (`//`, `/*`, or a block comment body). */
function isCommentLine(line: string): boolean {
  return /^\s*(\*|\/\/|\/\*)/.test(line);
}

/** Repo-relative (to `src/`), forward-slash paths of the files still hand-typing a URL. */
function filesStillHandTypingOperationsUrls(root = SRC_ROOT): string[] {
  const hits: string[] = [];
  for (const file of sourceFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (isTestOrExcluded(rel)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    if (lines.some((l) => NEEDLE.test(l) && !isCommentLine(l))) hits.push(rel);
  }
  return hits.sort();
}

describe("/operations URL ratchet", () => {
  it("the count of files hand-typing an /operations URL never rises above the pin", () => {
    const hits = filesStillHandTypingOperationsUrls();
    expect(
      hits.length,
      `${hits.length} files hand-type an /operations URL (pinned ${PINNED_COUNT}). ` +
        `Add the call to lib/api/operations/ instead. Files:\n${hits.join("\n")}`
    ).toBeLessThanOrEqual(PINNED_COUNT);
  });

  it("the pin is tight: lower PINNED_COUNT when a migration lands", () => {
    expect(filesStillHandTypingOperationsUrls().length).toBe(PINNED_COUNT);
  });

  it("a comment line is not a hand-typed URL", () => {
    expect(isCommentLine(" * see /api/v1/operations/fleet")).toBe(true);
    expect(isCommentLine("  // /api/v1/operations")).toBe(true);
    expect(isCommentLine('const u = "/api/v1/operations/x";')).toBe(false);
  });
});
