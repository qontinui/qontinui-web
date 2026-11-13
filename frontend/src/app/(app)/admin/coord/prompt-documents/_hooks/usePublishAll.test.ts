/**
 * `usePublishAll`'s refusal latch: which project a refusal is stamped with,
 * and which later answers clear it.
 *
 * The latch is what tells the page coord said "not the system tenant", so:
 *
 * 1. **A refusal is stamped with the project its request was PINNED to** — the
 *    stored project when it was SENT, not when it was answered — for the
 *    status read and for an armed publish-all alike.
 * 2. **`reload(pin)` sends exactly that pin.**
 * 3. **A 200 from the status door clears a refusal stamped with the same
 *    project; a `null` stamp is cleared only by an explicitly pinned 200; a
 *    refusal stamped with ANOTHER project is kept.**
 * 4. **A status read for another project drops the held one's answer** —
 *    candidates, count, D5 switch, worker — before it is sent; a read for the
 *    same project keeps it.
 * 5. **With `resolvePin`, every request is sent in the resolved project** —
 *    the dry run, the armed run, the publish-mode PATCH and every status read
 *    a caller does not pin itself, the re-take after a publish-mode change
 *    included — asked as each is sent, while another project is stored. The
 *    mount read runs once, and no returned function changes identity with the
 *    resolver.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const fetchStatus = vi.hoisted(() => vi.fn());
const publishAllMock = vi.hoisted(() => vi.fn());
const previewMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/operations/coordPromptDocuments", () => ({
  fetchAutoPublishStatus: (...args: unknown[]) => fetchStatus(...args),
  previewPublishAll: (...args: unknown[]) => previewMock(...args),
  publishAllPromptDocuments: (...args: unknown[]) => publishAllMock(...args),
  updatePromptDocument: (...args: unknown[]) => updateMock(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { usePublishAll } from "./usePublishAll";

const KEY = "qontinui.active_tenant_id";
const STATUS = "/api/v1/operations/coord/prompt-documents/auto-publish/status";
const notSystem = (verb = "GET", url = STATUS) =>
  new Error(
    `${verb} ${url} failed: 403 - ${JSON.stringify({
      error: "FORBIDDEN",
      message: JSON.stringify({ error: "not_system_tenant", detail: "x" }),
    })}`
  );
const ok = { candidates: [], count: 1, publishing_enabled: true };

beforeEach(() => {
  fetchStatus.mockReset();
  publishAllMock.mockReset();
  previewMock.mockReset();
  updateMock.mockReset();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe("what a refusal is stamped with", () => {
  it("stamps the status read with the project it was SENT in", async () => {
    localStorage.setItem(KEY, "t-a");
    let answer: (() => void) | undefined;
    fetchStatus.mockImplementation(
      () =>
        new Promise((_, reject) => {
          answer = () => reject(notSystem());
        })
    );
    const { result } = renderHook(() => usePublishAll());
    await waitFor(() => expect(answer).toBeDefined());
    // Another tab switches while the read is in flight.
    localStorage.setItem(KEY, "t-b");
    await act(async () => answer?.());
    await waitFor(() => expect(result.current.unavailable).not.toBeNull());
    expect(result.current.unavailable?.tenant).toBe("t-a");
    expect(fetchStatus).toHaveBeenCalledWith({ tenant: "t-a" });
  });

  it("stamps an armed publish-all with the project it was SENT in", async () => {
    localStorage.setItem(KEY, "t-a");
    fetchStatus.mockResolvedValue(ok);
    let answer: (() => void) | undefined;
    publishAllMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          answer = () => reject(notSystem("POST", "/publish-all"));
        })
    );
    const { result } = renderHook(() => usePublishAll());
    await waitFor(() => expect(result.current.statusSettled).toBe(true));
    let run: Promise<unknown> | undefined;
    act(() => {
      run = result.current.publishAll([], "");
    });
    await waitFor(() => expect(answer).toBeDefined());
    localStorage.setItem(KEY, "t-b");
    await act(async () => {
      answer?.();
      await run;
    });
    expect(result.current.unavailable?.tenant).toBe("t-a");
    expect(publishAllMock.mock.calls[0]?.[2]).toEqual({ tenant: "t-a" });
  });
});

describe("reload(pin)", () => {
  it("sends the read in the pinned project, not the stored one", async () => {
    localStorage.setItem(KEY, "t-other");
    fetchStatus.mockResolvedValue(ok);
    const { result } = renderHook(() => usePublishAll());
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
    expect(fetchStatus).toHaveBeenLastCalledWith({ tenant: "t-other" });
    await act(async () => {
      await result.current.reload({ tenant: "t-page" });
    });
    expect(fetchStatus).toHaveBeenLastCalledWith({ tenant: "t-page" });
  });
});

describe("which 200 clears a refusal", () => {
  /** Mount with the status read refused, stamped with whatever is stored. */
  async function latchedIn(stored: string | null) {
    if (stored !== null) localStorage.setItem(KEY, stored);
    fetchStatus.mockRejectedValueOnce(notSystem());
    const hook = renderHook(() => usePublishAll());
    await waitFor(() => expect(hook.result.current.unavailable).not.toBeNull());
    expect(hook.result.current.unavailable?.tenant).toBe(stored);
    return hook;
  }

  it("clears a refusal stamped with the same project", async () => {
    const { result } = await latchedIn("t-s");
    fetchStatus.mockResolvedValueOnce(ok);
    await act(async () => {
      await result.current.reload({ tenant: "t-s" });
    });
    expect(result.current.unavailable).toBeNull();
  });

  it("keeps a refusal stamped with ANOTHER project", async () => {
    const { result } = await latchedIn("t-y");
    fetchStatus.mockResolvedValueOnce(ok);
    await act(async () => {
      await result.current.reload({ tenant: "t-s" });
    });
    expect(result.current.unavailable?.tenant).toBe("t-y");
  });

  it("clears a null-stamped refusal on an explicitly pinned 200 for the page's project", async () => {
    const { result } = await latchedIn(null);
    fetchStatus.mockResolvedValueOnce(ok);
    await act(async () => {
      await result.current.reload({ tenant: "t-s" });
    });
    expect(result.current.unavailable).toBeNull();
  });

  it("keeps a null-stamped refusal on an UNPINNED 200 from whatever project is stored", async () => {
    const { result } = await latchedIn(null);
    localStorage.setItem(KEY, "t-q");
    fetchStatus.mockResolvedValueOnce(ok);
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.unavailable?.tenant).toBeNull();
  });
});

describe("a status read for another project", () => {
  const served = {
    candidates: [{ kind: "policy", name: "a", held: true }],
    count: 3,
    publishing_enabled: true,
    worker: { pass: { state: "ok" } },
  };

  /** Mount in S with S's answer held, then re-ask with S's next answer gated. */
  async function answeredIn(stored: string) {
    localStorage.setItem(KEY, stored);
    fetchStatus.mockResolvedValueOnce(served);
    const hook = renderHook(() => usePublishAll());
    await waitFor(() => expect(hook.result.current.changedCount).toBe(3));
    let answer: (() => void) | undefined;
    fetchStatus.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          answer = () => reject(notSystem());
        })
    );
    return { ...hook, answer: () => answer?.(), asked: () => answer };
  }

  it("drops the held project's candidates, count, switch and worker before it is sent", async () => {
    const { result, answer, asked } = await answeredIn("t-s");
    act(() => {
      void result.current.reload({ tenant: "t-b" });
    });
    await waitFor(() => expect(asked()).toBeDefined());
    // While B is asked, nothing of S's stands in for it.
    expect(result.current.status).toEqual([]);
    expect(result.current.changedCount).toBe(0);
    expect(result.current.publishingEnabled).toBeUndefined();
    expect(result.current.worker).toBeUndefined();
    expect(result.current.statusSettled).toBe(false);
    // B is refused, which sets none of them: still nothing of S's.
    await act(async () => answer());
    expect(result.current.status).toEqual([]);
    expect(result.current.changedCount).toBe(0);
    expect(result.current.unavailable?.tenant).toBe("t-b");
  });

  it("keeps the held answer while the SAME project is re-asked", async () => {
    const { result, asked } = await answeredIn("t-s");
    act(() => {
      void result.current.reload({ tenant: "t-s" });
    });
    await waitFor(() => expect(asked()).toBeDefined());
    expect(result.current.changedCount).toBe(3);
    expect(result.current.status).toHaveLength(1);
    expect(result.current.statusSettled).toBe(true);
  });
});

describe("with a resolver: the page's project", () => {
  const inPage = () => ({ tenant: "t-page" });

  it("sends the dry run, the armed run and the publish-mode PATCH in the resolved project, not the stored one", async () => {
    localStorage.setItem(KEY, "t-other");
    fetchStatus.mockResolvedValue(ok);
    previewMock.mockResolvedValue({ dry_run: true, candidates: [] });
    publishAllMock.mockResolvedValue({ dry_run: false, results: [] });
    updateMock.mockResolvedValue({});
    const { result } = renderHook(() => usePublishAll({ resolvePin: inPage }));
    await waitFor(() => expect(result.current.statusSettled).toBe(true));

    await act(async () => {
      await result.current.loadCandidates();
      await result.current.publishAll([], "");
      await result.current.setPublishMode("policy", "p", "manual");
    });

    expect(previewMock.mock.calls).toEqual([[{ tenant: "t-page" }]]);
    expect(publishAllMock.mock.calls[0]?.[2]).toEqual({ tenant: "t-page" });
    expect(updateMock.mock.calls[0]?.[3]).toEqual({ tenant: "t-page" });
  });

  it("stamps a refused dry run with the resolved project", async () => {
    localStorage.setItem(KEY, "t-other");
    fetchStatus.mockResolvedValue(ok);
    previewMock.mockRejectedValue(notSystem("POST", "/publish-all"));
    const { result } = renderHook(() => usePublishAll({ resolvePin: inPage }));
    await waitFor(() => expect(result.current.statusSettled).toBe(true));

    await act(async () => {
      await result.current.loadCandidates();
    });

    expect(result.current.unavailable?.tenant).toBe("t-page");
  });

  it("the status re-take after a publish-mode change is pinned", async () => {
    // The PATCH goes out while the page's project is stored; another tab
    // switches project inside its answer, so the re-take is sent with the
    // OTHER project stored.
    localStorage.setItem(KEY, "t-page");
    fetchStatus.mockResolvedValue(ok);
    updateMock.mockImplementation(async () => {
      localStorage.setItem(KEY, "t-other");
      return {};
    });
    const { result } = renderHook(() => usePublishAll({ resolvePin: inPage }));
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.setPublishMode("policy", "p", "never");
    });

    expect(saved).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("t-other");
    expect(updateMock.mock.calls[0]?.[3]).toEqual({ tenant: "t-page" });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(fetchStatus).toHaveBeenLastCalledWith({ tenant: "t-page" });
  });

  it("reload() defaults to the resolved project, asked as it is sent; reload(pin) still sends its own", async () => {
    localStorage.setItem(KEY, "t-other");
    fetchStatus.mockResolvedValue(ok);
    let page = "t-page";
    const { result } = renderHook(() =>
      usePublishAll({ resolvePin: () => ({ tenant: page }) })
    );
    await waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
    page = "t-next";

    await act(async () => {
      await result.current.reload();
      await result.current.reload({ tenant: "t-named" });
    });

    expect(fetchStatus.mock.calls).toEqual([
      [{ tenant: "t-page" }],
      [{ tenant: "t-next" }],
      [{ tenant: "t-named" }],
    ]);
  });

  it("clears a null-stamped refusal on a default re-take once the resolver names the page's project", async () => {
    // Mounted before the page's project is known: the mount read goes out
    // with nothing stored, and is refused — stamped `null`.
    let page: { tenant: string } | undefined = undefined;
    fetchStatus.mockRejectedValueOnce(notSystem());
    const { result } = renderHook(() =>
      usePublishAll({ resolvePin: () => page })
    );
    await waitFor(() => expect(result.current.unavailable).not.toBeNull());
    expect(result.current.unavailable?.tenant).toBeNull();
    page = { tenant: "t-page" };
    fetchStatus.mockResolvedValueOnce(ok);

    await act(async () => {
      await result.current.reload();
    });

    expect(fetchStatus).toHaveBeenLastCalledWith({ tenant: "t-page" });
    expect(result.current.unavailable).toBeNull();
  });

  it("runs the mount read once, keeps every function's identity across resolver identities, and asks the newest resolver", async () => {
    localStorage.setItem(KEY, "t-page");
    fetchStatus.mockResolvedValue(ok);
    const { result, rerender } = renderHook(
      ({ resolve }: { resolve: () => { tenant: string } }) =>
        usePublishAll({ resolvePin: resolve }),
      { initialProps: { resolve: () => ({ tenant: "t-page" }) } }
    );
    await waitFor(() => expect(result.current.statusSettled).toBe(true));
    const { reload, loadCandidates, publishAll, setPublishMode } =
      result.current;

    rerender({ resolve: () => ({ tenant: "t-page" }) });
    rerender({ resolve: () => ({ tenant: "t-moved" }) });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(result.current.reload).toBe(reload);
    expect(result.current.loadCandidates).toBe(loadCandidates);
    expect(result.current.publishAll).toBe(publishAll);
    expect(result.current.setPublishMode).toBe(setPublishMode);

    // The resolver the caller passes NOW is the one asked, through the same
    // `reload`.
    await act(async () => {
      await reload();
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(fetchStatus).toHaveBeenLastCalledWith({ tenant: "t-moved" });
  });
});
