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

  it("a full reload yields to a quiet re-read begun after it, and supersedes one begun before it", async () => {
    api.fetchVerificationMetrics.mockResolvedValue(populated());
    const { result, rerender } = renderHook(
      ({ win }) => useVerificationMetrics("t-1", false, win),
      { initialProps: { win: "28d" } }
    );
    await waitFor(() => expect(result.current.read.status).toBe("ok"));

    const deferred = () => {
      let resolve: (v: unknown) => void = () => {};
      const p = new Promise((r) => {
        resolve = r;
      });
      return { p, resolve };
    };
    const generatedAt = () =>
      result.current.read.status === "ok"
        ? result.current.read.metrics.generated_at
        : null;

    // (a) reload in flight, THEN a quiet re-read: the re-read's answer wins
    // even though the reload's answer arrives last.
    const full = deferred();
    const quiet = deferred();
    api.fetchVerificationMetrics
      .mockReturnValueOnce(full.p)
      .mockReturnValueOnce(quiet.p);
    rerender({ win: "7d" });
    let q: Promise<void> = Promise.resolve();
    act(() => {
      q = result.current.rereadMetrics();
    });
    await act(async () => {
      quiet.resolve(populated({ generated_at: "2026-11-03T02:00:00Z" }));
      await q;
    });
    await act(async () => {
      full.resolve(populated({ generated_at: "2026-11-03T01:00:00Z" }));
    });
    expect(generatedAt()).toBe("2026-11-03T02:00:00Z");

    // (b) a quiet re-read in flight, THEN a full reload: the reload wins even
    // though the re-read's answer arrives last.
    const quiet2 = deferred();
    const full2 = deferred();
    api.fetchVerificationMetrics
      .mockReturnValueOnce(quiet2.p)
      .mockReturnValueOnce(full2.p);
    act(() => {
      q = result.current.rereadMetrics();
    });
    rerender({ win: "28d" });
    await act(async () => {
      full2.resolve(populated({ generated_at: "2026-11-03T04:00:00Z" }));
    });
    await act(async () => {
      quiet2.resolve(populated({ generated_at: "2026-11-03T03:00:00Z" }));
      await q;
    });
    expect(generatedAt()).toBe("2026-11-03T04:00:00Z");
  });
});
