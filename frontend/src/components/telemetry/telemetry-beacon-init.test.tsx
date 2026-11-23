/**
 * Arming test: production installs the beacon through TelemetryBeaconInit in
 * the root layout, so the abort/timeout contract is pinned through it (plan
 * 2026-11-23-an-exec-mode-pass-draws-an-unattributed-load-time-429, Phase 5).
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { uninstallBeacon } from "@/lib/telemetry/beacon";

import { TelemetryBeaconInit } from "./telemetry-beacon-init";

const DSN = "https://abc123def456@o4509.ingest.de.sentry.io/1234567";
const INGEST_HOST = "https://o4509.ingest.de.sentry.io";

beforeEach(() => {
  uninstallBeacon();
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "doNotTrack", {
    configurable: true,
    value: null,
  });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: undefined,
  });
  vi.stubEnv("NEXT_PUBLIC_TELEMETRY_BEACON_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_TELEMETRY_INGEST_URL", DSN);
});

afterEach(() => {
  uninstallBeacon();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("TelemetryBeaconInit installs a beacon that skips aborts and reports timeouts", async () => {
  const ingest: string[] = [];
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(INGEST_HOST)) {
        ingest.push(String(init?.body ?? ""));
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      // Platform behaviour: an aborted request rejects with the signal's reason.
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    }),
  });
  const unwrapped = window.fetch;

  render(<TelemetryBeaconInit />);
  expect(window.fetch).not.toBe(unwrapped); // the beacon wrapped fetch

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  // A navigation-aborted request: the default AbortError reason.
  const nav = new AbortController();
  const navigated = window.fetch(
    "https://api.qontinui.example/api/v1/operations/runners",
    { signal: nav.signal }
  );
  nav.abort();
  await expect(navigated).rejects.toMatchObject({ name: "AbortError" });
  await settle();
  expect(ingest).toHaveLength(0);

  // A client timeout: the typed TimeoutError reason.
  const timer = new AbortController();
  const timedOut = window.fetch(
    "https://api.qontinui.example/api/v1/operations/runners",
    { signal: timer.signal }
  );
  timer.abort(new DOMException("Request timed out", "TimeoutError"));
  await expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });
  await settle();
  expect(ingest).toHaveLength(1);
  expect(ingest[0]).toContain("TimeoutError");
});
