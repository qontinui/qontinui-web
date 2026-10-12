import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import {
  backendBaseOrResponse,
  runnerBaseOrResponse,
} from "./endpoint-response";

describe("endpoint-response", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("backend: BACKEND_URL, then NEXT_PUBLIC_API_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    expect(backendBaseOrResponse()).toBe("https://api.example.com");
    vi.stubEnv("BACKEND_URL", "http://backend.internal");
    expect(backendBaseOrResponse()).toBe("http://backend.internal");
  });

  it("backend unset in production → 503 naming both variables", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BACKEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const res = backendBaseOrResponse();
    expect(res).toBeInstanceOf(NextResponse);
    const response = res as NextResponse;
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("endpoint_unresolved");
    expect(body.env_var).toBe("BACKEND_URL");
    expect(body.next_action).toContain("BACKEND_URL (or NEXT_PUBLIC_API_URL)");
  });

  it("runner: configured value passes through", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QONTINUI_RUNNER_URL", "http://runner.internal:9876");
    expect(runnerBaseOrResponse()).toBe("http://runner.internal:9876");
  });
});
