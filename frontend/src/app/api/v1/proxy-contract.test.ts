/**
 * Pins each `/api/v1` proxy verb's contract to what it did BEFORE the
 * `proxyToBackend` migration (the Phase 8 Step-1 table): the 401 body key (or
 * forward-without-auth), the forwarded URL + query, method and body, and the
 * 500 body when the upstream call fails. A handler passing the wrong option
 * to `proxyToBackend` turns this red.
 */
import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

let cookieToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "access_token" && cookieToken !== undefined
        ? { name, value: cookieToken }
        : undefined,
  }),
}));

import * as aiTasks from "./ai-tasks/route";
import * as aiTask from "./ai-tasks/[id]/route";
import * as aiTaskFinding from "./ai-tasks/[id]/findings/[findingId]/route";
import * as runs from "./execution/runs/route";
import * as run from "./execution/runs/[runId]/route";
import * as runTree from "./execution/runs/[runId]/tree/route";
import * as runTreeEvents from "./execution/runs/[runId]/tree-events/route";
import * as extractions from "./projects/[projectId]/extractions/route";
import * as ragDashboard from "./projects/[projectId]/rag/dashboard/route";
import * as ragEmbeddings from "./projects/[projectId]/rag/embeddings/route";
import * as ragJobs from "./projects/[projectId]/rag/jobs/route";
import * as ragSearch from "./projects/[projectId]/rag/search/route";
import * as ragStates from "./projects/[projectId]/rag/states/route";
import * as streaming from "./users/me/automation-streaming/route";
import * as streamingReset from "./users/me/automation-streaming/reset-limit/route";
import * as streamingToggle from "./users/me/automation-streaming/toggle/route";
import * as connectionInfo from "./users/me/connection-info/route";

type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

type Verb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Auth = "detail" | "error" | "forward";
type Query = "drop" | "raw" | "reencoded";
type Body = "none" | "json" | "text";
type ErrorShape = "detail" | "details" | { error: string } | "throw";

const PROXY = "Failed to proxy request to backend";
const PARAMS = { id: "1", findingId: "2", runId: "3", projectId: "4" };

// [module, verb, path, 401 key | forward, query, request body, 500 body]
const CONTRACT: [
  Record<string, unknown>,
  Verb,
  string,
  Auth,
  Query,
  Body,
  ErrorShape,
][] = [
  [aiTasks, "GET", "ai-tasks", "detail", "reencoded", "none", "detail"],
  [aiTasks, "POST", "ai-tasks", "detail", "drop", "json", "detail"],
  [aiTask, "GET", "ai-tasks/1", "detail", "drop", "none", "detail"],
  [aiTask, "PATCH", "ai-tasks/1", "detail", "drop", "json", "detail"],
  [aiTask, "DELETE", "ai-tasks/1", "detail", "drop", "none", "detail"],
  [
    aiTaskFinding,
    "PATCH",
    "ai-tasks/1/findings/2",
    "detail",
    "drop",
    "json",
    "detail",
  ],
  [runs, "GET", "execution/runs", "detail", "reencoded", "none", "detail"],
  [runs, "POST", "execution/runs", "detail", "drop", "json", "detail"],
  [run, "GET", "execution/runs/3", "detail", "drop", "none", "detail"],
  [run, "DELETE", "execution/runs/3", "detail", "drop", "none", "detail"],
  [runTree, "GET", "execution/runs/3/tree", "detail", "drop", "none", "detail"],
  [
    runTreeEvents,
    "GET",
    "execution/runs/3/tree-events",
    "detail",
    "raw",
    "none",
    "detail",
  ],
  [
    extractions,
    "GET",
    "projects/4/extractions",
    "forward",
    "raw",
    "none",
    "throw",
  ],
  [
    extractions,
    "POST",
    "projects/4/extractions",
    "forward",
    "raw",
    "text",
    "throw",
  ],
  [
    extractions,
    "DELETE",
    "projects/4/extractions",
    "forward",
    "raw",
    "none",
    "throw",
  ],
  [
    ragDashboard,
    "GET",
    "projects/4/rag/dashboard",
    "error",
    "drop",
    "none",
    { error: "Failed to fetch RAG dashboard" },
  ],
  [
    ragEmbeddings,
    "GET",
    "projects/4/rag/embeddings",
    "error",
    "raw",
    "none",
    { error: "Failed to fetch embeddings" },
  ],
  [
    ragJobs,
    "GET",
    "projects/4/rag/jobs",
    "error",
    "raw",
    "none",
    { error: "Failed to fetch jobs" },
  ],
  [
    ragSearch,
    "POST",
    "projects/4/rag/search",
    "error",
    "drop",
    "text",
    { error: "Failed to perform search" },
  ],
  [
    ragStates,
    "GET",
    "projects/4/rag/states",
    "error",
    "drop",
    "none",
    { error: "Failed to fetch states" },
  ],
  [
    streaming,
    "GET",
    "users/me/automation-streaming",
    "error",
    "drop",
    "none",
    "details",
  ],
  [
    streamingReset,
    "POST",
    "users/me/automation-streaming/reset-limit",
    "error",
    "drop",
    "none",
    "details",
  ],
  [
    streamingToggle,
    "POST",
    "users/me/automation-streaming/toggle",
    "error",
    "drop",
    "json",
    "details",
  ],
  [
    connectionInfo,
    "GET",
    "users/me/connection-info",
    "error",
    "drop",
    "none",
    "details",
  ],
];

const RAW_BODY = '{ "k" : 1 }';
const QUERY = { drop: "", raw: "?a=b%20c&x=1", reencoded: "?a=b+c&x=1" };
const FORWARDED_BODY = { none: undefined, json: '{"k":1}', text: RAW_BODY };

function call(
  verb: Verb,
  path: string,
  handler: Handler,
  query = "",
  headers: Record<string, string> = {},
  params: Record<string, string> = PARAMS
) {
  const takesBody = verb === "POST" || verb === "PUT" || verb === "PATCH";
  return handler(
    new NextRequest(`http://app.test/api/v1/${path}${query}`, {
      method: verb,
      body: takesBody ? RAW_BODY : undefined,
      headers,
    }),
    { params: Promise.resolve(params) }
  );
}

function stubFetch(impl: () => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = async () => new Response("{}", { status: 200 });

describe("/api/v1 proxy handlers keep their pre-migration contract", () => {
  beforeEach(() => {
    cookieToken = undefined;
    vi.stubEnv("BACKEND_URL", "http://backend.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("covers every exported verb of the 17 handlers", () => {
    const modules = new Set(CONTRACT.map(([mod]) => mod));
    expect(modules.size).toBe(17);
    const exported = [...modules].flatMap((mod) =>
      (["GET", "POST", "PUT", "PATCH", "DELETE"] as const).filter(
        (v) => typeof mod[v] === "function"
      )
    );
    expect(exported).toHaveLength(CONTRACT.length);
  });

  // A plain loop rather than describe.each: each row is titled
  // "<VERB> /api/v1/<path>" verbatim (describe.each's `$name` interpolation
  // quotes strings, and `%s` would print the module object), so a failing row
  // names the route it is about.
  for (const [mod, verb, path, auth, query, body, errorShape] of CONTRACT) {
    describe(`${verb} /api/v1/${path}`, () => {
      const handler = mod[verb] as Handler;

      it(`with no token: ${auth === "forward" ? "forwards without auth" : `401 {${auth}}`}`, async () => {
        const f = stubFetch(ok);
        const res = await call(verb, path, handler);
        if (auth === "forward") {
          expect(f).toHaveBeenCalledOnce();
          const init = f.mock.calls[0]![1] as RequestInit;
          expect(init.headers).not.toHaveProperty("Authorization");
        } else {
          expect(res.status).toBe(401);
          expect(await res.json()).toEqual({ [auth]: "Not authenticated" });
          expect(f).not.toHaveBeenCalled();
        }
      });

      it(`forwards URL (${query} query), method and ${body} body`, async () => {
        cookieToken = "t";
        const f = stubFetch(ok);
        await call(verb, path, handler, "?a=b c&x=1");
        expect(f).toHaveBeenCalledOnce();
        const [url, init] = f.mock.calls[0] as unknown as [
          string,
          RequestInit & { headers: Record<string, string> },
        ];
        expect(url).toBe(`http://backend.test/api/v1/${path}${QUERY[query]}`);
        expect(init.method).toBe(verb);
        expect(init.body).toBe(FORWARDED_BODY[body]);
        expect(init.headers.Authorization).toBe("Bearer t");
        expect(init.headers["Content-Type"]).toBe("application/json");
      });

      // The cookie-only handler (extractions) ignores an Authorization header
      // and forwards without auth; every other handler falls back to it.
      it(`with only an Authorization header: ${auth === "forward" ? "ignores it" : "forwards it"}`, async () => {
        const f = stubFetch(ok);
        await call(verb, path, handler, "", { Authorization: "Bearer h" });
        expect(f).toHaveBeenCalledOnce();
        const init = f.mock.calls[0]![1] as RequestInit & {
          headers: Record<string, string>;
        };
        if (auth === "forward") {
          expect(init.headers).not.toHaveProperty("Authorization");
        } else {
          expect(init.headers.Authorization).toBe("Bearer h");
        }
      });

      it("answers its own 500 body when the upstream call fails", async () => {
        cookieToken = "t";
        stubFetch(async () => {
          throw new TypeError("boom");
        });
        if (errorShape === "throw") {
          await expect(call(verb, path, handler)).rejects.toThrow("boom");
          return;
        }
        const res = await call(verb, path, handler);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual(
          errorShape === "detail"
            ? { detail: PROXY, error: "boom" }
            : errorShape === "details"
              ? { error: PROXY, details: "boom", name: "TypeError" }
              : errorShape
        );
      });
    });
  }

  // A param is one path segment: whatever the caller puts in it must not move
  // the forwarded request to another backend route (the caller's token rides
  // along). Each handler encodes its params; `proxyToBackend` refuses a path
  // the URL parser would still rewrite (`.` / `..` survive encoding) or one
  // carrying an encoded `/` (the backend decodes before routing). The
  // encoding is pinned on its own by "x/y" (refused only once encoded) and
  // "a b" (forwarded only once encoded), since the guard alone also refuses
  // a raw "../x".
  describe("path params stay inside their segment", () => {
    // Hand list: route directory (relative to this file) -> module. Asserted
    // equal to the dynamic-segment route files on disk, so a new handler that
    // is missing here reds.
    const DYNAMIC: [string, Record<string, unknown>][] = [
      ["ai-tasks/[id]", aiTask],
      ["ai-tasks/[id]/findings/[findingId]", aiTaskFinding],
      ["execution/runs/[runId]", run],
      ["execution/runs/[runId]/tree", runTree],
      ["execution/runs/[runId]/tree-events", runTreeEvents],
      ["projects/[projectId]/extractions", extractions],
      ["projects/[projectId]/rag/dashboard", ragDashboard],
      ["projects/[projectId]/rag/embeddings", ragEmbeddings],
      ["projects/[projectId]/rag/jobs", ragJobs],
      ["projects/[projectId]/rag/search", ragSearch],
      ["projects/[projectId]/rag/states", ragStates],
    ];
    const routeOf = new Map(DYNAMIC.map(([route, mod]) => [mod, route]));
    const EVERY = (value: string) =>
      Object.fromEntries(Object.keys(PARAMS).map((k) => [k, value]));

    /** `route` with every `[param]` segment replaced by `value`. */
    function fill(route: string, value: string) {
      return route
        .split("/")
        .map((seg) => (/^\[[^\]]+\]$/.test(seg) ? value : seg))
        .join("/");
    }

    // Every CONTRACT row of a dynamic module, with the 400 body key the
    // handler answers its own refusals with.
    const rows: [Verb, string, Handler, string, string][] = CONTRACT.filter(
      ([mod]) => routeOf.has(mod)
    ).map(([mod, verb, path, auth]) => [
      verb,
      path,
      mod[verb] as Handler,
      routeOf.get(mod)!,
      auth === "error" ? "error" : "detail",
    ]);

    it("the hand list is every dynamic-segment route file on disk", () => {
      const onDisk = (readdirSync(__dirname, { recursive: true }) as string[])
        .map((f) => f.split("\\").join("/"))
        .filter((f) => f.includes("[") && /(^|\/)route\.ts$/.test(f))
        .map((f) => f.replace(/\/route\.ts$/, ""))
        .sort();
      expect(onDisk).toEqual(DYNAMIC.map(([route]) => route).sort());
    });

    it("covers every verb of the 11 dynamic-segment modules", () => {
      const covered = new Set(
        rows.map(([verb, , , route]) => `${verb} ${route}`)
      );
      for (const [route, mod] of DYNAMIC) {
        for (const v of [
          "GET",
          "HEAD",
          "OPTIONS",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
        ] as const) {
          if (typeof mod[v] === "function") {
            expect(covered, `${v} ${route}`).toContain(`${v} ${route}`);
          }
        }
      }
    });

    async function expectRefused(
      verb: Verb,
      path: string,
      handler: Handler,
      key: string,
      params: Record<string, string>
    ) {
      cookieToken = "t";
      const f = stubFetch(ok);
      const res = await call(verb, path, handler, "", {}, params);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ [key]: "Invalid path parameter" });
      expect(f).not.toHaveBeenCalled();
    }

    for (const [verb, path, handler, route, key] of rows) {
      it(`${verb} /api/v1/${path}: "a b" is forwarded as one encoded segment`, async () => {
        // The request URL keeps the row's own segments; only params differ.
        expect(path.split("/")).toHaveLength(route.split("/").length);
        cookieToken = "t";
        const f = stubFetch(ok);
        await call(verb, path, handler, "", {}, EVERY("a b"));
        expect(f).toHaveBeenCalledOnce();
        const url = f.mock.calls[0]![0] as unknown as string;
        expect(new URL(url).pathname).toBe(`/api/v1/${fill(route, "a%20b")}`);
      });

      it.each(["x/y", "../x", ".."])(
        `${verb} /api/v1/${path}: %j never leaves its segment (400 {${key}}, no fetch)`,
        async (value) => {
          await expectRefused(verb, path, handler, key, EVERY(value));
        }
      );
    }

    it.each(["x/y", "../x", ".."])(
      "PATCH ai-tasks/[id]/findings/[findingId]: a bad findingId %j alone is refused",
      async (findingId) => {
        await expectRefused(
          "PATCH",
          "ai-tasks/1/findings/2",
          aiTaskFinding.PATCH as Handler,
          "detail",
          { ...PARAMS, findingId }
        );
      }
    );
  });
});
