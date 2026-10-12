/**
 * useRepoFollowupDials — plan
 * `2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind` Phase 4b.
 *
 * Pins: a failed read never becomes a value; a write displays the READ-BACK,
 * and a failed read-back is UNKNOWN; a later failure keeps the last value.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const httpGet = vi.fn();
const httpPut = vi.fn();
const listRepos = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => httpGet(...a),
    put: (...a: unknown[]) => httpPut(...a),
  },
}));

vi.mock("@/components/sessions/api", () => ({
  listRegisteredRepos: (...a: unknown[]) => listRepos(...a),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import {
  READ_CONCURRENCY,
  inPool,
  useRepoFollowupDials,
} from "./useRepoFollowupDials";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const REPO = "qontinui/qontinui-dev-notes";

function scopeView(scope = "all", resolved = "default") {
  return {
    repo: REPO,
    scope,
    code_paths: scope === "code_only" ? ["scripts/**"] : [],
    resolved_scope: resolved,
    mode: "shadow",
    can_edit: true,
  };
}

function deliveryView(mode = "in_session_with_spawn_fallback") {
  return { repo: REPO, mode, provenance_known: false, can_edit: true };
}

function routeGets(
  scope: () => Promise<unknown>,
  delivery: () => Promise<unknown> = () => Promise.resolve(deliveryView())
) {
  httpGet.mockImplementation((url: string) =>
    url.includes("post-merge-followup-scope") ? scope() : delivery()
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listRepos.mockResolvedValue([{ repo: REPO }]);
});

describe("useRepoFollowupDials", () => {
  it("reads both dials for every registered repo", async () => {
    routeGets(() => Promise.resolve(scopeView()));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repos).toEqual([REPO]);
    expect(result.current.readings[REPO].scope?.scope).toBe("all");
    expect(result.current.readings[REPO].delivery?.mode).toBe(
      "in_session_with_spawn_fallback"
    );
    expect(httpGet).toHaveBeenCalledWith(
      `/api/v1/operations/post-merge-followup-scope?repo=${encodeURIComponent(REPO)}`
    );
  });

  it("an unreadable scope stays UNKNOWN — no value is synthesised", async () => {
    routeGets(() =>
      Promise.reject(
        new Error('GET x failed: 503 - {"error":"preference_unreadable"}')
      )
    );
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const r = result.current.readings[REPO];
    expect(r.scope).toBeNull();
    expect(r.scopeError).toContain("preference_unreadable");
    // The other dial is independent.
    expect(r.delivery?.mode).toBe("in_session_with_spawn_fallback");
  });

  it("a later failed read keeps the last value, marked by its error", async () => {
    routeGets(() => Promise.resolve(scopeView("none", "repo")));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));

    routeGets(() => Promise.reject(new Error("GET x failed: 502 - down")));
    await act(async () => {
      await result.current.reload();
    });
    const r = result.current.readings[REPO];
    expect(r.scope?.scope).toBe("none");
    expect(r.scopeError).toContain("502");
  });

  it("a failed repo list is reported, not rendered as 'no repos'", async () => {
    listRepos.mockRejectedValueOnce(new Error("GET /repos failed: 502"));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repos).toBeNull();
    expect(result.current.reposError).toContain("502");
  });

  it("a scope write displays the read-back, not the written value", async () => {
    routeGets(() => Promise.resolve(scopeView()));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));

    httpPut.mockResolvedValueOnce({
      ok: true,
      repo: REPO,
      written_scope: "code_only",
      stored_code_paths: ["scripts/**"],
      updated_by: null,
      // Coord resolved something else than was written — show THAT.
      effective: scopeView("all", "repo"),
      readback_error: null,
    });
    let ok = false;
    await act(async () => {
      ok = await result.current.writeScope({
        repo: REPO,
        scope: "code_only",
        code_paths: ["scripts/**"],
      });
    });
    expect(ok).toBe(true);
    expect(httpPut).toHaveBeenCalledWith(
      "/api/v1/operations/post-merge-followup-scope",
      { repo: REPO, scope: "code_only", code_paths: ["scripts/**"] }
    );
    expect(result.current.readings[REPO].scope?.scope).toBe("all");
    expect(result.current.readings[REPO].scope?.resolved_scope).toBe("repo");
  });

  it("a failed read-back is UNKNOWN until a later read succeeds", async () => {
    routeGets(() => Promise.resolve(scopeView()));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));

    httpPut.mockResolvedValueOnce({
      ok: true,
      repo: REPO,
      written_scope: "none",
      stored_code_paths: [],
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 503",
    });
    await act(async () => {
      await result.current.writeScope({ repo: REPO, scope: "none" });
    });
    expect(result.current.readings[REPO].scopeReadbackError).toContain("503");

    routeGets(() => Promise.resolve(scopeView("none", "repo")));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.readings[REPO].scopeReadbackError).toBeNull();
    expect(result.current.readings[REPO].scope?.scope).toBe("none");
  });

  it("a refused write is recorded per repo and dial", async () => {
    routeGets(() => Promise.resolve(scopeView()));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));

    httpPut.mockRejectedValueOnce(
      new Error('PUT x failed: 403 - {"error":"admin_required"}')
    );
    await act(async () => {
      await result.current.writeDelivery(REPO, "notify_only");
    });
    expect(result.current.writeErrors[`${REPO}:delivery`]).toContain(
      "admin_required"
    );
    // The displayed value is untouched by a refused write.
    expect(result.current.readings[REPO].delivery?.mode).toBe(
      "in_session_with_spawn_fallback"
    );
  });

  it("a refresh issued BEFORE a write cannot paint the pre-write value over its read-back", async () => {
    routeGets(() => Promise.resolve(scopeView()));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // A refresh whose scope read hangs…
    const slow = deferred<unknown>();
    routeGets(() => slow.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });
    await waitFor(() =>
      expect(
        httpGet.mock.calls.filter((c) =>
          String(c[0]).includes("post-merge-followup-scope")
        ).length
      ).toBe(2)
    );

    // …then a write lands with its read-back…
    httpPut.mockResolvedValueOnce({
      ok: true,
      repo: REPO,
      written_scope: "none",
      stored_code_paths: [],
      updated_by: null,
      effective: scopeView("none", "repo"),
      readback_error: null,
    });
    await act(async () => {
      await result.current.writeScope({ repo: REPO, scope: "none" });
    });
    expect(result.current.readings[REPO].scope?.scope).toBe("none");

    // …and the old refresh answers with the PRE-write value. It is refused.
    await act(async () => {
      slow.resolve(scopeView("all", "default"));
      await refresh;
    });
    expect(result.current.readings[REPO].scope?.scope).toBe("none");
    expect(result.current.readings[REPO].scopeError).toBeNull();
  });

  it("an older failure landing after a newer success does not stale the value", async () => {
    routeGets(() => Promise.resolve(scopeView()));
    const { result } = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const older = deferred<unknown>();
    routeGets(() => older.promise);
    let first!: Promise<void>;
    act(() => {
      first = result.current.reload();
    });
    await waitFor(() => expect(httpGet).toHaveBeenCalledTimes(4));

    routeGets(() => Promise.resolve(scopeView("code_only", "repo")));
    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      older.reject(new Error("GET x failed: 502 - down"));
      await first;
    });
    const r = result.current.readings[REPO];
    expect(r.scope?.scope).toBe("code_only");
    expect(r.scopeError).toBeNull();
  });
});

describe("useRepoFollowupDials — refresh during a save", () => {
  async function setup() {
    routeGets(() => Promise.resolve(scopeView()));
    const hook = renderHook(() => useRepoFollowupDials());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it("a refresh started DURING the PUT cannot replace its read-back", async () => {
    const { result } = await setup();
    const put = deferred<unknown>();
    httpPut.mockReturnValueOnce(put.promise);
    let write!: Promise<boolean>;
    act(() => {
      write = result.current.writeScope({ repo: REPO, scope: "none" });
    });
    // The refresh is answered with the PRE-write value before the PUT resolves.
    routeGets(() => Promise.resolve(scopeView("all", "default")));
    await act(async () => {
      await result.current.reload();
    });
    await act(async () => {
      put.resolve({
        ok: true,
        repo: REPO,
        written_scope: "none",
        stored_code_paths: [],
        updated_by: null,
        effective: scopeView("none", "repo"),
        readback_error: null,
      });
      await write;
    });
    expect(result.current.readings[REPO].scope?.scope).toBe("none");
  });

  it("a refresh started DURING the PUT cannot retire a failed read-back", async () => {
    const { result } = await setup();
    const put = deferred<unknown>();
    httpPut.mockReturnValueOnce(put.promise);
    let write!: Promise<boolean>;
    act(() => {
      write = result.current.writeScope({ repo: REPO, scope: "none" });
    });
    const slow = deferred<unknown>();
    routeGets(() => slow.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });
    await act(async () => {
      put.resolve({
        ok: true,
        repo: REPO,
        written_scope: "none",
        stored_code_paths: [],
        updated_by: null,
        effective: null,
        readback_error: "read-back failed: coord returned 503",
      });
      await write;
    });
    await act(async () => {
      slow.resolve(scopeView("all", "default"));
      await refresh;
    });
    expect(result.current.readings[REPO].scopeReadbackError).toContain("503");
  });
});

describe("inPool", () => {
  it("runs every item, never more than the limit at once", async () => {
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    const items = Array.from({ length: 11 }, (_, i) => i);
    await inPool(items, READ_CONCURRENCY, async (i) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(i);
      live -= 1;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBe(READ_CONCURRENCY);
  });

  it("handles an empty list", async () => {
    const run = vi.fn();
    await inPool([], READ_CONCURRENCY, run);
    expect(run).not.toHaveBeenCalled();
  });
});
