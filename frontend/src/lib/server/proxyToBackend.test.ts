/**
 * `proxyToBackend`: each option, driven through a real `NextRequest` and a
 * stubbed upstream `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let cookieToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "access_token" && cookieToken !== undefined
        ? { name, value: cookieToken }
        : undefined,
  }),
}));

import { proxyToBackend, type ProxyOptions } from "./proxyToBackend";

const BASE = "http://backend.test";
const PATH = "/api/v1/things/7";

const DETAIL_401: ProxyOptions = {
  tokenSources: ["cookie", "header"],
  onMissingToken: "401",
  unauthorizedBodyKey: "detail",
  errorBody: "detail",
};
const FORWARD: ProxyOptions = {
  tokenSources: ["cookie"],
  onMissingToken: "forward",
  errorBody: "throw",
};

function req(
  init: { method?: string; auth?: string; body?: string; url?: string } = {}
) {
  const headers: Record<string, string> = {};
  if (init.auth) headers.Authorization = init.auth;
  return new NextRequest(init.url ?? `http://app.test${PATH}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}

function upstream(body: string | null, status = 200, contentType?: string) {
  const fetchSpy = vi.fn(
    async () =>
      new Response(body, {
        status,
        headers: contentType ? { "Content-Type": contentType } : {},
      })
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function sent(fetchSpy: ReturnType<typeof upstream>) {
  const [url, init] = fetchSpy.mock.calls[0] as unknown as [
    string,
    RequestInit & { headers: Record<string, string> },
  ];
  return { url, init };
}

describe("proxyToBackend", () => {
  beforeEach(() => {
    cookieToken = undefined;
    vi.stubEnv("BACKEND_URL", BASE);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("token sources", () => {
    it("prefers the cookie over the Authorization header", async () => {
      cookieToken = "from-cookie";
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(
        req({ auth: "Bearer from-header" }),
        PATH,
        DETAIL_401
      );
      expect(sent(f).init.headers.Authorization).toBe("Bearer from-cookie");
    });

    it("cookie + header: falls back to the Bearer header", async () => {
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(
        req({ auth: "Bearer from-header" }),
        PATH,
        DETAIL_401
      );
      expect(sent(f).init.headers.Authorization).toBe("Bearer from-header");
    });

    it("cookie only: ignores the Authorization header", async () => {
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(req({ auth: "Bearer from-header" }), PATH, FORWARD);
      expect(sent(f).init.headers).not.toHaveProperty("Authorization");
    });

    it("an empty `Bearer ` header is no token", async () => {
      const f = upstream("{}");
      const res = await proxyToBackend(
        req({ auth: "Bearer " }),
        PATH,
        DETAIL_401
      );
      expect(res.status).toBe(401);
      expect(f).not.toHaveBeenCalled();
    });
  });

  describe("missing token", () => {
    it.each([
      ["detail", { detail: "Not authenticated" }],
      ["error", { error: "Not authenticated" }],
    ] as const)("401 with the `%s` key, never fetching", async (key, body) => {
      const f = upstream("{}");
      const res = await proxyToBackend(req(), PATH, {
        ...DETAIL_401,
        unauthorizedBodyKey: key,
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(body);
      expect(f).not.toHaveBeenCalled();
    });

    it("forward: calls the backend with no Authorization", async () => {
      const f = upstream('{"ok":true}', 200, "application/json");
      const res = await proxyToBackend(req(), PATH, FORWARD);
      expect(res.status).toBe(200);
      expect(sent(f).url).toBe(`${BASE}${PATH}`);
      expect(sent(f).init.headers).toEqual({
        "Content-Type": "application/json",
      });
    });

    it("401 precedes the unresolved-backend 503", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("BACKEND_URL", "");
      vi.stubEnv("NEXT_PUBLIC_API_URL", "");
      const res = await proxyToBackend(req(), PATH, DETAIL_401);
      expect(res.status).toBe(401);
    });
  });

  describe("forwarding", () => {
    it("uses the request method and the backend base", async () => {
      cookieToken = "t";
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(req({ method: "DELETE" }), PATH, DETAIL_401);
      expect(sent(f).url).toBe(`${BASE}${PATH}`);
      expect(sent(f).init.method).toBe("DELETE");
      expect(sent(f).init.body).toBeUndefined();
    });

    it("forwards a HEAD (served by the GET handler) as GET", async () => {
      cookieToken = "t";
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(req({ method: "HEAD" }), PATH, DETAIL_401);
      expect(sent(f).init.method).toBe("GET");
    });

    it.each([
      ["drop", ""],
      ["raw", "?q=a%20b&flag"],
      ["reencoded", "?q=a+b&flag="],
    ] as const)("query %s", async (query, suffix) => {
      cookieToken = "t";
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(
        req({ url: `http://app.test${PATH}?q=a%20b&flag` }),
        PATH,
        { ...DETAIL_401, query }
      );
      expect(sent(f).url).toBe(`${BASE}${PATH}${suffix}`);
    });

    it("forwardBody json re-stringifies the request body", async () => {
      cookieToken = "t";
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(req({ method: "POST", body: '{ "a" : 1 }' }), PATH, {
        ...DETAIL_401,
        forwardBody: "json",
      });
      expect(sent(f).init.body).toBe('{"a":1}');
    });

    it("an unresolved backend answers 503 even with an unparseable body", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("BACKEND_URL", "");
      vi.stubEnv("NEXT_PUBLIC_API_URL", "");
      cookieToken = "t";
      const res = await proxyToBackend(
        req({ method: "POST", body: "not json" }),
        PATH,
        { ...DETAIL_401, forwardBody: "json" }
      );
      expect(res.status).toBe(503);
    });

    it("forwardBody json: an unparseable body is a caught 500", async () => {
      cookieToken = "t";
      const f = upstream("{}");
      const res = await proxyToBackend(
        req({ method: "POST", body: "not json" }),
        PATH,
        { ...DETAIL_401, forwardBody: "json" }
      );
      expect(res.status).toBe(500);
      expect(f).not.toHaveBeenCalled();
    });

    it("forwardBody text forwards the body verbatim", async () => {
      cookieToken = "t";
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(req({ method: "POST", body: '{ "a" : 1 }' }), PATH, {
        ...DETAIL_401,
        forwardBody: "text",
      });
      expect(sent(f).init.body).toBe('{ "a" : 1 }');
    });

    it("never forwards a body for a verb without one", async () => {
      cookieToken = "t";
      const f = upstream("{}", 200, "application/json");
      await proxyToBackend(req(), PATH, { ...DETAIL_401, forwardBody: "text" });
      expect(sent(f).init.body).toBeUndefined();
    });
  });

  describe("response body", () => {
    it("keeps the upstream JSON byte-for-byte with its status", async () => {
      cookieToken = "t";
      upstream('{ "a" : 1 }', 422, "application/json");
      const res = await proxyToBackend(req(), PATH, DETAIL_401);
      expect(res.status).toBe(422);
      expect(await res.text()).toBe('{ "a" : 1 }');
    });

    it("keeps a non-JSON upstream text, status and Content-Type", async () => {
      cookieToken = "t";
      upstream("Bad Gateway", 502, "text/plain");
      const res = await proxyToBackend(req(), PATH, DETAIL_401);
      expect(res.status).toBe(502);
      expect(res.headers.get("Content-Type")).toBe("text/plain");
      expect(await res.text()).toBe("Bad Gateway");
    });

    it("defaults a missing Content-Type to application/json", async () => {
      cookieToken = "t";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          const r = new Response("{}", { status: 200 });
          r.headers.delete("Content-Type");
          return r;
        })
      );
      const res = await proxyToBackend(req(), PATH, FORWARD);
      expect(res.headers.get("Content-Type")).toBe("application/json");
    });

    it.each([204, 205, 304])(
      "answers an upstream %i with an empty body and that status",
      async (status) => {
        cookieToken = "t";
        upstream(null, status);
        const res = await proxyToBackend(
          req({ method: "DELETE" }),
          PATH,
          DETAIL_401
        );
        expect(res.status).toBe(status);
        expect(await res.text()).toBe("");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      }
    );

    it("sets X-Content-Type-Options: nosniff on a proxied answer", async () => {
      cookieToken = "t";
      upstream("<html></html>", 200, "text/html");
      const res = await proxyToBackend(req(), PATH, DETAIL_401);
      expect(res.headers.get("Content-Type")).toBe("text/html");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });
  });

  describe("error body", () => {
    const boom = () =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("fetch failed");
        })
      );

    it.each([
      [
        "detail",
        { detail: "Failed to proxy request to backend", error: "fetch failed" },
      ],
      [
        "details",
        {
          error: "Failed to proxy request to backend",
          details: "fetch failed",
          name: "TypeError",
        },
      ],
    ] as const)("%s", async (errorBody, body) => {
      cookieToken = "t";
      boom();
      const res = await proxyToBackend(req(), PATH, {
        ...DETAIL_401,
        errorBody,
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual(body);
    });

    it("a fixed { error } message", async () => {
      cookieToken = "t";
      boom();
      const res = await proxyToBackend(req(), PATH, {
        ...DETAIL_401,
        errorBody: { error: "Failed to fetch jobs" },
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to fetch jobs" });
    });

    it("throw lets the error propagate", async () => {
      cookieToken = "t";
      boom();
      await expect(proxyToBackend(req(), PATH, FORWARD)).rejects.toThrow(
        "fetch failed"
      );
    });
  });

  it("answers the unresolved-backend 503 without fetching", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    cookieToken = "t";
    const f = upstream("{}");
    const res = await proxyToBackend(req(), PATH, DETAIL_401);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("endpoint_unresolved");
    expect(f).not.toHaveBeenCalled();
  });
});
