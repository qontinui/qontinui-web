/**
 * Single-data-owner guard for the merge-pipeline surfaces.
 *
 * `useMergePipelineData` exists so the fleet dashboard's hero has ONE owner of
 * the four merge endpoints (`/merge/queue`, `/pr-merge/prs`,
 * `/pr-merge/suggestions`, `/pr-merge/blast-radius-blocks`) plus one
 * WebSocket. The 2026-07-21 production incident made that a load invariant
 * rather than a preference: every in-flight request pins a backend DB
 * connection for its whole lifetime, so a second poller is a second draw on a
 * pool whose exhaustion 504'd sign-in.
 *
 * The invariant was silently broken for five weeks and nothing noticed,
 * because the second copy was UNREACHABLE rather than merely redundant. The
 * fleet-page redesign (`946e06c7`, 2026-07-15) replaced the `MergeTrain` panel
 * with `MergePipeline` and stopped rendering it, but left its body — a full
 * duplicate of all four fetches and a second WebSocket client — in the module.
 * It stayed under maintenance: plan
 * 2026-08-20-predicate-eval-surface-counts-evals-not-decisions Phase 2 (PR
 * #1032) edited BOTH `fetchGateBlocks` implementations, and only one of them
 * could ever run. A render test cannot catch that — the dead copy renders
 * nothing — so this asserts the property at the source level.
 *
 * SCOPE, deliberately narrow. "One fetch site in the repo" is NOT true of
 * `/merge/queue` or `/pr-merge/prs`: `StuckPrRecoveryPanel`,
 * `usePrCheckDetails` and `utils` read them for their
 * own surfaces, and that is legitimate — they are separate views with separate
 * lifecycles, not duplicate copies of the hero. What must stay single is (a)
 * the two side-channels nothing else consumes, and (b) the hero's own module
 * set, which must take its data from the hook rather than fetch again.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const OPERATIONS_DIR = __dirname;
const SRC_DIR = join(OPERATIONS_DIR, "..", "..");

/** The hero's module set — every file rendered by, or rendering, MergePipeline. */
const HERO_MODULES = [
  "MergePipeline.tsx",
  "MergeTrain.tsx",
  "MergeTrainActivity.tsx",
];

/** Every non-test `.ts`/`.tsx` module under a directory. */
function moduleFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) moduleFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string, root: string): string {
  return file
    .slice(root.length + 1)
    .split(sep)
    .join("/");
}

/**
 * Files whose source CALLS the endpoint, not merely names it. Comments and
 * wire-type docs reference these paths freely and must keep being allowed to;
 * only the `${OPERATIONS_API}/…` request form counts.
 */
function fetchSites(endpoint: string, root = OPERATIONS_DIR): string[] {
  const needle = "${OPERATIONS_API}" + endpoint;
  return moduleFiles(root)
    .filter((f) => readFileSync(f, "utf8").includes(needle))
    .map((f) => relative(f, root))
    .sort();
}

describe("merge-pipeline single data owner", () => {
  // The two actionable side-channels. Nothing outside the hero reads either,
  // so a second fetch site here is a duplicate by construction.
  it.each(["/pr-merge/suggestions", "/pr-merge/blast-radius-blocks"])(
    "%s is fetched from exactly one module",
    (endpoint) => {
      expect(fetchSites(endpoint)).toEqual(["useMergePipelineData.ts"]);
    }
  );

  // The two shared endpoints. Other surfaces may read them; the hero may not
  // read them a second time.
  it.each(["/merge/queue", "/pr-merge/prs"])(
    "%s is not re-fetched inside the hero's own modules",
    (endpoint) => {
      const sites = fetchSites(endpoint);
      expect(sites).toContain("useMergePipelineData.ts");
      expect(sites.filter((f) => HERO_MODULES.includes(f))).toEqual([]);
    }
  );
});

describe("MergeTrain.tsx is presentation-only", () => {
  const source = readFileSync(join(OPERATIONS_DIR, "MergeTrain.tsx"), "utf8");

  it("holds no transport", () => {
    // A fetch here is a second poller by construction — the module has no
    // caller that could dedupe it against the hook. Matched on the CALL form,
    // so the header comment may keep describing the copy that was removed.
    expect(source).not.toContain("httpClient.fetch(");
    expect(source).not.toContain("new WebSocket(");
    expect(source).not.toContain("${OPERATIONS_API}");
  });

  it("holds no data state or effects", () => {
    // `useMemo` is fine (pure derivation); state and effects are how a
    // self-fetching panel grows back.
    expect(source).not.toMatch(/\buseState\s*[<(]/);
    expect(source).not.toMatch(/\buseEffect\s*\(/);
  });

  it("exports nothing that no one renders", () => {
    // The `MergeTrain` panel itself was such an export: re-exported from the
    // barrel, imported by nothing, and still being edited. Every export must
    // be reachable from some module outside this file — tests count, since
    // they are how the pure helpers are pinned.
    const exported = [...source.matchAll(/^export function (\w+)/gm)].map(
      (m) => m[1]
    );
    expect(exported.length).toBeGreaterThan(0);

    const others = moduleFiles(SRC_DIR).filter(
      (f) => !f.endsWith("MergeTrain.tsx")
    );
    const tests = readdirSync(OPERATIONS_DIR)
      .filter((f) => /\.test\.tsx?$/.test(f))
      .map((f) => join(OPERATIONS_DIR, f));
    const haystack = [...others, ...tests]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    expect(exported.filter((name) => !haystack.includes(name))).toEqual([]);
  });
});
