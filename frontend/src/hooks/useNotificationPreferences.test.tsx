/**
 * Tests for useNotificationPreferences.
 *
 * Covers:
 *  - GET /api/v1/notifications/preferences loads and surfaces preferences
 *  - save() PUTs the partial update payload
 *  - Optimistic update is applied immediately; rolled back on server failure
 *  - save() re-throws on PUT failure so the caller can show an error
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  useNotificationPreferences,
  NOTIFICATION_PREFS_QUERY_KEY,
  type NotificationPreferencesShape,
} from "./useNotificationPreferences";

// ---------------------------------------------------------------------------
// Mock the httpClient and ApiConfig so no real HTTP calls are made
// ---------------------------------------------------------------------------
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "" },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const DEFAULT_PREFS: NotificationPreferencesShape = {
  id: "abc",
  user_id: "u1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  email_mentions: true,
  email_comments: true,
  email_shares: true,
  email_replies: true,
  email_team_invites: true,
  email_gate_action: true,
  in_app_mentions: true,
  in_app_comments: true,
  in_app_shares: true,
  in_app_replies: true,
  in_app_team_invites: true,
  in_app_project_updates: true,
  in_app_gate_action: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useNotificationPreferences", () => {
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

  it("surfaces preferences from the GET response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(DEFAULT_PREFS));

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences).toMatchObject({
      email_gate_action: true,
      in_app_gate_action: true,
    });
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error when the GET fails", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.preferences).toBeUndefined();
  });

  it("save() PUTs only the changed field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(DEFAULT_PREFS));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...DEFAULT_PREFS, email_gate_action: false })
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.save({ email_gate_action: false });
    });

    const putCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT"
    );
    expect(putCalls).toHaveLength(1);
    const [, opts] = putCalls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ email_gate_action: false });
    await waitFor(() =>
      expect(result.current.preferences?.email_gate_action).toBe(false)
    );
  });

  it("optimistically applies the update before the PUT resolves", async () => {
    // Use a promise we can control to delay the PUT response
    let resolvePut!: (r: Response) => void;
    const putPromise = new Promise<Response>((res) => {
      resolvePut = res;
    });

    fetchMock.mockResolvedValueOnce(jsonResponse(DEFAULT_PREFS));
    fetchMock.mockReturnValueOnce(putPromise);

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Kick off save without awaiting
    void act(async () => {
      void result.current.save({ in_app_gate_action: false });
    });

    // Optimistic update should be visible before the PUT settles
    await waitFor(() =>
      expect(result.current.preferences?.in_app_gate_action).toBe(false)
    );

    // Now settle the PUT
    resolvePut(
      jsonResponse({ ...DEFAULT_PREFS, in_app_gate_action: false })
    );

    await waitFor(() => expect(result.current.isMutating).toBe(false));
    expect(result.current.preferences?.in_app_gate_action).toBe(false);
  });

  it("rolls back the optimistic update on PUT failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(DEFAULT_PREFS));
    fetchMock.mockResolvedValueOnce(
      new Response("server error", { status: 500 })
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.save({ email_mentions: false });
      })
    ).rejects.toThrow();

    // Optimistic false is rolled back to original true
    expect(result.current.preferences?.email_mentions).toBe(true);
    expect(
      (queryClient.getQueryData(
        NOTIFICATION_PREFS_QUERY_KEY
      ) as NotificationPreferencesShape | undefined)?.email_mentions
    ).toBe(true);
  });
});
