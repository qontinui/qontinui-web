/**
 * `useClauses`' write guard: with `canWrite` answering `false` — the
 * prompt-documents page after another tab switched project — every clause
 * write sends NOTHING and reports failure; answering `true`, it writes, in the
 * project it was given as its `pin`.
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
      useClauses("policy", "testing", false, { canWrite: () => false })
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
      useClauses("policy", "testing", true, { canWrite: () => allowed })
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
    // The refused run is unpinned, so it does not re-read the list: the
    // read would be served by the other project.
    expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(listsBefore);
  });

  it("re-reads, in its pinned project, after an import stopped part-way", async () => {
    let allowed = true;
    api.createPromptDocumentClause.mockImplementation(async () => {
      allowed = false;
      return {};
    });
    const pin = { tenant: "t-b" };
    const { result } = renderHook(() =>
      useClauses("policy", "testing", true, {
        canWrite: () => allowed,
        pin,
      })
    );
    await waitFor(() =>
      expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      await result.current.importCandidates([
        { clause_id: "a" } as never,
        { clause_id: "b" } as never,
      ]);
    });
    expect(api.createPromptDocumentClause).toHaveBeenCalledTimes(1);
    // Pinned, the re-read cannot be served by the other project, so it is
    // taken: the list shows what the run created before it stopped.
    expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(2);
    expect(api.listPromptDocumentClauses).toHaveBeenLastCalledWith(
      "policy",
      "testing",
      { tenant: "t-b" }
    );
  });

  it("takes no re-read after an import stopped part-way when its pin names no project", async () => {
    // A `null` pin sends no header, so the client fills in the project stored
    // when the read is made — the other tab's — exactly as for no pin at all.
    let allowed = true;
    api.createPromptDocumentClause.mockImplementation(async () => {
      allowed = false;
      return {};
    });
    const { result } = renderHook(() =>
      useClauses("policy", "testing", true, {
        canWrite: () => allowed,
        pin: { tenant: null },
      })
    );
    await waitFor(() =>
      expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(1)
    );
    await act(async () => {
      await result.current.importCandidates([
        { clause_id: "a" } as never,
        { clause_id: "b" } as never,
      ]);
    });
    expect(api.createPromptDocumentClause).toHaveBeenCalledTimes(1);
    expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(1);
  });

  it("writes when it answers true, in its pinned project", async () => {
    const { result } = renderHook(() =>
      useClauses("policy", "testing", false, {
        canWrite: () => true,
        pin: { tenant: "t-b" },
      })
    );
    await act(async () => {
      await result.current.deleteClause("x");
    });
    expect(api.deletePromptDocumentClause).toHaveBeenCalledWith(
      "policy",
      "testing",
      "x",
      { tenant: "t-b" }
    );
  });
});
