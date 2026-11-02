/**
 * Static tripwire: no runner door call bypasses the door proxy
 * (plan `2026-09-17-retire-the-runner-origin-guard-dev-grace`, Phase 4,
 * test 7).
 *
 * Every runner request in this app goes through `runnerRequest`
 * (./api-client), which sends door calls to `/api/runner-doors`. A door call
 * can only bypass the proxy by fetching a loopback runner URL itself. This
 * test scans `src/**` for exactly that:
 *
 *   - a `fetch(` whose argument builds a loopback runner URL
 *     (`runnerLoopbackUrl(`, `loopbackBaseForPort(`, `DEFAULT_RUNNER_BASE`,
 *     `.base}` or a literal `localhost:98xx` / `127.0.0.1:98xx`), outside the
 *     two places allowed to (`runnerRequest` itself, and the locality probe's
 *     non-door `/settings/device-info`);
 *   - a literal loopback runner URL naming a door path anywhere;
 *   - `runnerLoopbackUrl(<target>, "<door path>")` (that helper is for
 *     WebSocket and EventSource streams, none of which is a door).
 *
 * The mutation proof is in the last block: the scanner flags the shapes a
 * reintroduced direct door call would take.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchRunnerDoorRoute } from "./door-routes";

const SRC = path.resolve(__dirname, "../..");

/** Files allowed to fetch a loopback runner base directly, and why. */
const ALLOWED_DIRECT_FETCH = new Set([
  // runnerRequest: the one transport, which routes doors to the proxy.
  "lib/runner/api-client.ts",
  // isRunnerLocal: GET /settings/device-info, not a door.
  "lib/runner/locality.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const LOOPBACK_BASE_MARKERS =
  /runnerLoopbackUrl\(|loopbackBaseForPort\(|DEFAULT_RUNNER_BASE|\.base\}|(localhost|127\.0\.0\.1):98\d\d/;

const DOOR_METHODS = ["GET", "POST", "PUT", "DELETE"];

function isDoorPath(p: string): boolean {
  const bare = p.replace(/\$\{[^}]*\}/g, "x");
  return DOOR_METHODS.some((m) => matchRunnerDoorRoute(m, bare) !== null);
}

/** The text of the first argument list after `index` (balanced parens). */
function argText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length && i < open + 2000; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1, open + 2000);
}

export function scanForDoorBypass(rel: string, src: string): string[] {
  const hits: string[] = [];
  if (!ALLOWED_DIRECT_FETCH.has(rel)) {
    for (const m of src.matchAll(/\bfetch\s*\(/g)) {
      const args = argText(src, m.index! + m[0].length - 1);
      if (LOOPBACK_BASE_MARKERS.test(args)) {
        hits.push(
          `${rel}: fetch of a loopback runner URL: fetch(${args.slice(0, 80)})`
        );
      }
    }
  }
  for (const m of src.matchAll(
    /["'`](?:https?:)?\/\/(?:localhost|127\.0\.0\.1):98\d\d(\/[^"'`?\s]*)/g
  )) {
    if (isDoorPath(m[1]!)) hits.push(`${rel}: literal door URL ${m[0]}`);
  }
  for (const m of src.matchAll(
    /runnerLoopbackUrl\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]/g
  )) {
    if (isDoorPath(m[1]!))
      hits.push(`${rel}: runnerLoopbackUrl to door ${m[1]}`);
  }
  return hits;
}

describe("no runner door call bypasses the door proxy", () => {
  it("src/** has no direct loopback fetch to a door", () => {
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      hits.push(...scanForDoorBypass(rel, readFileSync(file, "utf8")));
    }
    expect(hits).toEqual([]);
  });

  it("runnerRequest — the one allowed direct fetch — routes doors through the proxy", () => {
    // The allowance above is safe only while this holds; door-client.test.ts
    // proves the behaviour, this pins the wiring next to the allowance.
    const src = readFileSync(
      path.join(SRC, "lib/runner/api-client.ts"),
      "utf8"
    );
    expect(src).toMatch(/runnerDoorRouting\(route\.base, path,/);
  });

  describe("mutation proof: the scanner flags a reintroduced direct call", () => {
    it.each([
      ['fetch(runnerLoopbackUrl(target, "/hooks"))'],
      ['await fetch(`${route.base}/hooks/${id}/test`, { method: "POST" })'],
      ['fetch("http://localhost:9876/configs/parse", { method: "POST" })'],
      ['const u = "http://127.0.0.1:9877/settings/ai/api-key";'],
    ])("%s", (snippet) => {
      expect(scanForDoorBypass("components/x.tsx", snippet)).not.toEqual([]);
    });

    it("a non-door stream URL is not flagged", () => {
      expect(
        scanForDoorBypass(
          "hooks/x.ts",
          'const u = runnerLoopbackUrl(target, "/ws/events");'
        )
      ).toEqual([]);
    });
  });
});
