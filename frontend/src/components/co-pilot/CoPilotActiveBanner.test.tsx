/**
 * Tests for ``<CoPilotActiveBanner>``.
 *
 * §4.5 contract under test:
 *   - banner renders ONLY when preference=true AND consent=granted AND
 *     activity says isActive
 *   - the rendered banner subtree is wrapped in
 *     ``data-bridge-invisible="true"`` (SDK auto-register skip — Stop
 *     button MUST be inside that subtree so the bridge can't click it)
 *   - "Stop" revokes the per-session consent AND fires a
 *     consent.revoked audit POST
 *   - "Disable for this account" calls preference.mutate(false) AND
 *     revokes session AND fires a consent.revoked audit POST
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CoPilotActiveBanner } from "./CoPilotActiveBanner";
import {
  __CO_PILOT_SESSION_CONSENT_KEY__,
} from "@/hooks/useCoPilotSessionConsent";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "" },
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function preferenceResponse(enabled: boolean): Response {
  return jsonResponse({ ui_bridge_co_pilot_enabled: enabled });
}

function activityResponse(items: Array<{ occurred_at: string }>): Response {
  return jsonResponse({ items });
}

function renderBanner() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CoPilotActiveBanner />
    </QueryClientProvider>
  );
}

describe("<CoPilotActiveBanner>", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("renders hidden placeholder when preference is off", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/preferences")) {
        return Promise.resolve(preferenceResponse(false));
      }
      return Promise.resolve(activityResponse([]));
    });
    renderBanner();
    await waitFor(() => {
      const hidden = screen.queryByTestId("co-pilot-active-banner-hidden");
      expect(hidden).not.toBeNull();
      expect(hidden?.getAttribute("data-bridge-invisible")).toBe("true");
    });
  });

  it("renders hidden placeholder when consent is not granted", async () => {
    window.sessionStorage.setItem(__CO_PILOT_SESSION_CONSENT_KEY__, "revoked");
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/preferences")) {
        return Promise.resolve(preferenceResponse(true));
      }
      return Promise.resolve(activityResponse([]));
    });
    renderBanner();
    await waitFor(() => {
      expect(
        screen.queryByTestId("co-pilot-active-banner-hidden")
      ).not.toBeNull();
    });
  });

  it("renders the banner when preference=on, consent=granted, and activity is recent", async () => {
    window.sessionStorage.setItem(
      __CO_PILOT_SESSION_CONSENT_KEY__,
      "granted"
    );
    const recent = new Date(Date.now() - 2_000).toISOString();
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/preferences")) {
        return Promise.resolve(preferenceResponse(true));
      }
      return Promise.resolve(activityResponse([{ occurred_at: recent }]));
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.queryByTestId("co-pilot-active-banner")).not.toBeNull();
    });
  });

  it("banner root is wrapped in data-bridge-invisible='true' (auto-register skip)", async () => {
    window.sessionStorage.setItem(
      __CO_PILOT_SESSION_CONSENT_KEY__,
      "granted"
    );
    const recent = new Date(Date.now() - 2_000).toISOString();
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/preferences")) {
        return Promise.resolve(preferenceResponse(true));
      }
      return Promise.resolve(activityResponse([{ occurred_at: recent }]));
    });
    renderBanner();
    await waitFor(() => {
      const banner = screen.getByTestId("co-pilot-active-banner");
      expect(banner.getAttribute("data-bridge-invisible")).toBe("true");
      // Stop button must be INSIDE the invisible subtree.
      const stop = screen.getByTestId("co-pilot-active-banner-stop");
      expect(banner.contains(stop)).toBe(true);
    });
  });

  it("Stop button revokes session consent AND fires a consent.revoked audit POST", async () => {
    window.sessionStorage.setItem(
      __CO_PILOT_SESSION_CONSENT_KEY__,
      "granted"
    );
    const recent = new Date(Date.now() - 2_000).toISOString();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/preferences")) {
        return Promise.resolve(preferenceResponse(true));
      }
      if (
        typeof url === "string" &&
        url.includes("/co-pilot/activity") &&
        init?.method === "POST"
      ) {
        return Promise.resolve(new Response("{}", { status: 201 }));
      }
      return Promise.resolve(activityResponse([{ occurred_at: recent }]));
    });
    renderBanner();
    await waitFor(() => {
      expect(screen.queryByTestId("co-pilot-active-banner")).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("co-pilot-active-banner-stop"));

    expect(
      window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBe("revoked");

    const audited = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        typeof url === "string" &&
        url.includes("/co-pilot/activity") &&
        init?.method === "POST"
    );
    expect(audited).toBeDefined();
    const [, init] = audited as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.command_name).toBe("consent.revoked");
    expect(body.path).toBe("/co-pilot/banner");
    expect(body.method).toBe("POST");
    expect(body.status_code).toBe(200);
    expect(body.payload_summary?.reason).toBe("stop_button");
  });

  it("'Disable for this account' link mutates preference=false AND revokes session AND audits", async () => {
    window.sessionStorage.setItem(
      __CO_PILOT_SESSION_CONSENT_KEY__,
      "granted"
    );
    const recent = new Date(Date.now() - 2_000).toISOString();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/preferences")) {
        if (init?.method === "PUT") {
          return Promise.resolve(preferenceResponse(false));
        }
        return Promise.resolve(preferenceResponse(true));
      }
      if (
        typeof url === "string" &&
        url.includes("/co-pilot/activity") &&
        init?.method === "POST"
      ) {
        return Promise.resolve(new Response("{}", { status: 201 }));
      }
      return Promise.resolve(activityResponse([{ occurred_at: recent }]));
    });

    renderBanner();
    await waitFor(() => {
      expect(screen.queryByTestId("co-pilot-active-banner")).not.toBeNull();
    });

    fireEvent.click(
      screen.getByTestId("co-pilot-active-banner-disable-account")
    );

    // Session consent revoked
    expect(
      window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBe("revoked");

    // Preference PUT fired with false
    await waitFor(() => {
      const prefPut = fetchMock.mock.calls.find(
        ([url, init]: [string, RequestInit | undefined]) =>
          typeof url === "string" &&
          url.includes("/preferences") &&
          init?.method === "PUT"
      );
      expect(prefPut).toBeDefined();
      const [, prefInit] = prefPut as [string, RequestInit];
      expect(JSON.parse(prefInit.body as string)).toEqual({
        ui_bridge_co_pilot_enabled: false,
      });
    });

    // Audit row fired with the right reason
    const audited = fetchMock.mock.calls.find(
      ([url, init]: [string, RequestInit | undefined]) =>
        typeof url === "string" &&
        url.includes("/co-pilot/activity") &&
        init?.method === "POST"
    );
    expect(audited).toBeDefined();
    const [, auditInit] = audited as [string, RequestInit];
    const auditBody = JSON.parse(auditInit.body as string);
    expect(auditBody.command_name).toBe("consent.revoked");
    expect(auditBody.payload_summary?.reason).toBe("disable_for_account");
  });
});
