/**
 * A backend-proxying route handler answers an unset backend base with a
 * structured 503 instead of fetching `http://localhost:8000` (plan B5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { GET } from "./route";

describe("/api/v1/ai-tasks with no backend configured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("answers 503 naming BACKEND_URL and never fetches", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(
      new NextRequest("http://app.test/api/v1/ai-tasks", {
        headers: { Authorization: "Bearer t" },
      })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("endpoint_unresolved");
    expect(body.env_var).toBe("BACKEND_URL");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
