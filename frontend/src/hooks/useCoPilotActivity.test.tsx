/**
 * Tests for ``useCoPilotActivity``.
 *
 * The audit-log polling path is exercised with vi.useFakeTimers + a
 * controllable clock fn so we don't depend on real wall-clock advances.
 *
 * Property under test: ``isActive`` reflects whether the latest
 * ``occurred_at`` is within ``staleAfterMs`` of "now".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useCoPilotActivity } from "./useCoPilotActivity";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "" },
}));

function activityJson(items: Array<{ occurred_at: string }>): Response {
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("useCoPilotActivity", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns isActive=false when polling is disabled", async () => {
    const { result } = renderHook(() =>
      useCoPilotActivity({ enabled: false })
    );
    expect(result.current.isActive).toBe(false);
    expect(result.current.lastActionAt).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches immediately on enable and reports isActive=true within staleAfterMs", async () => {
    const NOW = 1_700_000_000_000;
    const recentIso = new Date(NOW - 5_000).toISOString();
    fetchMock.mockResolvedValue(activityJson([{ occurred_at: recentIso }]));

    const { result } = renderHook(() =>
      useCoPilotActivity({
        enabled: true,
        pollIntervalMs: 1_000,
        staleAfterMs: 30_000,
        now: () => NOW,
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.lastActionAt).not.toBeNull());

    expect(result.current.isActive).toBe(true);
    expect(result.current.lastActionAt).toBe(Date.parse(recentIso));
  });

  it("reports isActive=false when the latest action is older than staleAfterMs", async () => {
    const NOW = 1_700_000_000_000;
    const oldIso = new Date(NOW - 90_000).toISOString();
    fetchMock.mockResolvedValue(activityJson([{ occurred_at: oldIso }]));

    const { result } = renderHook(() =>
      useCoPilotActivity({
        enabled: true,
        pollIntervalMs: 1_000,
        staleAfterMs: 30_000,
        now: () => NOW,
      })
    );

    await waitFor(() => expect(result.current.lastActionAt).not.toBeNull());
    expect(result.current.isActive).toBe(false);
  });

  it("hits the cursor-paginated endpoint with limit=1", async () => {
    fetchMock.mockResolvedValue(activityJson([]));
    renderHook(() => useCoPilotActivity({ enabled: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/v1/users/me/co-pilot/activity");
    expect(url).toContain("limit=1");
  });

  it("polls again after pollIntervalMs", async () => {
    fetchMock.mockResolvedValue(activityJson([]));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() =>
      useCoPilotActivity({ enabled: true, pollIntervalMs: 1_000 })
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      vi.advanceTimersByTime(1_001);
    });
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
  });

  it("survives an HTTP error (no throw, no state change)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useCoPilotActivity({ enabled: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.isActive).toBe(false);
    expect(result.current.lastActionAt).toBeNull();
  });

  it("ignores malformed occurred_at values", async () => {
    fetchMock.mockResolvedValue(
      activityJson([{ occurred_at: "definitely-not-a-date" }])
    );
    const { result } = renderHook(() => useCoPilotActivity({ enabled: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.lastActionAt).toBeNull();
    expect(result.current.isActive).toBe(false);
  });
});
