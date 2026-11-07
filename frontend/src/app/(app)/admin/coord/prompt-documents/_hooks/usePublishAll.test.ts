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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const fetchStatus = vi.hoisted(() => vi.fn());
const publishAllMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/operations/coordPromptDocuments", () => ({
  fetchAutoPublishStatus: (...args: unknown[]) => fetchStatus(...args),
  previewPublishAll: vi.fn(),
  publishAllPromptDocuments: (...args: unknown[]) => publishAllMock(...args),
  updatePromptDocument: vi.fn(),
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
