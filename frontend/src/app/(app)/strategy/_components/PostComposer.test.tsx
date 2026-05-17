import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const searchUsersMock = vi.fn();

vi.mock("@/lib/api/strategy", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/strategy")>(
      "@/lib/api/strategy"
    );
  return {
    ...actual,
    searchUsers: (...args: unknown[]) => searchUsersMock(...args),
  };
});

import { PostComposer } from "./PostComposer";

const UID = "33333333-4444-5555-6666-777777777777";

function renderComposer(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PostComposer onSubmit={onSubmit} />
    </QueryClientProvider>
  );
  return { onSubmit };
}

describe("<PostComposer>", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchUsersMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces /users/search and shows suggestions", async () => {
    searchUsersMock.mockResolvedValue([
      { id: UID, display: "alice", email: "a@x" },
    ]);
    renderComposer();
    const ta = screen.getByTestId(
      "post-composer-textarea"
    ) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi @al" } });

    // Before the 250ms tick, no call yet.
    expect(searchUsersMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(260);
    await waitFor(() => expect(searchUsersMock).toHaveBeenCalledTimes(1));
    expect(searchUsersMock).toHaveBeenCalledWith("al", 10);

    await waitFor(() =>
      expect(screen.getByTestId("mention-suggestions")).toBeInTheDocument()
    );
    expect(screen.getByText("@alice")).toBeInTheDocument();
  });

  it("inserts @[user_id:<uuid>] marker on selection", async () => {
    searchUsersMock.mockResolvedValue([
      { id: UID, display: "alice", email: "a@x" },
    ]);
    renderComposer();
    const ta = screen.getByTestId(
      "post-composer-textarea"
    ) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hi @al" } });
    vi.advanceTimersByTime(260);
    await waitFor(() =>
      expect(screen.getByTestId(`mention-option-${UID}`)).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId(`mention-option-${UID}`));

    await waitFor(() =>
      expect((ta as HTMLTextAreaElement).value).toBe(`hi @[user_id:${UID}] `)
    );
  });

  it("does not show suggestions before debounce window elapses", async () => {
    searchUsersMock.mockResolvedValue([
      { id: UID, display: "alice", email: "a@x" },
    ]);
    renderComposer();
    const ta = screen.getByTestId(
      "post-composer-textarea"
    ) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "@al" } });
    // Only 100ms — under the 250ms threshold
    vi.advanceTimersByTime(100);
    expect(searchUsersMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mention-suggestions")).not.toBeInTheDocument();
  });
});
