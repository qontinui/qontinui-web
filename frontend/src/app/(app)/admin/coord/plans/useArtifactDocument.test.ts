/**
 * `useArtifactDocument` — the detail read and the kind correction, folded in
 * from the retired `usePlanLibrary` (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 1).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const getMock = vi.fn();
const patchMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { useArtifactDocument } from "./useArtifactDocument";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useArtifactDocument", () => {
  it("reads one artifact by id", async () => {
    getMock.mockResolvedValue({ id: "abc", slug: "s" });
    const { result } = renderHook(() => useArtifactDocument(vi.fn()));
    let detail: unknown;
    await act(async () => {
      detail = await result.current.fetchDetail("abc");
    });
    expect(getMock).toHaveBeenCalledWith("/api/v1/plan-library/abc");
    expect(detail).toEqual({ id: "abc", slug: "s" });
  });

  it("a failed read is null plus a toast, never a fabricated artifact", async () => {
    getMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useArtifactDocument(vi.fn()));
    let detail: unknown = "unset";
    await act(async () => {
      detail = await result.current.fetchDetail("abc");
    });
    expect(detail).toBeNull();
    expect(toastError).toHaveBeenCalledWith("boom");
  });

  it("patches the kind idempotently and re-reads what lists the artifact", async () => {
    patchMock.mockResolvedValue({});
    const onCorrected = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useArtifactDocument(onCorrected));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.correctKind("abc", "handoff");
    });
    expect(ok).toBe(true);
    expect(patchMock).toHaveBeenCalledWith(
      "/api/v1/plan-library/abc/kind",
      { kind: "handoff" },
      expect.objectContaining({ idempotent: true })
    );
    expect(onCorrected).toHaveBeenCalled();
  });

  it("surfaces a 409 identity collision instead of guessing a merge", async () => {
    patchMock.mockRejectedValue(new Error("kind_identity_conflict"));
    const onCorrected = vi.fn();
    const { result } = renderHook(() => useArtifactDocument(onCorrected));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.correctKind("abc", "handoff");
    });
    expect(ok).toBe(false);
    expect(onCorrected).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("kind_identity_conflict")
    );
  });
});
