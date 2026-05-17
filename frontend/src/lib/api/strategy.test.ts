import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listThreads,
  listUnreadMentions,
  type StrategyMention,
  type StrategyThread,
} from "./strategy";

/**
 * Regression: coord (Phase 2.2 `list_threads` / `list_unread_mentions`)
 * returns `{items: [...]}`, NOT `{threads: [...]}` / `{mentions: [...]}`.
 * Earlier shape assumption silently produced empty lists in the live
 * CommentsPanel and MentionNotificationsDropdown (`unwrap` returned the
 * server payload, but `body.threads` was undefined → CommentsPanel
 * showed "No threads yet" with the data sitting right there).
 */
describe("strategy api — list-shape tolerance", () => {
  const sampleThread: StrategyThread = {
    thread_id: "019e34ac-7325-7d31-a344-e4349f6cb6e6",
    doc_id: "ee6f4f75-177f-437d-9a74-9e2e68c6c4ae",
    title: "smoke thread A",
    anchor: null,
    created_by: "301df86c-3e75-49f9-a667-c15d4cd2ec4b",
    created_at: "2026-05-17T06:42:57.445344Z",
    resolved_at: null,
    resolved_by: null,
    post_count: 1,
  };
  const sampleMention: StrategyMention = {
    mention_id: "019e34ac-7395-71c2-99df-f2ce8b94c39d",
    post_id: "019e34ac-7394-7df3-b337-facca417c809",
    thread_id: "019e34ac-7325-7d31-a344-e4349f6cb6e6",
    mentioned_user_id: "e6b06ccb-dbaf-4f7d-95ff-76ff2893b5dd",
    created_at: "2026-05-17T06:42:57.556205Z",
    read_at: null,
  };

  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(body: unknown) {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  describe("listThreads", () => {
    it("unwraps coord's live shape {items: [...], next_before: null}", async () => {
      mockFetch({ items: [sampleThread], next_before: null });
      const result = await listThreads("README.md");
      expect(result).toEqual([sampleThread]);
    });

    it("tolerates legacy {threads: [...]} shape", async () => {
      mockFetch({ threads: [sampleThread] });
      const result = await listThreads("README.md");
      expect(result).toEqual([sampleThread]);
    });

    it("tolerates bare array shape", async () => {
      mockFetch([sampleThread]);
      const result = await listThreads("README.md");
      expect(result).toEqual([sampleThread]);
    });

    it("returns empty list on coord's empty {items: []}", async () => {
      mockFetch({ items: [], next_before: null });
      const result = await listThreads("README.md");
      expect(result).toEqual([]);
    });
  });

  describe("listUnreadMentions", () => {
    it("unwraps coord's live {items: [...]} shape", async () => {
      mockFetch({ items: [sampleMention] });
      const result = await listUnreadMentions();
      expect(result).toEqual([sampleMention]);
    });

    it("tolerates legacy {mentions: [...]} shape", async () => {
      mockFetch({ mentions: [sampleMention] });
      const result = await listUnreadMentions();
      expect(result).toEqual([sampleMention]);
    });

    it("tolerates bare array shape", async () => {
      mockFetch([sampleMention]);
      const result = await listUnreadMentions();
      expect(result).toEqual([sampleMention]);
    });

    it("returns empty list on coord's empty {items: []}", async () => {
      mockFetch({ items: [] });
      const result = await listUnreadMentions();
      expect(result).toEqual([]);
    });
  });
});
