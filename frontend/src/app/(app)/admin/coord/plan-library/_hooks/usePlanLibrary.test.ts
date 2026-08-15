/**
 * usePlanLibrary / useDivergentArtifacts / useCaptureHealth.
 *
 * The list hook is mostly plumbing; what is worth pinning is the behaviour
 * that is wrong in a way nobody notices:
 *
 * * A filter change must reset the offset. Staying on page 3 of the previous
 *   query renders an empty page and reads as "no matches".
 * * A failed load must not blank the rows into a confident empty state.
 * * The facet chips are derived from the LOADED page, not the corpus — the
 *   hook must not pretend otherwise by returning a fixed vocabulary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const patchMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: vi.fn(),
  },
}));

import {
  useCaptureHealth,
  useDivergentArtifacts,
  usePlanLibrary,
} from "./usePlanLibrary";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organization_id: null,
    created_by_user_id: null,
    kind: "plan",
    kind_locked: false,
    slug: "2026-08-10-a-plan",
    title: "A plan",
    status: "VETTED",
    content_sha256: "abc123",
    source_path: "plans/a.md",
    source_repo: "qontinui-web",
    work_unit_slug: null,
    repos: ["qontinui-coord"],
    authored_at: null,
    captured_by: "runner_scan",
    current_version: 1,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePlanLibrary — filters", () => {
  it("puts every filter on the query string", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.updateFilter("kind", "handoff"));
    act(() => result.current.updateFilter("status", "VETTED"));
    act(() => result.current.updateFilter("repo", "qontinui-coord"));
    act(() => result.current.updateFilter("q", "merge train"));

    await waitFor(() => {
      const url = String(getMock.mock.calls.at(-1)?.[0]);
      expect(url).toContain("kind=handoff");
      expect(url).toContain("status=VETTED");
      expect(url).toContain("repo=qontinui-coord");
      expect(url).toContain("q=merge+train");
    });
  });

  it("debounces typed text but applies the kind dropdown at once", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    // Five keystrokes must not be five full-text scans.
    act(() => result.current.updateFilter("q", "m"));
    act(() => result.current.updateFilter("q", "me"));
    act(() => result.current.updateFilter("q", "mer"));
    act(() => result.current.updateFilter("q", "merg"));
    act(() => result.current.updateFilter("q", "merge"));
    expect(getMock).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(String(getMock.mock.calls.at(-1)?.[0])).toContain("q=merge")
    );
    // One request for the settled value, not one per character.
    expect(getMock.mock.calls.length).toBe(1);

    // The dropdown is a single discrete action — no lag.
    getMock.mockClear();
    act(() => result.current.updateFilter("kind", "plan"));
    await waitFor(() => expect(getMock).toHaveBeenCalled());
  });

  it("returns to page 1 when a filter changes", async () => {
    getMock.mockResolvedValue({
      items: [row()],
      total: 500,
      offset: 0,
      limit: 50,
    });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setOffset(100));
    await waitFor(() => expect(result.current.offset).toBe(100));

    act(() => result.current.updateFilter("kind", "plan"));

    // Staying on page 3 of a NEW query renders empty and reads as "no matches".
    await waitFor(() => expect(result.current.offset).toBe(0));
  });

  it("derives the facet chips from the loaded page only", async () => {
    getMock.mockResolvedValue({
      items: [
        row({ status: "VETTED", source_repo: "qontinui-web", repos: ["a"] }),
        row({
          id: "22222222-2222-2222-2222-222222222222",
          status: "DRAFT",
          source_repo: "qontinui-runner",
          repos: ["b"],
        }),
      ],
      total: 2,
      offset: 0,
      limit: 50,
    });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.seen.statuses).toEqual(["DRAFT", "VETTED"]);
    expect(result.current.seen.repos).toEqual([
      "a",
      "b",
      "qontinui-runner",
      "qontinui-web",
    ]);
  });
});

describe("usePlanLibrary — failure is not emptiness", () => {
  it("keeps the last rows on screen when a reload fails", async () => {
    getMock.mockResolvedValueOnce({
      items: [row()],
      total: 1,
      offset: 0,
      limit: 50,
    });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    getMock.mockRejectedValueOnce(new Error("backend down"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toContain("backend down");
    // Clearing these would render the "library is empty" state on no evidence.
    expect(result.current.items).toHaveLength(1);
  });
});

describe("usePlanLibrary — kind correction", () => {
  it("patches the kind and reloads the list", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });
    patchMock.mockResolvedValue({ ...row(), kind: "handoff" });

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.correctKind("abc", "handoff");
    });

    expect(ok).toBe(true);
    expect(patchMock).toHaveBeenCalledWith("/api/v1/plan-library/abc/kind", {
      kind: "handoff",
    });
    // The list carries `kind` and `kind_locked`; a stale row would show the
    // correction as not having happened.
    expect(getMock).toHaveBeenCalled();
  });

  it("surfaces a 409 identity collision instead of guessing a merge", async () => {
    getMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50 });
    patchMock.mockRejectedValue(new Error("kind_identity_conflict"));

    const { result } = renderHook(() => usePlanLibrary());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.correctKind("abc", "handoff");
    });

    expect(ok).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("kind_identity_conflict")
    );
  });
});

describe("useDivergentArtifacts", () => {
  it("keeps content drift and kind forks as separate findings", async () => {
    getMock.mockResolvedValue({
      groups: [
        { kind: "plan", slug: "s1", variant_count: 2, variants: [] },
      ],
      total: 1,
      kind_forks: [
        {
          slug: "s2",
          source_repo: "qontinui-web",
          kinds: ["plan", "handoff"],
          variant_count: 2,
          resolvable: false,
          variants: [],
        },
      ],
      kind_fork_total: 1,
    });

    const { result } = renderHook(() => useDivergentArtifacts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.total).toBe(1);
    // A kind fork is invisible to `(kind, slug)` grouping — it must not be
    // folded into `groups`.
    expect(result.current.data?.kind_fork_total).toBe(1);
    expect(result.current.data?.kind_forks[0].resolvable).toBe(false);
  });

  it("reports a failed read rather than an empty result", async () => {
    getMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useDivergentArtifacts());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("boom");
    expect(result.current.data).toBeNull();
  });
});

describe("useCaptureHealth", () => {
  it("passes through the zero-count doors the backend returns", async () => {
    getMock.mockResolvedValue({
      total: 12,
      doors: [
        {
          captured_by: "runner_scan",
          count: 12,
          known: true,
          first_at: "2026-08-01T00:00:00Z",
          last_touched_at: "2026-08-14T00:00:00Z",
        },
        {
          captured_by: "agent",
          count: 0,
          known: true,
          first_at: null,
          last_touched_at: null,
        },
        {
          captured_by: "operator",
          count: 0,
          known: true,
          first_at: null,
          last_touched_at: null,
        },
      ],
    });

    const { result } = renderHook(() => useCaptureHealth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // "The agent door has written nothing" is the finding this panel exists
    // for — it must survive as an explicit zero, not be filtered out.
    const agent = result.current.data?.doors.find(
      (d) => d.captured_by === "agent"
    );
    expect(agent?.count).toBe(0);
    expect(result.current.data?.doors).toHaveLength(3);
  });
});

describe("useCaptureHealth — a failed read is not a corpus of zero", () => {
  it("leaves `data` null rather than synthesising empty doors", async () => {
    getMock.mockRejectedValue(new Error("backend down"));

    const { result } = renderHook(() => useCaptureHealth());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Rendering three zeroed doors here would state "the agent door has never
    // been used" on the evidence of a network failure.
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("backend down");
  });
});
