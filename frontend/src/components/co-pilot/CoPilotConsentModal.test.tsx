/**
 * Tests for ``<CoPilotConsentModal>``.
 *
 * §4.5 safety rails under test:
 *   - renders ONLY when preference=true AND consent.state===null
 *   - "Allow this session" -> grants (sessionStorage = "granted")
 *   - "Not now" -> revokes (sessionStorage = "revoked"), not grant
 *   - ESC / backdrop close maps to revoke, NEVER to grant
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

import { CoPilotConsentModal } from "./CoPilotConsentModal";
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

function renderModal(client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CoPilotConsentModal />
    </QueryClientProvider>
  );
}

describe("<CoPilotConsentModal>", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("does NOT render when the user preference is off", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ui_bridge_co_pilot_enabled: false })
    );
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("co-pilot-consent-modal")).toBeNull();
  });

  it("does NOT render when the session decision is already 'granted'", async () => {
    window.sessionStorage.setItem(
      __CO_PILOT_SESSION_CONSENT_KEY__,
      "granted"
    );
    fetchMock.mockResolvedValue(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("co-pilot-consent-modal")).toBeNull();
  });

  it("does NOT render when the session decision is already 'revoked'", async () => {
    window.sessionStorage.setItem(
      __CO_PILOT_SESSION_CONSENT_KEY__,
      "revoked"
    );
    fetchMock.mockResolvedValue(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );
    renderModal();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("co-pilot-consent-modal")).toBeNull();
  });

  it("renders when preference=true AND no session decision yet", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("co-pilot-consent-modal")).toBeInTheDocument()
    );
  });

  it("'Allow this session' grants and writes 'granted' to sessionStorage", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("co-pilot-consent-modal")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("co-pilot-consent-allow"));
    expect(
      window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBe("granted");
  });

  it("'Not now' revokes and writes 'revoked' to sessionStorage (NOT granted)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("co-pilot-consent-modal")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("co-pilot-consent-not-now"));
    expect(
      window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
    ).toBe("revoked");
  });

  it("pressing Escape revokes (does NOT grant by default)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("co-pilot-consent-modal")).toBeInTheDocument()
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(
        window.sessionStorage.getItem(__CO_PILOT_SESSION_CONSENT_KEY__)
      ).toBe("revoked")
    );
  });
});
