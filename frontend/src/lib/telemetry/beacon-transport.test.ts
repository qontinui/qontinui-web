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

  describe("timeouts are incidents, caller aborts are not", () => {
    /** An app request that rejects the way the platform does: with the signal's reason. */
    function rejectOnAbort() {
      h.appResponse = (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) return reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason));
        });
    }

    it("a client timeout aborting with a TimeoutError reason IS captured", async () => {
      rejectOnAbort();
      expect(installBeacon()).toBe(true);
      const controller = new AbortController();
      const pending = window.fetch(`${API_URL}/api/v1/operations/slow`, {
        signal: controller.signal,
      });
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
      await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      await flush();

      expect(sends(h)).toBe(1);
    });

    it("an AbortSignal.timeout expiry IS captured", async () => {
      rejectOnAbort();
      expect(installBeacon()).toBe(true);
      const pending = window.fetch(`${API_URL}/api/v1/operations/slow`, {
        signal: AbortSignal.timeout(1),
      });
      await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
      await flush();

      expect(sends(h)).toBe(1);
    });

    it("a navigation/user abort (default AbortError reason) is NOT captured", async () => {
      rejectOnAbort();
      expect(installBeacon()).toBe(true);
      const controller = new AbortController();
      const pending = window.fetch(`${API_URL}/api/v1/operations/slow`, {
        signal: controller.signal,
      });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await flush();

      expect(sends(h)).toBe(0);
    });

    it("a Request input whose own signal aborted is NOT captured", async () => {
      const boom = new TypeError("Failed to fetch");
      h.appResponse = async () => {
        throw boom;
      };
      expect(installBeacon()).toBe(true);
      const controller = new AbortController();
      controller.abort();
      const request = new Request(`${API_URL}/api/v1/operations/health`, {
        signal: controller.signal,
      });

      await expect(window.fetch(request)).rejects.toBe(boom);
      await flush();

      expect(sends(h)).toBe(0);
    });

    it("a rejection while the page is hiding is NOT captured", async () => {
      h.appResponse = async () => {
        throw new TypeError("Failed to fetch");
      };
      expect(installBeacon()).toBe(true);
      window.dispatchEvent(new Event("pagehide"));

      await expect(
        window.fetch(`${API_URL}/api/v1/operations/health`)
      ).rejects.toThrow();
      await flush();

      expect(sends(h)).toBe(0);
    });
  });

  describe("ingest answers that are neither success nor failure", () => {
    it("a 429 opens the window but does not count toward the breaker", async () => {
      expect(installBeacon()).toBe(true);
      h.ingestResponse = () => new Response(null, { status: 500 });
      for (const p of ["a", "b", "c", "d"]) {
        await appFailure(`/api/v1/operations/${p}`);
      }
      h.ingestResponse = () =>
        new Response(null, { status: 429, headers: { "Retry-After": "1" } });
      await appFailure("/api/v1/operations/e");
      expect(sends(h)).toBe(5);

      vi.setSystemTime(Date.now() + 2_000);
      h.ingestResponse = () => new Response(null, { status: 200 });
      // 4 failures + a 429: the breaker has NOT tripped.
      await appFailure("/api/v1/operations/f");
      expect(sends(h)).toBe(6);
    });

    it("a rejected keepalive fetch is NOT retried via sendBeacon and opens the default 60 s window", async () => {
      // A rejection cannot be told apart from a CORS-blocked read of an answer
      // the ingest already received, so re-sending could duplicate it.
      h.beaconReturns = true;
      h.ingestResponse = () => {
        throw new TypeError("Failed to fetch");
      };
      expect(installBeacon()).toBe(true);

      await appFailure("/api/v1/operations/a");
      expect(h.ingestFetches).toHaveLength(1);
      expect(h.beaconCalls).toBe(0);

      // Unknown outcome → the conservative window: nothing for 60 s.
      vi.setSystemTime(Date.now() + 59_000);
      await appFailure("/api/v1/operations/b");
      expect(sends(h)).toBe(1);

      vi.setSystemTime(Date.now() + 2_000);
      await appFailure("/api/v1/operations/c");
      expect(h.ingestFetches).toHaveLength(2);
      expect(h.beaconCalls).toBe(0);
    });

    it("sustained keepalive rejections trip the breaker", async () => {
      h.ingestResponse = () => {
        throw new TypeError("Failed to fetch");
      };
      expect(installBeacon()).toBe(true);

      for (const p of ["a", "b", "c", "d", "e"]) {
        await appFailure(`/api/v1/operations/${p}`);
        vi.setSystemTime(Date.now() + 61_000); // past each rejection's window
      }
      expect(sends(h)).toBe(5);

      // Five consecutive unknown rejections: the breaker is open.
      h.ingestResponse = () => new Response(null, { status: 200 });
      await appFailure("/api/v1/operations/f");
      expect(sends(h)).toBe(5);
    });

    it("a throw inside the response handler never becomes an unhandled rejection", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        // A Response whose headers getter throws: the handler blows up.
        h.ingestResponse = () => {
          const res = new Response(null, { status: 200 });
          Object.defineProperty(res, "headers", {
            get() {
              throw new Error("handler boom");
            },
          });
          return res;
        };
        expect(installBeacon()).toBe(true);
        await appFailure("/api/v1/operations/a");
        await flush();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });
  });

  describe("rate-limit header details", () => {
    async function firstSendAnswered(res: () => Response) {
      h.ingestResponse = res;
      expect(installBeacon()).toBe(true);
      await appFailure("/api/v1/operations/first");
      expect(sends(h)).toBe(1);
      h.ingestResponse = () => new Response(null, { status: 200 });
    }

    it("honours an HTTP-date Retry-After", async () => {
      const until = new Date(Date.now() + 120_000).toUTCString();
      await firstSendAnswered(
        () =>
          new Response(null, { status: 429, headers: { "Retry-After": until } })
      );

      vi.setSystemTime(Date.now() + 119_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(1);

      vi.setSystemTime(Date.now() + 2_000);
      await appFailure("/api/v1/operations/third");
      expect(sends(h)).toBe(2);
    });

    it("a rate-limit group naming only `transaction` does not back off error events", async () => {
      await firstSendAnswered(
        () =>
          new Response(null, {
            status: 429,
            headers: { "X-Sentry-Rate-Limits": "600:transaction:organization" },
          })
      );

      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(2);
    });

    it("a 2xx carrying X-Sentry-Rate-Limits applies it", async () => {
      await firstSendAnswered(
        () =>
          new Response(null, {
            status: 200,
            headers: { "X-Sentry-Rate-Limits": "60:error:key" },
          })
      );

      vi.setSystemTime(Date.now() + 59_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(1);

      vi.setSystemTime(Date.now() + 2_000);
      await appFailure("/api/v1/operations/third");
      expect(sends(h)).toBe(2);
    });

    it("caps any rate-limit delay at one hour", async () => {
      await firstSendAnswered(
        () =>
          new Response(null, {
            status: 429,
            headers: { "X-Sentry-Rate-Limits": "86400:error:organization" },
          })
      );

      vi.setSystemTime(Date.now() + 3_601_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(2);
    });

    it("caps a huge Retry-After at one hour", async () => {
      await firstSendAnswered(
        () =>
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "999999" },
          })
      );

      vi.setSystemTime(Date.now() + 3_601_000);
      await appFailure("/api/v1/operations/second");
      expect(sends(h)).toBe(2);
    });
  });

  describe("throttle signature distinguishes distinct errors of one class", () => {
    it("two window errors with different top frames both send", async () => {
      expect(installBeacon()).toBe(true);
      const own = window.location.origin;
      for (const fn of ["alpha", "beta"]) {
        const err = new Error("boom");
        err.stack = `Error: boom\n    at ${fn} (${own}/_next/app.js:1${fn.length}:5)`;
        window.onerror?.("boom", undefined, undefined, undefined, err);
      }
      await flush();
      expect(sends(h)).toBe(2);
    });

    it("the same error on two different routes both send", async () => {
      expect(installBeacon()).toBe(true);
      const err = new Error("boom");
      err.stack = `Error: boom\n    at alpha (${window.location.origin}/_next/app.js:10:5)`;
      window.history.pushState({}, "", "/first");
      window.onerror?.("boom", undefined, undefined, undefined, err);
      window.history.pushState({}, "", "/second");
      window.onerror?.("boom", undefined, undefined, undefined, err);
      window.history.pushState({}, "", "/");
      await flush();
      expect(sends(h)).toBe(2);
    });
  });
});
