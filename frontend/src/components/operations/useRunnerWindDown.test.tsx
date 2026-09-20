/**
 * useRunnerWindDown — the device-keyed polls behind `/admin/coord/runners`.
 *
 * Pinned here: **an answer older than the last one applied is dropped.** The
 * poll and an operator's refresh race; when the earlier request lands last,
 * applying it would put an older readiness verdict back on screen after a
 * newer one had already replaced it.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...a: unknown[]) => httpFetch(...a) },
}));

import { useDeviceReadiness } from "./useRunnerWindDown";

const DEVICE = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";

function sampleResponse(reason: string) {
  const body = {
    latest: [
      {
        device_id: DEVICE,
        lane: "host",
        sampled_at: "2026-09-13T10:00:00Z",
        readiness_safe: false,
        readiness_reason: reason,
        readiness_blocking: 1,
        readiness_finished: 0,
        wind_down_candidates: 0,
        wind_down_exit_stuck: 0,
        wind_down_sessions: [],
        readiness_age_secs: 10,
        readiness_state: "fresh",
      },
    ],
    count: 1,
    schema_pending: false,
  };
  return { ok: true, status: 200, json: async () => body };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  httpFetch.mockReset();
});

describe("useDeviceReadiness", () => {
  it("drops an older response that lands after a newer one", async () => {
    const first = deferred<ReturnType<typeof sampleResponse>>();
    const second = deferred<ReturnType<typeof sampleResponse>>();
    httpFetch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => useDeviceReadiness(DEVICE));
    // The mount issued request 1; a manual refresh issues request 2.
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refresh();
    });
    expect(httpFetch).toHaveBeenCalledTimes(2);

    // Request 2 answers first…
    await act(async () => {
      second.resolve(sampleResponse("newer verdict"));
      await refreshing;
    });
    await waitFor(() =>
      expect(
        result.current.read.kind === "fresh" && result.current.read.sample.reason
      ).toBe("newer verdict")
    );

    // …then the stalled request 1 lands. It must not replace the newer answer.
    await act(async () => {
      first.resolve(sampleResponse("older verdict"));
      await first.promise;
    });
    expect(
      result.current.read.kind === "fresh" && result.current.read.sample.reason
    ).toBe("newer verdict");
  });

  it("issues no request until a device is chosen", () => {
    renderHook(() => useDeviceReadiness(""));
    expect(httpFetch).not.toHaveBeenCalled();
  });
});
