import { describe, expect, it } from "vitest";

import { DELETE, GET, POST } from "./route";

const ctx = (endpoint: string) => ({
  params: Promise.resolve({ endpoint }),
});

describe("/api/endpoint-unresolved/[endpoint]", () => {
  it.each([
    ["backend", "BACKEND_URL", /BACKEND_URL \(or NEXT_PUBLIC_API_URL\)/],
    ["coord", "COORD_URL", /Set COORD_URL/],
  ])("%s → 503 naming %s", async (endpoint, envVar, nextAction) => {
    for (const handler of [GET, POST, DELETE]) {
      const res = await handler(
        new Request("http://app.test/api/x"),
        ctx(endpoint)
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("endpoint_unresolved");
      expect(body.endpoint).toBe(endpoint);
      expect(body.env_var).toBe(envVar);
      expect(body.next_action).toMatch(nextAction);
      expect(body.error).toMatch(/^This deployment is misconfigured — /);
    }
  });

  it("404s any other name", async () => {
    const res = await GET(new Request("http://app.test/x"), ctx("runner"));
    expect(res.status).toBe(404);
  });
});
