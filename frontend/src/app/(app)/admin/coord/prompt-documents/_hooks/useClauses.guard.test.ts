/**
 * `useClauses`' write guard. The hook is always under the prompt-documents
 * page's provider, and takes the page's guard and pin from it:
 *
 * - A clause write is sent only when the page's guard allows it. Answering
 *   `false` sends NOTHING and reports failure.
 * - What is sent goes in the page's pin.
 * - Outside the provider the hook throws: there is no unguarded mode.
 *
 * Each test mounts it under a test page guard (`__fixtures__/pageWriteGuard`),
 * standing in for the page's provider.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import { useClauses, type UseClausesOptions } from "./useClauses";
import { testPageGuard, withPageGuard } from "../__fixtures__/pageWriteGuard";

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

afterEach(() => {
  vi.restoreAllMocks();
});

const writes = [
  api.createPromptDocumentClause,
  api.updatePromptDocumentClause,
  api.deletePromptDocumentClause,
  api.reorderPromptDocumentClauses,
  api.updatePromptDocumentAttrs,
];

/** The page's side: its guard, and the pin it hands down. */
type Page = { writeAllowed?: () => boolean; pin?: { tenant: string } };

function mount(
  enabled: boolean,
  page: Page = {},
  options: UseClausesOptions = {}
) {
  const guard = testPageGuard(page);
  return renderHook(() => useClauses("policy", "testing", enabled, options), {
    wrapper: withPageGuard(guard),
  });
}

/** Every write the hook makes, each once; what each answered. */
async function writeEveryWay(
  result: ReturnType<typeof mount>["result"]
): Promise<unknown[]> {
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
  return outcomes;
}

describe("useClauses write guard", () => {
  it("sends nothing while the page's guard answers false", async () => {
    const { result } = mount(false, { writeAllowed: () => false });

    const outcomes = await writeEveryWay(result);

    expect(outcomes).toEqual([false, false, false, false, 0, false]);
    for (const fn of writes) expect(fn).not.toHaveBeenCalled();
  });

  it("writes when the page's guard allows, in the page's pin", async () => {
    const { result } = mount(false, {
      writeAllowed: () => true,
      pin: { tenant: "t-b" },
    });

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

  it("stops an import part-way when the guard turns false between creates", async () => {
    // Another tab switches project while the first create is in flight.
    let allowed = true;
    api.createPromptDocumentClause.mockImplementation(async () => {
      allowed = false;
      return {};
    });
    // Enabled, so a re-read after the run would actually be sent.
    const { result } = mount(true, { writeAllowed: () => allowed });
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
    // The page has no pin, so the refused run does not re-read the list: the
    // read would be served by the other project.
    expect(api.listPromptDocumentClauses).toHaveBeenCalledTimes(listsBefore);
  });

  it("re-reads, in the page's pin, after an import stopped part-way", async () => {
    let allowed = true;
    api.createPromptDocumentClause.mockImplementation(async () => {
      allowed = false;
      return {};
    });
    const { result } = mount(true, {
      writeAllowed: () => allowed,
      pin: { tenant: "t-b" },
    });
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

  it("throws outside the page's provider rather than writing unguarded", () => {
    // React reports the render error it rethrows; that report is not under test.
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      renderHook(() => useClauses("policy", "testing", false))
    ).toThrow(/PageWriteGuardProvider/);
  });
});
