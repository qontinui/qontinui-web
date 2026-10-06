/**
 * useScanRoots / usePlanCoverage — the two reads the scan-source and coverage
 * panels own.
 *
 * What is worth pinning is the behaviour that is wrong in a way nobody
 * notices: a failed read must not blank rows into a confident empty state,
 * and an overlapping read must neither paint over a newer answer nor be
 * thrown away when a newer read failed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    patch: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { usePlanCoverage, useScanRoots } from "./usePlanLibrary";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useScanRoots", () => {
  it("reads the scan-roots door and preserves the UNKNOWN no-rows shape", async () => {
    getMock.mockResolvedValue({
      state: "unknown",
      detail: "no_observation: no device has reported …",
      fresh_within_secs: 2700,
      count: 0,
      fresh_count: 0,
      rows: [],
    });

    const { result } = renderHook(() => useScanRoots());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // `coverage=false`: this panel renders no coverage field, so it must not
    // pay the route's census-load and corpus anti-join — see `usePlanCoverage`
    // below, whose own read asks for coverage instead.
    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/plan-library/scan-roots?coverage=false"
    );
    // The whole point of the route: an empty list arrives labelled `unknown`,
    // and the hook must not flatten that into "no rows, so nothing is wrong".
    expect(result.current.data?.state).toBe("unknown");
    expect(result.current.data?.rows).toEqual([]);
  });

  it("a failed read is not a fleet with no drift", async () => {
    getMock.mockRejectedValue(new Error("backend down"));

    const { result } = renderHook(() => useScanRoots());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Synthesising an empty list here would render as "no feeder is behind"
    // on the evidence of a network failure.
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("backend down");
  });
});

describe("useScanRoots — a failed reload must not blank, and must not invert", () => {
  it("keeps the rows a successful load produced when a reload fails", async () => {
    const page = {
      state: "reported",
      detail: null,
      fresh_within_secs: 2700,
      count: 1,
      fresh_count: 1,
      rows: [{ device_id: "d", state: "measured" }],
    };
    getMock.mockResolvedValueOnce(page);

    const { result } = renderHook(() => useScanRoots());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const firstStamp = result.current.fetchedAt;
    expect(firstStamp).toBeInstanceOf(Date);

    getMock.mockRejectedValueOnce(new Error("backend down"));
    await act(async () => {
      await result.current.reload();
    });

    // The panel's error copy promises exactly this — "the readings below are
    // the last ones read and may be stale" — so blanking `data` here would
    // make that sentence a lie about an empty list.
    expect(result.current.data).toEqual(page);
    expect(result.current.error).toContain("backend down");
    // AND the stamp must not move. The panel renders "Read at HH:MM:SS; the
    // ages above are as of then" from it, so advancing it on a FAILED read
    // would print a fresh timestamp over rows fetched minutes earlier — a
    // stale reading relabelled as current, which is the defect this whole
    // feature exists to remove. Moving `setFetchedAt` into the catch block
    // ships exactly that, and without this assertion the suite stays green.
    expect(result.current.fetchedAt).toEqual(firstStamp);
  });

  it("a late response never overwrites a newer one", async () => {
    const slow = {
      state: "reported",
      count: 1,
      fresh_count: 1,
      rows: [],
      detail: null,
      fresh_within_secs: 2700,
    };
    const fresh = { ...slow, count: 2 };
    let releaseSlow: (v: unknown) => void = () => {};
    getMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseSlow = resolve;
          })
      )
      .mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useScanRoots());
    // Second read starts and finishes while the first is still in flight.
    await act(async () => {
      void result.current.reload();
    });
    await waitFor(() => expect(result.current.data).toEqual(fresh));
    const freshStamp = result.current.fetchedAt;

    await act(async () => {
      releaseSlow(slow);
      await Promise.resolve();
    });

    // Without the request-id guard the stale page would land last and win.
    expect(result.current.data).toEqual(fresh);
    // The stamp is written in the same guarded block, so a discarded response
    // must not leave its timestamp behind over the data that did win.
    expect(result.current.fetchedAt).toEqual(freshStamp);
  });

  it("has no stamp before the first read lands", async () => {
    // A stamp with no reading behind it is the confident default the panel
    // refuses to render; the hook must not invent one at mount.
    getMock.mockImplementationOnce(() => new Promise(() => {}));
    const { result } = renderHook(() => useScanRoots());
    expect(result.current.fetchedAt).toBeNull();
    expect(result.current.data).toBeNull();
  });
});

// Overlapping reads, pinned on both hooks because both run the same
// `useRetainedRead`. Three of these are orderings a newest-id guard gets WRONG
// (a superseded success after a newer failure, `loading` while the newest read
// is out, and whose failure the banner names). The fourth — a superseded
// success after a newer one — a newest-id guard gets right, and it is here to
// catch the opposite mistake: a hook that applies whatever lands last.
describe.each([
  [
    "usePlanCoverage",
    () => usePlanCoverage(),
    {
      state: "reported",
      detail: null,
      fresh_within_secs: 2700,
      count: 1,
      fresh_count: 1,
      rows: [],
      coverage: [],
    },
  ],
  [
    "useScanRoots",
    () => useScanRoots(),
    {
      state: "reported",
      detail: null,
      fresh_within_secs: 2700,
      count: 1,
      fresh_count: 1,
      rows: [],
    },
  ],
] as const)("%s — overlapping reads", (_name, useHook, payload) => {
  function pending() {
    let release: (value: unknown) => void = () => {};
    getMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    return (value: unknown) => release(value);
  }

  it("keeps a superseded read's SUCCESS when the newer read failed", async () => {
    const releaseSlow = pending();
    getMock.mockRejectedValueOnce(new Error("backend down"));

    const { result } = renderHook(() => useHook());
    await act(async () => {
      await result.current.reload();
    });
    // The newer read failed and nothing has landed yet: unknown, not empty.
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("backend down");

    await act(async () => {
      releaseSlow(payload);
    });
    // Real data arrived, so it is shown — a newest-id guard discards it and
    // keeps claiming nothing could be read. The error STAYS: the read that
    // failed was issued after the one that delivered, so these may be stale.
    await waitFor(() => expect(result.current.data).toEqual(payload));
    expect(result.current.error).toContain("backend down");
  });

  it("drops a superseded read's success that lands after a newer one", async () => {
    const releaseSlow = pending();
    const fresh = { ...payload, fresh: true };
    getMock.mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useHook());
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.data).toEqual(fresh));

    await act(async () => {
      releaseSlow(payload);
      // A macrotask, so the straggler has settled all the way through the
      // hook before the negative is asserted — not merely a microtask that
      // happens to be queued ahead of it today.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.data).toEqual(fresh);
    expect(result.current.error).toBeNull();
  });

  it("names the NEWEST failure, not an older one that lands after it", async () => {
    let failSlow: (e: unknown) => void = () => {};
    getMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failSlow = reject;
        })
    );
    getMock.mockRejectedValueOnce(new Error("newer read: 503"));

    const { result } = renderHook(() => useHook());
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toContain("newer read: 503");

    await act(async () => {
      failSlow(new Error("older read: timeout"));
      // A macrotask, so the straggler's rejection has run all the way through
      // the hook's catch before anything is asserted. Nothing observable
      // changes when it lands correctly, so there is nothing to `waitFor`.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The banner explains why what is on screen is not current; the reason is
    // the most recent attempt's, and a straggler must not rewrite it.
    expect(result.current.error).toContain("newer read: 503");
    expect(result.current.error).not.toContain("older read");
  });

  it("keeps `loading` true while the NEWEST read is still out", async () => {
    const releaseOld = pending();
    const releaseNew = pending();

    const { result } = renderHook(() => useHook());
    await act(async () => {
      void result.current.reload();
    });

    await act(async () => {
      releaseOld(payload);
    });
    await waitFor(() => expect(result.current.data).toEqual(payload));
    // The older read settling must not re-enable Refresh: the newer one is
    // still in flight, and a second click would stack a third read on it.
    expect(result.current.loading).toBe(true);

    await act(async () => {
      releaseNew(payload);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

/**
 * `usePlanCoverage` reads the SAME route as `useScanRoots`, deliberately and
 * at the cost of a second GET — but not a second full-cost one, since
 * `useScanRoots` asks with `?coverage=false`. These pin the two properties
 * that make the second GET defensible: it is really the coverage door, and it
 * hands the panel the `coverage_detail` an empty `coverage` needs — without
 * which an empty array is indistinguishable from "nothing is missing".
 */
describe("usePlanCoverage", () => {
  it("reads the scan-roots door, where coverage is computed", async () => {
    getMock.mockResolvedValue({
      state: "measured",
      detail: null,
      fresh_within_secs: 2700,
      count: 1,
      fresh_count: 1,
      rows: [],
      by_source_repo: [],
      coverage: [],
      coverage_detail: "not_computed_here: …",
    });

    const { result } = renderHook(() => usePlanCoverage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getMock).toHaveBeenCalledWith("/api/v1/plan-library/scan-roots");
    // An empty `coverage` is only readable NEXT TO its detail; a hook that
    // handed the panel the array alone would make the panel unable to tell
    // "not computed here" from "nothing is missing".
    expect(result.current.data?.coverage).toEqual([]);
    expect(result.current.data?.coverage_detail).toContain("not_computed_here");
  });

  it("a failed read is not full coverage", async () => {
    getMock.mockRejectedValue(new Error("backend down"));

    const { result } = renderHook(() => usePlanCoverage());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Synthesising an empty coverage list here renders as "nothing is
    // missing" on the evidence of a network failure.
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("backend down");
  });
});
