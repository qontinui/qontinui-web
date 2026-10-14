/**
 * Ask the Twin's handed-over draft: the sub-space drawer's "Ask the Twin about
 * this" passes a question through the page, and the box must TYPE it in (and
 * focus it) without asking it — the operator reviews and submits.
 *
 * The chat socket is not under test here, so `useChatWebSocket` is stubbed to
 * a connected, idle session; `createSession` / `sendMessage` are spies that
 * prove nothing was asked.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.hoisted(() => ({
  createSession: vi.fn(),
  sendMessage: vi.fn(),
  runnerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
}));

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchTarget: () => ({
    runnerId: chat.runnerId,
    reason: "explicit",
    message: "No runner is connected.",
  }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
vi.mock("@/hooks/useChatWebSocket", () => ({
  useChatWebSocket: () => ({
    isConnected: true,
    sessionState: "disconnected",
    sessionError: null,
    messages: [],
    streamingContent: "",
    createSession: chat.createSession,
    sendMessage: chat.sendMessage,
  }),
}));

import { AskTheTwin } from "./AskTheTwin";

const PLACEHOLDER = "Ask a question about the digital twin…";

beforeEach(() => {
  chat.createSession.mockReset();
  chat.sendMessage.mockReset();
  chat.runnerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
});

describe("AskTheTwin draft", () => {
  it("types a handed-over question into the box, focuses it and does not ask it", async () => {
    const applied = vi.fn();
    render(
      <AskTheTwin draft="What do the gates observe?" onDraftApplied={applied} />
    );

    const box = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("What do the gates observe?"));
    expect(document.activeElement).toBe(box);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(chat.createSession).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("replaces what was typed when a new draft arrives, and leaves it when the draft clears", async () => {
    const { rerender } = render(<AskTheTwin draft="first" />);
    const box = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("first"));

    rerender(<AskTheTwin draft={null} />);
    expect(box.value).toBe("first");

    rerender(<AskTheTwin draft="second" />);
    await waitFor(() => expect(box.value).toBe("second"));
  });

  it("renders an empty box with no draft", () => {
    render(<AskTheTwin />);
    expect(
      (screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement).value
    ).toBe("");
  });

  it("keeps and shows a handed-over question while no runner can take it", async () => {
    chat.runnerId = null;
    const applied = vi.fn();
    render(
      <AskTheTwin draft="What do the gates observe?" onDraftApplied={applied} />
    );

    expect(
      (await screen.findByTestId("ask-the-twin-kept-question")).textContent
    ).toContain("What do the gates observe?");
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus later when a runner connects after the draft", async () => {
    chat.runnerId = null;
    const { rerender } = render(<AskTheTwin draft="later" />);
    await screen.findByTestId("ask-the-twin-kept-question");
    rerender(<AskTheTwin draft={null} />);

    chat.runnerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    rerender(<AskTheTwin draft={null} />);
    const box = screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement;
    expect(box.value).toBe("later");
    expect(document.activeElement).not.toBe(box);
  });
});
