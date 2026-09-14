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

/**
 * The lazy per-row diff (plan
 * `2026-08-27-tenant-level-agent-authorable-stores.md`, Phase 4).
 *
 * It reuses the SAME `…/versions/{n}` reads the undo path makes, one version
 * apart, so the two properties worth pinning are about the cache rather than the
 * fetch: a version snapshot is immutable, so a hit must not re-fetch — and a
 * FAILED read must not become permanent, or a transient 502 leaves that row
 * unexplainable for the life of the page.
 */
describe("usePromptDocumentProposals — the landed-write diff", () => {
  it("fetches this version and the one before it, and caches the pair", async () => {
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions/4")) return Promise.resolve({ body: "new" });
      if (url.endsWith("/versions/3")) return Promise.resolve({ body: "old" });
      return routeInitial({})(url);
    });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    await act(async () => {
      await result.current.loadWriteDiff(HEAD_WRITE);
    });
    expect(result.current.writeDiffFor(HEAD_WRITE)).toEqual({
      status: "ready",
      previous: "old",
      current: "new",
    });
    expect(getMock).toHaveBeenCalledTimes(2);

    // A second expand of the same row must not hit the network again.
    getMock.mockClear();
    await act(async () => {
      await result.current.loadWriteDiff(HEAD_WRITE);
    });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("diffs v1 against the empty document without a second fetch", async () => {
    const first = { ...HEAD_WRITE, version_number: 1, current_version: 1 };
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions/1"))
        return Promise.resolve({ body: "first" });
      return routeInitial({})(url);
    });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    await act(async () => {
      await result.current.loadWriteDiff(first);
    });
    expect(result.current.writeDiffFor(first)).toEqual({
      status: "ready",
      previous: "",
      current: "first",
    });
    // There is no v0 to ask for.
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("records a failed read as an ERROR and lets a later expand retry", async () => {
    let attempt = 0;
    getMock.mockImplementation((url: string) => {
      if (url.includes("/versions/")) {
        attempt += 1;
        if (attempt <= 2) return Promise.reject(new Error("HTTP 502"));
        return Promise.resolve({ body: url.endsWith("/3") ? "old" : "new" });
      }
      return routeInitial({})(url);
    });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadWriteDiff(HEAD_WRITE);
    });
    expect(result.current.writeDiffFor(HEAD_WRITE)).toEqual({
      status: "error",
      error: "HTTP 502",
    });

    // The guard released, so the row is retryable rather than pinned.
    await act(async () => {
      await result.current.loadWriteDiff(HEAD_WRITE);
    });
    expect(result.current.writeDiffFor(HEAD_WRITE)).toMatchObject({
      status: "ready",
    });
  });

  it("reports a never-requested row as null, not as an empty diff", async () => {
    getMock.mockImplementation(routeInitial({}));
    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.writeDiffFor(HEAD_WRITE)).toBeNull();
  });
});

/**
 * The Error `httpClient.post` throws for a coord refusal relayed by the
 * operations proxy, built the way production builds it: coord's JSON body is
 * the `HTTPException` detail STRING, the backend's error envelope carries it as
 * `message`, and `httpClient` folds the whole response text into
 * `POST <url> failed: <status> - <text>`.
 */
function proxiedFailure(
  status: number,
  coordBody: Record<string, unknown>,
  path = "/api/v1/operations/coord/prompt-documents/decision_record/no-cross-tenant-reads/withdraw"
): Error {
  const envelope = JSON.stringify({
    error: status === 409 ? "conflict" : "forbidden",
    message: JSON.stringify(coordBody),
    timestamp: "2026-09-14T00:00:00Z",
    path,
  });
  return new Error(`POST ${path} failed: ${status} - ${envelope}`);
}

const CREATED_RECORD: PromptDocumentWrite = {
  kind: "decision_record",
  name: "no-cross-tenant-reads",
  label: "No cross-tenant reads",
  version_number: 1,
  change_note: "recorded an operator ruling",
  edited_by: "agent:chart",
  created_at: "2026-09-13T10:00:00Z",
  current_version: 1,
};

describe("usePromptDocumentProposals — withdrawing a created decision record", () => {
  it("POSTs the trimmed reason to the operator withdraw route after a live head check", async () => {
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions")) {
        return Promise.resolve({ current_version: 1, versions: [] });
      }
      return routeInitial({})(url);
    });
    postMock.mockResolvedValue({ current_version: 2, withdrawn: true });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.withdrawWrite(
        CREATED_RECORD,
        "  never decided — recorded from a guess  "
      );
    });

    expect(outcome).toBe(true);
    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0];
    expect(url).toBe(
      "/api/v1/operations/coord/prompt-documents/decision_record/no-cross-tenant-reads/withdraw"
    );
    // The reason and the version just re-read — the withdrawer is coord's to
    // stamp, never the browser's; the version lets coord refuse a withdrawal
    // that a peer write overtook between the re-read and this POST.
    expect(body).toEqual({
      reason: "never decided — recorded from a guess",
      expected_version: 1,
    });
    // No PATCH: a withdrawal is not an undo-by-body.
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("aborts when the record moved since page load — nothing is written", async () => {
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions")) {
        return Promise.resolve({ current_version: 2, versions: [] });
      }
      return routeInitial({})(url);
    });

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.withdrawWrite(CREATED_RECORD, "a reason");
    });

    expect(outcome).toBe(false);
    expect(postMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("now v2"));
  });

  it("reports coord's stale refusal as a moved record and reloads", async () => {
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions")) {
        return Promise.resolve({ current_version: 1, versions: [] });
      }
      return routeInitial({})(url);
    });
    postMock.mockRejectedValue(
      proxiedFailure(409, {
        error:
          "`decision_record/no-cross-tenant-reads` moved since it was read: the withdrawal was decided against version 1, and the record is now at version 2.",
        error_code: "withdraw_stale",
        expected_version: 1,
        current_version: 2,
      })
    );

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const loadsBefore = getMock.mock.calls.filter(([u]) =>
      String(u).includes("prompt-document-writes")
    ).length;

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.withdrawWrite(CREATED_RECORD, "a reason");
    });

    expect(outcome).toBe(false);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][1]).toMatchObject({ expected_version: 1 });
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("changed while you were withdrawing it (now v2)")
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    const loadsAfter = getMock.mock.calls.filter(([u]) =>
      String(u).includes("prompt-document-writes")
    ).length;
    expect(loadsAfter).toBeGreaterThan(loadsBefore);
  });

  it("does not read another refusal as stale because the record's NAME carries the token", async () => {
    const named: PromptDocumentWrite = {
      ...CREATED_RECORD,
      name: "why-withdraw_stale-exists",
    };
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions")) {
        return Promise.resolve({ current_version: 1, versions: [] });
      }
      return routeInitial({})(url);
    });
    postMock.mockRejectedValue(
      proxiedFailure(
        403,
        { error: "not a tenant admin" },
        "/api/v1/operations/coord/prompt-documents/decision_record/why-withdraw_stale-exists/withdraw"
      )
    );

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.withdrawWrite(named, "a reason");
    });

    expect(outcome).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("not a tenant admin")
    );
    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("changed while you were withdrawing it")
    );
  });

  it("refuses a blank reason without any round trip", async () => {
    getMock.mockImplementation(routeInitial({}));

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.withdrawWrite(CREATED_RECORD, "   ");
    });

    expect(outcome).toBe(false);
    expect(getMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("refuses a kind other than decision_record, and a v > 1 write", async () => {
    getMock.mockImplementation(routeInitial({}));

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));
    getMock.mockClear();

    const outcomes: boolean[] = [];
    await act(async () => {
      outcomes.push(
        await result.current.withdrawWrite(
          { ...CREATED_RECORD, kind: "initiative" },
          "a reason"
        )
      );
      outcomes.push(
        await result.current.withdrawWrite(
          { ...CREATED_RECORD, version_number: 3, current_version: 3 },
          "a reason"
        )
      );
    });

    expect(outcomes).toEqual([false, false]);
    expect(getMock).not.toHaveBeenCalled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("reports a refused withdrawal and keeps the caller's composer open", async () => {
    getMock.mockImplementation((url: string) => {
      if (url.endsWith("/versions")) {
        return Promise.resolve({ current_version: 1, versions: [] });
      }
      return routeInitial({})(url);
    });
    postMock.mockRejectedValue(new Error("HTTP 403: not a tenant admin"));

    const { result } = renderHook(() => usePromptDocumentProposals());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.withdrawWrite(CREATED_RECORD, "a reason");
    });

    expect(outcome).toBe(false);
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("not a tenant admin")
    );
  });
});
