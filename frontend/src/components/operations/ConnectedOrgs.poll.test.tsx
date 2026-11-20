/**
 * The Connected Organizations card's accounts re-read poll
 * (`ConnectedOrgs.tsx` `useAccountsPoll`), which an account row's enroll,
 * restore and un-enroll share, one at a time. The row's callers clear the
 * poll before they start one, so the card's own suite (`ConnectedOrgs.test.tsx`)
 * cannot reach a start over a running poll; this drives the hook directly.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountsPoll } from "./ConnectedOrgs";

describe("useAccountsPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a start over a running poll ends it: one interval, one give-up, and nothing left re-reading", async () => {
    const refetch = vi.fn(async (_polled?: boolean) => undefined);
    const { result, unmount } = renderHook(() => useAccountsPoll(refetch));
    const idle = vi.getTimerCount();
    const firstGiveUp = vi.fn();
    const secondGiveUp = vi.fn();

    act(() => {
      result.current.start({ immediate: false, onGiveUp: firstGiveUp });
    });
    expect(vi.getTimerCount()).toBe(idle + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => {
      result.current.start({ immediate: false, onGiveUp: secondGiveUp });
    });
    expect(vi.getTimerCount()).toBe(idle + 1);

    // The second poll's 20 reads, 3 s apart, end at its cap 60 s after it
    // started; the first poll reads nothing more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(refetch).toHaveBeenCalledTimes(20);
    expect(refetch).toHaveBeenLastCalledWith(true);
    expect(secondGiveUp).toHaveBeenCalledTimes(1);
    expect(secondGiveUp).toHaveBeenCalledWith(false);
    expect(firstGiveUp).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(idle);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refetch).toHaveBeenCalledTimes(20);
    unmount();
  });
});
