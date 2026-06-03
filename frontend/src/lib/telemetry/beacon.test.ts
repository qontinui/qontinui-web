import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __isInstalledForTests,
  installBeacon,
  isBeaconEnabled,
  isOptedOut,
  uninstallBeacon,
} from "./beacon";

const INGEST_URL = "https://telemetry.qontinui.example/ingest";

function clearOptOut() {
  // Ensure GPC/DNT are off for the baseline.
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "doNotTrack", {
    configurable: true,
    value: null,
  });
}

describe("beacon enable gate (counsel-review gate)", () => {
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

  it("is DISABLED by default (flag unset)", () => {
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "");
    expect(isBeaconEnabled()).toBe(false);
  });

  it("flag-off → installBeacon is a NO-OP: no listeners, nothing sent", () => {
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", INGEST_URL);
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    const originalFetch = window.fetch;

    const onErrorBefore = window.onerror;
    const installed = installBeacon();

    expect(installed).toBe(false);
    expect(__isInstalledForTests()).toBe(false);
    // No listeners installed: fetch NOT wrapped + window.onerror untouched.
    expect(window.fetch).toBe(originalFetch);
    expect(window.onerror).toBe(onErrorBefore);
    // And nothing was transmitted at install time.
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("flag-on with NO ingest URL → still installs nothing (never derives from API_URL)", () => {
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", "");
    expect(installBeacon()).toBe(false);
    expect(__isInstalledForTests()).toBe(false);
  });

  it("flag-on + ingest URL → installs + wraps fetch", () => {
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", INGEST_URL);
    const originalFetch = window.fetch;
    expect(installBeacon()).toBe(true);
    expect(__isInstalledForTests()).toBe(true);
    expect(window.fetch).not.toBe(originalFetch);
  });
});

describe("GPC / DNT opt-out (plan §3.6)", () => {
  beforeEach(() => {
    uninstallBeacon();
    clearOptOut();
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", INGEST_URL);
  });

  afterEach(() => {
    uninstallBeacon();
    clearOptOut();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("GPC=true → opted out → installs nothing + sends nothing", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      configurable: true,
      value: true,
    });
    expect(isOptedOut()).toBe(true);

    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });

    expect(installBeacon()).toBe(false);
    expect(__isInstalledForTests()).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("DNT=1 → opted out", () => {
    Object.defineProperty(navigator, "doNotTrack", {
      configurable: true,
      value: "1",
    });
    expect(isOptedOut()).toBe(true);
    expect(installBeacon()).toBe(false);
  });
});

describe("scrubbing through the capture path (no raw URL / message body leaks)", () => {
  let sendBeacon: ReturnType<typeof vi.fn>;
  const sentBodies: string[] = [];

  beforeEach(async () => {
    uninstallBeacon();
    clearOptOut();
    sentBodies.length = 0;
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", INGEST_URL);
    // Force the keepalive-fetch transmit fallback (jsdom Blob has no readable
    // .text(), so we route through fetch where the body is a plain JSON string
    // we can capture + inspect for scrubbing).
    sendBeacon = vi.fn(() => false); // returns false → beacon falls back to fetch
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
  });

  afterEach(() => {
    uninstallBeacon();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("a thrown cross-origin fetch is captured + scrubbed (host kept, url/body dropped)", async () => {
    // The underlying fetch: REJECT the app's cross-origin call (the worked
    // example), but ACCEPT + record the beacon's own telemetry POST (so we can
    // inspect the scrubbed body). Give the error an own-bundle stack so the
    // §4.1 carve-out admits it.
    const err = new TypeError("Failed to fetch");
    const own = window.location.origin; // jsdom page origin = own bundle
    err.stack = [
      "TypeError: Failed to fetch",
      `    at getCurrentUser (${own}/_next/app.js:10:5)`,
      `    at fetch (${own}/_next/app.js:20:3)`,
    ].join("\n");
    window.fetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.startsWith(INGEST_URL)) {
          if (init?.body) sentBodies.push(String(init.body));
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.reject(err);
      }
    ) as unknown as typeof fetch;

    installBeacon();

    const wrapped = window.fetch;
    await expect(
      wrapped(
        "https://web.staging.qontinui.io/api/v1/users/12345?token=secret&email=jspinak@gmail.com"
      )
    ).rejects.toBeTruthy();

    // Let the keepalive-fetch transmit microtask resolve.
    await Promise.resolve();
    await Promise.resolve();

    // The cross-origin failure must have been transmitted to the dedicated
    // ingest origin (via the fetch fallback after sendBeacon returned false).
    expect(sentBodies.length).toBeGreaterThan(0);
    const body = sentBodies[0];
    expect(body).toContain("web.staging.qontinui.io"); // host kept
    expect(body).not.toContain("token=secret"); // raw query dropped
    expect(body).not.toContain("jspinak@gmail.com"); // PII in query dropped
    expect(body).not.toContain("12345"); // raw id templatized away
    expect(body).toContain("cors_failure"); // classified correctly
    // The path template is host-stripped + param-templatized.
    const parsed = JSON.parse(body);
    expect(parsed.request_host).toBe("web.staging.qontinui.io");
    expect(parsed.request_path_tmpl).toBe("/api/v1/users/:id");
  });
});

describe("third-party / extension frame carve-out (§4.1)", () => {
  // Indirectly covered: isOwnBundleStack is exercised in the capture path.
  // Here we just assert the gate constants behave.
  it("enable + opt-out helpers are pure booleans", () => {
    expect(typeof isBeaconEnabled()).toBe("boolean");
    expect(typeof isOptedOut()).toBe("boolean");
  });
});
