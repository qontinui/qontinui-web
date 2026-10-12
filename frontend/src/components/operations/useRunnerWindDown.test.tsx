/**
 * useRunnerWindDown — the device-keyed polls behind `/admin/coord/runners`.
 *
 * Pinned here: **the poll and an operator's refresh never overlap.** A refresh
 * issued while a read is outstanding runs once, after it, and its answer is
 * the one on screen — so an older readiness verdict can never land after a
 * newer one.
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
  it("never overlaps: a refresh during a flight runs once, after it, and its answer wins", async () => {
    // Plan `2026-09-25-fleet-worktree-slots-hang-mechanism-and-safe-reland`
    // D5: one request per (route, tab). Before it, the poll and an operator's
    // refresh raced and a sequence number dropped the older answer; now they
    // cannot overlap, so the refresh queues ONE trailing request and the
    // answer it produces is the one on screen.
    const first = deferred<ReturnType<typeof sampleResponse>>();
    const second = deferred<ReturnType<typeof sampleResponse>>();
    httpFetch
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => useDeviceReadiness(DEVICE));
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = result.current.refresh();
      // The poll is invoked from a microtask; let it reach the wire.
      await Promise.resolve();
      await Promise.resolve();
    });
    // The mount's request is outstanding, so the refresh sent nothing yet.
    expect(httpFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(sampleResponse("older verdict"));
      await first.promise;
    });
    await waitFor(() => expect(httpFetch).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(sampleResponse("newer verdict"));
      await refreshing;
    });
    await waitFor(() =>
      expect(
        result.current.read.kind === "fresh" &&
          result.current.read.sample.reason
      ).toBe("newer verdict")
    );
    expect(httpFetch).toHaveBeenCalledTimes(2);
  });

  it("issues no request until a device is chosen", () => {
    renderHook(() => useDeviceReadiness(""));
    expect(httpFetch).not.toHaveBeenCalled();
  });
});
