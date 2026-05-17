/**
 * Presence heartbeat driver tests (Phase 2.4).
 *
 * Verifies:
 * - First heartbeat fires synchronously on mount
 * - Subsequent heartbeats fire on the interval cadence
 * - Unmount cancels the interval (no further sends)
 * - The returned doc_id reflects the most recent successful response
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  usePresenceHeartbeat,
  HEARTBEAT_INTERVAL_MS,
  type HeartbeatResponse,
} from "./presence";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePresenceHeartbeat", () => {
  it("fires immediately on mount, then every interval", async () => {
    const send = vi
      .fn<
        (docName: string) => Promise<HeartbeatResponse | null>
      >()
      .mockResolvedValue({ doc_id: "doc-1-uuid" });

    renderHook(() =>
      usePresenceHeartbeat({
        docName: "README.md",
        send,
        intervalMs: 1000,
      }),
    );

    // Immediate fire on mount.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith("README.md");

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(send).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("returns the resolved doc_id from the first response", async () => {
    const send = vi
      .fn<
        (docName: string) => Promise<HeartbeatResponse | null>
      >()
      .mockResolvedValue({ doc_id: "doc-1-uuid" });

    const { result } = renderHook(() =>
      usePresenceHeartbeat({
        docName: "README.md",
        send,
        intervalMs: 5000,
      }),
    );

    expect(result.current).toBeNull();
    // Let the async send resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBe("doc-1-uuid");
  });

  it("stops firing after unmount", async () => {
    const send = vi
      .fn<
        (docName: string) => Promise<HeartbeatResponse | null>
      >()
      .mockResolvedValue({ doc_id: "doc-1-uuid" });

    const { unmount } = renderHook(() =>
      usePresenceHeartbeat({
        docName: "README.md",
        send,
        intervalMs: 1000,
      }),
    );

    expect(send).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(send).toHaveBeenCalledTimes(1); // no more firings
  });

  it("does not fire when enabled=false", () => {
    const send = vi
      .fn<
        (docName: string) => Promise<HeartbeatResponse | null>
      >()
      .mockResolvedValue({ doc_id: "x" });

    renderHook(() =>
      usePresenceHeartbeat({
        docName: "README.md",
        enabled: false,
        send,
        intervalMs: 1000,
      }),
    );
    expect(send).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("default interval matches the plan-locked 30s cadence", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });
});
