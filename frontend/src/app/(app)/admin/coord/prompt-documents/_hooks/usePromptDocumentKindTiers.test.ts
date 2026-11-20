/**
 * usePromptDocumentKindTiers on its own: it reads only under the page's pin,
 * and a read that began before a tier write landed does not paint the tiers
 * as they were before the write (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review rounds 4-5).
 * The page offers no read beside a tier write (its controls wait for the
 * hook's reads), so the race is driven here, through `reload`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";

const fetchKindTiers = vi.fn();
const setKindTier = vi.fn();
const clearKindTier = vi.fn();
vi.mock("@/lib/api/operations/coordPromptDocuments", () => ({
  fetchKindTiers: (...args: unknown[]) => fetchKindTiers(...args),
  setKindTier: (...args: unknown[]) => setKindTier(...args),
  clearKindTier: (...args: unknown[]) => clearKindTier(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { usePromptDocumentKindTiers } from "./usePromptDocumentKindTiers";
import {
  PINNED_PAGE,
  testPageGuard,
  withPageGuard,
} from "../__fixtures__/pageWriteGuard";

/** The tiers coord holds, with `initiative` stored at `tier` (or none). */
const tiers = (tier: string | null) => ({
  kinds: [
    {
      kind: "initiative",
      tier,
      unreadable: false,
      builtin_default_tier: "allow_with_notification",
      effective_tier: tier ?? "allow_with_notification",
      effective_source: tier ? "tenant" : "default",
    },
  ],
  vocabulary: ["deny", "allow", "allow_with_notification"],
  notification_enforced: false,
  warning: "x",
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePromptDocumentKindTiers", () => {
  it("reads nothing while the page has no project, a reload included, and says it is waiting", async () => {
    const { result } = renderHook(() => usePromptDocumentKindTiers(), {
      wrapper: withPageGuard(testPageGuard()),
    });
    let applied: boolean | undefined;
    await act(async () => {
      applied = await result.current.reload();
    });

    expect(applied).toBe(false);
    expect(fetchKindTiers).not.toHaveBeenCalled();
    expect(result.current.waitingForProject).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("reads once, pinned, under the page's project", async () => {
    fetchKindTiers.mockResolvedValue(tiers("allow"));
    const { result } = renderHook(() => usePromptDocumentKindTiers(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(fetchKindTiers.mock.calls).toEqual([[{ tenant: "t-page" }]]);
    expect(result.current.waitingForProject).toBe(false);
  });

  it("does not paint a read sent before a tier write landed over the write's read-back", async () => {
    fetchKindTiers.mockResolvedValueOnce(tiers("allow"));
    const { result } = renderHook(() => usePromptDocumentKindTiers(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    // A read goes out, and coord answers it with the tiers before the write.
    const before = deferred<unknown>();
    fetchKindTiers.mockReturnValueOnce(before.promise);
    let reading: Promise<boolean> = Promise.resolve(false);
    act(() => {
      reading = result.current.reload();
    });
    // The write lands, and its own read-back shows the kind cleared.
    clearKindTier.mockResolvedValueOnce({ ok: true });
    fetchKindTiers.mockResolvedValueOnce(tiers(null));
    await act(async () => {
      await result.current.clearTier("initiative");
    });
    expect(result.current.data?.kinds[0]?.tier).toBeNull();

    await act(async () => {
      before.resolve(tiers("allow"));
      await reading;
    });

    expect(result.current.data?.kinds[0]?.tier).toBeNull();
  });

  it("does not paint a read sent before a tier was set over the write's read-back", async () => {
    fetchKindTiers.mockResolvedValueOnce(tiers(null));
    const { result } = renderHook(() => usePromptDocumentKindTiers(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    const before = deferred<unknown>();
    fetchKindTiers.mockReturnValueOnce(before.promise);
    let reading: Promise<boolean> = Promise.resolve(false);
    act(() => {
      reading = result.current.reload();
    });
    setKindTier.mockResolvedValueOnce({ ok: true });
    fetchKindTiers.mockResolvedValueOnce(tiers("allow"));
    await act(async () => {
      await result.current.setTier("initiative", "allow");
    });
    expect(result.current.data?.kinds[0]?.tier).toBe("allow");

    await act(async () => {
      before.resolve(tiers(null));
      await reading;
    });

    expect(result.current.data?.kinds[0]?.tier).toBe("allow");
  });

  /**
   * Every render of the hook whose page names `t-page` from mount, or only
   * after it: whether it said waiting, loading, or showed tiers. A section
   * renders its waiting line, its loading line or the tiers, so a render with
   * none of the three would show it empty.
   */
  async function rendersOfAFirstRead(atMount: boolean) {
    let pin: { tenant: string } | undefined = atMount
      ? { tenant: "t-page" }
      : undefined;
    const answer = deferred<unknown>();
    fetchKindTiers.mockReturnValueOnce(answer.promise);
    const states: { waiting: boolean; loading: boolean; read: boolean }[] = [];
    const guard = testPageGuard({ resolvePin: () => pin });
    const { result, rerender } = renderHook(
      () => {
        const tiersNow = usePromptDocumentKindTiers();
        states.push({
          waiting: tiersNow.waitingForProject,
          loading: tiersNow.loading,
          read: tiersNow.data !== null,
        });
        return tiersNow;
      },
      { wrapper: withPageGuard(guard) }
    );
    pin = { tenant: "t-page" };
    rerender();
    await act(async () => answer.resolve(tiers("allow")));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(fetchKindTiers).toHaveBeenCalledTimes(1);
    return states;
  }

  it("shows its waiting line, its loading line or its tiers at every render, when the project arrives after mount", async () => {
    for (const state of await rendersOfAFirstRead(false)) {
      expect(state.waiting || state.loading || state.read).toBe(true);
    }
  });

  it("shows its loading line or its tiers at every render, with the project there at mount", async () => {
    const states = await rendersOfAFirstRead(true);
    expect(states.some((state) => state.waiting)).toBe(false);
    for (const state of states) {
      expect(state.loading || state.read).toBe(true);
    }
  });

  it("refuses a tier write and a clear beside their sends when the page names no project, whatever its guard allowed", async () => {
    // A guard the page's provider never builds — a write allowed with no
    // pin — so only the hook's own refusal can stop each send.
    const { result } = renderHook(() => usePromptDocumentKindTiers(), {
      wrapper: withPageGuard(testPageGuard({ writeAllowed: () => true })),
    });
    let setSent: boolean | undefined;
    let clearSent: boolean | undefined;
    await act(async () => {
      setSent = await result.current.setTier("initiative", "allow");
      clearSent = await result.current.clearTier("initiative");
    });

    expect([setSent, clearSent]).toEqual([false, false]);
    expect(setKindTier).not.toHaveBeenCalled();
    expect(clearKindTier).not.toHaveBeenCalled();
    expect(fetchKindTiers).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(
      "Nothing was sent: this page has no project to send a change in. Select a project, or reload the page."
    );
  });
});
