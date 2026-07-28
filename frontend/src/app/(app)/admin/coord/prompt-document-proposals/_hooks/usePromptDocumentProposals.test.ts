/**
 * usePromptDocumentProposals — the safety-critical branches of the review feed.
 *
 * Two things here are worth pinning because getting them wrong is silent and
 * destructive rather than merely broken:
 *
 * 1. **The undo guard re-reads live state.** The feed's `current_version` is a
 *    page-load snapshot. coord's PATCH takes no version precondition, so if a
 *    peer admin edited the document since load, an undo computed from the stale
 *    snapshot would clobber their write with older prose and coord would
 *    happily record it as the new head. The guard must re-read immediately
 *    before writing and abort when the document has moved.
 *
 * 2. **Caveats are never swallowed.** Every path that drops a write from the
 *    feed sets a caveat (`unavailable`/`degraded`/`partial`/`truncated`/
 *    `limited`), and they co-occur routinely — showing only the first would
 *    make an incomplete feed look complete, which is the exact failure the
 *    review surface exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const patchMock = vi.fn();
const postMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    delete: vi.fn(),
  },
}));
// Arrow indirection, not a direct reference: `vi.mock` factories are hoisted
// above these consts, so naming them eagerly is a TDZ error.
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { usePromptDocumentProposals } from "./usePromptDocumentProposals";
import type { PromptDocumentWrite } from "../types";

const HEAD_WRITE: PromptDocumentWrite = {
  kind: "policy",
  name: "production-and-cost",
  label: "Production and Cost",
  version_number: 4,
  change_note: "agent append",
  edited_by: "agent:merge-shepherd",
  created_at: "2026-07-28T10:00:00Z",
  current_version: 4,
};

/** Route the three initial loads by URL so tests only state what they care about. */
function routeInitial(overrides: {
  proposals?: unknown;
  writes?: unknown;
  documents?: unknown;
}) {
  return (url: string) => {
    if (url.includes("/prompt-document-proposals")) {
      return Promise.resolve(
        overrides.proposals ?? { proposals: [], total: 0 }
      );
    }
    if (url.includes("/prompt-document-writes")) {
      return Promise.resolve(overrides.writes ?? { writes: [], total: 0 });
    }
    return Promise.resolve(overrides.documents ?? { documents: [] });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePromptDocumentProposals — undo guard", () => {
  it("aborts the undo when the document moved since page load", async () => {
    // The feed says v4 is head. Live state says v5 — a peer admin got there
    // first, so undoing v4 would discard their write.
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions")) {
        return Promise.resolve({ current_version: 5, versions: [] });
      }
      return routeInitial({})(url);
    });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.revertWrite(HEAD_WRITE);
    });

    expect(outcome).toBe(false);
    // The load-bearing assertion: nothing was written.
    expect(patchMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("now v5"));
  });

  it("undoes the head write by restoring the PREVIOUS version's body", async () => {
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions")) {
        return Promise.resolve({ current_version: 4, versions: [] });
      }
      if (url.endsWith("/versions/3")) {
        return Promise.resolve({ body: "the wording from v3" });
      }
      return routeInitial({})(url);
    });
    patchMock.mockResolvedValue({ current_version: 5 });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.revertWrite(HEAD_WRITE);
    });

    expect(outcome).toBe(true);
    // v4 is undone by restoring v3 — NOT by re-writing v4's own body.
    const [, body] = patchMock.mock.calls[0];
    expect(body.body).toBe("the wording from v3");
    expect(body.change_description).toContain("v3");
  });

  it("refuses to undo a write that is not head, without any round trip", async () => {
    getMock.mockImplementation(routeInitial({}));

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.revertWrite({
        ...HEAD_WRITE,
        version_number: 2,
        current_version: 4,
      });
    });

    expect(outcome).toBe(false);
    expect(patchMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("refuses to undo v1 — there is no earlier wording to restore", async () => {
    getMock.mockImplementation(routeInitial({}));

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.revertWrite({
        ...HEAD_WRITE,
        version_number: 1,
        current_version: 1,
      });
    });

    expect(outcome).toBe(false);
    expect(patchMock).not.toHaveBeenCalled();
  });
});

describe("usePromptDocumentProposals — honesty about what is missing", () => {
  it("surfaces every write-feed caveat, not just the first", async () => {
    getMock.mockImplementation(
      routeInitial({
        writes: {
          writes: [],
          total: 0,
          degraded: "store not provisioned",
          partial: "2 of the 5 documents read did not return their history",
          truncated: "40 documents beyond the ceiling were not read",
          limited: "Showing the 40 most recent of 90 writes.",
        },
      })
    );

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.writesNotices).toHaveLength(4);
    // Incomplete-but-working is not styled as coord failing.
    expect(result.current.writesSevere).toBe(false);
  });

  it("treats an UNLABELLED write-feed failure as severe", async () => {
    // The write feed's document-list route ships in today's coord, so any
    // failure means coord is not answering — the opposite default from the
    // proposals queue, whose whole point is a benign pre-deploy 404.
    getMock.mockImplementation(
      routeInitial({
        writes: {
          writes: [],
          total: 0,
          unavailable: "coord did not answer the document list (HTTP 502).",
        },
      })
    );

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.writesSevere).toBe(true);
    expect(result.current.writesNothingRead).toBe(true);
  });

  it("does not claim 'nothing recorded' when every document failed", async () => {
    // coord is up (no `unavailable`), but every document's history read failed,
    // so the feed is empty for a reason the operator must not read as "quiet".
    getMock.mockImplementation(
      routeInitial({
        writes: {
          writes: [],
          total: 0,
          partial: "5 of the 5 documents read did not return their history",
        },
      })
    );

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.writesSevere).toBe(false);
    expect(result.current.writesNothingRead).toBe(true);
  });

  it("keeps an unreadable queue distinct from an empty one", async () => {
    getMock.mockImplementation(
      routeInitial({
        proposals: {
          proposals: [],
          total: 0,
          unavailable: "coord has no proposal queue yet",
          unavailable_kind: "not_deployed",
        },
      })
    );

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.proposals).toEqual([]);
    expect(result.current.unavailable).toBeTruthy();
    // A pre-deploy 404 is expected — it must not be dressed as an incident.
    expect(result.current.unavailableKind).toBe("not_deployed");
  });

  it("does not leave a stale unavailable note beside a fresh error", async () => {
    getMock.mockImplementation((url: string) => {
      if (url.includes("/prompt-document-proposals")) {
        return Promise.reject(new Error("network down"));
      }
      return routeInitial({})(url);
    });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toContain("network down");
    expect(result.current.unavailable).toBeNull();
  });
});
