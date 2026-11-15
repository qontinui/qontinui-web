/**
 * useSessionCompliance on its own (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review round 6): the
 * newest verdict read is the one shown, and the save reads the pin it is sent
 * in. The page-level rows — what is read under which project, and a save
 * beside a Refresh — are in `PromptDocumentsPageSettingsCrossTab`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";

const fetchSessionComplianceConfig = vi.fn();
const listSessionComplianceConfigVersions = vi.fn();
const listSessionComplianceOutstanding = vi.fn();
const listSessionComplianceSessions = vi.fn();
const saveSessionComplianceConfig = vi.fn();
vi.mock("@/lib/api/operations/coordPromptDocuments", () => ({
  fetchSessionComplianceConfig: (...args: unknown[]) =>
    fetchSessionComplianceConfig(...args),
  listSessionComplianceConfigVersions: (...args: unknown[]) =>
    listSessionComplianceConfigVersions(...args),
  listSessionComplianceOutstanding: (...args: unknown[]) =>
    listSessionComplianceOutstanding(...args),
  listSessionComplianceSessions: (...args: unknown[]) =>
    listSessionComplianceSessions(...args),
  saveSessionComplianceConfig: (...args: unknown[]) =>
    saveSessionComplianceConfig(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { useSessionCompliance } from "./useSessionCompliance";
import {
  PINNED_PAGE,
  testPageGuard,
  withPageGuard,
} from "../__fixtures__/pageWriteGuard";

const CONFIG = {
  enabled: true,
  mode: "nudge",
  max_attempts: 1,
  enforced_clause_ref: "policy/planning-and-scope#finish-to-zero",
  applicable: true,
  applicability_reason: "applicable",
  clause_resolved_via: "registry",
  prompt_document_version: 7,
  current_version: 3,
};

/** One verdict row, told apart by its id. */
function row(id: string, verdict: string) {
  return {
    id,
    claude_session_id: `session-${id}`,
    verdict,
    checked_at: "2026-11-15T12:00:00Z",
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The verdict filter each verdict read was sent with, in order. */
const verdictsAsked = () =>
  listSessionComplianceSessions.mock.calls.map(
    ([params]) => (params as { verdict?: string }).verdict
  );

beforeEach(() => {
  vi.clearAllMocks();
  fetchSessionComplianceConfig.mockResolvedValue(CONFIG);
  listSessionComplianceConfigVersions.mockResolvedValue({ versions: [] });
  listSessionComplianceOutstanding.mockResolvedValue({ items: [] });
});

describe("useSessionCompliance — the newest verdict read is the one shown", () => {
  it("keeps a filter's rows and cursor when a read for the earlier filter answers after it", async () => {
    // The mount read (every verdict) is held; the filter's read answers at once.
    const everyVerdict = deferred<unknown>();
    listSessionComplianceSessions
      .mockReturnValueOnce(everyVerdict.promise)
      .mockResolvedValueOnce({
        sessions: [row("v1", "verified")],
        next_cursor: "after-v1",
      });
    const { result } = renderHook(() => useSessionCompliance(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() =>
      expect(listSessionComplianceSessions).toHaveBeenCalledTimes(1)
    );

    act(() => result.current.changeVerdictFilter("verified"));
    await waitFor(() =>
      expect(result.current.sessions.data?.map((r) => r.id)).toEqual(["v1"])
    );
    await act(async () =>
      everyVerdict.resolve({
        sessions: [row("u1", "unverified")],
        next_cursor: "after-u1",
      })
    );

    expect(verdictsAsked()).toEqual([undefined, "verified"]);
    expect(result.current.sessions.data?.map((r) => r.id)).toEqual(["v1"]);
    expect(result.current.nextCursor).toBe("after-v1");
    expect(result.current.sessions.loading).toBe(false);
  });

  it("keeps a filter's rows when a read for the earlier filter fails after it", async () => {
    const everyVerdict = deferred<unknown>();
    listSessionComplianceSessions
      .mockReturnValueOnce(everyVerdict.promise)
      .mockResolvedValueOnce({
        sessions: [row("v1", "verified")],
        next_cursor: "after-v1",
      });
    const { result } = renderHook(() => useSessionCompliance(), {
      wrapper: withPageGuard(PINNED_PAGE),
    });
    await waitFor(() =>
      expect(listSessionComplianceSessions).toHaveBeenCalledTimes(1)
    );

    act(() => result.current.changeVerdictFilter("verified"));
    await waitFor(() =>
      expect(result.current.sessions.data?.map((r) => r.id)).toEqual(["v1"])
    );
    await act(async () => everyVerdict.reject(new Error("coord timed out")));

    expect(result.current.sessions.data?.map((r) => r.id)).toEqual(["v1"]);
    expect(result.current.sessions.error).toBeNull();
    expect(result.current.nextCursor).toBe("after-v1");
  });
});

describe("useSessionCompliance — the save reads the pin it is sent in", () => {
  it("refuses a save beside its send when the page names no project, whatever its guard allowed", async () => {
    // A guard the page's provider never builds — a write allowed with no
    // pin — so only the hook's own refusal can stop the send.
    const { result } = renderHook(() => useSessionCompliance(), {
      wrapper: withPageGuard(testPageGuard({ writeAllowed: () => true })),
    });
    let sentSave: boolean | undefined;
    await act(async () => {
      sentSave = await result.current.saveConfig({ max_attempts: 2 });
    });

    expect(sentSave).toBe(false);
    expect(saveSessionComplianceConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Nothing was sent: this page has no project to send a change in. Select a project, or reload the page."
    );
  });
});
