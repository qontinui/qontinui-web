/**
 * `rereadMetrics` — the quiet metrics-only re-read a recorded operator label
 * triggers. It keeps the current answer on screen, skips the refutation list,
 * and always reads for the project on screen NOW, even when the caller
 * captured it before a project switch.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchVerificationMetrics: vi.fn(),
  fetchCoordFindings: vi.fn(),
}));
vi.mock("@/lib/api/operations/coordVerification", () => ({
  fetchVerificationMetrics: api.fetchVerificationMetrics,
}));
vi.mock("@/lib/api/operations/coordFindings", () => ({
  fetchCoordFindings: api.fetchCoordFindings,
}));

import { populated } from "./verificationMetrics.fixture";
import { readLastGood } from "./verificationMetrics";
import { useVerificationMetrics } from "./useVerificationMetrics";

describe("useVerificationMetrics rereadMetrics", () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.fetchVerificationMetrics.mockReset();
    api.fetchCoordFindings.mockReset();
    api.fetchCoordFindings.mockResolvedValue({ findings: [], limit: 50 });
  });

  it("is quiet: no loading state and no refutation re-read", async () => {
    api.fetchVerificationMetrics.mockResolvedValue(populated());
    const { result } = renderHook(() =>
      useVerificationMetrics("t-1", false, "28d")
    );
    await waitFor(() => expect(result.current.read.status).toBe("ok"));
    const findingsCalls = api.fetchCoordFindings.mock.calls.length;

    let resolve: (v: unknown) => void = () => {};
    api.fetchVerificationMetrics.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.rereadMetrics();
    });
    // In flight: the previous answer is still the one on screen.
    expect(result.current.read.status).toBe("ok");
    await act(async () => {
      resolve(populated({ generated_at: "2026-11-03T00:00:00Z" }));
      await pending;
    });
    expect(result.current.read.status).toBe("ok");
    expect(api.fetchCoordFindings.mock.calls.length).toBe(findingsCalls);
    expect(result.current.lastGood).toBe("2026-11-03T00:00:00Z");
  });

  it("a reference captured before a project switch reads for the new project", async () => {
    api.fetchVerificationMetrics.mockResolvedValue(populated());
    const { result, rerender } = renderHook(
      ({ tenant }) => useVerificationMetrics(tenant, false, "28d"),
      { initialProps: { tenant: "t-old" } }
    );
    await waitFor(() => expect(result.current.read.status).toBe("ok"));
    const captured = result.current.rereadMetrics;

    rerender({ tenant: "t-new" });
    await waitFor(() => expect(result.current.read.status).toBe("ok"));
    expect(result.current.rereadMetrics).toBe(captured);

    api.fetchVerificationMetrics.mockResolvedValue(
      populated({ generated_at: "2026-11-03T01:00:00Z" })
    );
    await act(async () => {
      await captured();
    });
    expect(readLastGood("t-new")).toBe("2026-11-03T01:00:00Z");
    expect(readLastGood("t-old")).not.toBe("2026-11-03T01:00:00Z");
  });
});
