/**
 * The same-origin runner door proxy and the gated `/api/vga/*` hops.
 *
 * Plan `2026-09-17-retire-the-runner-origin-guard-dev-grace`, Phase 4,
 * acceptance tests 1-5 and 9. Every refusal is asserted together with ZERO
 * upstream runner calls: a refusal that still forwarded would be no refusal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { __resetAuthCache } from "../../ui-bridge/[...path]/_auth";
import { __resetRunnerOwnershipCache } from "../../_runner-hop/bridge-session";
import * as route from "./route";
import { GET as vgaCaptureGET } from "../../vga/capture/route";
import {
  NEVER_PROXIED_PREFIXES,
  RUNNER_DOOR_ROUTES,
} from "@/lib/runner/door-routes";

const BACKEND_URL = "http://backend.test";
const USER_TOKEN = "operator-bearer";
const DEVICE_TOKEN = "device-jwt";

let fetchMock: ReturnType<typeof vi.fn>;

/** Device id the mocked runner names, and the devices the operator owns. */
let runnerDeviceId: string | null = "dev-own";
let ownedDeviceIds: string[] = ["DEV-OWN"];

/** Door calls that reached a runner: anything on 127.0.0.1 / localhost:98xx
 * except the ownership probe (`GET /settings/device-info`, not a door). */
function runnerCalls(): Array<[string, RequestInit | undefined]> {
  return fetchMock.mock.calls.filter(
    ([url]) =>
      /^http:\/\/(127\.0\.0\.1|localhost):98\d\d\//.test(String(url)) &&
      !String(url).endsWith("/settings/device-info")
  ) as Array<[string, RequestInit | undefined]>;
}

/** Backend identity mock: the operator bearer is a user, the device JWT a
 * device, anything else a 401. Runner calls answer 200. */
function installFetch(backendStatus?: number): void {
  fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(BACKEND_URL)) {
      if (backendStatus !== undefined) {
        return new Response(null, { status: backendStatus });
      }
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      if (
        url.endsWith("/api/v1/auth/users/me") &&
        auth === `Bearer ${USER_TOKEN}`
      ) {
        return Response.json({ id: "user-1" });
      }
      if (
        url.endsWith("/api/v1/devices/me") &&
        auth === `Bearer ${DEVICE_TOKEN}`
      ) {
        return Response.json({
          device_id: "d",
          user_id: "user-1",
          tenant_id: "t",
        });
      }
      if (url.endsWith("/api/v1/devices") && auth === `Bearer ${USER_TOKEN}`) {
        return Response.json(ownedDeviceIds.map((id) => ({ id })));
      }
      return new Response(null, { status: 401 });
    }
    if (url.endsWith("/settings/device-info")) {
      return Response.json({
        success: true,
        data: runnerDeviceId === null ? {} : { device_id: runnerDeviceId },
      });
    }
    return Response.json(
      { success: true, data: { ok: true } },
      { headers: { "set-cookie": "s=1", location: "http://evil.test/" } }
    );
  });
  vi.stubGlobal("fetch", fetchMock);
}

interface Req {
  method?: string;
  path: string;
  host?: string;
  origin?: string | null;
  token?: string | null;
  cookie?: string;
  port?: string | null;
  secFetchSite?: string;
}

function doorRequest({
  method = "POST",
  path,
  host = "localhost:3001",
  origin = `http://${host}`,
  token = USER_TOKEN,
  cookie,
  port = "9876",
  secFetchSite,
}: Req): [NextRequest, { params: Promise<{ path: string[] }> }] {
  const headers: Record<string, string> = {
    host,
    "content-type": "application/json",
  };
  if (origin !== null) headers.origin = origin;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (port !== null) headers["x-qontinui-runner-port"] = port;
  if (secFetchSite) headers["sec-fetch-site"] = secFetchSite;
  const req = new NextRequest(`http://${host}/api/runner-doors${path}`, {
    method,
    headers,
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  const segments = path.split("?")[0]!.split("/").filter(Boolean);
  return [req, { params: Promise.resolve({ path: segments }) }];
}

async function call(r: Req): Promise<Response> {
  const [req, ctx] = doorRequest(r);
  const method = (r.method ?? "POST") as "GET" | "POST" | "PUT" | "DELETE";
  return route[method](req, ctx);
}

beforeEach(() => {
  __resetAuthCache();
  __resetRunnerOwnershipCache();
  runnerDeviceId = "dev-own";
  ownedDeviceIds = ["DEV-OWN"];
  vi.stubEnv("BACKEND_URL", BACKEND_URL);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QONTINUI_WEB_RUNNER_DOOR_PROXY", "");
  installFetch();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runner door proxy — origin (test 1)", () => {
  it("a foreign Origin is refused, nothing forwarded", async () => {
    const res = await call({
      path: "/settings/ai/api-key",
      origin: "http://localhost:5555",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("RUNNER_HOP_CROSS_ORIGIN_REFUSED");
    expect(runnerCalls()).toHaveLength(0);
  });

  it("a rebound host with a matching Origin is refused as HOST_NOT_LOOPBACK", async () => {
    const res = await call({
      path: "/settings/ai/api-key",
      host: "rebind.example:3001",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("RUNNER_HOP_HOST_NOT_LOOPBACK");
    expect(runnerCalls()).toHaveLength(0);
  });

  it("a state-changing call with no Origin is refused", async () => {
    const res = await call({ path: "/settings/ai/api-key", origin: null });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("RUNNER_HOP_CROSS_ORIGIN_REFUSED");
    expect(runnerCalls()).toHaveLength(0);
  });

  it("Sec-Fetch-Site other than same-origin is refused", async () => {
    const res = await call({
      path: "/settings/ai/api-key",
      secFetchSite: "same-site",
    });
    expect(res.status).toBe(403);
    expect(runnerCalls()).toHaveLength(0);
  });
});

describe("runner door proxy — auth (test 2)", () => {
  it("a cookie is not a credential: no bearer → 401, nothing forwarded", async () => {
    const res = await call({
      path: "/settings/ai/api-key",
      token: null,
      cookie: "access_token=a-valid-cognito-token",
    });
    expect(res.status).toBe(401);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("an identity backend 503 stays a 503, not a 401", async () => {
    installFetch(503);
    const res = await call({ path: "/settings/ai/api-key" });
    expect(res.status).toBe(503);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("a device JWT → 403", async () => {
    const res = await call({
      path: "/settings/ai/api-key",
      token: DEVICE_TOKEN,
    });
    expect(res.status).toBe(403);
    expect(runnerCalls()).toHaveLength(0);
  });
});

describe("runner door proxy — allowlist (test 3)", () => {
  it("POST /ui-bridge/invoke/get_coord_device_token → 404, nothing forwarded", async () => {
    const res = await call({
      path: "/ui-bridge/invoke/get_coord_device_token",
    });
    expect(res.status).toBe(404);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("a route that is not a listed door → 404", async () => {
    const res = await call({ method: "GET", path: "/health" });
    expect(res.status).toBe(404);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("no listed door falls under a never-proxied prefix", () => {
    for (const r of RUNNER_DOOR_ROUTES) {
      for (const prefix of NEVER_PROXIED_PREFIXES) {
        expect(r.pattern.startsWith(prefix), `${r.method} ${r.pattern}`).toBe(
          false
        );
      }
    }
  });

  it.each([
    ["POST", "/ui-bridge/invoke/get_coord_device_token"],
    ["POST", "/coord-mcp"],
    ["GET", "/files/read"],
    ["POST", "/terminals"],
    ["POST", "/execute-python"],
  ])("%s %s is never forwarded", async (method, path) => {
    const res = await call({ method, path });
    expect(res.status).toBe(404);
    expect(runnerCalls()).toHaveLength(0);
  });
});

describe("runner door proxy — forwarding (test 4)", () => {
  it("forwards exactly one call to 127.0.0.1:<port> with only content-type and accept", async () => {
    const res = await call({
      path: "/hooks/abc/test",
      port: "9877",
      cookie: "access_token=x",
      secFetchSite: "same-origin",
    });
    expect(res.status).toBe(200);
    const calls = runnerCalls();
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe("http://127.0.0.1:9877/hooks/abc/test");
    const sent = new Headers(init?.headers);
    for (const h of [
      "origin",
      "cookie",
      "authorization",
      "sec-fetch-site",
      "referer",
    ]) {
      expect(sent.has(h), h).toBe(false);
    }
    expect(sent.get("content-type")).toBe("application/json");
  });

  it("passes the runner's status and body through", async () => {
    const res = await call({ method: "GET", path: "/settings/backup/summary" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { ok: true } });
  });
});

describe("runner door proxy — port and posture (test 5)", () => {
  it("a port outside the runner range → 400, nothing forwarded", async () => {
    const res = await call({ path: "/hooks/abc/test", port: "22" });
    expect(res.status).toBe(400);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("a missing port → 400", async () => {
    const res = await call({ path: "/hooks/abc/test", port: null });
    expect(res.status).toBe(400);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("production posture without the force flag → 404", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await call({ path: "/hooks/abc/test" });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("production posture with QONTINUI_WEB_RUNNER_DOOR_PROXY=1 forwards", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QONTINUI_WEB_RUNNER_DOOR_PROXY", "1");
    const res = await call({ path: "/hooks/abc/test" });
    expect(res.status).toBe(200);
    expect(runnerCalls()).toHaveLength(1);
  });
});

describe("runner door proxy — the runner must be the operator's own", () => {
  // Host and Origin bind only browsers: `next dev` listens on 0.0.0.0, so a
  // script on another machine can forge both. Ownership is what stops it.
  it("a valid user whose devices do not include this runner → 403, no door call", async () => {
    ownedDeviceIds = ["someone-elses-runner"];
    const res = await call({ path: "/hooks/abc/test" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("RUNNER_HOP_RUNNER_NOT_OWNED");
    expect(runnerCalls()).toHaveLength(0);
  });

  it("a runner that names no paired device → 403, no door call", async () => {
    runnerDeviceId = null;
    const res = await call({ path: "/hooks/abc/test" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("RUNNER_HOP_RUNNER_UNPAIRED");
    expect(runnerCalls()).toHaveLength(0);
  });

  it("force mode drops only the loopback-Host rule: a foreign Origin is still refused", async () => {
    vi.stubEnv("QONTINUI_WEB_RUNNER_DOOR_PROXY", "1");
    const res = await call({
      path: "/hooks/abc/test",
      host: "demo.example:3001",
      origin: "http://attacker.example",
    });
    expect(res.status).toBe(403);
    expect(runnerCalls()).toHaveLength(0);
  });
});

describe("runner door proxy — ownership cache and browser-shaped requests", () => {
  it("a cached verdict for one operator does not admit another on the same runner", async () => {
    expect((await call({ method: "GET", path: "/hooks" })).status).toBe(200);
    // A second operator whose device list does not hold this runner.
    const OTHER = "other-operator";
    const inner = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      if (auth === `Bearer ${OTHER}`) {
        if (url.endsWith("/api/v1/auth/users/me"))
          return Response.json({ id: "user-2" });
        if (url.endsWith("/api/v1/devices"))
          return Response.json([{ id: "elsewhere" }]);
      }
      return inner(input, init);
    });
    const before = runnerCalls().length;
    const res = await call({ method: "GET", path: "/hooks", token: OTHER });
    expect(res.status).toBe(403);
    expect(runnerCalls().length).toBe(before);
  });

  it("a browser same-origin GET (no Origin, Sec-Fetch-Site: same-origin) is forwarded with its query", async () => {
    const [req] = doorRequest({
      method: "GET",
      path: "/settings/backup/summary",
      origin: null,
      secFetchSite: "same-origin",
    });
    const withQuery = new NextRequest(`${req.url}?verbose=1`, {
      method: "GET",
      headers: req.headers,
    });
    const res = await route.GET(withQuery, {
      params: Promise.resolve({ path: ["settings", "backup", "summary"] }),
    });
    expect(res.status).toBe(200);
    expect(runnerCalls().map(([u]) => u)).toEqual([
      "http://127.0.0.1:9876/settings/backup/summary?verbose=1",
    ]);
  });

  it("a runner literal route a {param} pattern would swallow is not proxied", async () => {
    const res = await call({ method: "GET", path: "/state-explorer/history" });
    expect(res.status).toBe(404);
    expect(runnerCalls()).toHaveLength(0);
  });
});

describe("runner door proxy — paths, response headers, audit", () => {
  it.each([
    [[".."]],
    [["hooks", "..", "x"]],
    [["hooks", "a/b", "test"]],
    [["hooks", "", "test"]],
  ])("segments %j are refused, nothing forwarded", async (segments) => {
    const [req] = doorRequest({ path: "/hooks/abc/test" });
    const res = await route.POST(req, {
      params: Promise.resolve({ path: segments as string[] }),
    });
    expect(res.status).toBe(404);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("strips set-cookie and location from the runner's response", async () => {
    const res = await call({ method: "GET", path: "/settings/backup/summary" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("writes one audit line naming the operator and never the body", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const [req, ctx] = doorRequest({ path: "/settings/ai/api-key" });
    const body = JSON.stringify({ provider: "x", api_key: "sk-secret-value" });
    const withBody = new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body,
    });
    const res = await route.POST(withBody, ctx);
    expect(res.status).toBe(200);
    const lines = info.mock.calls.filter((c) =>
      String(c[0]).includes("runner-door-proxy: forwarded")
    );
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).toContain("user-1");
    expect(JSON.stringify(lines[0])).not.toContain("sk-secret-value");
    info.mockRestore();
  });
});

describe("existing Next runner hop /api/vga/capture (test 9)", () => {
  function capture(headers: Record<string, string>): NextRequest {
    return new NextRequest("http://localhost:3001/api/vga/capture?monitor=0", {
      method: "GET",
      headers: { host: "localhost:3001", ...headers },
    });
  }

  it("a foreign Origin → 403, nothing forwarded", async () => {
    const res = await vgaCaptureGET(
      capture({
        origin: "http://localhost:5555",
        authorization: `Bearer ${USER_TOKEN}`,
      })
    );
    expect(res.status).toBe(403);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("no bearer → 401, nothing forwarded", async () => {
    const res = await vgaCaptureGET(
      capture({ origin: "http://localhost:3001" })
    );
    expect(res.status).toBe(401);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("a runner that is not the operator's own → 403, nothing forwarded", async () => {
    ownedDeviceIds = ["someone-elses-runner"];
    const res = await vgaCaptureGET(
      capture({
        origin: "http://localhost:3001",
        authorization: `Bearer ${USER_TOKEN}`,
      })
    );
    expect(res.status).toBe(403);
    expect(runnerCalls()).toHaveLength(0);
  });

  it("the door proxy's force flag does not enable it in a production posture", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QONTINUI_WEB_RUNNER_DOOR_PROXY", "1");
    const res = await vgaCaptureGET(
      capture({
        origin: "http://localhost:3001",
        authorization: `Bearer ${USER_TOKEN}`,
      })
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("same-origin with an operator bearer is forwarded", async () => {
    const res = await vgaCaptureGET(
      capture({
        origin: "http://localhost:3001",
        authorization: `Bearer ${USER_TOKEN}`,
      })
    );
    expect(res.status).toBe(200);
    expect(runnerCalls()).toHaveLength(1);
  });
});
