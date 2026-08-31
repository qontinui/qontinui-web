/**
 * useTrainHealth — load discipline.
 *
 * These exist because the hook's cost is not its own: every request through
 * the operations proxy pins a backend DB connection for the whole outbound
 * coord round-trip, which is what took the API down on 2026-07-21. The three
 * rules (only while enabled, never while hidden, throttled on reveal) are
 * therefore load-bearing, and each was one line away from silently reverting.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { useTrainHealth, TRAIN_HEALTH_POLL_MS } from "./useTrainHealth";

/** Drive `document.hidden`, which is a getter and not writable directly. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

function healthCalls() {
  return fetchMock.mock.calls.filter((c) =>
    String(c[0]).includes("/pr-merge/health")
  ).length;
}

describe("useTrainHealth", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok({ last_merged_at: "2026-07-26T00:00:00Z" }));
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch at all while disabled", async () => {
    renderHook(() => useTrainHealth(false));
    await new Promise((r) => setTimeout(r, 10));
    expect(healthCalls()).toBe(0);
  });

  it("fetches once when enabled and reports the body", async () => {
    const { result } = renderHook(() => useTrainHealth(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(healthCalls()).toBe(1);
    expect(result.current.health?.last_merged_at).toBe("2026-07-26T00:00:00Z");
  });

  it("does not fetch when the tab opens in a hidden document", async () => {
    // Opening the Train tab in a background window must not issue a request
    // nobody is looking at — and must not then claim coord is unavailable.
    setHidden(true);
    const { result } = renderHook(() => useTrainHealth(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(healthCalls()).toBe(0);
    expect(result.current.loaded).toBe(false);
  });

  it("throttles the visibility-reveal refetch", async () => {
    // Rapid hide/reveal churn (alt-tab, a sleeping monitor) would otherwise
    // issue one proxy request per reveal.
    const { result } = renderHook(() => useTrainHealth(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(healthCalls()).toBe(1);

    for (let i = 0; i < 5; i++) {
      act(() => setHidden(true));
      act(() => setHidden(false));
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(healthCalls()).toBe(1);
  });

  it("does refetch on reveal once the throttle window has passed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useTrainHealth(true));
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(healthCalls()).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(TRAIN_HEALTH_POLL_MS + 1_000);
    });
    act(() => setHidden(true));
    act(() => setHidden(false));
    await vi.waitFor(() => expect(healthCalls()).toBeGreaterThan(1));
  });

  it("stops polling when the tab is switched away", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result, rerender } = renderHook(
      ({ on }) => useTrainHealth(on),
      { initialProps: { on: true } }
    );
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    const before = healthCalls();

    rerender({ on: false });
    await act(async () => {
      vi.advanceTimersByTime(TRAIN_HEALTH_POLL_MS * 3);
    });
    expect(healthCalls()).toBe(before);
  });

  it("renders a degraded body rather than staying in loading on failure", async () => {
    // The proxy already turns 404/5xx into `{}`; any other failure must not
    // leave the tab in a permanent skeleton.
    fetchMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useTrainHealth(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.health).toEqual({});
  });

  it("keeps the last known-good body across a later failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useTrainHealth(true));
    await vi.waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.health?.last_merged_at).toBeTruthy();

    fetchMock.mockRejectedValue(new Error("coord blip"));
    await act(async () => {
      vi.advanceTimersByTime(TRAIN_HEALTH_POLL_MS + 1_000);
    });
    // A transient blip must not blank the fleet banner.
    expect(result.current.health?.last_merged_at).toBe(
      "2026-07-26T00:00:00Z"
    );
  });
});
