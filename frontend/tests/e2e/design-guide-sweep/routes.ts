/**
 * Route enumeration for the design-guide route sweep
 * (tests/e2e/design-guide-sweep.spec.ts; plan
 * 2026-11-21-design-kit-compiler-gaps-and-the-unrequired-design-guide-check,
 * Phase 8).
 *
 * Pure functions over paths relative to `src/app`, plus one directory walk.
 * No Playwright import, so vitest can unit-test it (routes.test.ts, collected
 * by vitest.config.ts's `tests/e2e/**\/*.test.ts` include).
 *
 * What a `page.tsx` file maps to follows the Next.js App Router's own
 * folder conventions:
 *
 *   - `(group)`       a route group: organises files, adds no URL segment.
 *   - `@slot`         a parallel-route slot: renders INTO its parent's
 *                     layout, adds no URL segment. Its page shares the parent's
 *                     URL, so the URL is swept once and every file is listed.
 *   - `_private`      a private folder: it and everything under it is opted
 *                     out of routing. Recorded as `not_a_route`, never dropped.
 *   - `%5Fname`       an escaped underscore: a real URL segment `_name`.
 *   - `[x]`, `[...x]`, `[[...x]]`
 *                     a dynamic segment. No URL is derivable without data, so
 *                     the route is recorded `not_swept: "dynamic segment"`
 *                     with its file, never dropped.
 *   - `(.)x`, `(..)x`, `(..)(..)x`, `(...)x`
 *                     an intercepting route: it renders only on a SOFT
 *                     navigation from inside the app, and a direct hit on its
 *                     URL serves the route it intercepts instead. Recorded
 *                     `not_swept: "intercepting route"`, and its `route` is the
 *                     URL it INTERCEPTS, resolved the way Next resolves it:
 *                     `(.)` the same level, each `(..)` one route segment up
 *                     (groups and slots are not segments), `(...)` the app
 *                     root. That URL has its own page, which the sweep visits
 *                     when it is static.
 *
 * Deliberately left out:
 *   - `route.ts` handlers, `default.tsx` slot fallbacks, `layout.tsx`,
 *     `not-found.tsx` and the other special files are not pages: the sweep
 *     measures rendered pages, and those are either not HTML (route handlers)
 *     or only render beneath a page this walk already visits.
 *   - Rewrites, redirects and middleware in next.config.mjs / middleware.ts
 *     are not read. A static route that redirects at request time reaches the
 *     kit, which reports it as `unknown(redirected)` (exit 3): measured, not
 *     hidden.
 *   - `pageExtensions` is not read from next.config.mjs (it sets none, so
 *     Next's default tsx/ts/jsx/js applies, and that is what PAGE_FILE
 *     matches).
 */
import fs from "node:fs";
import path from "node:path";

/** `page.tsx` and the other default `pageExtensions`; `page.test.tsx` is not a page. */
const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;

export type RouteEntry =
  | { kind: "static"; route: string; file: string }
  | {
      kind: "not_swept";
      route: string;
      file: string;
      reason: "dynamic segment" | "intercepting route";
    }
  | { kind: "not_a_route"; file: string; reason: "private folder" };

const isGroup = (seg: string): boolean => /^\([^.)][^)]*\)$/.test(seg);
const isIntercepting = (seg: string): boolean => /^(\(\.{1,3}\))+/.test(seg);
const isSlot = (seg: string): boolean => seg.startsWith("@");
const isPrivate = (seg: string): boolean => seg.startsWith("_");
const isDynamic = (seg: string): boolean => /\[.*\]/.test(seg);

/**
 * What one page file (path relative to `src/app`, either separator) maps to.
 * Throws on a path whose last segment is not a page file, so a caller that
 * hands it the wrong file fails loudly rather than inventing a route.
 */
export function routeOf(relFile: string): RouteEntry {
  const file = relFile
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
  const parts = file.split("/");
  const leaf = parts.pop();
  if (leaf === undefined || !PAGE_FILE.test(leaf)) {
    throw new Error(`routeOf: ${relFile} is not a page file`);
  }
  if (parts.some(isPrivate))
    return { kind: "not_a_route", file, reason: "private folder" };
  const urlSegs: string[] = [];
  let intercepting = false;
  for (const seg of parts) {
    if (isIntercepting(seg)) {
      intercepting = true;
      const markers = /^(\(\.{1,3}\))+/.exec(seg)?.[0] ?? "";
      for (const m of markers.match(/\(\.{1,3}\)/g) ?? []) {
        if (m === "(...)") urlSegs.length = 0;
        else if (m === "(..)") urlSegs.pop();
      }
      urlSegs.push(seg.slice(markers.length));
      continue;
    }
    if (isGroup(seg) || isSlot(seg)) continue;
    urlSegs.push(seg.replace(/^%5F/i, "_"));
  }
  const route = "/" + urlSegs.join("/");
  if (intercepting)
    return { kind: "not_swept", route, file, reason: "intercepting route" };
  if (urlSegs.some(isDynamic))
    return { kind: "not_swept", route, file, reason: "dynamic segment" };
  return { kind: "static", route, file };
}

/** Every page file under `appDir`, relative to it with `/` separators, sorted. */
export function listPageFiles(appDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && PAGE_FILE.test(ent.name))
        out.push(path.relative(appDir, abs).split(path.sep).join("/"));
    }
  };
  walk(appDir);
  return out.sort();
}

export interface SweepRoute {
  route: string;
  /** Every page file serving this URL (a parallel-route slot shares its parent's). */
  files: string[];
}

export interface Enumeration {
  page_count: number;
  /** One per distinct static URL, sorted by route. */
  static_routes: SweepRoute[];
  not_swept: { route: string; file: string; reason: string }[];
  not_a_route: { file: string; reason: string }[];
}

/** Group page files into the sweep set; nothing is dropped, every file lands in exactly one list. */
export function enumerate(relFiles: readonly string[]): Enumeration {
  const statics = new Map<string, string[]>();
  const notSwept: Enumeration["not_swept"] = [];
  const notARoute: Enumeration["not_a_route"] = [];
  for (const f of relFiles) {
    const e = routeOf(f);
    if (e.kind === "static")
      statics.set(e.route, [...(statics.get(e.route) ?? []), e.file]);
    else if (e.kind === "not_swept")
      notSwept.push({ route: e.route, file: e.file, reason: e.reason });
    else notARoute.push({ file: e.file, reason: e.reason });
  }
  const static_routes = [...statics.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([route, files]) => ({ route, files: files.sort() }));
  return {
    page_count: relFiles.length,
    static_routes,
    not_swept: notSwept,
    not_a_route: notARoute,
  };
}

/**
 * A file-name-safe slug for a route, injective over routes: `r` plus the route
 * with each `/` written `~` and every other character outside `[A-Za-z0-9._-]`
 * (`~` and `%` included) percent-escaped as its UTF-8 bytes, `%XX` each. So `/` -> `r~`, `/index` -> `r~index`,
 * `/a/b` -> `r~a~b`, and `/a~b` -> `r~a%7Eb`.
 */
export function slugOf(route: string): string {
  return (
    "r~" +
    route
      .slice(1)
      .split("/")
      .map((s) =>
        // Each code point outside the safe set becomes its UTF-8 bytes, each a
        // fixed-width `%XX` (as encodeURIComponent does), so no two strings
        // share an escape. A lone surrogate, which no file name on disk holds,
        // is the one input UTF-8 cannot carry.
        s.replace(/[^A-Za-z0-9._-]/gu, (c) =>
          [...Buffer.from(c, "utf8")]
            .map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`)
            .join("")
        )
      )
      .join("~")
  );
}
