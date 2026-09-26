/**
 * Every frontend `HttpClient` call site, checked against the backend OpenAPI
 * snapshot.
 *
 * The walker (`route-walker.ts`) parses every app source under `frontend/src`
 * (tests and `lib/api-client/*` excluded) with the TypeScript compiler API,
 * finds each `httpClient` / `this.httpClient` / other `HttpClient` instance
 * `.fetch/.get/.post/.put/.patch/.delete` call, resolves its method and URL
 * (same-file `const` prefixes, `ApiConfig.API_BASE_URL` and same-class
 * `this.baseUrl`-style fields; the origin becomes "", substitutions become
 * `{param}`, the query string is dropped), and matches the
 * `(method, path template)` against `lib/api-client/openapi-schema.json` —
 * which backend CI regenerates from `app.openapi()` and fails on any
 * difference.
 *
 * A mismatch is classed `dead` (no served path, or a served path without that
 * verb), `websocket` (WS routes are absent from OpenAPI by construction),
 * `catch-all-proxy`, or `unresolved` (the walker could not read the URL or
 * method statically — never counted as a pass).
 *
 * THE BASELINE IS SHRINK-ONLY. `known-route-mismatches.json` holds today's
 * backlog, one entry per `(file, method, path)`. This test fails on:
 *   - a mismatch that is not in the baseline — fix the call site (or the
 *     backend route); do not add it to the baseline;
 *   - a baseline entry that no longer occurs — the site was fixed or deleted,
 *     so delete the entry.
 *
 * Regenerating the baseline (only to REMOVE fixed entries, or after an
 * intentional walker change): from `frontend/`,
 *
 *     UPDATE_ROUTE_BASELINE=1 npx vitest run src/lib/api/route-walker.test.ts
 *
 * then review the diff — it must only delete lines unless the walker itself
 * changed.
 *
 * Plan: 2026-09-12-four-frontend-routes-the-retry-sweep-found-dead-or-mismatched
 * (Phase 5).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type BaselineEntry,
  buildSnapshotIndex,
  checkSite,
  diffAgainstBaseline,
  entryKey,
  extractCallSites,
  loadSnapshotPaths,
  mismatchEntries,
  nextCatchAllPrefixes,
  walkSourceTree,
} from "./route-walker";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, "../..");
const BASELINE_FILE = path.join(HERE, "known-route-mismatches.json");

const tree = walkSourceTree(SRC_ROOT);
const index = buildSnapshotIndex(
  loadSnapshotPaths(),
  nextCatchAllPrefixes(tree.files)
);

/**
 * The four sites this plan repointed or deleted. None may ever re-enter the
 * baseline: they are fixed, and `route-contract.test.ts` pins the live ones.
 */
const FIXED_BY_THIS_PLAN: {
  label: string;
  matches: (e: BaselineEntry) => boolean;
}[] = [
  {
    label: "capture/sessions/{id}/notes",
    matches: (e) => /\/capture\/sessions\/[^/]+\/notes/.test(e.path),
  },
  {
    label: "POST discoveries/{id}/reject",
    matches: (e) =>
      e.method === "POST" && /\/discoveries\/[^/]+\/reject$/.test(e.path),
  },
  {
    label: "/api/integration-testing/*",
    matches: (e) => e.path.includes("/api/integration-testing/"),
  },
  {
    label: "reset-limit in automation-streaming-card",
    matches: (e) =>
      e.file.endsWith("automation-streaming-card.tsx") &&
      e.path.includes("reset-limit"),
  },
];

function describeEntries(entries: BaselineEntry[]): string {
  return entries
    .map((e) => `  ${e.reason}/${e.kind} ${e.method} ${e.path}  (${e.file})`)
    .join("\n");
}

describe("route walker: the real tree against the OpenAPI snapshot", () => {
  const { sites } = tree;
  const actual = mismatchEntries(sites, index);

  it("finds call sites at all (a walker that finds none passes vacuously)", () => {
    expect(sites.length).toBeGreaterThan(200);
  });

  it("matches the shrink-only baseline exactly", () => {
    if (process.env.UPDATE_ROUTE_BASELINE === "1") {
      writeFileSync(BASELINE_FILE, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    const baseline: BaselineEntry[] = JSON.parse(
      readFileSync(BASELINE_FILE, "utf8")
    );
    const { added, stale } = diffAgainstBaseline(actual, baseline);
    expect(
      added,
      `New route mismatches — fix the call site, do not baseline them:\n${describeEntries(added)}`
    ).toEqual([]);
    expect(
      stale,
      `Baseline entries that no longer occur — delete them from known-route-mismatches.json:\n${describeEntries(stale)}`
    ).toEqual([]);
  });

  it("the four sites this plan fixed are neither mismatching nor baselined", () => {
    const baseline: BaselineEntry[] = JSON.parse(
      readFileSync(BASELINE_FILE, "utf8")
    );
    for (const { label, matches } of FIXED_BY_THIS_PLAN) {
      expect(baseline.filter(matches), `${label} is in the baseline`).toEqual(
        []
      );
      expect(actual.filter(matches), `${label} mismatches`).toEqual([]);
    }
  });

  it("the baseline is sorted and has one entry per (file, method, path)", () => {
    const baseline: BaselineEntry[] = JSON.parse(
      readFileSync(BASELINE_FILE, "utf8")
    );
    const keys = baseline.map((e) => `${e.file}\t${e.method}\t${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...baseline].sort((a, b) =>
      entryKey(a) < entryKey(b) ? -1 : entryKey(a) > entryKey(b) ? 1 : 0
    );
    expect(baseline).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Fixtures (V4): the walker's pure functions on in-memory sources.
// ---------------------------------------------------------------------------

/** A tiny snapshot standing in for the real one. */
const fixtureIndex = buildSnapshotIndex({
  "/api/v1/widgets": { get: {}, post: {} },
  "/api/v1/widgets/{widget_id}": { get: {}, delete: {} },
  "/api/v1/widgets/{widget_id}/approve": { put: {} },
  "/api/v1/integration-testing/execute": { post: {} },
  "/api/v1/files/{file_path}": { get: {} },
});

function fixture(source: string): BaselineEntry[] {
  return mismatchEntries(extractCallSites("fixture.ts", source), fixtureIndex);
}

const PREAMBLE = `
import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";
`;

describe("route walker fixtures", () => {
  it("a matching call passes", () => {
    expect(
      fixture(`${PREAMBLE}
        export const list = () => httpClient.get(\`\${ApiConfig.API_BASE_URL}/api/v1/widgets?limit=5\`);
        export const one = (id: string) => httpClient.fetch(\`\${ApiConfig.API_BASE_URL}/api/v1/widgets/\${id}\`, { method: "DELETE" });
        export const file = (p: string) => httpClient.get(\`/api/v1/files/\${p}/nested/\${p}\`);
      `)
    ).toEqual([]);
  });

  it("a seeded dead route goes red", () => {
    expect(
      fixture(`${PREAMBLE}
        export const gone = (id: string) =>
          httpClient.patch(\`\${ApiConfig.API_BASE_URL}/api/v1/widgets/\${id}/notes\`, {});
      `)
    ).toEqual([
      {
        file: "fixture.ts",
        method: "PATCH",
        path: "/api/v1/widgets/{param}/notes",
        reason: "dead",
        kind: "no-path",
      },
    ]);
  });

  it("a seeded prefix-constant mismatch (the old row 3 shape) goes red", () => {
    expect(
      fixture(`${PREAMBLE}
        const API = \`\${ApiConfig.API_BASE_URL}/api\`;
        export const run = () =>
          httpClient.fetch(\`\${API}/integration-testing/execute\`, { method: "POST" });
      `)
    ).toEqual([
      {
        file: "fixture.ts",
        method: "POST",
        path: "/api/integration-testing/execute",
        reason: "dead",
        kind: "no-path",
      },
    ]);
    // …and the repointed prefix passes.
    expect(
      fixture(`${PREAMBLE}
        const API = \`\${ApiConfig.API_BASE_URL}/api/v1\`;
        export const run = () =>
          httpClient.fetch(\`\${API}/integration-testing/execute\`, { method: "POST" });
      `)
    ).toEqual([]);
  });

  it("a verb mismatch goes red", () => {
    expect(
      fixture(`${PREAMBLE}
        class Svc {
          private baseUrl = \`\${ApiConfig.API_BASE_URL}/api/v1/widgets\`;
          constructor(private httpClient: unknown) {}
          approve(id: string) { return this.httpClient.post(\`\${this.baseUrl}/\${id}/approve\`, {}); }
        }
      `)
    ).toEqual([
      {
        file: "fixture.ts",
        method: "POST",
        path: "/api/v1/widgets/{param}/approve",
        reason: "dead",
        kind: "verb",
      },
    ]);
  });

  it("an unresolvable prefix is reported unresolved, never passed", () => {
    expect(
      fixture(`${PREAMBLE}
        import { BASE } from "./elsewhere";
        export const x = () => httpClient.get(\`\${BASE}/api/v1/widgets\`);
      `)
    ).toMatchObject([{ method: "GET", reason: "unresolved" }]);
  });

  it("a WebSocket URL is classed websocket", () => {
    expect(
      fixture(`${PREAMBLE}
        export const x = () => httpClient.get("/api/v1/stream/ws");
      `)
    ).toMatchObject([{ reason: "websocket" }]);
  });

  it("a mismatch under a catch-all proxy prefix is classed catch-all-proxy", () => {
    const sites = extractCallSites(
      "fixture.ts",
      `${PREAMBLE} httpClient.get("/api/ui-bridge/tabs");`
    );
    const proxied = buildSnapshotIndex({}, ["/api/ui-bridge"]);
    expect(mismatchEntries(sites, proxied)).toMatchObject([
      { reason: "catch-all-proxy" },
    ]);
  });

  it("the shrink-only diff reports both a new mismatch and a stale entry", () => {
    const entry = (p: string): BaselineEntry => ({
      file: "f.ts",
      method: "GET",
      path: p,
      reason: "dead",
      kind: "no-path",
    });
    // Deleting a baseline entry whose site still mismatches -> `added`.
    expect(diffAgainstBaseline([entry("/a")], [])).toEqual({
      added: [entry("/a")],
      stale: [],
    });
    // Leaving an entry whose site now matches -> `stale`.
    expect(diffAgainstBaseline([], [entry("/a")])).toEqual({
      added: [],
      stale: [entry("/a")],
    });
  });

  it("checkSite does not treat a literal segment as a parameter", () => {
    const [site] = extractCallSites(
      "fixture.ts",
      `${PREAMBLE} httpClient.get("/api/v1/widgets/search/extra");`
    );
    expect(checkSite(site, fixtureIndex).ok).toBe(false);
  });
});
