/**
 * A coord write answered 2xx with a body that would not parse, through the
 * REAL `HttpClient` (only the network is stubbed).
 *
 * The answer reached the browser — an HTML page from an intermediary, or an
 * empty body — so the outcome is open (the write may have landed) and the
 * reason must say an answer came back, never "no answer reached the browser".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenManager } from "@/services/auth/token-manager";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/services/service-factory", () => ({
  get httpClient() {
    return holder.client;
  },
}));

import { HttpClient, UnreadableAnswerError } from "@/services/http-client";
import {
  ANSWER_UNREADABLE_REASON,
  outcomeUnknownReason,
} from "@/components/admin/coord/writeOutcome";
import { isUnconfirmedFailure } from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import {
  isWriteOutcomeUnknown,
  putAgentPref,
  putAgentRegistryDefaults,
} from "./agent-registry";
import { putNextStepSettings } from "./operations/coordSettings";
import { patchTenantAutoFixPr } from "./operations/prMerge";
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

const BODIES = {
  "an HTML body": {
    body: "<html><body>Upstream says hello</body></html>",
    type: "text/html",
  },
  "an empty body": { body: "", type: "application/json" },
} as const;

let writes = 0;
let answer: { body: string; type: string } = BODIES["an HTML body"];

beforeEach(() => {
  writes = 0;
  for (const k of ["warn", "error", "log", "debug"] as const) {
    vi.spyOn(console, k).mockImplementation(() => {});
  }
  holder.client = new HttpClient(tokenManager());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method !== "PUT" && method !== "PATCH") {
        return new Response('{"error":"not in this test"}', { status: 404 });
      }
      writes += 1;
      return new Response(answer.body, {
        status: 200,
        headers: { "Content-Type": answer.type },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const WRITES: Array<[string, () => Promise<unknown>]> = [
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
    () => putPostMergeFollowupScope({ repo: "acme/widgets", scope: "all" }),
  ],
  [
    "putContinuationDeliveryMode",
    () => putContinuationDeliveryMode("acme/widgets", "spawn_always"),
  ],
  ["patchTenantAutoFixPr", () => patchTenantAutoFixPr(true)],
];

describe.each(Object.entries(BODIES))("a 2xx with %s", (_label, body) => {
  describe.each(WRITES)("%s", (name, write) => {
    it("is an open outcome whose reason says an answer came back", async () => {
      answer = body;
      const err = await write().then(
        () => {
          throw new Error(`${name} resolved on an unreadable 2xx`);
        },
        (e: unknown) => e
      );
      expect(writes).toBe(1);
      expect(err).toBeInstanceOf(UnreadableAnswerError);
      expect(err).toBeInstanceOf(SyntaxError);
      expect((err as UnreadableAnswerError).answeredStatus).toBe(200);
      expect(isWriteOutcomeUnknown(err)).toBe(true);
      expect(outcomeUnknownReason(err)).toBe(ANSWER_UNREADABLE_REASON);
      expect(outcomeUnknownReason(err)).not.toContain("no answer");
      if (name === "patchTenantAutoFixPr") {
        expect(isUnconfirmedFailure(err)).toBe(true);
      }
    });
  });
});

describe("outcomeUnknownReason", () => {
  it("names a bare SyntaxError from a response.json() as an answer that came back", () => {
    expect(
      outcomeUnknownReason(new SyntaxError("Unexpected end of JSON input"))
    ).toBe(ANSWER_UNREADABLE_REASON);
  });

  it("still says no answer reached the browser for a rejected fetch", () => {
    expect(outcomeUnknownReason(new TypeError("Failed to fetch"))).toBe(
      "no answer reached the browser"
    );
  });
});
