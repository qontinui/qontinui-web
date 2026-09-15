/**
 * Tests for ``<CoPilotReadyStatus>``.
 *
 * The badge must report the SAME answer the relay listener mounts on
 * (``lib/ui-bridge/co-pilot-gates``) — in particular it must not claim
 * consent is missing while a loopback-dev auto-grant has the relay live,
 * nor claim "ready" after the developer explicitly revoked.
 *
 * The env gate and loopback detection both read `isDev`, which is fixed at
 * import time (NODE_ENV is "test" under vitest), so both are stubbed here.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CoPilotReadyStatus } from "./CoPilotReadyStatus";
import { __CO_PILOT_SESSION_CONSENT_KEY__ } from "@/hooks/useCoPilotSessionConsent";

const gates = vi.hoisted(() => ({ envEnabled: true, loopbackDev: false }));
vi.mock("@/lib/ui-bridge/co-pilot-gates", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ui-bridge/co-pilot-gates")>();
  return {
    ...actual,
    get isRemoteCommandsEnvEnabled() {
      return gates.envEnabled;
    },
    useIsLoopbackDev: () => gates.loopbackDev,
  };
});

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "" },
}));

function preferenceResponse(enabled: boolean): Response {
  return new Response(JSON.stringify({ ui_bridge_co_pilot_enabled: enabled }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function renderedStatus(): Promise<string | null> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CoPilotReadyStatus />
    </QueryClientProvider>
  );
  let status: string | null = null;
  await waitFor(() => {
    status = screen
      .getByTestId("co-pilot-ready-status")
      .getAttribute("data-status");
    expect(status).not.toBe("loading");
  });
  return status;
}

describe("<CoPilotReadyStatus>", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.sessionStorage.clear();
    gates.envEnabled = true;
    gates.loopbackDev = false;
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it.each([
    // envEnabled, loopbackDev, preference, consent, expected data-status
    [false, true, true, "granted", "env-disabled"],
    [true, true, false, null, "loopback-auto-granted"],
    [true, true, false, "granted", "loopback-auto-granted"],
    [true, true, true, "granted", "ready"],
    [true, true, true, "revoked", "revoked"],
    [true, true, false, "revoked", "revoked"],
    [true, false, false, null, "disabled"],
    [true, false, true, null, "consent-pending"],
    [true, false, true, "revoked", "consent-pending"],
    [true, false, true, "granted", "ready"],
  ] as const)(
    "env=%s loopbackDev=%s preference=%s consent=%s → %s",
    async (envEnabled, loopbackDev, preference, consent, expected) => {
      gates.envEnabled = envEnabled;
      gates.loopbackDev = loopbackDev;
      if (consent !== null) {
        window.sessionStorage.setItem(__CO_PILOT_SESSION_CONSENT_KEY__, consent);
      }
      fetchMock.mockResolvedValue(preferenceResponse(preference));
      expect(await renderedStatus()).toBe(expected);
    }
  );
});
