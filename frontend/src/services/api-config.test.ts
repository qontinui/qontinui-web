import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ENDPOINT_UNRESOLVED_CODE,
  type EndpointUnresolvedError,
} from "@/lib/errors/endpoint-unresolved";

async function loadApiConfig() {
  vi.resetModules();
  return (await import("./api-config")).ApiConfig;
}

describe("ApiConfig.resolveAbsoluteBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the configured absolute base", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com/");
    const ApiConfig = await loadApiConfig();
    expect(ApiConfig.resolveAbsoluteBaseUrl()).toBe("https://api.example.com");
  });

  it("uses this page's origin in the browser for the same-origin config", async () => {
    // Same-origin (NEXT_PUBLIC_API_URL="") is supported: next.config's
    // `/api/:path*` fallback rewrite proxies /api/v1/extractions/* to the
    // backend, so the origin is a working base for the runner.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const ApiConfig = await loadApiConfig();
    expect(ApiConfig.resolveAbsoluteBaseUrl()).toBe(window.location.origin);
  });

  it("refuses server-side in production with a typed error naming the variable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubGlobal("window", undefined);
    const ApiConfig = await loadApiConfig();
    let caught: unknown;
    try {
      ApiConfig.resolveAbsoluteBaseUrl();
    } catch (err) {
      caught = err;
    }
    const err = caught as EndpointUnresolvedError;
    expect(err?.code).toBe(ENDPOINT_UNRESOLVED_CODE);
    expect(err.envVar).toBe("NEXT_PUBLIC_API_URL");
    expect(err.nextAction).toContain("Set NEXT_PUBLIC_API_URL");
  });
});

describe("ApiConfig.resolveWebSocketBaseUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers NEXT_PUBLIC_WS_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_WS_URL", "wss://ws.example.com/");
    const ApiConfig = await loadApiConfig();
    expect(ApiConfig.resolveWebSocketBaseUrl()).toBe("wss://ws.example.com");
  });

  it("derives ws(s) from the API base, never a dev default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WS_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    const ApiConfig = await loadApiConfig();
    expect(ApiConfig.resolveWebSocketBaseUrl()).toBe("wss://api.example.com");
  });
});
