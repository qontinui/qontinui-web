/**
 * The session chip's lookup (plan
 * `2026-11-08-subprojects-group-sessions-gates-and-plans-and-say-why-one-stalled`
 * Phase 6): ONE read per page of sessions, bounded at 200 ids, re-asked only
 * when the set of sessions changes — and every state but a membership is a
 * dash that says which, never a guess.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useSubprojectsBySessions,
  type SubprojectLookup,
} from "./SubprojectChip";

const MEMBER = { id: "sp-1", title: "console work", headline: "working" };

function lookupOf(
  answer: (ids: string[]) => Promise<{
    items: Record<string, typeof MEMBER>;
    missing: string[];
  }>
) {
  return vi.fn(async (ids: readonly string[]) => answer([...ids]));
}

describe("useSubprojectsBySessions", () => {
  it("asks once for the set, and not again when the same sessions are re-sorted", async () => {
    const lookup = lookupOf(async () => ({
      items: { a: MEMBER },
      missing: ["b"],
    }));
    const { result, rerender } = renderHook(
      ({ ids }: { ids: Array<string | null> }) =>
        useSubprojectsBySessions(ids, lookup as unknown as SubprojectLookup),
      { initialProps: { ids: ["b", null, "a", "b"] } }
    );
    expect(result.current("a")).toEqual({ kind: "looking_up" });
    await waitFor(() =>
      expect(result.current("a")).toEqual({ kind: "member", ...MEMBER })
    );
    expect(result.current("b")).toEqual({ kind: "none" });
    expect(result.current(null)).toEqual({ kind: "not_applicable" });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]?.[0]).toEqual(["a", "b"]);

    rerender({ ids: ["a", "b"] });
    expect(lookup).toHaveBeenCalledTimes(1);

    rerender({ ids: ["a", "b", "c"] });
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    // The known answers stay on screen while the next set is asked.
    expect(result.current("a")).toEqual({ kind: "member", ...MEMBER });
  });

  it("looks up at most 200 sessions and says the rest were not looked up", async () => {
    const ids = Array.from(
      { length: 201 },
      (_, i) => `s-${String(i).padStart(3, "0")}`
    );
    const lookup = lookupOf(async (asked) => ({ items: {}, missing: asked }));
    const { result } = renderHook(() =>
      useSubprojectsBySessions(ids, lookup as unknown as SubprojectLookup)
    );
    await waitFor(() =>
      expect(result.current("s-000")).toEqual({ kind: "none" })
    );
    expect(lookup.mock.calls[0]?.[0]).toHaveLength(200);
    expect(result.current("s-200")).toEqual({ kind: "not_looked_up" });
  });

  it("calls a session coord did not name either way unanswered, not none", async () => {
    const lookup = lookupOf(async () => ({ items: {}, missing: [] }));
    const { result } = renderHook(() =>
      useSubprojectsBySessions(["a"], lookup as unknown as SubprojectLookup)
    );
    await waitFor(() =>
      expect(result.current("a")).toEqual({ kind: "unanswered" })
    );
  });

  it("calls a failed lookup failed, with its reason, never none", async () => {
    const lookup = vi.fn(async () => {
      throw new Error(
        'GET /api/v1/operations/subprojects/by-sessions?ids=a failed: 503 - {"error":"schema_migration_pending"}'
      );
    });
    const { result } = renderHook(() =>
      useSubprojectsBySessions(["a"], lookup as unknown as SubprojectLookup)
    );
    await waitFor(() =>
      expect(result.current("a")).toEqual({
        kind: "failed",
        failure: { kind: "migration_pending" },
      })
    );
  });

  it("asks nothing for a page with no session ids", () => {
    const lookup = lookupOf(async () => ({ items: {}, missing: [] }));
    const { result } = renderHook(() =>
      useSubprojectsBySessions(
        [null, null],
        lookup as unknown as SubprojectLookup
      )
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(result.current(null)).toEqual({ kind: "not_applicable" });
  });
});
