/**
 * Asking the twin starts a NEW AI session — new work — so it goes only where
 * new work may go: the user's explicit choice or coord's `resolved` pick
 * (plan 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3).
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchTarget } from "@/contexts/active-runner-context";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  dispatch: null as unknown as DispatchTarget,
  wsRunnerIds: [] as Array<string | null>,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchTarget: () => state.dispatch,
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
vi.mock("@/hooks/useChatWebSocket", () => ({
  useChatWebSocket: ({ runnerId }: { runnerId: string | null }) => {
    state.wsRunnerIds.push(runnerId);
    return {
      isConnected: runnerId !== null,
      sessionState: "disconnected",
      messages: [],
      streamingContent: "",
      createSession: vi.fn(),
      sendMessage: vi.fn(),
    };
  },
}));

import { AskTheTwin } from "./AskTheTwin";

beforeEach(() => {
  state.wsRunnerIds = [];
});

describe("AskTheTwin runner", () => {
  it("coord named no runner (unavailable): no session channel, and the outcome is shown", () => {
    state.dispatch = {
      runnerId: null,
      reason: "resolver_unavailable",
      message: "Which runner should take new work is unknown.",
    };
    render(<AskTheTwin />);
    expect(state.wsRunnerIds.every((id) => id === null)).toBe(true);
    expect(screen.getByTestId("ask-the-twin-outcome").textContent).toBe(
      "Which runner should take new work is unknown."
    );
    expect(
      screen.queryByPlaceholderText("Ask a question about the digital twin…")
    ).toBeNull();
  });

  it("an explicit choice: the session channel opens to that runner", () => {
    state.dispatch = { runnerId: DESK, reason: "explicit", message: null };
    render(<AskTheTwin />);
    expect(state.wsRunnerIds.at(-1)).toBe(DESK);
    expect(
      screen.getByPlaceholderText("Ask a question about the digital twin…")
    ).toBeInTheDocument();
  });
});
