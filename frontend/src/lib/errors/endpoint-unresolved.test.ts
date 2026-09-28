import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ENDPOINT_UNRESOLVED_CODE,
  EndpointUnresolvedError,
  resolveEndpoint,
} from "./endpoint-unresolved";

describe("resolveEndpoint", () => {
  it("returns the configured value, trailing slashes trimmed", () => {
    expect(
      resolveEndpoint("api", "https://api.example.com/", "production")
    ).toBe("https://api.example.com");
  });

  it("keeps a dev default only in development", () => {
    expect(resolveEndpoint("api", undefined, "development")).toBe(
      "http://localhost:8000"
    );
    expect(resolveEndpoint("runner", "", "development")).toBe(
      "http://localhost:9876"
    );
  });

  it.each([
    ["api", "NEXT_PUBLIC_API_URL"],
    ["runner", "QONTINUI_RUNNER_URL"],
    ["llama_swap", "QONTINUI_LLAMA_SWAP_URL"],
    ["mcp", "NEXT_PUBLIC_MCP_URL"],
  ] as const)(
    "fails loudly for %s in production when unset, naming %s",
    (endpoint, envVar) => {
      let caught: unknown;
      try {
        resolveEndpoint(endpoint, undefined, "production");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EndpointUnresolvedError);
      const err = caught as EndpointUnresolvedError;
      expect(err.code).toBe(ENDPOINT_UNRESOLVED_CODE);
      expect(err.envVar).toBe(envVar);
      expect(err.nextAction).toContain(`Set ${envVar}`);
      expect(err.message).toContain(envVar);
      // Never a dev-stack address in the refusal.
      expect(err.message).not.toMatch(/localhost|127\.0\.0\.1/);
      expect(err.toBody()).toEqual({
        code: ENDPOINT_UNRESOLVED_CODE,
        endpoint,
        env_var: envVar,
        error: err.message,
        next_action: err.nextAction,
      });
    }
  );

  it("treats a whitespace-only value as unset", () => {
    expect(() => resolveEndpoint("mcp", "   ", "production")).toThrow(
      EndpointUnresolvedError
    );
  });

  it("fails loudly under test/preview builds too, not only production", () => {
    expect(() => resolveEndpoint("api", undefined, "test")).toThrow(
      EndpointUnresolvedError
    );
  });
});

describe("ApiConfig.resolveAbsoluteBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws a typed error naming NEXT_PUBLIC_API_URL in production when unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const { ApiConfig } = await import("@/services/api-config");
    expect(() => ApiConfig.resolveAbsoluteBaseUrl()).toThrow(
      /Set NEXT_PUBLIC_API_URL/
    );
  });

  it("returns the configured absolute base", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    const { ApiConfig } = await import("@/services/api-config");
    expect(ApiConfig.resolveAbsoluteBaseUrl()).toBe("https://api.example.com");
  });
});
