/**
 * Creating a chat is NEW work — a new AI session — so it goes only where new
 * work may go (plan 2026-09-20-runner-selector-drives-a-transport-not-a-target,
 * Phase 3): the user's explicit choice or coord's `resolved` pick. When coord
 * named no runner (drained, none capable, resolver UNKNOWN) the page shows
 * coord's outcome and cannot create a session — even though the READ target
 * would keep a runner for library/results reads.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchTarget } from "@/contexts/active-runner-context";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  dispatch: null as unknown as DispatchTarget,
  wsRunnerIds: [] as Array<string | null>,
  createSession: vi.fn(() => true),
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchTarget: () => state.dispatch,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/usePageSpecs", () => ({ usePageSpecs: () => {} }));
vi.mock("@/lib/ui-bridge/use-discovered-specs", () => ({
  useDiscoveredSpec: () => null,
}));
vi.mock("@/hooks/useChatWebSocket", () => ({
  useChatWebSocket: ({ runnerId }: { runnerId: string | null }) => {
    state.wsRunnerIds.push(runnerId);
    return {
      createSession: state.createSession,
      // Connected whenever a runner id was handed over.
      isConnected: runnerId !== null,
    };
  },
}));

import ChatPage from "./page";

beforeEach(() => {
  state.wsRunnerIds = [];
  state.createSession.mockClear();
});

describe("New chat goes only where new work may go", () => {
  it("coord says all runners are drained: no session can be created, and the outcome is shown", () => {
    state.dispatch = {
      runnerId: null,
      reason: "all_drained",
      message:
        "All your runners are drained — taken out of service for new work.",
    };
    render(<ChatPage />);

    const button = document.getElementById("chat-new-btn") as HTMLButtonElement;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(state.createSession).not.toHaveBeenCalled();
    expect(state.wsRunnerIds.every((id) => id === null)).toBe(true);
    expect(
      screen.getByText(
        "All your runners are drained — taken out of service for new work."
      )
    ).toBeInTheDocument();
  });

  it("a runner coord resolved: the session is created on it", () => {
    state.dispatch = { runnerId: DESK, reason: "resolved", message: null };
    render(<ChatPage />);

    fireEvent.click(
      document.getElementById("chat-new-btn") as HTMLButtonElement
    );
    expect(state.createSession).toHaveBeenCalledTimes(1);
    expect(state.wsRunnerIds.at(-1)).toBe(DESK);
  });
});
