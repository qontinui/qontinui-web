/**
 * Tests for the two gates that stop the beacon drowning its own signal, and
 * for the React-error capture path.
 *
 * Measured on production 2026-08-26: a single ANONYMOUS page load emitted ~4
 * error events — Google Analytics CORS/opaque failures plus the expected 401s
 * from `/auth/users/me` and `/users/me/preferences` — and Sentry was returning
 * HTTP 429 (quota exhausted) on every envelope. A full quota drops REAL errors
 * at ingest, and on that same day an outage that white-screened every
 * authenticated page produced no Sentry event at all.
 *
 * Contract under test:
 *   - a 401 from a first-party host is NOT an incident (it is the correct
 *     answer to an unauthenticated probe)
 *   - a 403 from a first-party host IS still an incident (possible authz bug)
 *   - a 4xx/5xx from a THIRD-party host is not ours to report
 *   - a thrown (CORS-blocked) fetch to a third-party host is not reported, and
 *     is still re-thrown to the caller
 *   - captureReactError is a safe no-op when the beacon is not installed
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __isInstalledForTests,
  captureReactError,
  installBeacon,
  uninstallBeacon,
} from "./beacon";

const INGEST_URL = "https://telemetry.qontinui.example/ingest";
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

/**
 * Captures what the beacon transmits, so we can assert on incident count. The
 * beacon's live-page transport is an observed keepalive fetch to the ingest
 * URL, so the transport spy is fed by the underlying fetch stub below.
 */
function armTransport() {
  return vi.fn();
}

let transport: ReturnType<typeof armTransport> | null = null;

/**
 * Installs a fake underlying fetch, then the beacon wraps it. Requests to the
 * ingest URL are the beacon's own sends: recorded on the transport spy and
 * answered 200; everything else goes to `impl`.
 */
function stubUnderlyingFetch(impl: typeof fetch) {
  const routed = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.startsWith(INGEST_URL)) {
      transport?.(url, init);
      return new Response(null, { status: 200 });
    }
    return impl(input, init);
  }) as typeof fetch;
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: routed,
  });
}

function jsonResponse(status: number): Response {
  return new Response("{}", { status });
}

describe("beacon noise gates", () => {
  let ingestSend: ReturnType<typeof armTransport>;

  beforeEach(() => {
    uninstallBeacon();
    clearOptOut();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", INGEST_URL);
    vi.stubEnv("NEXT_PUBLIC_API_URL", API_URL);
    ingestSend = armTransport();
    transport = ingestSend;
  });

  afterEach(() => {
    uninstallBeacon();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does NOT report a 401 from the API host", async () => {
    stubUnderlyingFetch(vi.fn(async () => jsonResponse(401)) as typeof fetch);
    expect(installBeacon()).toBe(true);

    await window.fetch(`${API_URL}/api/v1/auth/users/me`);

    expect(ingestSend).not.toHaveBeenCalled();
  });

  it("DOES report a 403 from the API host", async () => {
    stubUnderlyingFetch(vi.fn(async () => jsonResponse(403)) as typeof fetch);
    expect(installBeacon()).toBe(true);

    await window.fetch(`${API_URL}/api/v1/admin/stats`);

    // 403 is "authenticated but not allowed" — a possible authz defect, and it
    // is not emitted on every anonymous load the way 401 is.
    expect(ingestSend).toHaveBeenCalled();
  });

  it("does NOT report a 500 from a THIRD-party host", async () => {
    stubUnderlyingFetch(vi.fn(async () => jsonResponse(500)) as typeof fetch);
    expect(installBeacon()).toBe(true);

    await window.fetch("https://region1.google-analytics.com/g/collect");

    expect(ingestSend).not.toHaveBeenCalled();
  });

  it("does NOT report a thrown fetch to a third party, but still re-throws", async () => {
    const boom = new TypeError("Failed to fetch");
    stubUnderlyingFetch(
      vi.fn(async () => {
        throw boom;
      }) as unknown as typeof fetch
    );
    expect(installBeacon()).toBe(true);

    await expect(
      window.fetch("https://region1.google-analytics.com/g/collect")
    ).rejects.toBe(boom);

    // Observed, never swallowed — the app still sees its own error.
    expect(ingestSend).not.toHaveBeenCalled();
  });

  it("DOES report a thrown fetch to the API host", async () => {
    stubUnderlyingFetch(
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch
    );
    expect(installBeacon()).toBe(true);

    await expect(window.fetch(`${API_URL}/api/v1/workflows`)).rejects.toThrow();

    expect(ingestSend).toHaveBeenCalled();
  });
});

describe("captureReactError", () => {
  beforeEach(() => {
    uninstallBeacon();
    clearOptOut();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    uninstallBeacon();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is a safe no-op when the beacon is not installed", () => {
    expect(__isInstalledForTests()).toBe(false);
    // The ErrorBoundary calls this unconditionally, so it must never throw
    // while already handling an error.
    expect(() =>
      captureReactError(new Error("boom"), "\n    at Thing (file.tsx)")
    ).not.toThrow();
  });

  it("transmits a react_error incident when installed", () => {
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", INGEST_URL);

    // The live-page transport is a keepalive fetch, whose body is a plain
    // JSON string we can read. sendBeacon is removed so it cannot be used.
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: undefined,
    });
    const sentBodies: string[] = [];
    transport = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.body) sentBodies.push(String(init.body));
    });
    stubUnderlyingFetch(
      vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch
    );

    expect(installBeacon()).toBe(true);

    captureReactError(
      new Error("useOrganization must be used within an OrganizationProvider"),
      "\n    at CreateOrganizationDialog (app.js)"
    );

    expect(sentBodies.length).toBeGreaterThan(0);
    expect(sentBodies[0]).toContain("react_error");
  });
});
