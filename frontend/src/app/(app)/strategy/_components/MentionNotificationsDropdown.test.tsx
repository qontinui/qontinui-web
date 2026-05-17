/**
 * MentionNotificationsDropdown tests (Phase 2.5).
 *
 * Verifies:
 *   1. Empty state renders when there are no unread mentions
 *   2. Up to 10 mentions render; overflow shown as a `+N more`
 *   3. Click on a mention calls `markMentionRead` AND navigates
 *      via `next/navigation` `useRouter().push`
 */

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const listUnreadMock = vi.fn();
const markReadMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@/lib/api/strategy", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/strategy")>(
      "@/lib/api/strategy"
    );
  return {
    ...actual,
    listUnreadMentions: (...args: unknown[]) => listUnreadMock(...args),
    markMentionRead: (...args: unknown[]) => markReadMock(...args),
  };
});

import { MentionNotificationsDropdown } from "./MentionNotificationsDropdown";

const ME = "11111111-1111-1111-1111-111111111111";

function mention(idx: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    mention_id: `m-${idx}`,
    post_id: `p-${idx}`,
    thread_id: `t-${idx}`,
    mentioned_user_id: ME,
    read_at: null,
    created_at: new Date(Date.now() - idx * 60_000).toISOString(),
    ...overrides,
  };
}

function renderDropdown({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MentionNotificationsDropdown defaultOpen={defaultOpen} />
    </QueryClientProvider>
  );
}

describe("<MentionNotificationsDropdown>", () => {
  beforeEach(() => {
    listUnreadMock.mockReset();
    markReadMock.mockReset();
    routerPushMock.mockReset();
  });

  it("renders the trigger without a badge when count = 0", async () => {
    listUnreadMock.mockResolvedValue([]);
    renderDropdown();

    await waitFor(() => expect(listUnreadMock).toHaveBeenCalled());
    expect(screen.getByTestId("mention-notifications-trigger")).toBeInTheDocument();
    expect(
      screen.queryByTestId("mention-notifications-badge")
    ).not.toBeInTheDocument();
  });

  it("renders a count badge when count > 0", async () => {
    listUnreadMock.mockResolvedValue([mention(1), mention(2), mention(3)]);
    renderDropdown();

    await waitFor(() => {
      const badge = screen.getByTestId("mention-notifications-badge");
      expect(badge.textContent).toBe("3");
    });
  });

  it("renders empty state inside the dropdown when count = 0", async () => {
    listUnreadMock.mockResolvedValue([]);
    renderDropdown({ defaultOpen: true });

    await waitFor(() => expect(listUnreadMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("mention-notifications-empty")).toBeInTheDocument();
    });
  });

  it("renders up to 10 mentions and an overflow row when count > 10", async () => {
    const mentions = Array.from({ length: 12 }, (_, i) => mention(i));
    listUnreadMock.mockResolvedValue(mentions);
    renderDropdown({ defaultOpen: true });

    await waitFor(() => {
      expect(screen.getByTestId("mention-notifications-list")).toBeInTheDocument();
    });
    // 10 visible rows.
    const items = screen.getAllByTestId(/^mention-notifications-item-m-\d+$/);
    expect(items).toHaveLength(10);
    // Overflow row visible.
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  it("calls markMentionRead AND router.push when a mention is clicked (enriched payload)", async () => {
    markReadMock.mockResolvedValue(undefined);
    listUnreadMock.mockResolvedValue([
      mention(1, {
        doc_name: "business-goals.md",
        post_excerpt: "hello @you",
        thread_title: "Goal: hire",
      }),
    ]);
    renderDropdown({ defaultOpen: true });

    await waitFor(() =>
      expect(screen.getByTestId("mention-notifications-list")).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("mention-notifications-item-m-1"));
    await waitFor(() => expect(markReadMock).toHaveBeenCalledWith("m-1"));
    expect(routerPushMock).toHaveBeenCalledTimes(1);
    const target = routerPushMock.mock.calls[0][0];
    expect(target).toContain("/strategy/business-goals.md");
    expect(target).toContain("post=p-1");
    expect(target).toContain("thread=t-1");
  });
});
