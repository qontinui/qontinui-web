/**
 * `useClauses`' write guard: with `canWrite` answering `false` — the
 * prompt-documents page after another tab switched project — every clause
 * write sends NOTHING and reports failure; answering `true`, it writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({
  createPromptDocumentClause: vi.fn(),
  updatePromptDocumentClause: vi.fn(),
  deletePromptDocumentClause: vi.fn(),
  reorderPromptDocumentClauses: vi.fn(),
  updatePromptDocumentAttrs: vi.fn(),
  listPromptDocumentClauses: vi.fn(),
}));
vi.mock("@/lib/api/operations/coordPromptDocuments", () => api);
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useClauses } from "./useClauses";

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.listPromptDocumentClauses.mockResolvedValue({ clauses: [] });
  for (const fn of [
    api.createPromptDocumentClause,
    api.updatePromptDocumentClause,
    api.deletePromptDocumentClause,
    api.reorderPromptDocumentClauses,
    api.updatePromptDocumentAttrs,
  ]) {
    fn.mockResolvedValue({});
  }
});

const writes = [
  api.createPromptDocumentClause,
  api.updatePromptDocumentClause,
  api.deletePromptDocumentClause,
  api.reorderPromptDocumentClauses,
  api.updatePromptDocumentAttrs,
];

describe("useClauses canWrite", () => {
  it("sends nothing while it answers false", async () => {
    const { result } = renderHook(() =>
      useClauses("policy", "testing", false, undefined, () => false)
    );
    let outcomes: unknown[] = [];
    await act(async () => {
      outcomes = [
        await result.current.createClause({ clause_id: "x" } as never),
        await result.current.updateClause("x", {} as never),
        await result.current.deleteClause("x"),
        await result.current.reorderClauses(["x"]),
        await result.current.importCandidates([{ clause_id: "x" } as never]),
        await result.current.saveAttrs({} as never),
      ];
    });
    expect(outcomes).toEqual([false, false, false, false, 0, false]);
    for (const fn of writes) expect(fn).not.toHaveBeenCalled();
  });

  it("stops an import part-way when it turns false between creates", async () => {
    // Another tab switches project while the first create is in flight.
    let allowed = true;
    api.createPromptDocumentClause.mockImplementation(async () => {
      allowed = false;
      return {};
    });
    const { result } = renderHook(() =>
      // Enabled, so a re-read after the run would actually be sent.
      useClauses("policy", "testing", true, undefined, () => allowed)
    );
    await waitFor(() =>
      expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(1)
    );
    const listsBefore = api.listPromptDocumentClauses.mock.calls.length;
    let created = -1;
    await act(async () => {
      created = await result.current.importCandidates([
        { clause_id: "a" } as never,
        { clause_id: "b" } as never,
        { clause_id: "c" } as never,
      ]);
    });
    expect(created).toBe(1);
    expect(api.createPromptDocumentClause).toHaveBeenCalledTimes(1);
    // The refused run does not re-read the list in the other project.
    expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(listsBefore);
  });

  it("writes when it answers true", async () => {
    const { result } = renderHook(() =>
      useClauses("policy", "testing", false, undefined, () => true)
    );
    await act(async () => {
      await result.current.deleteClause("x");
    });
    expect(api.deletePromptDocumentClause).toHaveBeenCalledWith(
      "policy",
      "testing",
      "x"
    );
  });
});
