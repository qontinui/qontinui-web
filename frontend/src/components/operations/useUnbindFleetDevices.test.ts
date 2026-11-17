/**
 * `useUnbindFleetDevices`'s own in-flight guard (plan
 * `2026-11-15-stale-ci-hosts-and-devices-are-removable-from-the-web-console`
 * Phase 3), driven through the hook directly — no disabled button in the way —
 * so removing the guard fails this test.
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { useUnbindFleetDevices } from "./useUnbindFleetDevices";

const DEV = "c3c3c3c3-0000-4000-8000-00000000000c";

describe("useUnbindFleetDevices", () => {
  it("refuses a second unbind while the first (and its re-read) is out", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    fetchMock.mockImplementation(async () => {
      await held;
      const body = {
        results: [
          {
            device_id: DEV,
            outcome: "unbound",
            status: 200,
            error: null,
            still_member_via_pointer: false,
          },
        ],
      };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
    let releaseRead: () => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<void>((r) => {
          releaseRead = r;
        })
    );
    const { result } = renderHook(() => useUnbindFleetDevices(refresh));

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = result.current.unbind([DEV]);
      second = await result.current.unbind([DEV]);
    });
    expect(second).toEqual({ state: "in_flight" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The answer has landed but the re-read has not: still refused.
    await act(async () => {
      release();
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    let third: unknown;
    await act(async () => {
      third = await result.current.unbind([DEV]);
    });
    expect(third).toEqual({ state: "in_flight" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseRead();
      await first;
    });
    expect(result.current.busy).toBe(false);
  });
});
