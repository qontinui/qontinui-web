/**
 * Frontend `HttpClient` call sites, checked against the backend OpenAPI
 * snapshot and the Next.js route handlers.
 *
 * The walker (`route-walker.ts`) parses every app source under `frontend/src`
 * (tests and `lib/api-client/*` excluded) with the TypeScript compiler API,
 * finds each `httpClient` / `this.httpClient` / other `HttpClient` instance
 * `.fetch/.get/.post/.put/.patch/.delete` call, resolves its method and URL
 * (same-file and imported `const` prefixes, `ApiConfig.API_BASE_URL`,
 * same-class `this.baseUrl`-style fields and inlined URL-building helpers; the
 * origin becomes "", run-time substitutions become `{param}`, the query string
 * is dropped), and matches the `(method, path template)` against
 * `lib/api-client/openapi-schema.json` — which backend CI regenerates from
 * `app.openapi()` and fails on any difference — and against every
 * `app/api/**\/route.ts` handler's exported verbs.
 *
 * WRAPPERS. A call whose URL prefix, glued path suffix, or method comes from a
 * parameter of its enclosing named function (`request(path, init)`,
 * `this.fetchWithAuth(url, options)`) is not checked itself: every call of
 * that function — in the same file, or in any file importing it — is checked
 * with the caller's arguments bound. A caller whose argument does not resolve
 * is `unresolved`, never a pass. A wrapper nothing is found calling is
 * reported as its own (unresolved) site.
 *
 * A mismatch is classed `dead` (no served path, or a served path without that
 * verb), `websocket` (WS routes are absent from OpenAPI by construction), or
 * `unresolved` (the walker could not read the URL or method statically —
 * never counted as a pass).
 *
 * KNOWN BLIND SPOTS — calls this test does NOT check:
 *   - wrappers of wrappers: resolution is one level deep, so a caller that
 *     passes its OWN parameter through is `unresolved`, and its callers are
 *     not followed;
 *   - a wrapper method called on an instance from another file
 *     (`client.getX()`): members are followed only through `this.name(...)`
 *     in their own class, so such a wrapper stays one `unresolved` entry;
 *   - wrappers reached by default import, re-export, or passed as a value;
 *   - calls through anything that is not an `HttpClient` (bare `fetch`,
 *     axios, the generated `lib/api-client`, `EventSource`, `WebSocket`);
 *   - the origin: `ApiConfig.API_BASE_URL` resolves to "", so a
 *     backend-prefixed URL that only a Next.js handler serves counts as
 *     served (with `NEXT_PUBLIC_API_URL` unset it really is);
 *   - a `{param}` standing for several segments where the template has one:
 *     only snapshot templates in `MULTI_SEGMENT_TEMPLATE_PARAMS` (and Next.js
 *     `[...x]`) absorb more than one segment, so such a site reads `dead`.
 *
 * THE BASELINE IS SHRINK-ONLY. `known-route-mismatches.json` holds today's
 * backlog: one entry per `(file, method, path)` for a resolved path, and one
 * per occurrence for an unresolved one (`<unresolved> <source> #<n>`, `n`
 * counting the file's unresolved sites with the same method and source text in
 * source order). This test fails on:
 *   - a mismatch that is not in the baseline — fix the call site (or the
 *     backend route); do not add it to the baseline;
 *   - a baseline entry that no longer occurs — the site was fixed or deleted,
 *     so delete the entry.
 *
 * A BACKEND PR CAN TURN THIS RED WITHOUT TOUCHING THE FRONTEND: adding the
 * route a baselined `dead` entry was missing makes that entry stale. That is
 * the backlog shrinking — delete the entry from `known-route-mismatches.json`
 * (or regenerate it as below and check the diff only deletes).
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

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  isWebsocketPath,
  loadSnapshotPaths,
  MULTI_SEGMENT_TEMPLATE_PARAMS,
  memoryModuleLoader,
  mismatchEntries,
  nextRouteTemplates,
  walkSources,
  walkSourceTree,
} from "./route-walker";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, "../..");
const BACKEND_API = path.resolve(SRC_ROOT, "../../backend/app/api/v1");
const BASELINE_FILE = path.join(HERE, "known-route-mismatches.json");

const SNAPSHOT_PATHS = loadSnapshotPaths();
const tree = walkSourceTree(SRC_ROOT);
const index = buildSnapshotIndex(SNAPSHOT_PATHS, {
  nextRoutes: tree.nextRoutes,
});

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

  it("indexes the Next.js route handlers (a handler-served site is not dead)", () => {
    const templates = tree.nextRoutes.map((r) => r.template);
    expect(templates).toContain("/api/ui-bridge/{path}");
    expect(templates).toContain("/api/vga/state/{id}");
    expect(tree.nextRoutes.every((r) => r.methods.size > 0)).toBe(true);
  });
});

/**
 * `(template, param)` for every `{name:path}` route under
 * `backend/app/api/v1/endpoints`, composed from the decorator path and the
 * module's `include_router(..., prefix=...)` in `backend/app/api/v1/api.py`.
 */
function backendMultiSegmentParams(): [string, string][] {
  const api = readFileSync(path.join(BACKEND_API, "api.py"), "utf8");
  const prefixes = new Map<string, string[]>();
  for (const m of api.matchAll(
    /include_router\(\s*(\w+)\.router\s*(?:,([^)]*))?\)/g
  )) {
    const prefix = /prefix\s*=\s*"([^"]*)"/.exec(m[2] ?? "")?.[1] ?? "";
    const mod = m[1] as string;
    prefixes.set(mod, [...(prefixes.get(mod) ?? []), prefix]);
  }
  const endpoints = path.join(BACKEND_API, "endpoints");
  const out: [string, string][] = [];
  for (const rel of readdirSync(endpoints, { recursive: true }) as string[]) {
    if (!rel.endsWith(".py")) continue;
    const src = readFileSync(path.join(endpoints, rel), "utf8");
    for (const d of src.matchAll(
      /@router\.(?:get|post|put|patch|delete|api_route)\(\s*"([^"]*)"/g
    )) {
      const route = d[1] as string;
      const names = [...route.matchAll(/\{(\w+):path\}/g)].map(
        (n) => n[1] as string
      );
      if (names.length === 0) continue;
      const mod = path.basename(rel, ".py");
      const mounted = prefixes.get(mod);
      if (!mounted || rel.includes(path.sep)) {
        throw new Error(
          `${rel} declares ${route} but its include_router prefix was not found in api.py — extend backendMultiSegmentParams`
        );
      }
      for (const prefix of mounted) {
        const template = `/api/v1${prefix}${route.replace(/\{(\w+):\w+\}/g, "{$1}")}`;
        for (const name of names) out.push([template, name]);
      }
    }
  }
  // One pair per template, however many verbs declare it.
  const unique = [...new Map(out.map((p) => [p.join(" "), p])).values()];
  return unique.sort((a, b) => (a.join(" ") < b.join(" ") ? -1 : 1));
}

describe("MULTI_SEGMENT_TEMPLATE_PARAMS", () => {
  it("is exactly the backend's `{x:path}` routes, recomputed from source", () => {
    expect(
      [...MULTI_SEGMENT_TEMPLATE_PARAMS]
        .map(([t, n]) => [t, n])
        .sort((a, b) => (a.join(" ") < b.join(" ") ? -1 : 1))
    ).toEqual(backendMultiSegmentParams());
  });

  it("names only templates the snapshot serves", () => {
    for (const [template, name] of MULTI_SEGMENT_TEMPLATE_PARAMS) {
      expect(Object.keys(SNAPSHOT_PATHS), template).toContain(template);
      expect(template).toContain(`{${name}}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures (V4): the walker's pure functions on in-memory sources.
// ---------------------------------------------------------------------------

/** A tiny snapshot standing in for the real one. */
const fixtureIndex = buildSnapshotIndex(
  {
    "/api/v1/widgets": { get: {}, post: {} },
    "/api/v1/widgets/{widget_id}": { get: {}, delete: {} },
    "/api/v1/widgets/{widget_id}/approve": { put: {} },
    "/api/v1/integration-testing/execute": { post: {} },
    "/api/v1/files/{file_path}": { get: {} },
    "/api/v1/prs/{owner}/{repo}/draft": { get: {} },
    "/api/v1/merge/{repo}/nudges": { get: {} },
  },
  {
    multiSegment: [
      ["/api/v1/files/{file_path}", "file_path"],
      ["/api/v1/merge/{repo}/nudges", "repo"],
    ],
  }
);

function fixture(source: string): BaselineEntry[] {
  return mismatchEntries(extractCallSites("fixture.ts", source), fixtureIndex);
}

/** Several in-memory files, walked as a tree (imports followed between them). */
function fixtureTree(files: Record<string, string>): BaselineEntry[] {
  return mismatchEntries(
    walkSources(Object.keys(files), memoryModuleLoader(files)),
    fixtureIndex
  );
}

const PREAMBLE = `
import { ApiConfig } from "@/services/api-config";
import { httpClient } from "@/services/service-factory";
`;

const entry = (
  method: string,
  p: string,
  reason: BaselineEntry["reason"],
  kind: BaselineEntry["kind"],
  file = "fixture.ts"
): BaselineEntry => ({ file, method, path: p, reason, kind });

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
      entry("PATCH", "/api/v1/widgets/{param}/notes", "dead", "no-path"),
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
      entry("POST", "/api/integration-testing/execute", "dead", "no-path"),
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
      entry("POST", "/api/v1/widgets/{param}/approve", "dead", "verb"),
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

  it("the shrink-only diff reports both a new mismatch and a stale entry", () => {
    const e = entry("GET", "/a", "dead", "no-path", "f.ts");
    // Deleting a baseline entry whose site still mismatches -> `added`.
    expect(diffAgainstBaseline([e], [])).toEqual({ added: [e], stale: [] });
    // Leaving an entry whose site now matches -> `stale`.
    expect(diffAgainstBaseline([], [e])).toEqual({ added: [], stale: [e] });
  });

  it("checkSite does not treat a literal segment as a parameter", () => {
    const [site] = extractCallSites(
      "fixture.ts",
      `${PREAMBLE} httpClient.get("/api/v1/widgets/search/extra");`
    );
    expect(checkSite(site, fixtureIndex).ok).toBe(false);
  });
});

describe("finding 1: unresolved sites are keyed per occurrence", () => {
  const TWO = `${PREAMBLE}
    export const a = () => httpClient.fetch(url);
    export const b = () => httpClient.fetch(url);
  `;

  it("two unresolved sites with the same source text are two entries", () => {
    expect(fixture(TWO)).toEqual([
      entry("GET", "<unresolved> url #1", "unresolved", "unresolved"),
      entry("GET", "<unresolved> url #2", "unresolved", "unresolved"),
    ]);
  });

  it("a second one added beside a baselined one is new, not hidden", () => {
    const baseline = fixture(`${PREAMBLE}
      export const a = () => httpClient.fetch(url);
    `);
    expect(diffAgainstBaseline(fixture(TWO), baseline).added).toEqual([
      entry("GET", "<unresolved> url #2", "unresolved", "unresolved"),
    ]);
  });

  it("resolved entries stay line-free (moving code churns nothing)", () => {
    const one = fixture(`${PREAMBLE}
      export const g = (id: string) => httpClient.patch(\`/api/v1/widgets/\${id}/notes\`, {});`);
    const moved = fixture(`${PREAMBLE}


      export const other = 1;
      export const g = (id: string) => httpClient.patch(\`/api/v1/widgets/\${id}/notes\`, {});
      export const h = (id: string) => httpClient.patch(\`/api/v1/widgets/\${id}/notes\`, {});`);
    expect(moved).toEqual(one);
  });
});

describe("finding 2: wrapper callers are checked, one level deep", () => {
  it("a function wrapper is checked at each caller, with its options bound", () => {
    expect(
      fixture(`${PREAMBLE}
        const API = \`\${ApiConfig.API_BASE_URL}/api/v1/widgets\`;
        async function request<T>(path: string, init?: HttpOptions): Promise<T> {
          const res = await httpClient.fetch(\`\${API}\${path}\`, { cache: "no-store", ...init });
          return (await res.json()) as T;
        }
        export const list = () => request("");
        export const create = () => request("", { method: "POST" });
        export const remove = (id: string) => request(\`/\${id}\`, { method: "DELETE" });
        export const gone = (id: string) => request(\`/\${id}/notes\`, { method: "PATCH" });
        export const approve = (id: string) => request(\`/\${id}/approve\`, { method: "POST" });
      `)
    ).toEqual([
      entry("PATCH", "/api/v1/widgets/{param}/notes", "dead", "no-path"),
      entry("POST", "/api/v1/widgets/{param}/approve", "dead", "verb"),
    ]);
  });

  it("a glued `${PREFIX}${path}` wrapper is no longer a false pass", () => {
    expect(
      fixture(`${PREAMBLE}
        const PREFIX = "/api/v1/widgets";
        function getW(path: string) { return httpClient.get(\`\${PREFIX}\${path}\`); }
        export const ok = () => getW("");
        export const gone = () => getW("/nope/deeper");
      `)
    ).toEqual([entry("GET", "/api/v1/widgets/nope/deeper", "dead", "no-path")]);
  });

  it("a class-method wrapper is checked at its `this.` callers", () => {
    expect(
      fixture(`${PREAMBLE}
        class Api {
          private async fetchWithAuth(url: string, options: HttpOptions = {}) {
            return httpClient.fetch(\`\${ApiConfig.API_BASE_URL}/api/v1\${url}\`, options);
          }
          list() { return this.fetchWithAuth("/widgets"); }
          update(id: string) { return this.fetchWithAuth(\`/widgets/\${id}\`, { method: "PUT" }); }
        }
      `)
    ).toEqual([entry("PUT", "/api/v1/widgets/{param}", "dead", "verb")]);
  });

  it("a method-parameter wrapper binds the caller's verb", () => {
    expect(
      fixture(`${PREAMBLE}
        async function send(method: "GET" | "POST" | "PATCH", url: string) {
          return httpClient.fetch(\`\${ApiConfig.getBaseUrl()}\${url}\`, { method });
        }
        export const a = () => send("GET", "/api/v1/widgets");
        export const b = () => send("PATCH", "/api/v1/widgets");
      `)
    ).toEqual([entry("PATCH", "/api/v1/widgets", "dead", "verb")]);
  });

  it("a caller whose argument does not resolve is unresolved, never a pass", () => {
    expect(
      fixture(`${PREAMBLE}
        const PREFIX = "/api/v1/widgets";
        function getW(path: string) { return httpClient.get(\`\${PREFIX}\${path}\`); }
        export const passThrough = (p: string) => getW(p);
      `)
    ).toEqual([
      entry("GET", "<unresolved> getW(p) #1", "unresolved", "unresolved"),
    ]);
  });

  it("an imported wrapper is checked at callers in other files", () => {
    expect(
      fixtureTree({
        "services/req.ts": `${PREAMBLE}
          export async function request(path: string) {
            return httpClient.get(\`\${ApiConfig.API_BASE_URL}/api/v1/widgets\${path}\`);
          }`,
        "features/use.ts": `
          import { request } from "@/services/req";
          export const ok = () => request("");
          export const gone = () => request("/gone/too");`,
      })
    ).toEqual([
      entry(
        "GET",
        "/api/v1/widgets/gone/too",
        "dead",
        "no-path",
        "features/use.ts"
      ),
    ]);
  });

  it("a `useCallback` wrapper binds `opts.method ?? default` per caller", () => {
    expect(
      fixture(`${PREAMBLE}
        export function Actions({ id }: { id: string }) {
          const run = useCallback(
            async (url: string, opts: { method?: "PUT" | "POST" }) =>
              httpClient.fetch(url, { method: opts.method ?? "POST" }),
            []
          );
          const a = () => run("/api/v1/widgets", {});
          const b = () => run(\`/api/v1/widgets/\${id}/approve\`, { method: "PUT" });
          const c = () => run(\`/api/v1/widgets/\${id}\`, {});
        }
      `)
    ).toEqual([entry("POST", "/api/v1/widgets/{param}", "dead", "verb")]);
  });

  it("a wrapper nothing calls is still reported, as itself", () => {
    expect(
      fixture(`${PREAMBLE}
        function getW(path: string) { return httpClient.get(\`/api/v1/widgets\${path}\`); }
      `)
    ).toEqual([
      entry(
        "GET",
        "<unresolved> `/api/v1/widgets${path}` #1",
        "unresolved",
        "unresolved"
      ),
    ]);
  });
});

describe("finding 3: multi-segment parameters are per template", () => {
  it("`{repo}` absorbs several segments only where it is `:path`", () => {
    expect(
      fixture(`${PREAMBLE}
        export const one = (o: string, r: string) => httpClient.get(\`/api/v1/prs/\${o}/\${r}/draft\`);
        export const many = (o: string, a: string, b: string) => httpClient.get(\`/api/v1/prs/\${o}/\${a}/\${b}/draft\`);
        export const nudges = (a: string, b: string) => httpClient.get(\`/api/v1/merge/\${a}/\${b}/nudges\`);
      `)
    ).toEqual([
      entry(
        "GET",
        "/api/v1/prs/{param}/{param}/{param}/draft",
        "dead",
        "no-path"
      ),
    ]);
  });
});

describe("finding 4: Next.js route handlers are indexed", () => {
  const nextRoutes = nextRouteTemplates([
    {
      file: "app/api/vga/state/route.ts",
      source: "export async function POST() {}\nexport async function GET() {}",
    },
    {
      file: "app/api/vga/state/[id]/route.ts",
      source:
        "export async function GET() {}\nexport const PATCH = async () => {};",
    },
    {
      file: "app/api/vga/state/import/route.ts",
      source: "export async function POST() {}",
    },
    {
      file: "app/api/ui-bridge/[...path]/route.ts",
      source: "async function h() {}\nexport { h as GET, h as POST };",
    },
    {
      file: "app/api/(docs)/docs/[[...slug]]/route.ts",
      source: "export function GET() {}",
    },
    { file: "app/api/vga/helpers.ts", source: "export function GET() {}" },
  ]);
  const nextIndex = buildSnapshotIndex({}, { nextRoutes });

  it("reads templates and exported verbs off the handler files", () => {
    expect(
      nextRoutes.map((r) => [r.template, [...r.methods].sort().join(",")])
    ).toEqual([
      ["/api/docs", "GET"],
      ["/api/docs/{slug}", "GET"],
      ["/api/ui-bridge/{path}", "GET,POST"],
      ["/api/vga/state", "GET,POST"],
      ["/api/vga/state/import", "POST"],
      ["/api/vga/state/{id}", "GET,PATCH"],
    ]);
  });

  it("a handler-served site passes; an unexported verb is dead", () => {
    const sites = extractCallSites(
      "fixture.ts",
      `${PREAMBLE}
        export const a = (id: string) => httpClient.patch(\`/api/vga/state/\${id}\`, {});
        export const b = () => httpClient.post("/api/vga/state/import", {});
        export const c = () => httpClient.post("/api/ui-bridge/tabs/1/focus", {});
        export const d = () => httpClient.get("/api/docs/a/b");
        export const e = () => httpClient.get("/api/docs");
        export const f = () => httpClient.get("/api/vga/state/import");
        export const g = () => httpClient.delete("/api/ui-bridge/tabs");
      `
    );
    expect(mismatchEntries(sites, nextIndex)).toEqual([
      entry("DELETE", "/api/ui-bridge/tabs", "dead", "verb"),
      entry("GET", "/api/vga/state/import", "dead", "verb"),
    ]);
  });
});

describe("finding 5: only run-time values widen to {param}", () => {
  const SITE = `${PREAMBLE}
    import { SEGMENT } from "./consts";
    export const x = (id: string) => httpClient.put(\`/api/v1/widgets/\${id}/\${SEGMENT}\`, {});
  `;

  it("a re-exported constant in the middle of the URL is unresolved", () => {
    expect(
      fixtureTree({
        "fixture.ts": SITE,
        "consts.ts": `export { SEGMENT } from "./segments";`,
        "segments.ts": `export const SEGMENT = "approve";`,
      })
    ).toMatchObject([{ method: "PUT", reason: "unresolved" }]);
  });

  it("a followable constant still resolves (and passes)", () => {
    expect(
      fixtureTree({
        "fixture.ts": SITE,
        "consts.ts": `export const SEGMENT = "approve";`,
      })
    ).toEqual([]);
  });

  it("a `var` in the middle of the URL is unresolved", () => {
    expect(
      fixture(`${PREAMBLE}
        var SEG = "approve";
        export const x = (id: string) => httpClient.put(\`/api/v1/widgets/\${id}/\${SEG}\`, {});
      `)
    ).toMatchObject([{ method: "PUT", reason: "unresolved" }]);
  });

  it("parameters, properties, calls, loop and destructured values still widen", () => {
    expect(
      fixture(`${PREAMBLE}
        export const p = (id: string) => httpClient.get(\`/api/v1/widgets/\${id}\`);
        export const q = (w: { id: string }) => httpClient.get(\`/api/v1/widgets/\${w.id}\`);
        export const r = (id: string) => httpClient.get(\`/api/v1/widgets/\${encodeURIComponent(id)}\`);
        export const s = (ids: string[]) => { for (const id of ids) httpClient.get(\`/api/v1/widgets/\${id}\`); };
        export const t = ({ id }: { id: string }) => httpClient.get(\`/api/v1/widgets/\${id}\`);
        export function u(props: { id: string }) { const { id } = props; return httpClient.get(\`/api/v1/widgets/\${id}\`); }
      `)
    ).toEqual([]);
  });
});

describe("S1: websocket classification", () => {
  it.each([
    "/api/v1/stream/ws",
    "/api/v1/runner-ws",
    "/api/v1/ws/abc",
    "/api/v1/events_ws",
  ])("%s is a websocket path", (p) => expect(isWebsocketPath(p)).toBe(true));

  it.each([
    "/api/v1/reviews",
    "/api/v1/previews",
    "/api/v1/news",
    "/api/v1/wsx",
  ])("%s is not", (p) => expect(isWebsocketPath(p)).toBe(false));

  it("a dead `/reviews` route is dead, not websocket", () => {
    expect(
      fixture(
        `${PREAMBLE} export const x = () => httpClient.get("/api/v1/reviews");`
      )
    ).toEqual([entry("GET", "/api/v1/reviews", "dead", "no-path")]);
    expect(
      fixture(
        `${PREAMBLE} export const x = () => httpClient.get("/api/v1/stream/ws");`
      )
    ).toMatchObject([{ reason: "websocket" }]);
  });
});
