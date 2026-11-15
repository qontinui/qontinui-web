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
});
