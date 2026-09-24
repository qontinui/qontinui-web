/**
 * useTenantFleetPolicyDial — the refresh-vs-write race.
 *
 * The per-domain hooks' tests pin the read/write/read-back honesty properties.
 * This file pins the one property that exists only in the shared core: a read
 * that STARTED before a write must not land over that write's confirmed
 * read-back. Otherwise a slow Refresh paints the pre-write value back on screen
 * and clears the read-back warning — the dial reporting a state the fleet has
 * already left.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useTenantFleetPolicyDial } from "./useTenantFleetPolicyDial";

const view = (level: string) => ({
  domain: "some_dial",
  effective_level: level,
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
  keys_not_shown: [],
  keys_not_shown_source: null,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTenantFleetPolicyDial — a read that began before a write", () => {
  it("does not overwrite the write's confirmed read-back", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Refresh starts, and is still in flight when the write lands.
    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockResolvedValue({
      ok: true,
      domain: "some_dial",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: null,
      effective: view("on"),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setLevel("on");
    });
    expect(result.current.policy?.effective_level).toBe("on");

    // The stale read now answers with the pre-write value.
    await act(async () => {
      slowRead.resolve(view("off"));
      await refresh;
    });

    expect(result.current.policy?.effective_level).toBe("on");
    expect(result.current.loading).toBe(false);
  });

  it("does not clear an unconfirmed write's read-back warning", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockResolvedValue({
      ok: true,
      domain: "some_dial",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    await act(async () => {
      await result.current.setLevel("on");
    });

    await act(async () => {
      slowRead.resolve(view("off"));
      await refresh;
    });

    // The pre-write read says nothing about what resolves after the write.
    expect(result.current.readbackError).toContain("502");
  });

  it("keeps a Refresh that overlapped a REJECTED write", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockRejectedValue(new Error("admin_required"));
    await act(async () => {
      await result.current.setLevel("on");
    });

    // Someone else changed the dial meanwhile; the refused write changed
    // nothing, so this read is the freshest fact and must be shown.
    await act(async () => {
      slowRead.resolve(view("on"));
      await refresh;
    });

    expect(result.current.policy?.effective_level).toBe("on");
  });

  it("applies a read that began after the write", async () => {
    getMock.mockResolvedValueOnce(view("off"));
    const { result } = renderHook(() =>
      useTenantFleetPolicyDial<"off" | "on">("some_dial", "some dial")
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    putMock.mockResolvedValue({
      ok: true,
      domain: "some_dial",
      written_level: "on",
      written_master_enabled: true,
      versioned: true,
      version: 2,
      updated_by: null,
      effective: null,
      readback_error: "read-back failed: coord returned 502",
    });
    await act(async () => {
      await result.current.setLevel("on");
    });

    getMock.mockResolvedValueOnce(view("on"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.policy?.effective_level).toBe("on");
    expect(result.current.readbackError).toBeNull();
  });
});
