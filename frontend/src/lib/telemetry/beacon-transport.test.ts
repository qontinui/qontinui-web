/**
 * Transport-honesty tests for the client beacon.
 *
 * Plan 2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429,
 * Phase 5. Coord finding 687e0dbd attributed every load-time 429 in an agent's
 * exec-mode pass (14/14) to a POST of a Sentry envelope by this beacon:
 *
 *  - a navigation-aborted `/api/v1/operations/*` fetch was captured as a
 *    `fetch_failure`, so every early navigation emitted an envelope;
 *  - `transmit()` counted `navigator.sendBeacon()` merely QUEUEING as success,
 *    so Sentry's 429 never reached the rate limiter or the circuit breaker;
 *  - a burst of identical `/operations/*` 504s emitted one envelope each.
 *
 * Contract under test:
 *   - an aborted request (AbortError, or its own signal aborted) is not an
 *     incident, and is still re-thrown to the caller;
 *   - the beacon transmits with an OBSERVED fetch; only a 2xx answer is
 *     success, any other answer counts toward the circuit breaker;
 *   - a 429 suspends sending for Sentry's rate-limit window
 *     (`X-Sentry-Rate-Limits`, else `Retry-After`, else a conservative default);
 *   - a sendBeacon during pagehide is queued but unobserved, and is NOT success;
 *   - identical incidents are throttled per signature.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installBeacon, uninstallBeacon } from "./beacon";

const DSN = "https://abc123def456@o4509.ingest.de.sentry.io/1234567";
const INGEST_HOST = "https://o4509.ingest.de.sentry.io";
const API_URL = "https://api.qontinui.example";

function clearOptOut() {
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "doNotTrack", {
    configurable: true,
    value: null,
  });
}

/** Let the beacon's un-awaited ingest promise chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface Harness {
  /** Envelope POSTs that went out through fetch. */
  ingestFetches: Array<{ url: string; init?: RequestInit }>;
  /** Envelopes handed to navigator.sendBeacon. */
  beaconCalls: number;
  /** What the ingest answers next (default 200). */
  ingestResponse: () => Response;
  /** What an app request answers (default 504). */
  appResponse: (url: string, init?: RequestInit) => Promise<Response>;
  /** What navigator.sendBeacon returns. */
  beaconReturns: boolean;
}

function arm(): Harness {
  const h: Harness = {
    ingestFetches: [],
    beaconCalls: 0,
    ingestResponse: () => new Response(null, { status: 200 }),
    appResponse: async () => new Response("{}", { status: 504 }),
    beaconReturns: true,
  };
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: vi.fn(() => {
      h.beaconCalls += 1;
      return h.beaconReturns;
    }),
  });
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.startsWith(INGEST_HOST)) {
        h.ingestFetches.push({ url, init });
        return h.ingestResponse();
      }
      return h.appResponse(url, init);
    }),
  });
  return h;
}

/** Drive one app request that fails with an incident-worthy status. */
async function appFailure(path: string): Promise<void> {
  await window.fetch(`${API_URL}${path}`);
  await flush();
}

/** Total envelopes the beacon emitted, by either transport. */
function sends(h: Harness): number {
  return h.ingestFetches.length + h.beaconCalls;
}

describe("beacon transport honesty", () => {
  let h: Harness;

  beforeEach(() => {
    uninstallBeacon();
    clearOptOut();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", DSN);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
    h = arm();
  });

  afterEach(() => {
    uninstallBeacon();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("aborted requests are not incidents", () => {
    it("an AbortError DOMException is not captured, and is re-thrown", async () => {
      const abort = new DOMException(
        "The user aborted a request.",
        "AbortError"
      );
      h.appResponse = async () => {
        throw abort;
      };
      expect(installBeacon()).toBe(true);

      await expect(
        window.fetch(`${API_URL}/api/v1/operations/health`)
      ).rejects.toBe(abort);
      await flush();

      expect(sends(h)).toBe(0);
    });

    it("a request whose own signal aborted is not captured, whatever it threw", async () => {
      const controller = new AbortController();
      controller.abort();
      const boom = new TypeError("Failed to fetch");
      h.appResponse = async () => {
        throw boom;
      };
      expect(installBeacon()).toBe(true);

      await expect(
        window.fetch(`${API_URL}/api/v1/operations/health`, {
          signal: controller.signal,
        })
      ).rejects.toBe(boom);
      await flush();

      expect(sends(h)).toBe(0);
    });

    it("a non-abort thrown fetch is still captured", async () => {
      h.appResponse = async () => {
        throw new TypeError("Failed to fetch");
      };
      expect(installBeacon()).toBe(true);

      await expect(
        window.fetch(`${API_URL}/api/v1/operations/health`)
      ).rejects.toThrow();
      await flush();

      expect(sends(h)).toBe(1);
    });
  });

  describe("the ingest answer is observed", () => {
    it("transmits with keepalive fetch (observable), not sendBeacon, while the page is live", async () => {
      expect(installBeacon()).toBe(true);
      await appFailure("/api/v1/operations/alpha");

      expect(h.beaconCalls).toBe(0);
      expect(h.ingestFetches).toHaveLength(1);
      const init = h.ingestFetches[0].init;
      expect(init?.method).toBe("POST");
      expect(init?.keepalive).toBe(true);
      // CORS-safelisted content type → no preflight against Sentry ingest.
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
        "text/plain;charset=UTF-8"
      );
    });

    it("a non-2xx ingest answer counts toward the circuit breaker", async () => {
      h.ingestResponse = () => new Response(null, { status: 500 });
      expect(installBeacon()).toBe(true);

      for (const p of ["a", "b", "c", "d", "e"]) {
        await appFailure(`/api/v1/operations/${p}`);
      }
      expect(sends(h)).toBe(5);

      // Five consecutive failures trip the breaker: nothing more goes out.
      await appFailure("/api/v1/operations/f");
      expect(sends(h)).toBe(5);
    });

    it("a 2xx ingest answer is success and resets the failure count", async () => {
      expect(installBeacon()).toBe(true);
      h.ingestResponse = () => new Response(null, { status: 500 });
      for (const p of ["a", "b", "c", "d"]) {
        await appFailure(`/api/v1/operations/${p}`);
      }
      h.ingestResponse = () => new Response(null, { status: 200 });
      await appFailure("/api/v1/operations/e");
      h.ingestResponse = () => new Response(null, { status: 500 });
      for (const p of ["f", "g", "h", "i"]) {
        await appFailure(`/api/v1/operations/${p}`);
      }
      // 4 failures after the reset — below the threshold, still sending.
      await appFailure("/api/v1/operations/j");
      expect(sends(h)).toBe(10);
    });

    it("a sendBeacon queued during pagehide is NOT counted as success", async () => {
      // sendBeacon accepts (queues) only while the page is hiding.
      h.beaconReturns = false;
      h.ingestResponse = () => new Response(null, { status: 500 });
      expect(installBeacon()).toBe(true);

      for (const p of ["a", "b", "c", "d"]) {
        await appFailure(`/api/v1/operations/${p}`);
      }
      expect(h.ingestFetches).toHaveLength(4);

      // Page hides: the beacon may only queue — sendBeacon is the right
      // transport here, and its acceptance says nothing about Sentry's answer.
      h.beaconReturns = true;
      window.dispatchEvent(new Event("pagehide"));
      await appFailure("/api/v1/operations/e");
      expect(h.beaconCalls).toBe(1);

      // bfcache restore: back to the observed transport.
      h.beaconReturns = false;
      window.dispatchEvent(new Event("pageshow"));
      await appFailure("/api/v1/operations/f");
      expect(h.ingestFetches).toHaveLength(5);

      // The queued send did not reset the count, so 4 + 1 observed failures
      // have tripped the breaker.
      await appFailure("/api/v1/operations/g");
      expect(sends(h)).toBe(6);
    });
  });

  describe("Sentry's 429 suspends sending for its window", () => {
    async function trip429(headers: Record<string, string>) {
      h.ingestResponse = () => new Response(null, { status: 429, headers });
      expect(installBeacon()).toBe(true);
      await appFailure("/api/v1/operations/first");
      expect(sends(h)).toBe(1);
      h.ingestResponse = () => new Response(null, { status: 200 });
    }

    it("honours Retry-After (seconds)", async () => {
      await trip429({ "Retry-After": "120" });

      vi.setSystemTime(Date.now() + 119_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(1);

      vi.setSystemTime(Date.now() + 2_000);
      await appFailure("/api/v1/operations/third");
      expect(sends(h)).toBe(2);
    });

    it("honours X-Sentry-Rate-Limits for the error category over Retry-After", async () => {
      await trip429({
        "X-Sentry-Rate-Limits": "300:error;default:organization:quota_exceeded",
        "Retry-After": "10",
      });

      vi.setSystemTime(Date.now() + 299_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(1);

      vi.setSystemTime(Date.now() + 2_000);
      await appFailure("/api/v1/operations/third");
      expect(sends(h)).toBe(2);
    });

    it("an X-Sentry-Rate-Limits group with no categories applies to all", async () => {
      await trip429({ "X-Sentry-Rate-Limits": "90::organization" });

      vi.setSystemTime(Date.now() + 89_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(1);

      vi.setSystemTime(Date.now() + 2_000);
      await appFailure("/api/v1/operations/third");
      expect(sends(h)).toBe(2);
    });

    it("with no readable rate-limit header, backs off conservatively (60 s)", async () => {
      await trip429({});

      vi.setSystemTime(Date.now() + 59_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(1);

      vi.setSystemTime(Date.now() + 2_000);
      await appFailure("/api/v1/operations/third");
      expect(sends(h)).toBe(2);
    });
  });

  describe("per-signature burst throttle", () => {
    it("a burst of 11 identical 504s emits one envelope", async () => {
      expect(installBeacon()).toBe(true);
      for (let i = 0; i < 11; i++) {
        await appFailure("/api/v1/operations/runners");
      }
      expect(sends(h)).toBe(1);
    });

    it("a different path or status is a different signature", async () => {
      expect(installBeacon()).toBe(true);
      await appFailure("/api/v1/operations/runners");
      await appFailure("/api/v1/operations/sessions");
      h.appResponse = async () => new Response("{}", { status: 502 });
      await appFailure("/api/v1/operations/runners");
      expect(sends(h)).toBe(3);
    });

    it("the same signature sends again once its window has passed", async () => {
      expect(installBeacon()).toBe(true);
      await appFailure("/api/v1/operations/runners");
      vi.setSystemTime(Date.now() + 61_000);
      await appFailure("/api/v1/operations/runners");
      expect(sends(h)).toBe(2);
    });
  });
});
