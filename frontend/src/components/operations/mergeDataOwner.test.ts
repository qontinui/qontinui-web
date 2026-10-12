/**
 * Single-data-owner guard for the merge-pipeline surfaces.
 *
 * `useMergePipelineData` exists so the fleet dashboard's hero has ONE owner of
 * the four merge endpoints (`/merge/queue`, `/pr-merge/prs`,
 * `/pr-merge/suggestions`, `/pr-merge/blast-radius-blocks`) plus one
 * WebSocket. The 2026-07-21 production incident made that a load invariant
 * rather than a preference: then, every in-flight request held a backend DB
 * connection, so a second poller was a second draw on a pool whose exhaustion
 * 504'd sign-in. Since `d77d79072` (2026-07-26) these requests hold no DB
 * connection, but a second poller still doubles the coord work behind every
 * one of them.
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
 * SCOPE, deliberately narrow. "One fetch site in the repo" is NOT required of
 * `/merge/queue` or `/pr-merge/prs`: another surface may read them for its own
 * view (today `StuckPrRecoveryPanel` reads the PR list), and that is
 * legitimate — a separate view with its own lifecycle, not a duplicate copy of
 * the hero. What must stay single is (a)
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
 * The typed `/operations` client functions (`lib/api/operations/prMerge.ts`)
 * that request each endpoint. Since Phase 7 batch 7 of plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * no component spells these URLs: a fetch site is a module that CALLS one of
 * these functions.
 */
const CLIENT_FUNCTIONS: Record<string, string[]> = {
  "/merge/queue": ["fetchMergeQueue"],
  "/pr-merge/prs": [
    "fetchOpenPrs",
    "fetchOpenPrsWithMergedCount",
    "fetchPrsIncludingMerged",
  ],
  "/pr-merge/suggestions": ["fetchMergeSuggestions"],
  "/pr-merge/blast-radius-blocks": ["fetchBlastRadiusBlocks"],
};

/** A line that is only a comment (`//`, `/*`, or a block comment body). */
function isCommentLine(line: string): boolean {
  return /^\s*(\*|\/\/|\/\*)/.test(line);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `source` REQUESTS `endpoint`, not merely names it. Comments and
 * wire-type docs reference these paths freely and must keep being allowed to,
 * so only non-comment lines count, in any of the request forms:
 *
 * - a call of the endpoint's client function (`fetchMergeQueue(`);
 * - an inlined URL over a base constant (`${OPERATIONS_BASE}/merge/queue`,
 *   or the retired `${OPERATIONS_API}/merge/queue`);
 * - the literal path (`"/api/v1/operations/merge/queue"`).
 *
 * The path forms match the endpoint itself (a query string may follow), not a
 * sub-route under it: `/pr-merge/prs/{repo}/{n}/checks` is another endpoint.
 */
function requestsEndpoint(source: string, endpoint: string): boolean {
  const path = escapeRegExp(endpoint) + "(?![\\w/-])";
  const forms = [
    ...CLIENT_FUNCTIONS[endpoint].map((fn) => new RegExp(`\\b${fn}\\(`)),
    new RegExp(`OPERATIONS_(?:BASE|API)\\}${path}`),
    new RegExp(`/api/v1/operations${path}`),
  ];
  return source
    .split(/\r?\n/)
    .some((line) => !isCommentLine(line) && forms.some((f) => f.test(line)));
}

/** Files whose source requests the endpoint — see {@link requestsEndpoint}. */
function fetchSites(endpoint: string, root = OPERATIONS_DIR): string[] {
  return moduleFiles(root)
    .filter((f) => requestsEndpoint(readFileSync(f, "utf8"), endpoint))
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

  // The guard's own mutant proof: each request form an inlined fetch could
  // take is seen, while a comment naming the same path is not.
  it.each([
    "await fetchMergeQueue();",
    "httpClient.fetch(`${OPERATIONS_BASE}/merge/queue`);",
    "httpClient.fetch(`${OPERATIONS_API}/merge/queue`);",
    'httpClient.fetch("/api/v1/operations/merge/queue?x=1");',
  ])("an inlined fetch is seen: %s", (line) => {
    const source = ["const a = 1;", `  ${line}`].join("\n");
    expect(requestsEndpoint(source, "/merge/queue")).toBe(true);
  });

  it("a comment or a sub-route is not a fetch of the endpoint", () => {
    const source = [
      "// reads `/api/v1/operations/pr-merge/prs` through the hook",
      " * `${OPERATIONS_BASE}/pr-merge/prs` is the listing",
      "httpClient.fetch(`${OPERATIONS_BASE}/pr-merge/prs/${repo}/1/checks`);",
    ].join("\n");
    expect(requestsEndpoint(source, "/pr-merge/prs")).toBe(false);
  });
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
    expect(source).not.toContain("@/lib/api/operations/");
    // ...nor a URL inlined over the typed client's base or spelled literally.
    for (const endpoint of Object.keys(CLIENT_FUNCTIONS)) {
      expect(requestsEndpoint(source, endpoint)).toBe(false);
    }
    expect(source).not.toContain("OPERATIONS_BASE");
    const code = source.split(/\r?\n/).filter((l) => !isCommentLine(l));
    expect(code.filter((l) => l.includes("/api/v1/operations"))).toEqual([]);
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
