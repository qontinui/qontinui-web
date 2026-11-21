/**
 * A failed run read resolves `null`, never `[]`: RunHistory renders `null` as
 * a failed read, and `[]` as "No runs yet" (the 2127 follow-up).
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: vi.fn(async (url: string) => {
      if (url.endsWith("/groups")) return [];
      throw new Error("network down");
    }),
  },
}));

import { useConditions } from "./useConditions";

describe("useConditions run reads", () => {
  it("resolves null, not an empty list, when the run-history read fails", async () => {
    const { result } = renderHook(() => useConditions());
    await expect(result.current.listRuns("g1")).resolves.toBeNull();
  });

  it("resolves null when the run-detail read fails", async () => {
    const { result } = renderHook(() => useConditions());
    await expect(result.current.getRun("r1")).resolves.toBeNull();
  });
});
