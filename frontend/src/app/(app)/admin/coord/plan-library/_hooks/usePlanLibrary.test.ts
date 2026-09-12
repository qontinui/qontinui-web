/**
 * usePlanLibrary / useDivergentArtifacts / useCaptureHealth / useScanRoots.
 *
 * The list hook is mostly plumbing; what is worth pinning is the behaviour
 * that is wrong in a way nobody notices:
 *
 * * A filter change must reset the offset. Staying on page 3 of the previous
 *   query renders an empty page and reads as "no matches".
 * * A failed load must not blank the rows into a confident empty state.
 * * The facet chips are derived from the LOADED page, not the corpus — the
 *   hook must not pretend otherwise by returning a fixed vocabulary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const patchMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: vi.fn(),
  },
}));

import {
  useCaptureHealth,
  useDivergentArtifacts,
  usePlanLibrary,
  useScanRoots,
} from "./usePlanLibrary";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organization_id: null,
    created_by_user_id: null,
    kind: "plan",
    kind_locked: false,
    slug: "2026-08-10-a-plan",
    title: "A plan",
    status: "VETTED",
    content_sha256: "abc123",
    source_path: "plans/a.md",
    source_repo: "qontinui-web",
    work_unit_slug: null,
    repos: ["qontinui-coord"],
    authored_at: null,
    captured_by: "runner_scan",
    current_version: 1,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePlanLibrary — filters", () => {
  it("puts every filter on the query string", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateFilter("kind", "handoff"));
    act(() => result.current.updateFilter("status", "VETTED"));
    act(() => result.current.updateFilter("repo", "qontinui-coord"));
    act(() => result.current.updateFilter("q", "merge train"));

    await waitFor(() => {
      const url = String(getMock.mock.calls.at(-1)?.[0]);
      expect(url).toContain("kind=handoff");
      expect(url).toContain("status=VETTED");
      expect(url).toContain("repo=qontinui-coord");
      expect(url).toContain("q=merge+train");
    });
  });

  it("debounces typed text but applies the kind dropdown at once", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    // Five keystrokes must not be five full-text scans.
    act(() => result.current.updateFilter("q", "m"));
    act(() => result.current.updateFilter("q", "me"));
    act(() => result.current.updateFilter("q", "mer"));
    act(() => result.current.updateFilter("q", "merg"));
    act(() => result.current.updateFilter("q", "merge"));
    expect(getMock).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(String(getMock.mock.calls.at(-1)?.[0])).toContain("q=merge")
    );
    // One request for the settled value, not one per character.
    expect(getMock.mock.calls.length).toBe(1);

    // The dropdown is a single discrete action — no lag.
    getMock.mockClear();
    act(() => result.current.updateFilter("kind", "plan"));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
  });

  it("returns to page 1 when a filter changes", async () => {
    getMock.mockResolvedValue({
      items: [row()],
      total: 500,
      offset: 0,
      limit: 50,
    });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setOffset(100));
    await waitFor(() => expect(result.current.offset).toBe(100));

    act(() => result.current.updateFilter("kind", "plan"));

    // Staying on page 3 of a NEW query renders empty and reads as "no matches".
    await waitFor(() => expect(result.current.offset).toBe(0));
  });

  it("derives the facet chips from the loaded page only", async () => {
    getMock.mockResolvedValue({
      items: [
        row({ status: "VETTED", source_repo: "qontinui-web", repos: ["a"] }),
        row({
          id: "22222222-2222-2222-2222-222222222222",
          status: "DRAFT",
          source_repo: "qontinui-runner",
          repos: ["b"],
        }),
      ],
      total: 2,
      offset: 0,
      limit: 50,
    });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.seen.statuses).toEqual(["DRAFT", "VETTED"]);
    expect(result.current.seen.repos).toEqual([
      "a",
      "b",
      "qontinui-runner",
      "qontinui-web",
    ]);
  });
});

describe("usePlanLibrary — failure is not emptiness", () => {
  it("keeps the last rows on screen when a reload fails", async () => {
    getMock.mockResolvedValueOnce({
      items: [row()],
      total: 1,
      offset: 0,
      limit: 50,
    });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    getMock.mockRejectedValueOnce(new Error("backend down"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toContain("backend down");
    // Clearing these would render the "library is empty" state on no evidence.
    expect(result.current.items).toHaveLength(1);
  });
});

describe("usePlanLibrary — overlapping loads must not race", () => {
  /** A promise plus its settle functions, so a request can be held open. */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Nothing awaits the rejection until the test does; keep node quiet.
    promise.catch(() => {});
    return { promise, resolve, reject };
  }

  const page = (title: string, offset: number) => ({
    items: [row({ title })],
    total: 200,
    offset,
    limit: 50,
  });

  // `load` is recreated on [applied, offset] and fired by an effect, so two
  // of it are in flight whenever the operator pages or retypes faster than
  // the backend answers. An AbortController cannot fix this — `http-client`
  // overwrites the caller's `signal` with its own timeout controller — so the
  // hook carries a generation counter, and each of these tests pins one of
  // its four writes.

  it("drops a superseded page response instead of painting it", async () => {
    const first = deferred<unknown>();
    getMock
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(page("page two", 50));

    const { result } = renderHook(() => usePlanLibrary());
    // Page forward before page 1 has landed.
    act(() => result.current.setOffset(50));
    await waitFor(() =>
      expect(result.current.items[0]?.title).toBe("page two")
    );

    await act(async () => {
      first.resolve(page("page one", 0));
      await first.promise;
    });

    // Page 1's rows under a "51–100 of 200" pager is the visible symptom.
    expect(result.current.items[0]?.title).toBe("page two");
    expect(result.current.offset).toBe(50);
  });

  it("does not paint a late FAILURE banner over fresh rows", async () => {
    // The honesty inversion, half one: a stale rejection runs `setError`, and
    // the page then warns that rows which are in fact current may be stale.
    const first = deferred<unknown>();
    getMock
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(page("fresh", 50));

    const { result } = renderHook(() => usePlanLibrary());
    act(() => result.current.setOffset(50));
    await waitFor(() => expect(result.current.items[0]?.title).toBe("fresh"));

    await act(async () => {
      first.reject(new Error("stale failure"));
      await first.promise.catch(() => {});
    });

    expect(result.current.error).toBeNull();
    expect(result.current.items[0]?.title).toBe("fresh");
  });

  it("does not let a late SUCCESS clear a live failure banner", async () => {
    // Half two, and the more dangerous direction: the banner that vanishes is
    // the one that was telling the truth, leaving stale rows unlabelled.
    const first = deferred<unknown>();
    getMock
      .mockImplementationOnce(() => first.promise)
      .mockRejectedValueOnce(new Error("backend down"));

    const { result } = renderHook(() => usePlanLibrary());
    act(() => result.current.setOffset(50));
    await waitFor(() => expect(result.current.error).toContain("backend down"));

    await act(async () => {
      first.resolve(page("late success", 0));
      await first.promise;
    });

    expect(result.current.error).toContain("backend down");
  });

  it("keeps `loading` true while the live request is still out", async () => {
    // `finally { setLoading(false) }` was unconditional, so a superseded
    // response re-enabled the pager underneath a request that had not landed.
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    getMock
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result } = renderHook(() => usePlanLibrary());
    act(() => result.current.setOffset(50));

    await act(async () => {
      first.resolve(page("page one", 0));
      await first.promise;
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      second.resolve(page("page two", 50));
      await second.promise;
    });
    expect(result.current.loading).toBe(false);
  });
});

describe("usePlanLibrary — kind correction", () => {
  it("patches the kind and reloads the list", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });
    patchMock.mockResolvedValue({ ...row(), kind: "handoff" });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.correctKind("abc", "handoff");
    });

    expect(ok).toBe(true);
    // `idempotent: true` opts the PATCH back into 5xx retry — the handler is
    // a full assignment of kind + kind_locked, so a re-issue is a no-op.
    expect(patchMock).toHaveBeenCalledWith(
      "/api/v1/plan-library/abc/kind",
      { kind: "handoff" },
      expect.objectContaining({ idempotent: true })
    );
    // The list carries `kind` and `kind_locked`; a stale row would show the
    // correction as not having happened.
    expect(getMock).toHaveBeenCalled();
  });

  it("surfaces a 409 identity collision instead of guessing a merge", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });
    patchMock.mockRejectedValue(new Error("kind_identity_conflict"));

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.correctKind("abc", "handoff");
    });

    expect(ok).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("kind_identity_conflict")
    );
  });
});

describe("useDivergentArtifacts", () => {
  it("keeps content drift and kind forks as separate findings", async () => {
    getMock.mockResolvedValue({
      groups: [{ kind: "plan", slug: "s1", variant_count: 2, variants: [] }],
      total: 1,
      kind_forks: [
        {
          slug: "s2",
          source_repo: "qontinui-web",
          kinds: ["plan", "handoff"],
          variant_count: 2,
          resolvable: false,
          variants: [],
        },
      ],
      kind_fork_total: 1,
    });

    const { result } = renderHook(() => useDivergentArtifacts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.total).toBe(1);
    // A kind fork is invisible to `(kind, slug)` grouping — it must not be
    // folded into `groups`.
    expect(result.current.data?.kind_fork_total).toBe(1);
    expect(result.current.data?.kind_forks[0].resolvable).toBe(false);
  });

  it("reports a failed read rather than an empty result", async () => {
    getMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useDivergentArtifacts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("boom");
    expect(result.current.data).toBeNull();
  });
});

describe("useCaptureHealth", () => {
  it("passes through the zero-count doors the backend returns", async () => {
    getMock.mockResolvedValue({
      total: 12,
      doors: [
        {
          captured_by: "runner_scan",
          count: 12,
          known: true,
          first_at: "2026-08-01T00:00:00Z",
          last_touched_at: "2026-08-14T00:00:00Z",
        },
        {
          captured_by: "agent",
          count: 0,
          known: true,
          first_at: null,
          last_touched_at: null,
        },
        {
          captured_by: "operator",
          count: 0,
          known: true,
          first_at: null,
          last_touched_at: null,
        },
      ],
    });

    const { result } = renderHook(() => useCaptureHealth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // "The agent door has written nothing" is the finding this panel exists
    // for — it must survive as an explicit zero, not be filtered out.
    const agent = result.current.data?.doors.find(
      (d) => d.captured_by === "agent"
    );
    expect(agent?.count).toBe(0);
    expect(result.current.data?.doors).toHaveLength(3);
  });
});

describe("useCaptureHealth — a failed read is not a corpus of zero", () => {
  it("leaves `data` null rather than synthesising empty doors", async () => {
    getMock.mockRejectedValue(new Error("backend down"));

    const { result } = renderHook(() => useCaptureHealth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Rendering three zeroed doors here would state "the agent door has never
    // been used" on the evidence of a network failure.
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("backend down");
  });
});

describe("useCaptureHealth — a wired reload must not blank, and must not invert", () => {
  const census = {
    total: 1,
    doors: [
      {
        captured_by: "runner_scan",
        count: 1,
        known: true,
        first_at: null,
        last_touched_at: null,
      },
    ],
  };

  it("keeps the doors a successful load produced when a reload fails", async () => {
    getMock.mockResolvedValueOnce(census);

    const { result } = renderHook(() => useCaptureHealth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    getMock.mockRejectedValueOnce(new Error("backend down"));
    await act(async () => {
      await result.current.reload();
    });

    // The panel's error copy promises "the counts below are the last ones read
    // and may be stale" — blanking `data` would make that a lie about nothing.
    expect(result.current.data).toEqual(census);
    expect(result.current.error).toContain("backend down");
  });

  it("a late response never overwrites a newer one", async () => {
    const fresh = { ...census, total: 2 };
    let failSlow: (e: unknown) => void = () => {};
    getMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failSlow = reject;
          })
      )
      .mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useCaptureHealth());
    // The second read starts and lands while the first is still out.
    await act(async () => {
      void result.current.reload();
    });
    await waitFor(() => expect(result.current.data).toEqual(fresh));

    await act(async () => {
      failSlow(new Error("backend down"));
      await Promise.resolve();
    });

    // Without the request-id guard the superseded read's FAILURE lands last
    // and paints "may be stale" over counts that were just refreshed.
    expect(result.current.data).toEqual(fresh);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
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

    expect(getMock).toHaveBeenCalledWith("/api/v1/plan-library/scan-roots");
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
  ["useCaptureHealth", () => useCaptureHealth(), { total: 1, doors: [] }],
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
