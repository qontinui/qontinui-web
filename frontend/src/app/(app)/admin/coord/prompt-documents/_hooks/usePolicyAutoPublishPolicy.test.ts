/**
 * usePolicyAutoPublishPolicy on its own: it reads only under the page's pin,
 * and a read that began before a level write landed does not paint the
 * level from before the write (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review rounds 4-5).
 * The page offers no read beside a level write (its controls wait for the
 * hook's reads), so the race is driven here, through `reload`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const fetchFleetPolicy = vi.fn();
const putFleetPolicy = vi.fn();
vi.mock("@/lib/api/operations/tenantPolicy", () => ({
  fetchFleetPolicy: (...args: unknown[]) => fetchFleetPolicy(...args),
  putFleetPolicy: (...args: unknown[]) => putFleetPolicy(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { usePolicyAutoPublishPolicy } from "./usePolicyAutoPublishPolicy";
import {
  PINNED_PAGE,
  testPageGuard,
  withPageGuard,
} from "../__fixtures__/pageWriteGuard";

const view = (level: string) => ({
  domain: "policy_auto_publish",
  effective_level: level,
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
});
const written = (level: string) => ({
  ok: true,
  domain: "policy_auto_publish",
  written_level: level,
  written_master_enabled: true,
  versioned: true,
  version: 2,
  updated_by: "operator@example.com",
  effective: view(level),
  readback_error: null,
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

describe("usePolicyAutoPublishPolicy", () => {
  it("reads nothing while the page has no project, a reload included, and says it is waiting", async () => {
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(testPageGuard()),
    });
    await act(async () => {
      await result.current.reload();
    });

    expect(fetchFleetPolicy).not.toHaveBeenCalled();
    expect(result.current.waitingForProject).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.policy).toBeNull();
  });

  it("reads once, pinned, under the page's project", async () => {
    fetchFleetPolicy.mockResolvedValue(view("off"));
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    expect(fetchFleetPolicy.mock.calls).toEqual([
      ["policy_auto_publish", undefined, { tenant: "t-page" }],
    ]);
    expect(result.current.waitingForProject).toBe(false);
  });

  it("reads again, pinned, after a write whose read-back failed, and shows coord's level", async () => {
    fetchFleetPolicy
      .mockResolvedValueOnce(view("off"))
      .mockResolvedValueOnce(view("on"));
    putFleetPolicy.mockResolvedValueOnce({
      ...written("on"),
      effective: null,
      readback_error: "read-back timed out",
    });
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    await act(async () => {
      await result.current.setLevel("on");
    });

    await waitFor(() =>
      expect(result.current.policy?.effective_level).toBe("on")
    );
    expect(result.current.readbackError).toBeNull();
    expect(fetchFleetPolicy.mock.calls).toEqual([
      ["policy_auto_publish", undefined, { tenant: "t-page" }],
      ["policy_auto_publish", undefined, { tenant: "t-page" }],
    ]);
  });

  it("does not paint a read sent before a level write landed over the write's result", async () => {
    fetchFleetPolicy.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() => usePolicyAutoPublishPolicy(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());

    // A read goes out, and coord answers it with the level before the write.
    const before = deferred<unknown>();
    fetchFleetPolicy.mockReturnValueOnce(before.promise);
    let reading: Promise<void> = Promise.resolve();
    act(() => {
      reading = result.current.reload();
    });
    putFleetPolicy.mockResolvedValueOnce(written("on"));
    await act(async () => {
      await result.current.setLevel("on");
    });
    expect(result.current.policy?.effective_level).toBe("on");

    await act(async () => {
      before.resolve(view("off"));
      await reading;
    });

    expect(result.current.policy?.effective_level).toBe("on");
  });
});
