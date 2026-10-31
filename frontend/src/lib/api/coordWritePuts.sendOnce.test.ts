/**
 * The coord write PUTs are sent ONCE, through the REAL `HttpClient` (only the
 * network is stubbed).
 *
 * The client re-sends a PUT on any 5xx, and the write classifier
 * (`writeOutcome.ts`) reads only the LAST answer. So a first PUT that coord
 * committed but whose answer came back as a 504, followed by retries that hit
 * a coord now down and answer the proxy's connect-failure 502, would read as
 * "not applied" — a refusal of a write that landed. One attempt keeps the
 * answer the classifier reads the answer to the only request sent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));

import { HttpClient } from "@/services/http-client";
import {
  isWriteOutcomeUnknown,
  putAgentPref,
  putAgentRegistryDefaults,
} from "./agent-registry";
import { putNextStepSettings } from "./operations/coordSettings";
import {
  putContinuationDeliveryMode,
  putPostMergeFollowupScope,
} from "./operations/repoFollowupDials";

function tokenManager(): TokenManager {
  return {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => Date.now() + 3_600_000,
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  } as unknown as TokenManager;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let puts = 0;

beforeEach(() => {
  puts = 0;
  vi.useFakeTimers();
  for (const k of ["warn", "error", "log", "debug"] as const) {
    vi.spyOn(console, k).mockImplementation(() => {});
  }
  holder.client = new HttpClient(tokenManager());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() !== "PUT") {
        return json({ error: "not in this test" }, 404);
      }
      puts += 1;
      // The first answer is lost after the commit; every later attempt meets
      // a coord that is now down.
      return puts === 1
        ? json(
            { error: "gateway_timeout", message: "timeout waiting for coord" },
            504
          )
        : json(
            { error: "bad_gateway", message: "coord is not reachable" },
            502
          );
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  ["putAgentPref", () => putAgentPref("code-reviewer", { enabled: false })],
  [
    "putAgentRegistryDefaults",
    () => putAgentRegistryDefaults("code-reviewer", { default_enabled: false }),
  ],
  [
    "putNextStepSettings",
    () =>
      putNextStepSettings([
        { decision_domain: "pr_fix", autonomy_level: "auto_decide" },
      ]),
  ],
  [
    "putPostMergeFollowupScope",
    () => putPostMergeFollowupScope({ repo: "acme/widgets", scope: "none" }),
  ],
  [
    "putContinuationDeliveryMode",
    () => putContinuationDeliveryMode("acme/widgets", "notify_only"),
  ],
])("%s", (_name, write) => {
  it("sends one PUT on a 504, so the open outcome is the one reported", async () => {
    const settled = write().then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err })
    );
    // Long enough for the client's whole retry backoff (1s + 2s + 4s).
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await settled;
    expect(puts).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(isWriteOutcomeUnknown(result.err)).toBe(true);
  });
});
