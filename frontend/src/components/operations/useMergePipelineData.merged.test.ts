/**
 * The recently-merged read's load discipline and failure reporting.
 *
 * That read is the expensive one: coord answers it in 14-21s for a 24h/48h
 * window, and the operations proxy holds a backend DB connection for the whole
 * round trip (the 2026-07-21 pool-exhaustion incident, recorded in the hook's
 * header). So it must follow the same three rules as the main batch —
 * single-flight, a gap measured from COMPLETION, no polling from a hidden tab —
 * and must not be retried by the HTTP client, which retries every 5xx three
 * times and would ask a struggling coord the same expensive question four times.
 *
 * `httpClient` is stubbed with a controllable merged response; everything else
 * the hook fetches gets an inert 200 so only the merged chain is under test.
 */

import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    // No token: the hook stays on its poll and never builds a WebSocket.
    getWebSocketToken: async () => null,
  },
}));

import { useMergePipelineData } from "./useMergePipelineData";

interface MergedCall {
  url: string;
  options: unknown;
}

const MERGED_POLL_MS = 60_000;
let mergedCalls: MergedCall[] = [];
// Set per test: what the merged read answers with.
let mergedResponse: () => Promise<unknown>;

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body });

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mergedCalls = [];
  mergedResponse = () => okJson({ prs: [] });
  setHidden(false);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, options?: unknown) => {
    if (url.includes("include_merged=")) {
      mergedCalls.push({ url, options });
      return mergedResponse();
    }
    return okJson({});
  });
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe("useMergePipelineData — merged read", () => {
  it("turns client retries off for the merged read", async () => {
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();

    expect(mergedCalls).toHaveLength(1);
    expect(mergedCalls[0].options).toMatchObject({ maxRetries: 0 });
  });

  it("does not read merged rows unless asked", async () => {
    renderHook(() => useMergePipelineData({ includeMerged: false }));
    await flush();
    await advance(MERGED_POLL_MS * 2);

    expect(mergedCalls).toHaveLength(0);
  });

  it("is single-flight and measures the gap from COMPLETION", async () => {
    let finish: (v: unknown) => void = () => {};
    mergedResponse = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    expect(mergedCalls).toHaveLength(1);

    // Still in flight past one interval: a bare setInterval would have fired
    // again by now, stacking a request on a coord that is already slow.
    await advance(MERGED_POLL_MS * 1.5);
    expect(mergedCalls).toHaveLength(1);

    // The read completes MID-interval (t = 90s). A fixed-rate poll that merely
    // skips while a read is out would fire again at t = 120s, 30s after
    // completion; measuring the gap from COMPLETION waits a full interval, so
    // the next read is at t = 150s. Finishing on a multiple of the interval
    // cannot tell the two apart, which is why this one does not.
    finish({ ok: true, status: 200, json: async () => ({ prs: [] }) });
    await flush();
    await advance(MERGED_POLL_MS - 1_000);
    expect(mergedCalls).toHaveLength(1);
    await advance(2_000);
    expect(mergedCalls).toHaveLength(2);
  });

  it("adopts a read already in flight when includeMerged flips off and on", async () => {
    // A tab click away from All PRs and back re-runs the effect. The new run
    // used to start its own 14-21s read while the first still pinned a backend
    // DB connection.
    let finish: (v: unknown) => void = () => {};
    mergedResponse = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => useMergePipelineData({ includeMerged: on }),
      { initialProps: { on: true } }
    );
    await flush();
    expect(mergedCalls).toHaveLength(1);

    rerender({ on: false });
    await flush();
    rerender({ on: true });
    await flush();
    expect(mergedCalls).toHaveLength(1);

    // The adopted read completes once, and the chain then continues normally.
    finish({ ok: true, status: 200, json: async () => ({ prs: [] }) });
    await flush();
    await advance(MERGED_POLL_MS + 1_000);
    expect(mergedCalls).toHaveLength(2);
  });

  it("starts one read under StrictMode's double mount", async () => {
    let finish: (v: unknown) => void = () => {};
    mergedResponse = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    renderHook(() => useMergePipelineData({ includeMerged: true }), {
      wrapper: StrictMode,
    });
    await flush();

    expect(mergedCalls).toHaveLength(1);
    finish({ ok: true, status: 200, json: async () => ({ prs: [] }) });
    await flush();
  });

  it("does not re-read on a flip back on within the minimum age", async () => {
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) => useMergePipelineData({ includeMerged: on }),
      { initialProps: { on: true } }
    );
    await flush();
    expect(mergedCalls).toHaveLength(1);

    await advance(5_000);
    rerender({ on: false });
    rerender({ on: true });
    await flush();
    expect(mergedCalls).toHaveLength(1);
  });

  it("does not start a read on every reveal, only when the data has aged", async () => {
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    expect(mergedCalls).toHaveLength(1);

    const reveal = async () => {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await flush();
    };
    // Alt-tabbing back and forth: with 14-21s reads and no floor this would be
    // one read per event, keeping a DB connection pinned almost continuously.
    await advance(5_000);
    await reveal();
    await advance(5_000);
    await reveal();
    expect(mergedCalls).toHaveLength(1);

    // Old enough now (t = 31s, floor 30s): refresh.
    await advance(21_000);
    await reveal();
    expect(mergedCalls).toHaveLength(2);
  });

  it("does not stack a second read when the tab is re-shown mid-read", async () => {
    // A tab that becomes visible again while a slow read is still out. (Only
    // the event is dispatched; `document.hidden` stays false, which is enough
    // to reach the handler.)
    let finish: (v: unknown) => void = () => {};
    mergedResponse = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    expect(mergedCalls).toHaveLength(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(mergedCalls).toHaveLength(1);

    // And the chain still continues normally once that read completes.
    finish({ ok: true, status: 200, json: async () => ({ prs: [] }) });
    await flush();
    await advance(MERGED_POLL_MS + 1_000);
    expect(mergedCalls).toHaveLength(2);
  });

  it("does not poll from a hidden tab, and refreshes when it is seen", async () => {
    setHidden(true);
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    await advance(MERGED_POLL_MS * 3);
    expect(mergedCalls).toHaveLength(0);

    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(mergedCalls).toHaveLength(1);
  });

  const reveal = async () => {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
  };

  it("applies the minimum age after a FAILED read too", async () => {
    // A struggling coord must not be re-asked on every reveal.
    mergedResponse = () =>
      Promise.resolve({ ok: false, status: 504, json: async () => ({}) });
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    expect(mergedCalls).toHaveLength(1);

    await advance(5_000);
    await reveal();
    expect(mergedCalls).toHaveLength(1);
  });

  it("anchors the minimum age at COMPLETION, not at the read's start", async () => {
    // A read slower than the floor: measured from its start it would already be
    // "old" the instant it completes, and a reveal would start another read
    // straight away.
    let finish: (v: unknown) => void = () => {};
    mergedResponse = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    await advance(40_000);
    finish({ ok: true, status: 200, json: async () => ({ prs: [] }) });
    await flush();

    await reveal();
    expect(mergedCalls).toHaveLength(1);
  });

  it("treats a backwards clock step as stale, not fresh", async () => {
    // Resume from sleep / NTP: `now - doneAt` goes negative and would stay under
    // the floor until the clock caught up, suppressing every read meanwhile.
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    expect(mergedCalls).toHaveLength(1);

    vi.setSystemTime(new Date(Date.now() - 3_600_000));
    await advance(MERGED_POLL_MS + 1_000);
    expect(mergedCalls).toHaveLength(2);
  });

  it("leaves no timer behind when unmounted mid-read", async () => {
    let finish: (v: unknown) => void = () => {};
    mergedResponse = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const { unmount } = renderHook(() =>
      useMergePipelineData({ includeMerged: true })
    );
    await flush();
    unmount();

    finish({ ok: true, status: 200, json: async () => ({ prs: [] }) });
    await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps exactly one timer chain when the tab is re-shown mid-read", async () => {
    // Count the timers the MERGED chain adds, against the same scenario with the
    // merged read off: the main batch re-arms its own poll on a reveal, and that
    // is not what is being tested.
    const timers = async (includeMerged: boolean) => {
      let finish: (v: unknown) => void = () => {};
      mergedResponse = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      const { unmount } = renderHook(() =>
        useMergePipelineData({ includeMerged })
      );
      await flush();
      await reveal();
      await advance(1_000);
      finish({ ok: true, status: 200, json: async () => ({ prs: [] }) });
      await flush();
      const n = vi.getTimerCount();
      unmount();
      return n;
    };
    const without = await timers(false);
    // A second chain (the reveal starting one while a read is out) would leave a
    // second pending timer once the read lands.
    expect((await timers(true)) - without).toBe(1);
  });

  it("re-arms rather than doubles the timer on a re-show after the minimum age", async () => {
    const timers = async (includeMerged: boolean) => {
      const { unmount } = renderHook(() =>
        useMergePipelineData({ includeMerged })
      );
      await flush();
      await advance(31_000);
      await reveal();
      await advance(1_000);
      const n = vi.getTimerCount();
      const reads = mergedCalls.length;
      unmount();
      mergedCalls = [];
      return { n, reads };
    };
    const without = await timers(false);
    const withMerged = await timers(true);
    // The reveal is past the floor, so it reads (2 reads: mount + reveal) and
    // re-arms the ONE merged timer: clearing the old one first is what keeps
    // this at +1 rather than +2.
    expect(withMerged.reads).toBe(2);
    expect(withMerged.n - without.n).toBe(1);
  });

  it("keeps polling after a read that throws", async () => {
    // `fetchMergedPrs` catches everything today; this pins that a throw cannot
    // end the chain even if that ever changes.
    mergedResponse = () => Promise.reject(Object.create(null));
    renderHook(() => useMergePipelineData({ includeMerged: true }));
    await flush();
    expect(mergedCalls).toHaveLength(1);

    mergedResponse = () => okJson({ prs: [] });
    await advance(MERGED_POLL_MS + 1_000);
    expect(mergedCalls).toHaveLength(2);
  });

  it("stops polling when the hook unmounts", async () => {
    const { unmount } = renderHook(() =>
      useMergePipelineData({ includeMerged: true })
    );
    await flush();
    expect(mergedCalls).toHaveLength(1);

    unmount();
    await advance(MERGED_POLL_MS * 3);
    expect(mergedCalls).toHaveLength(1);
  });

  it("reports why a read failed, and clears it on the next success", async () => {
    mergedResponse = () =>
      Promise.resolve({ ok: false, status: 504, json: async () => ({}) });
    const { result } = renderHook(() =>
      useMergePipelineData({ includeMerged: true })
    );
    await flush();

    expect(result.current.mergedError).toBe("HTTP 504");
    // A failed FIRST read is unknown, not "nothing landed".
    expect(result.current.mergedPrs).toBeNull();

    mergedResponse = () => okJson({ prs: [] });
    await advance(MERGED_POLL_MS + 1_000);
    expect(result.current.mergedError).toBeNull();
    expect(result.current.mergedPrs).toEqual([]);
  });

  it("keeps the last rows, and flags them, when a later read fails", async () => {
    const landed = {
      repo: "qontinui/qontinui-web",
      pr_number: 1,
      branch: "b",
      base_branch: "main",
      head_sha: "abc",
      pr_state: "closed",
      merge_commit_sha: "deadbeef",
      merged_at: "2026-09-19T08:00:00Z",
    };
    mergedResponse = () => okJson({ prs: [landed] });
    const { result } = renderHook(() =>
      useMergePipelineData({ includeMerged: true })
    );
    await flush();
    expect(result.current.mergedPrs).toHaveLength(1);

    mergedResponse = () =>
      Promise.resolve({ ok: false, status: 504, json: async () => ({}) });
    await advance(MERGED_POLL_MS + 1_000);

    expect(result.current.mergedPrs).toHaveLength(1);
    expect(result.current.mergedError).toBe("HTTP 504");
  });
});
