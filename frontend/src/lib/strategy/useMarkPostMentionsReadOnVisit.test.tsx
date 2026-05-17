/**
 * useMarkPostMentionsReadOnVisit tests (Phase 2.5).
 *
 * Verifies the doc-visit deep-link mark-read flow:
 *   - Mounting with a postId fires markPostMentionsRead exactly once
 *   - Server reporting marked_read>0 → invalidates the unread query
 *   - Server reporting marked_read=0 → does NOT invalidate (no churn)
 *   - Mounting with postId=null → does NOT fire the request
 */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const markBulkMock = vi.fn();

vi.mock("@/lib/api/strategy", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/strategy")>(
      "@/lib/api/strategy"
    );
  return {
    ...actual,
    markPostMentionsRead: (...args: unknown[]) => markBulkMock(...args),
  };
});

import { useMarkPostMentionsReadOnVisit } from "./useMarkPostMentionsReadOnVisit";

function Harness({ postId }: { postId: string | null }) {
  useMarkPostMentionsReadOnVisit(postId);
  return null;
}

function setup(postId: string | null) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const result = render(
    <QueryClientProvider client={qc}>
      <Harness postId={postId} />
    </QueryClientProvider>
  );
  return { qc, spy, result };
}

describe("useMarkPostMentionsReadOnVisit", () => {
  beforeEach(() => {
    markBulkMock.mockReset();
  });

  it("does not call the API when postId is null", async () => {
    const { spy } = setup(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(markBulkMock).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls markPostMentionsRead exactly once when postId is set", async () => {
    markBulkMock.mockResolvedValue(2);
    setup("post-abc");
    await waitFor(() => expect(markBulkMock).toHaveBeenCalledTimes(1));
    expect(markBulkMock).toHaveBeenCalledWith("post-abc");
  });

  it("invalidates the unread query when marked_read > 0", async () => {
    markBulkMock.mockResolvedValue(3);
    const { spy } = setup("post-abc");
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: ["strategy", "mentions", "unread"],
      })
    );
  });

  it("does NOT invalidate when marked_read = 0", async () => {
    markBulkMock.mockResolvedValue(0);
    const { spy } = setup("post-abc");
    await waitFor(() => expect(markBulkMock).toHaveBeenCalled());
    // Give the .then chain a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
  });

  it("swallows API errors silently (badge will self-correct on poll)", async () => {
    markBulkMock.mockRejectedValue(new Error("503"));
    const { spy } = setup("post-abc");
    await waitFor(() => expect(markBulkMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
  });
});
