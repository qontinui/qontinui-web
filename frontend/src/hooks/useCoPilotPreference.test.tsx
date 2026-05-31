/**
 * Tests for ``useCoPilotPreference``.
 *
 * Covers the §4.5 contract:
 *   - the preference loads from /api/v1/users/me/preferences
 *   - ``enabled`` is true iff the GET returned ui_bridge_co_pilot_enabled: true
 *   - mutate(false) and mutate(true) PUT the new value
 *   - server failure rolls back the optimistic update
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  useCoPilotPreference,
  CO_PILOT_PREFERENCE_QUERY_KEY,
} from "./useCoPilotPreference";

// Mock the httpClient so we can drive fetch shapes without spinning up
// the real service-factory + auth chain.
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "" },
}));

function wrapper(client: QueryClient) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("useCoPilotPreference", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("reports enabled=false when the GET returns the default shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ product_mode: "ai", ui_bridge_co_pilot_enabled: false })
    );

    const { result } = renderHook(() => useCoPilotPreference(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("reports enabled=true when the GET returns ui_bridge_co_pilot_enabled=true", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ product_mode: "ai", ui_bridge_co_pilot_enabled: true })
    );

    const { result } = renderHook(() => useCoPilotPreference(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("mutate(true) PUTs the new preference value", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ui_bridge_co_pilot_enabled: false })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );

    const { result } = renderHook(() => useCoPilotPreference(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.mutate(true);
    });

    const putCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT"
    );
    expect(putCalls).toHaveLength(1);
    const [, opts] = putCalls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({
      ui_bridge_co_pilot_enabled: true,
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("mutate(false) PUTs the new preference value (Stop / Disable for account)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ui_bridge_co_pilot_enabled: true })
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ui_bridge_co_pilot_enabled: false })
    );

    const { result } = renderHook(() => useCoPilotPreference(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.mutate(false);
    });

    const putCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT"
    );
    expect(putCall).toBeDefined();
    const [, opts] = putCall as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({
      ui_bridge_co_pilot_enabled: false,
    });
    await waitFor(() => expect(result.current.enabled).toBe(false));
  });

  it("rolls back the optimistic update on PUT failure", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ui_bridge_co_pilot_enabled: false })
    );
    fetchMock.mockResolvedValueOnce(
      new Response("server boom", { status: 500 })
    );

    const { result } = renderHook(() => useCoPilotPreference(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.enabled).toBe(false));

    await expect(
      act(async () => {
        await result.current.mutate(true);
      })
    ).rejects.toThrow();

    // After rollback the optimistic true is reverted.
    expect(result.current.enabled).toBe(false);
    expect(
      queryClient.getQueryData(CO_PILOT_PREFERENCE_QUERY_KEY)
    ).toEqual({ ui_bridge_co_pilot_enabled: false });
  });
});
