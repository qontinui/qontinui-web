import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { runnerBaseOrResponse } from "./_runner-base";

describe("runnerBaseOrResponse", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers a structured 503 naming the variable when unset in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QONTINUI_RUNNER_URL", "");
    const res = runnerBaseOrResponse();
    expect(res).toBeInstanceOf(NextResponse);
    const response = res as NextResponse;
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("endpoint_unresolved");
    expect(body.env_var).toBe("QONTINUI_RUNNER_URL");
    expect(body.next_action).toContain("Set QONTINUI_RUNNER_URL");
  });

  it("returns the configured runner base", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("QONTINUI_RUNNER_URL", "http://runner.internal:9876");
    expect(runnerBaseOrResponse()).toBe("http://runner.internal:9876");
  });
});
