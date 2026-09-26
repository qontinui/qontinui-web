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
 * origin is dropped but remembered, run-time substitutions become `{param}`,
 * the query string is dropped), and matches the `(method, path template)`
 * against `lib/api-client/openapi-schema.json` — which backend CI regenerates
 * from `app.openapi()` and fails on any difference — and against the
 * `app/api/**\/route.ts` handlers' exported verbs. A URL built on the backend
 * base URL is never served by a Next.js handler (production sets
 * `NEXT_PUBLIC_API_URL`), and an `app/api/v1/**` handler that only forwards
 * to the identical backend path is not indexed at all
 * (`NEXT_API_V1_SERVERS` lists the ones that do real work).
 *
 * WRAPPERS. A call whose URL prefix, glued path suffix, or method comes from a
 * parameter of its enclosing named function (`request(path, init)`,
 * `this.fetchWithAuth(url, options)`) is not checked itself: every call of
 * that function — in the same file, or in any file importing it — is checked
 * with the caller's arguments bound, including through an aliased import
 * (`import { request as r }`). A caller whose argument does not resolve is
 * `unresolved`, never a pass. Every other reference the walker sees — the
 * function passed as a value, a member wrapper called on an instance
 * (`api.fetchWithAuth(...)`) in a file importing its module — is its own
 * `unresolved` site, and a wrapper nothing is found calling is reported as
 * its own `unresolved` site. So is a URL glued onto a parameter of an
 * anonymous callback (`ids.map((p) => httpClient.get(\`${PREFIX}${p}\`))`).
 *
 * A `{param}` matches only a template PARAMETER, never a literal segment:
 * `/users/${userId}/activity` is not served by `/users/me/activity`. When a
 * `{param}` would have to fill a literal, a named function's parameter makes
 * that function a wrapper (resolved per caller, as `createCrud("checks")`);
 * any other value makes the site `unresolved`. A parameter typed as a
 * string-literal union (`action: "approve" | "reject"`) is checked value by
 * value. Mid-URL, only run-time values widen to `{param}`: a declared
 * constant the walker cannot read — a missing key, `Object.freeze`, an alias
 * or nested/element read it cannot follow, an unfollowable import — is
 * `unresolved`, and so is a run-time value glued onto a non-`/` path prefix
 * unless it is a parameter resolved per caller.
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
 *   - a member wrapper called on an instance is reported `unresolved`, not
 *     resolved; one called from a file that does not import its module is not
 *     seen at all — and that includes an instance imported through a barrel
 *     re-export (`import { api } from "@/services"`) or returned by a hook
 *     (`useApi().fetchWithAuth(...)`), which count as "not importing it";
 *   - wrappers reached by default import, namespace import or re-export;
 *   - calls through anything that is not an `HttpClient` (bare `fetch`,
 *     axios, the generated `lib/api-client`, `EventSource`, `WebSocket`);
 *   - the origin is recognised only as `ApiConfig.API_BASE_URL` /
 *     `getBaseUrl()` / `getApiUrl()` / `process.env.NEXT_PUBLIC_API_URL`
 *     (directly or through a followed const); a backend URL built any other
 *     way reads as same-origin and may be served by a Next.js handler;
 *   - a `{param}` standing for several segments where the template has one:
 *     only snapshot templates in `MULTI_SEGMENT_TEMPLATE_PARAMS` (and Next.js
 *     `[...x]`) absorb more than one segment, so such a site reads `dead`.
 *
 * THE BASELINE IS SHRINK-ONLY. `known-route-mismatches.json` holds today's
 * backlog: one entry per `(file, method, path)` for a resolved site, and one
 * per occurrence for an unresolved one — `<path> #<n>` when only the method
 * is unreadable, `<unresolved> <source> #<n>` otherwise, `n` counting the
 * file's unresolved sites with the same method and label in source order. This test fails on:
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
import ts from "typescript";
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
  NEXT_API_V1_SERVERS,
  nextRouteTemplates,
  walkSources,
  walkSourceTree,
} from "./route-walker";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, "../..");
const BACKEND_API = path.resolve(SRC_ROOT, "../../backend/app/api/v1");
const BASELINE_FILE = path.join(HERE, "known-route-mismatches.json");

const SNAPSHOT_PATHS = loadSnapshotPaths();
const tree = walkSourceTree(SRC_ROOT, SNAPSHOT_PATHS);
const { index } = tree;

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
];

function describeEntries(entries: BaselineEntry[]): string {
  return entries
    .map((e) => `  ${e.reason}/${e.kind} ${e.method} ${e.path}  (${e.file})`)
    .join("\n");
}

/** A path segment the forwarded URL fills at run time (`${id}`). */
const FWD_PARAM = "{p}";
/** A query-string suffix (`${url.search}`, `${qs ? `?${qs}` : ""}`). */
const FWD_QUERY = "?Q";

/**
 * For each exported `GET`/`POST`/… of a route module: every PATH the verb can
 * forward to — one per alternative — for each `fetch(url, …)` in the verb or
 * a same-file function it calls. A URL is normalised as:
 *   - a leading `${base}` (the backend origin: `${BACKEND_URL}…`) is dropped;
 *     it is the ONLY variable whose value is not part of the path, so
 *     `${ownUrl}/other` forwards to `/other`, not to `ownUrl`;
 *   - a variable that is the whole URL (`fetch(backendUrl)`) or a whole
 *     later part (`${backendPath}`) is replaced by its initializer, a
 *     conditional by each branch, and each `url += "/x"` adds an alternative;
 *   - a `.search` read, or a conditional whose branches are `""` or start
 *     with `?`, becomes `FWD_QUERY`; any other substitution `FWD_PARAM`.
 */
function forwardedPaths(sf: ts.SourceFile): Map<string, string[]> {
  const VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  const exported = (n: ts.Node) =>
    ts.canHaveModifiers(n) &&
    (ts.getModifiers(n) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword
    );
  const fns = new Map<string, ts.Node>();
  const verbs = new Map<string, ts.Node>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      fns.set(stmt.name.text, stmt);
      if (exported(stmt) && VERBS.has(stmt.name.text))
        verbs.set(stmt.name.text, stmt);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        fns.set(d.name.text, d.initializer);
        if (exported(stmt) && VERBS.has(d.name.text))
          verbs.set(d.name.text, d.initializer);
      }
    }
  }
  const within = (n: ts.Node, scope: ts.Node) =>
    n.pos >= scope.pos && n.end <= scope.end;
  const moduleLevel = (d: ts.VariableDeclaration) =>
    d.parent.parent.parent === sf;
  const decl = (name: string, scope: ts.Node) => {
    let found: ts.VariableDeclaration | undefined;
    const find = (m: ts.Node): void => {
      if (
        ts.isVariableDeclaration(m) &&
        ts.isIdentifier(m.name) &&
        m.name.text === name &&
        (within(m, scope) || moduleLevel(m))
      )
        found ??= m;
      ts.forEachChild(m, find);
    };
    find(sf);
    return found;
  };
  const appends = (name: string, scope: ts.Node): ts.Expression[] => {
    const out: ts.Expression[] = [];
    const find = (m: ts.Node): void => {
      if (
        ts.isBinaryExpression(m) &&
        m.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
        ts.isIdentifier(m.left) &&
        m.left.text === name &&
        within(m, scope)
      )
        out.push(m.right);
      ts.forEachChild(m, find);
    };
    find(sf);
    return out;
  };
  const isQueryOnly = (raw: ts.Expression, scope: ts.Node): boolean => {
    const e = ts.isParenthesizedExpression(raw) ? raw.expression : raw;
    if (ts.isPropertyAccessExpression(e) && e.name.text === "search")
      return true;
    if (ts.isConditionalExpression(e)) {
      const q = (b: ts.Expression) => {
        const t = ts.isParenthesizedExpression(b) ? b.expression : b;
        const head = ts.isTemplateExpression(t)
          ? t.head.text
          : ts.isStringLiteralLike(t)
            ? t.text
            : null;
        return head === "" || (head !== null && head.startsWith("?"));
      };
      return q(e.whenTrue) && q(e.whenFalse);
    }
    if (ts.isIdentifier(e)) {
      const d = decl(e.text, scope);
      return !!d?.initializer && isQueryOnly(d.initializer, scope);
    }
    return false;
  };
  /** Path alternatives of `raw`; `dropBase` drops a leading `${base}`. */
  const paths = (
    raw: ts.Expression,
    scope: ts.Node,
    dropBase: boolean,
    depth = 0
  ): string[] => {
    if (depth > 6) return [];
    const e = ts.isParenthesizedExpression(raw) ? raw.expression : raw;
    if (ts.isStringLiteralLike(e)) return [e.text];
    if (ts.isConditionalExpression(e))
      return [
        ...paths(e.whenTrue, scope, dropBase, depth + 1),
        ...paths(e.whenFalse, scope, dropBase, depth + 1),
      ];
    if (ts.isIdentifier(e)) {
      const d = decl(e.text, scope);
      if (!d?.initializer) return [FWD_PARAM];
      const own = paths(d.initializer, scope, dropBase, depth + 1);
      const extra = appends(e.text, scope).flatMap((rhs) =>
        paths(rhs, scope, false, depth + 1).flatMap((a) =>
          own.map((o) => o + a)
        )
      );
      return [...own, ...extra];
    }
    if (!ts.isTemplateExpression(e)) return [FWD_PARAM];
    let alts = [e.head.text];
    e.templateSpans.forEach((span, i) => {
      let parts: string[];
      if (i === 0 && dropBase && e.head.text === "") parts = [""];
      else if (isQueryOnly(span.expression, scope)) parts = [FWD_QUERY];
      else if (
        ts.isIdentifier(span.expression) &&
        decl(span.expression.text, scope)?.initializer &&
        !alts.every((a) => a.endsWith("/"))
      )
        parts = paths(span.expression, scope, false, depth + 1);
      else parts = [FWD_PARAM];
      alts = alts.flatMap((a) => parts.map((p) => a + p + span.literal.text));
    });
    return alts;
  };
  const result = new Map<string, string[]>();
  for (const [verb, fn] of verbs) {
    const scopes = [fn];
    const calls = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        fns.has(n.expression.text)
      )
        scopes.push(fns.get(n.expression.text) as ts.Node);
      ts.forEachChild(n, calls);
    };
    calls(fn);
    const out: string[] = [];
    for (const scope of scopes) {
      const fetches = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === "fetch" &&
          n.arguments[0]
        )
          out.push(...paths(n.arguments[0], scope, true));
        ts.forEachChild(n, fetches);
      };
      fetches(scope);
    }
    result.set(verb, [...new Set(out)]);
  }
  return result;
}

/** `/api/v1/ai-tasks/{id}` as a forwarded path, optionally with a query suffix. */
function ownPathPattern(template: string): RegExp {
  const body = template
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(FWD_PARAM.replace(/[{}]/g, "\\$&"));
  return new RegExp(`^${body}(${FWD_QUERY.replace("?", "\\?")})?$`);
}

/**
 * Proxy verbs that can forward to a path other than their own, and why that
 * branch never fires for the URL the handler serves. Only these may have
 * alternatives beyond the own path; each must still have the own path.
 */
const BRANCHING_FORWARDERS: ReadonlyMap<string, string> = new Map([
  [
    "app/api/v1/execution/runs/[runId]/route.ts PUT",
    "appends `/complete` only when the request pathname ends in `/complete`; this route's pathname is `/runs/{runId}`",
  ],
  [
    "app/api/v1/users/me/automation-streaming/route.ts POST",
    "appends `/toggle` / `/reset-limit` only when request.url contains them; those URLs are their own route files",
  ],
]);

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

  it("automation-streaming-card no longer carries the dead reset-limit call", () => {
    // Phase 4 deleted a commented-out block: commented code has no call site
    // for the walker to see, and the route it named IS served, so only the
    // source text can say the block is gone.
    const card = readFileSync(
      path.join(SRC_ROOT, "components/profile/automation-streaming-card.tsx"),
      "utf8"
    );
    expect(card).not.toContain("reset-limit");
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

  it("every unindexed /api/v1 handler's exported verbs forward to exactly the handler's own path", () => {
    // Parsed, per verb: every path its `fetch(...)` calls can forward to
    // (`forwardedPaths`) must END at the handler's own path, a query-string
    // suffix aside. Comments are not expressions, so a doc comment cannot
    // satisfy it; `${ownUrl}/other` forwards to `/other`.
    //
    // Two verbs branch, and are classified by what they forward for the URL
    // they SERVE — see `BRANCHING_FORWARDERS`: there the own path must be
    // one of the alternatives, and the entry must really be needed.
    const proxies = tree.nextRoutes.filter((r) => r.backendProxy);
    expect(proxies.length).toBeGreaterThan(0);
    const branching = new Set<string>();
    for (const r of proxies) {
      const own = ownPathPattern(r.template);
      const source = readFileSync(path.join(SRC_ROOT, r.file), "utf8");
      const byVerb = forwardedPaths(
        ts.createSourceFile(r.file, source, ts.ScriptTarget.Latest, true)
      );
      for (const verb of r.methods) {
        const alts = byVerb.get(verb) ?? [];
        const label = `${r.file} ${verb}`;
        const others = alts.filter((a) => !own.test(a));
        expect(
          alts.some((a) => own.test(a)),
          `${label}: ${alts.join(" | ")}`
        ).toBe(true);
        if (BRANCHING_FORWARDERS.has(label)) {
          branching.add(label);
          expect(others.length, `${label} no longer branches`).toBeGreaterThan(
            0
          );
        } else {
          expect(others, `${label} forwards elsewhere`).toEqual([]);
        }
      }
    }
    expect([...branching].sort()).toEqual(
      [...BRANCHING_FORWARDERS.keys()].sort()
    );
    for (const file of NEXT_API_V1_SERVERS)
      expect(tree.nextRoutes.map((r) => r.file)).toContain(file);
  });
});

/**
 * `(template, param)` for every `{name:path}` route under `backend/app/api`,
 * composed from each `@<router>.<verb>("…")` decorator and the prefixes its
 * router is mounted under: `include_router(<module>.<router>, prefix=…)` in
 * `api.py`, and `<router>.include_router(<sub>, prefix=…)` inside a module.
 * Also returns how many decorators the scan read, and every quoted
 * `…{x:path}…` string literal no decorator consumed (a route this scan would
 * silently miss).
 */
function scanBackendPathParams(): {
  pairs: [string, string][];
  decorators: number;
  unconsumed: string[];
} {
  const api = readFileSync(path.join(BACKEND_API, "api.py"), "utf8");
  /** `module.router` -> mount prefixes. */
  const mounts = new Map<string, string[]>();
  const mount = (key: string, prefix: string): void => {
    mounts.set(key, [...(mounts.get(key) ?? []), prefix]);
  };
  const prefixOf = (args: string | undefined): string =>
    /prefix\s*=\s*["']([^"']*)["']/.exec(args ?? "")?.[1] ?? "";
  for (const m of api.matchAll(
    /include_router\(\s*(\w+)\.(\w+)\s*(?:,([^)]*))?\)/g
  )) {
    mount(`${m[1]}.${m[2]}`, prefixOf(m[3]));
  }
  const apiRoot = path.dirname(BACKEND_API);
  const pairs: [string, string][] = [];
  const unconsumed: string[] = [];
  let decorators = 0;
  for (const rel of readdirSync(apiRoot, { recursive: true }) as string[]) {
    if (!rel.endsWith(".py")) continue;
    const src = readFileSync(path.join(apiRoot, rel), "utf8");
    const mod = path.basename(rel, ".py");
    const flat = path.dirname(rel) === path.join("v1", "endpoints");
    // Sub-routers mounted on a module router: `router.include_router(sub)`.
    const local = new Map<string, string[]>();
    const prefixesOf = (router: string): string[] | undefined => {
      const direct = flat ? mounts.get(`${mod}.${router}`) : undefined;
      if (direct) return direct;
      return local.get(router);
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const m of src.matchAll(
        /(\w+)\.include_router\(\s*(\w+)\s*(?:,([^)]*))?\)/g
      )) {
        const parent = prefixesOf(m[1] as string);
        const sub = m[2] as string;
        if (!parent || local.has(sub)) continue;
        local.set(
          sub,
          parent.map((p) => p + prefixOf(m[3]))
        );
        changed = true;
      }
    }
    const consumed: [number, number][] = [];
    for (const d of src.matchAll(
      /@(\w+)\.(?:get|post|put|patch|delete|api_route)\(\s*(?:path\s*=\s*)?(["'])(.*?)\2/g
    )) {
      decorators++;
      const start = d.index ?? 0;
      consumed.push([start, start + d[0].length]);
      const route = d[3] as string;
      const names = [...route.matchAll(/\{(\w+):path\}/g)].map(
        (n) => n[1] as string
      );
      if (names.length === 0) continue;
      const prefixes = prefixesOf(d[1] as string);
      if (!prefixes) {
        throw new Error(
          `${rel}: ${d[0]} — its router's mount prefix was not found; extend scanBackendPathParams`
        );
      }
      for (const prefix of prefixes) {
        const template = `/api/v1${prefix}${route.replace(/\{(\w+):\w+\}/g, "{$1}")}`;
        for (const name of names) pairs.push([template, name]);
      }
    }
    for (const lit of src.matchAll(/(["'])[^"'\n]*\{\w+:path\}[^"'\n]*\1/g)) {
      const at = lit.index ?? 0;
      if (!consumed.some(([a, b]) => at >= a && at < b))
        unconsumed.push(`${rel}: ${lit[0]}`);
    }
  }
  // One pair per template, however many verbs declare it.
  const unique = [...new Map(pairs.map((p) => [p.join(" "), p])).values()];
  return {
    pairs: unique.sort((a, b) => (a.join(" ") < b.join(" ") ? -1 : 1)),
    decorators,
    unconsumed,
  };
}

describe("MULTI_SEGMENT_TEMPLATE_PARAMS", () => {
  const scan = scanBackendPathParams();

  it("is exactly the backend's `{x:path}` routes, recomputed from source", () => {
    expect(
      [...MULTI_SEGMENT_TEMPLATE_PARAMS]
        .map(([t, n]) => [t, n])
        .sort((a, b) => (a.join(" ") < b.join(" ") ? -1 : 1))
    ).toEqual(scan.pairs);
  });

  it("the backend scan read every route decorator and every `:path` literal", () => {
    const { decorators, unconsumed } = scan;
    expect(decorators).toBeGreaterThan(1000);
    expect(unconsumed, "`{x:path}` strings no decorator scan consumed").toEqual(
      []
    );
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
  return mismatchEntries(
    extractCallSites("fixture.ts", source, undefined, fixtureIndex),
    fixtureIndex
  );
}

/** Several in-memory files, walked as a tree (imports followed between them). */
function fixtureTree(files: Record<string, string>): BaselineEntry[] {
  return mismatchEntries(
    walkSources(Object.keys(files), memoryModuleLoader(files), fixtureIndex),
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

describe("N1: a parameter glued onto a path prefix is resolved per caller, or unresolved", () => {
  const WRAP = `${PREAMBLE}
    const PREFIX = "/api/v1/widgets";
    function getW(path: string) { return httpClient.get(\`\${PREFIX}\${path}\`); }
  `;
  const unresolvedCall = (text: string) =>
    entry("GET", `<unresolved> ${text} #1`, "unresolved", "unresolved");

  it("a caller argument that starts with a property is unresolved", () => {
    expect(
      fixture(
        `${WRAP} export const a = (o: { p: string }) => getW(\`\${o.p}\`);`
      )
    ).toEqual([unresolvedCall("getW(`${o.p}`)")]);
  });

  it("a caller argument that is only a substitution is unresolved", () => {
    expect(
      fixture(`${WRAP} export const b = (q: string) => getW(\`\${q}\`);`)
    ).toEqual([unresolvedCall("getW(`${q}`)")]);
  });

  it('a caller argument `"" + q` is unresolved', () => {
    expect(
      fixture(`${WRAP} export const c = (q: string) => getW("" + q);`)
    ).toEqual([unresolvedCall('getW("" + q)')]);
  });

  it("a URL glued onto an anonymous callback's parameter is unresolved", () => {
    expect(
      fixture(`${PREAMBLE}
        const PREFIX = "/api/v1/widgets";
        export const d = (ps: string[]) => ps.map((p) => httpClient.get(\`\${PREFIX}\${p}\`));
      `)
    ).toEqual([
      entry(
        "GET",
        "<unresolved> `${PREFIX}${p}` #1",
        "unresolved",
        "unresolved"
      ),
    ]);
  });

  it("an argument with a `/` head still widens its segments", () => {
    expect(
      fixture(`${WRAP} export const e = (id: string) => getW(\`/\${id}\`);`)
    ).toEqual([]);
  });
});

describe("N2: backend-origin calls and /api/v1 proxies are not Next-served", () => {
  const nextRoutes = nextRouteTemplates([
    {
      file: "app/api/ui-bridge/[...path]/route.ts",
      source: "export async function GET() {}",
    },
    {
      file: "app/api/v1/ai-tasks/route.ts",
      source: "export async function GET() {}",
    },
    {
      file: "app/api/v1/ws-token/route.ts",
      source: "export async function GET() {}",
    },
  ]);
  const idx = buildSnapshotIndex({}, { nextRoutes });
  const check = (source: string) =>
    mismatchEntries(extractCallSites("fixture.ts", source), idx);

  it("an origin-backed call to a Next-only path is dead", () => {
    expect(
      check(`${PREAMBLE}
        export const a = () => httpClient.get(\`\${ApiConfig.API_BASE_URL}/api/ui-bridge/tabs\`);
        export const b = () => httpClient.get("/api/ui-bridge/tabs");
      `)
    ).toEqual([entry("GET", "/api/ui-bridge/tabs", "dead", "no-path")]);
  });

  it("an /api/v1 proxy handler path missing from the snapshot is dead", () => {
    expect(
      check(`${PREAMBLE}
        export const a = () => httpClient.get("/api/v1/ai-tasks");
        export const b = () => httpClient.get("/api/v1/ws-token");
      `)
    ).toEqual([entry("GET", "/api/v1/ai-tasks", "dead", "no-path")]);
  });
});

describe("N3: method-unresolved sites are keyed per occurrence", () => {
  const TWO = `${PREAMBLE}
    export const a = () => httpClient.fetch("/api/v1/widgets", opts);
    export const b = () => httpClient.fetch("/api/v1/widgets", opts);
  `;

  it("two method-unresolved fetches to the same path are two entries", () => {
    expect(fixture(TWO)).toEqual([
      entry("?", "/api/v1/widgets #1", "unresolved", "unresolved"),
      entry("?", "/api/v1/widgets #2", "unresolved", "unresolved"),
    ]);
  });

  it("a second one added beside a baselined one is new", () => {
    const baseline = fixture(`${PREAMBLE}
      export const a = () => httpClient.fetch("/api/v1/widgets", opts);
    `);
    expect(diffAgainstBaseline(fixture(TWO), baseline).added).toEqual([
      entry("?", "/api/v1/widgets #2", "unresolved", "unresolved"),
    ]);
  });
});

describe("N4: a missing key or unfollowable object in a property read does not widen", () => {
  const SITE = (decl: string) => `${PREAMBLE}
    ${decl}
    export const x = (id: string) => httpClient.put(\`/api/v1/widgets/\${id}/\${EP.seg}\`, {});
  `;

  it("a property of a re-exported object is unresolved", () => {
    expect(
      fixtureTree({
        "fixture.ts": SITE(`import { EP } from "./consts";`),
        "consts.ts": `export { EP } from "./eps";`,
        "eps.ts": `export const EP = { seg: "approve" };`,
      })
    ).toMatchObject([{ method: "PUT", reason: "unresolved" }]);
  });

  it("a key missing from a declared literal is unresolved", () => {
    expect(fixture(SITE(`const EP = { other: "approve" };`))).toMatchObject([
      { method: "PUT", reason: "unresolved" },
    ]);
  });

  it("a key the literal has still resolves (and passes)", () => {
    expect(fixture(SITE(`const EP = { seg: "approve" };`))).toEqual([]);
  });
});

describe("N6: no reference to a wrapper is silently dropped", () => {
  const REQ = `${PREAMBLE}
    export async function request(path: string) {
      return httpClient.get(\`\${ApiConfig.API_BASE_URL}/api/v1/widgets\${path}\`);
    }`;

  it("an aliased import is followed like the name", () => {
    expect(
      fixtureTree({
        "services/req.ts": REQ,
        "features/use.ts": `
          import { request as r } from "@/services/req";
          export const gone = () => r("/gone/too");`,
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

  it("a wrapper passed as a value is unresolved; a hook dependency is not a use", () => {
    expect(
      fixtureTree({
        "services/req.ts": REQ,
        "features/use.ts": `
          import { request } from "@/services/req";
          export const ok = () => request("");
          export const handler = request;
          export const memo = useMemo(() => 1, [request]);`,
      })
    ).toEqual([
      entry(
        "?",
        "<unresolved> request #1",
        "unresolved",
        "unresolved",
        "features/use.ts"
      ),
    ]);
  });

  it("a member wrapper called on an instance elsewhere is unresolved", () => {
    expect(
      fixtureTree({
        "services/api.ts": `${PREAMBLE}
          export class Api {
            fetchWithAuth(url: string) {
              return httpClient.get(\`\${ApiConfig.API_BASE_URL}/api/v1\${url}\`);
            }
            list() { return this.fetchWithAuth("/widgets"); }
          }
          export const api = new Api();`,
        "features/x.ts": `
          import { api } from "@/services/api";
          export const gone = () => api.fetchWithAuth("/nope");`,
      })
    ).toEqual([
      entry(
        "?",
        '<unresolved> api.fetchWithAuth("/nope") #1',
        "unresolved",
        "unresolved",
        "features/x.ts"
      ),
    ]);
  });
});

describe("W1: a {param} never stands in for a literal route segment", () => {
  it("a named function's parameter filling a literal is resolved per caller", () => {
    expect(
      fixture(`${PREAMBLE}
        function crud(resource: string) {
          return { list: () => httpClient.get(\`/api/v1/\${resource}\`) };
        }
        export const a = crud("nope");
        export const b = crud("widgets");
      `)
    ).toEqual([entry("GET", "/api/v1/nope", "dead", "no-path")]);
  });

  it("any other value filling a literal is unresolved", () => {
    expect(
      fixture(`${PREAMBLE}
        export const x = (rs: string[]) => { for (const r of rs) httpClient.get(\`/api/v1/\${r}\`); };
      `)
    ).toMatchObject([{ method: "GET", reason: "unresolved" }]);
  });

  it("a {param} against a template parameter still passes", () => {
    expect(
      fixture(`${PREAMBLE}
        export const one = (id: string) => httpClient.get(\`/api/v1/widgets/\${id}\`);
      `)
    ).toEqual([]);
  });

  it("a string-literal-union parameter is checked value by value", () => {
    expect(
      fixture(`${PREAMBLE}
        type Verb = "approve" | "nope";
        export const act = (id: string, action: Verb) =>
          httpClient.put(\`/api/v1/widgets/\${id}/\${action}\`, {});
      `)
    ).toEqual([
      entry("PUT", "/api/v1/widgets/{param}/nope", "dead", "no-path"),
    ]);
  });
});

/**
 * Fixtures whose `{param}` lands on a template PARAMETER, so the W1 rule
 * (never fill a literal) cannot be what turns them red.
 */
function fixtureAgainst(
  paths: Record<string, Record<string, unknown>>,
  source: string
): BaselineEntry[] {
  const idx = buildSnapshotIndex(paths, { multiSegment: [] });
  return mismatchEntries(
    extractCallSites("fixture.ts", source, undefined, idx),
    idx
  );
}

describe("W2: a run-time value glued onto a path prefix is unresolved", () => {
  const unresolvedOne = [{ method: "GET", reason: "unresolved" }];
  // `widgets{param}` aligns with `{kind}`, `/{param}{param}` with `{widget_id}`.
  const W2_PATHS = {
    "/api/v1/widgets": { get: {} },
    "/api/v1/{kind}": { get: {} },
    "/api/v1/widgets/{widget_id}": { get: {} },
  };

  it("a nested `+` template is judged in context (query values still pass)", () => {
    expect(
      fixture(`${PREAMBLE}
        export const u = (d: string) =>
          httpClient.get(\`/api/v1/widgets?device_id=\` + \`\${encodeURIComponent(d)}&limit=5\`);
      `)
    ).toEqual([]);
  });

  it.each([
    [
      "a loop variable",
      `export const x = () => { for (const s of ["/nope/deep"]) httpClient.get(\`/api/v1/widgets\${s}\`); };`,
    ],
    [
      "`this.x` with no initializer",
      `class A { go() { return httpClient.get(\`/api/v1/widgets\${this.other}\`); } }`,
    ],
    [
      "a call result",
      `export const x = () => httpClient.get(\`/api/v1/widgets\${mk()}\`);`,
    ],
    [
      "a destructured parameter",
      `export const x = ({ s }: { s: string }) => httpClient.get(\`/api/v1/widgets\${s}\`);`,
    ],
    [
      "a caller's own parameter glued inside its argument",
      `const PREFIX = "/api/v1/widgets";
       function getW(path: string) { return httpClient.get(\`\${PREFIX}\${path}\`); }
       export const c = (a: string, b: string) => getW(\`/\${a}\${b}\`);`,
    ],
    [
      "an outer function's parameter under an inner named wrapper",
      `export function outer(sfx: string) {
         function inner(base: string) { return httpClient.get(\`\${base}/api/v1/widgets\${sfx}\`); }
         return inner("");
       }`,
    ],
  ])("%s", (_label, body) => {
    expect(fixtureAgainst(W2_PATHS, `${PREAMBLE}${body}`)).toMatchObject(
      unresolvedOne
    );
  });
});

describe("W3: a declared constant's unreadable property does not widen", () => {
  const SITE = (decl: string, read: string) => `${PREAMBLE}
    ${decl}
    export const x = (id: string) => httpClient.put(\`/api/v1/widgets/\${id}/\${${read}}\`, {});
  `;
  const unresolvedPut = [{ method: "PUT", reason: "unresolved" }];
  // A `{field}` parameter, so a widened `{param}` WOULD align and pass.
  const W3_PATHS = {
    "/api/v1/widgets/{widget_id}": { get: {} },
    "/api/v1/widgets/{widget_id}/approve": { put: {} },
    "/api/v1/widgets/{widget_id}/{field}": { put: {} },
  };
  const w3 = (source: string) => fixtureAgainst(W3_PATHS, source);

  it.each([
    [
      "Object.freeze without the key",
      `const EP = Object.freeze({ other: "x" });`,
      "EP.seg",
    ],
    [
      "an alias of a literal",
      `const E0 = { other: "x" }; const EP = E0;`,
      "EP.seg",
    ],
    ["a nested read", `const EP = { a: { other: "x" } };`, "EP.a.seg"],
    ["an element access", `const EP = { other: "x" };`, `EP["seg"]`],
    [
      "a computed key",
      `const EP = { seg: "approve" }; const k = pick();`,
      "EP[k]",
    ],
  ])("%s is unresolved", (_label, decl, read) => {
    expect(w3(SITE(decl, read))).toMatchObject(unresolvedPut);
  });

  it.each([
    [
      "Object.freeze",
      `const EP = Object.freeze({ seg: "approve" });`,
      "EP.seg",
    ],
    ["an alias", `const E0 = { seg: "approve" }; const EP = E0;`, "EP.seg"],
    ["a nested read", `const EP = { a: { seg: "approve" } };`, "EP.a.seg"],
    ["an element access", `const EP = { seg: "approve" };`, `EP["seg"]`],
  ])("%s with the key resolves (and passes)", (_label, decl, read) => {
    expect(w3(SITE(decl, read))).toEqual([]);
  });

  it("a run-time object's property still widens", () => {
    expect(
      w3(`${PREAMBLE}
        export async function x() {
          const sm = await load();
          return httpClient.get(\`/api/v1/widgets/\${sm.projectId}\`);
        }
      `)
    ).toEqual([]);
  });
});

describe("S2/S3: caller discovery", () => {
  const REQ = `${PREAMBLE}
    export async function request(path: string) {
      return httpClient.get(\`/api/v1/widgets\${path}\`);
    }
    export default 1;`;

  it("a default-plus-named import is followed", () => {
    expect(
      fixtureTree({
        "services/req.ts": REQ,
        "features/use.ts": `
          import def, { request } from "@/services/req";
          export const gone = () => request("/gone/deep");`,
      })
    ).toEqual([
      entry(
        "GET",
        "/api/v1/widgets/gone/deep",
        "dead",
        "no-path",
        "features/use.ts"
      ),
    ]);
  });

  it("only React's own dependency arrays are exempt", () => {
    expect(
      fixtureTree({
        "services/req.ts": REQ,
        "features/use.ts": `
          import { request } from "@/services/req";
          export const ok = () => request("");
          const a = useCallback(() => 1, [request]);
          useImperativeHandle(ref, () => ({}), [request]);
          const b = useParallel(opts, [request]);`,
      })
    ).toEqual([
      entry(
        "?",
        "<unresolved> request #1",
        "unresolved",
        "unresolved",
        "features/use.ts"
      ),
    ]);
  });
});

describe("S2: the pass-through check itself", () => {
  const verbPaths = (body: string) =>
    forwardedPaths(
      ts.createSourceFile(
        "app/api/v1/own/[id]/route.ts",
        `const BACKEND_URL = process.env.BACKEND_URL;\n${body}`,
        ts.ScriptTarget.Latest,
        true
      )
    ).get("GET") ?? [];
  const own = ownPathPattern("/api/v1/own/{id}");
  const onlyOwn = (body: string) => {
    const alts = verbPaths(body);
    return alts.length > 0 && alts.every((a) => own.test(a));
  };

  it("an own-path variable used as a base for another path is not a pass-through", () => {
    expect(
      onlyOwn(`export async function GET(r: Request, id: string) {
        const u = \`\${BACKEND_URL}/api/v1/own/\${id}\`;
        return fetch(\`\${u}/other\`);
      }`)
    ).toBe(false);
  });

  it("a path suffix after the own path is not a pass-through", () => {
    expect(
      onlyOwn(`export async function GET(r: Request, id: string, suffix: string) {
        return fetch(\`\${BACKEND_URL}/api/v1/own/\${id}\${suffix}\`);
      }`)
    ).toBe(false);
  });

  it("a comment naming the own path is not a pass-through", () => {
    expect(
      onlyOwn(`export async function GET(r: Request, id: string) {
        // fetch(\`\${BACKEND_URL}/api/v1/own/\${id}\`)
        return fetch(\`\${BACKEND_URL}/api/v1/other/\${id}\`);
      }`)
    ).toBe(false);
  });

  it("the own path with a query suffix is a pass-through", () => {
    expect(
      onlyOwn(`export async function GET(r: Request, id: string) {
        const url = new URL(r.url);
        const qs = url.searchParams.toString();
        const backendUrl = \`\${BACKEND_URL}/api/v1/own/\${id}\${qs ? \`?\${qs}\` : ""}\`;
        return fetch(backendUrl, {});
      }`)
    ).toBe(true);
  });
});

describe("W1 (round 4): query-named substitutions are resolved, not cut", () => {
  it.each([
    [
      "a conditional `suffix`",
      `export const x = (a: boolean) => { const suffix = a ? "/nope" : ""; return httpClient.get(\`/api/v1/widgets\${suffix}\`); };`,
    ],
    [
      "a constant `suffix`",
      `const suffix = "/nope/deep"; export const x = () => httpClient.get(\`/api/v1/widgets\${suffix}\`);`,
    ],
    [
      "an object's `search`",
      `const R = { search: "/nope" }; export const x = () => httpClient.get(\`/api/v1/widgets\${R.search}\`);`,
    ],
    [
      "a constant `filter` segment",
      `const filter = "archived"; export const x = () => httpClient.get(\`/api/v1/widgets/\${filter}\`);`,
    ],
    [
      "a `filter` parameter before a literal",
      `export const x = (filter: string) => httpClient.get(\`/api/v1/widgets/\${filter}/nope\`);`,
    ],
    [
      "a wrapper's `params` argument",
      `function g(params: string) { return httpClient.get(\`/api/v1/widgets\${params}\`); } export const x = () => g("/nope/deep");`,
    ],
  ])("%s never passes", (_label, body) => {
    const entries = fixture(`${PREAMBLE}${body}`);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(["dead", "unresolved"]).toContain(e.reason);
  });

  it("a query-named value that IS a query string still passes", () => {
    expect(
      fixture(`${PREAMBLE}
        function g(params: string) { return httpClient.get(\`/api/v1/widgets\${params}\`); }
        export const a = () => g("?x=1");
        export const b = () => g("");
        export const c = (qs: string) => httpClient.get(\`/api/v1/widgets\${qs ? \`?\${qs}\` : ""}\`);
      `)
    ).toEqual([]);
  });
});

describe("S1 (round 4): an optional literal-union parameter is not expanded", () => {
  it('`action?: "approve"` may be undefined, so it is not read as `approve`', () => {
    expect(
      fixture(`${PREAMBLE}
        export const act = (id: string, action?: "approve") =>
          httpClient.put(\`/api/v1/widgets/\${id}/\${action}\`, {});
      `)
    ).toMatchObject([{ method: "PUT", reason: "unresolved" }]);
  });

  it('`action: "approve" | undefined` is not expanded either', () => {
    expect(
      fixture(`${PREAMBLE}
        export const act = (id: string, action: "approve" | undefined) =>
          httpClient.put(\`/api/v1/widgets/\${id}/\${action}\`, {});
      `)
    ).toMatchObject([{ method: "PUT", reason: "unresolved" }]);
  });
});
