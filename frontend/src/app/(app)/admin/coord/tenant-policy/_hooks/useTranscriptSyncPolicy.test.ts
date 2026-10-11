/**
 * useTranscriptSyncPolicy — what is shown comes from a READ.
 *
 * Pins the three honesty properties the hook documents: a write shows coord's
 * own re-read (not the requested value), a missing re-read is UNKNOWN and keeps
 * the last confirmed value, and a read that began before a landed write is
 * discarded.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    // The hooks go through the typed /operations client (httpClient.fetch);
    // adapt it onto the per-verb mocks the assertions below read.
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method;
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const result =
        method === "GET"
          ? await getMock(url)
          : method === "PATCH"
            ? await patchMock(url, body)
            : undefined;
      return new Response(JSON.stringify(result), { status: 200 });
    },
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useTranscriptSyncPolicy } from "./useTranscriptSyncPolicy";

const view = (enabled: boolean | null) => ({
  transcript_sync_enabled: enabled,
  column_missing: false,
  can_edit: true,
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

describe("useTranscriptSyncPolicy", () => {
  it("sends only the flag and shows coord's re-read", async () => {
    getMock.mockResolvedValueOnce(view(true));
    const { result } = renderHook(() => useTranscriptSyncPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/operations/tenant-policy/transcript-sync"
    );

    patchMock.mockResolvedValueOnce({
      written: true,
      effective: view(false),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(patchMock).toHaveBeenCalledWith(
      "/api/v1/operations/tenant-policy/transcript-sync",
      {
        transcript_sync_enabled: false,
      }
    );
    expect(result.current.policy?.transcript_sync_enabled).toBe(false);
    expect(result.current.readbackError).toBeNull();
  });

  it("keeps the last confirmed value when the re-read is missing", async () => {
    getMock.mockResolvedValueOnce(view(true));
    const { result } = renderHook(() => useTranscriptSyncPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    patchMock.mockResolvedValueOnce({
      written: true,
      effective: null,
      readback_error: "coord did not return the policy it re-read",
    });
    await act(async () => {
      await result.current.setEnabled(false);
    });

    // NOT painted as the requested `false`.
    expect(result.current.policy?.transcript_sync_enabled).toBe(true);
    expect(result.current.readbackError).toMatch(/did not return/);
  });

  it("treats a lost answer (504) as UNKNOWN, not as a failed write", async () => {
    getMock.mockResolvedValueOnce(view(true));
    const { result } = renderHook(() => useTranscriptSyncPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    patchMock.mockRejectedValueOnce(
      new Error(
        `PATCH /api/v1/operations/tenant-policy/transcript-sync failed: 504 - {"detail":"timeout waiting for coord"}`
      )
    );
    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(result.current.policy?.transcript_sync_enabled).toBe(true);
    expect(result.current.readbackError).toMatch(/unknown/);
  });

  it("a refused write (403) is a plain failure with no read-back warning", async () => {
    getMock.mockResolvedValueOnce(view(true));
    const { result } = renderHook(() => useTranscriptSyncPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    patchMock.mockRejectedValueOnce(
      new Error(
        `PATCH /api/v1/operations/tenant-policy/transcript-sync failed: 403 - admin_required`
      )
    );
    await act(async () => {
      await result.current.setEnabled(false);
    });

    expect(result.current.readbackError).toBeNull();
  });

  it("keeps the last known value when a refresh fails", async () => {
    getMock.mockResolvedValueOnce(view(true));
    const { result } = renderHook(() => useTranscriptSyncPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    getMock.mockRejectedValueOnce(new Error("HTTP 502"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.policy?.transcript_sync_enabled).toBe(true);
    expect(result.current.error).toBe("HTTP 502");
  });

  it("discards a read that began before a landed write", async () => {
    getMock.mockResolvedValueOnce(view(true));
    const { result } = renderHook(() => useTranscriptSyncPolicy());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });

    patchMock.mockResolvedValueOnce({
      written: true,
      effective: view(false),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setEnabled(false);
    });

    await act(async () => {
      slowRead.resolve(view(true));
      await refresh;
    });

    expect(result.current.policy?.transcript_sync_enabled).toBe(false);
  });
});
