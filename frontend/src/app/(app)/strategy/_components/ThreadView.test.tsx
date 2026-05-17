import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getThreadMock = vi.fn();
const createPostMock = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/strategy", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/strategy")>(
      "@/lib/api/strategy"
    );
  return {
    ...actual,
    getThread: (...args: unknown[]) => getThreadMock(...args),
    createPost: (...args: unknown[]) => createPostMock(...args),
    lookupUsers: vi.fn().mockResolvedValue([]),
  };
});

import { ThreadView } from "./ThreadView";

const ME = "11111111-1111-1111-1111-111111111111";
const THREAD = "tttttttt-tttt-tttt-tttt-tttttttttttt";
const POST_1 = "pppppppp-pppp-pppp-pppp-pppppppppppp";

const seed = {
  thread: {
    thread_id: THREAD,
    doc_id: "doc1",
    title: "Test thread",
    anchor: null,
    created_by: ME,
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null,
  },
  posts: [
    {
      post_id: POST_1,
      thread_id: THREAD,
      parent_post_id: null,
      author_id: ME,
      body_markdown: "first post body",
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
    },
  ],
};

function renderView() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ThreadView threadId={THREAD} currentUserId={ME} />
    </QueryClientProvider>
  );
}

describe("<ThreadView> optimistic reply", () => {
  beforeEach(() => {
    getThreadMock.mockReset();
    createPostMock.mockReset();
    getThreadMock.mockResolvedValue(seed);
  });

  it("rolls back optimistic post on server error", async () => {
    createPostMock.mockRejectedValue(new Error("kaboom"));
    renderView();

    await waitFor(() =>
      expect(screen.getByText("first post body")).toBeInTheDocument()
    );

    const ta = screen.getByTestId("post-composer-textarea");
    fireEvent.change(ta, { target: { value: "OPTIMISTIC REPLY" } });
    fireEvent.click(screen.getByTestId("post-composer-submit"));

    // Optimistic placeholder appears synchronously.
    await waitFor(() =>
      expect(screen.getByText("OPTIMISTIC REPLY")).toBeInTheDocument()
    );

    // Then rolls back when the mutation rejects.
    await waitFor(() =>
      expect(screen.queryByText("OPTIMISTIC REPLY")).not.toBeInTheDocument()
    );

    // First post still there.
    expect(screen.getByText("first post body")).toBeInTheDocument();
  });
});
