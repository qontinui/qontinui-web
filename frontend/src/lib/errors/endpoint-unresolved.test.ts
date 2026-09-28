import { describe, expect, it } from "vitest";

import {
  ENDPOINT_UNRESOLVED_CODE,
  isEndpointUnresolved,
  resolveEndpoint,
  tryResolveEndpoint,
  type EndpointUnresolvedError,
} from "./endpoint-unresolved";

function refusal(fn: () => unknown): EndpointUnresolvedError {
  try {
    fn();
  } catch (err) {
    expect(isEndpointUnresolved(err)).toBe(true);
    return err as EndpointUnresolvedError;
  }
  throw new Error("expected an endpoint refusal, got a value");
}

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
    ["backend", "BACKEND_URL"],
    ["runner", "QONTINUI_RUNNER_URL"],
    ["llama_swap", "QONTINUI_LLAMA_SWAP_URL"],
  ] as const)(
    "fails loudly for %s in production when unset, naming %s",
    (endpoint, envVar) => {
      const err = refusal(() =>
        resolveEndpoint(endpoint, undefined, "production")
      );
      expect(err.code).toBe(ENDPOINT_UNRESOLVED_CODE);
      expect(err.envVar).toBe(envVar);
      expect(err.nextAction).toContain(`Set ${envVar}`);
      expect(err.message).toMatch(/^This deployment is misconfigured — /);
      expect(err.message).toContain(err.nextAction);
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

  it("names the alternate variable for the server-side backend", () => {
    const err = refusal(() => resolveEndpoint("backend", "", "production"));
    expect(err.nextAction).toContain("BACKEND_URL (or NEXT_PUBLIC_API_URL)");
  });

  it("treats a whitespace-only value as unset", () => {
    expect(
      refusal(() => resolveEndpoint("runner", "   ", "production")).code
    ).toBe(ENDPOINT_UNRESOLVED_CODE);
  });

  it("fails loudly under test/preview builds too, not only production", () => {
    expect(refusal(() => resolveEndpoint("api", undefined, "test")).code).toBe(
      ENDPOINT_UNRESOLVED_CODE
    );
  });
});

describe("tryResolveEndpoint", () => {
  it("returns the refusal as a value", () => {
    const r = tryResolveEndpoint(() =>
      resolveEndpoint("api", undefined, "production")
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ENDPOINT_UNRESOLVED_CODE);
  });

  it("passes a resolved url through and rethrows unrelated errors", () => {
    expect(tryResolveEndpoint(() => "https://x.example")).toEqual({
      ok: true,
      url: "https://x.example",
    });
    expect(() =>
      tryResolveEndpoint(() => {
        throw new TypeError("boom");
      })
    ).toThrow(TypeError);
  });
});
