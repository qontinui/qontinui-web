/**
 * What the chat page does with the answer to its "New Chat", driven through
 * the REAL `useChatWebSocket` over a fake WebSocket. The runner's replies
 * reach every chat socket of the device (the backend relay cannot tell which
 * one asked), and a refused spawn is `{ type: "chat_created", error }` with no
 * id (qontinui-runner `backend_relay.rs` `handle_chat_create`).
 *
 * Before: the refusal routed the page to `/chat/undefined`, and so did every
 * other open chat page of the device; another tab's session was opened as
 * this page's own; and a create the relay could not forward spun for 15 s and
 * reset with no reason given.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DESK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchTarget: () => ({
    runnerId: DESK,
    reason: "resolved",
    message: null,
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/hooks/usePageSpecs", () => ({ usePageSpecs: () => {} }));
vi.mock("@/lib/ui-bridge/use-discovered-specs", () => ({
  useDiscoveredSpec: () => null,
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: { getWebSocketToken: async () => "test-token" },
}));

import ChatPage from "./page";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  push(frame: Record<string, unknown>) {
    act(() => this.onmessage?.({ data: JSON.stringify(frame) }));
  }
  requests(): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type !== "ping");
  }
}

async function renderConnected(): Promise<FakeWebSocket> {
  render(<ChatPage />);
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const ws = FakeWebSocket.instances[0];
  if (!ws) throw new Error("the page opened no socket");
  act(() => ws.open());
  return ws;
}

function newChatButton(): HTMLButtonElement {
  return document.getElementById("chat-new-btn") as HTMLButtonElement;
}

function startNewChat(ws: FakeWebSocket) {
  fireEvent.click(newChatButton());
  expect(ws.requests().map((r) => r.type)).toEqual(["chat_create"]);
  // Waiting: both create buttons spin and are disabled.
  expect(newChatButton().disabled).toBe(true);
}

/** The wait ended: no spinner, and a new chat can be started again. */
function expectWaitEnded() {
  expect(newChatButton().disabled).toBe(false);
  expect(
    screen.getByRole("button", { name: /start new chat/i })
  ).not.toBeDisabled();
  expect(document.querySelector(".animate-spin")).toBeNull();
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  nav.push.mockClear();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("New Chat outcomes", () => {
  it("a refused spawn ends the wait, says why, and navigates nowhere", async () => {
    const ws = await renderConnected();
    startNewChat(ws);

    ws.push({
      type: "chat_created",
      error: "device_drained: this device is drained for new work",
    });

    const reason = document.getElementById("chat-create-error");
    expect(reason?.getAttribute("role")).toBe("alert");
    expect(reason?.textContent).toBe(
      "device_drained: this device is drained for new work"
    );
    expectWaitEnded();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("the relay's own error (runner not connected) ends the wait and says why", async () => {
    const ws = await renderConnected();
    startNewChat(ws);

    // Backend `runner_chat_ws.py` when it cannot forward the request.
    ws.push({ type: "error", message: "Runner is not connected." });

    expect(document.getElementById("chat-create-error")?.textContent).toBe(
      "Runner is not connected."
    );
    expectWaitEnded();
  });

  it("trying again clears the previous reason", async () => {
    const ws = await renderConnected();
    startNewChat(ws);
    ws.push({ type: "chat_created", error: "spawn-authorization deny: no" });
    expect(document.getElementById("chat-create-error")).not.toBeNull();

    fireEvent.click(newChatButton());

    expect(document.getElementById("chat-create-error")).toBeNull();
    expect(newChatButton().disabled).toBe(true);
  });

  it("a session another tab created is not opened here", async () => {
    const ws = await renderConnected();

    ws.push({
      type: "chat_created",
      id: "run-other",
      task_name: "New Chat",
      state: "initializing",
    });

    expect(nav.push).not.toHaveBeenCalled();
  });

  it("its own session is opened, once", async () => {
    const ws = await renderConnected();
    startNewChat(ws);

    ws.push({
      type: "chat_created",
      id: "run-own",
      task_name: "New Chat",
      state: "initializing",
    });
    ws.push({
      type: "chat_created",
      id: "run-other",
      task_name: "New Chat",
      state: "initializing",
    });

    expect(nav.push.mock.calls).toEqual([["/chat/run-own"]]);
  });
});
