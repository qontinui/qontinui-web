/**
 * `useDomainCost` — the read's failure modes surface as reasons (plan
 * `2026-09-20-the-second-ratchet-domain-is-operations-and-its-cost-is-compared-to-the-first`
 * Phase 8): a held read whose project list FAILED says so instead of "not
 * read yet" forever, and a malformed body is a failed read, never a ledger.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => httpGet(...args) },
}));

import { useDomainCost } from "./useDomainCost";
import compounded from "../../../../../test-fixtures/domain-cost/compounded.json";

describe("useDomainCost", () => {
  beforeEach(() => httpGet.mockReset());

  it("a held read with a failed project list names that failure, and reads nothing", () => {
    const { result } = renderHook(() =>
      useDomainCost("t-1", true, "HTTP 502")
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("project list unavailable: HTTP 502");
    expect(httpGet).not.toHaveBeenCalled();
  });

  it("a held read with no failure is still loading", () => {
    const { result } = renderHook(() => useDomainCost("t-1", true, null));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("a partial body is the answered-without-a-ledger error, never data", async () => {
    httpGet.mockResolvedValue({
      ...compounded,
      comparison: { ...compounded.comparison, dimensions: undefined },
    });
    const { result } = renderHook(() => useDomainCost("t-1", false));
    await waitFor(() =>
      expect(result.current.error).toBe(
        "coord answered without a domain cost ledger"
      )
    );
    expect(result.current.data).toBeNull();
  });

  it("a well-formed body is the data", async () => {
    httpGet.mockResolvedValue(compounded);
    const { result } = renderHook(() => useDomainCost("t-1", false));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull();
  });
});
