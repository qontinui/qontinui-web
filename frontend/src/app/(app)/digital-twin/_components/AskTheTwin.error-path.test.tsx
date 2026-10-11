/**
 * Ask the Twin's error paths, driven through the REAL `useChatWebSocket` over
 * a fake WebSocket. Each frame has the shape its emitter writes: the runner
 * (`backend_relay.rs`) or the backend (`runner_chat_ws.py`).
 *
 * Which runner frames reach the page is the backend relay's decision, not the
 * hook's. Its device socket forwards only the runner's `chat_response` frames
 * to chat sockets (`devices_ws.py` `_route_device_message`), so the runner's
 * `chat_created` / `chat_session_state` replies used below reach the page
 * only once that relay forwards them. The backend's own `error` frame does
 * reach it.
 *
 * Before this file, these failures were dropped on the page:
 *  - a refused spawn is `{ type: "chat_created", error }` with no id and no
 *    state (qontinui-runner `handle_chat_create`). The hook announced it as a
 *    created session, the question sat with no answer and no explanation, and
 *    a follow-up then waited forever on a `ready` that could not come
 *    ("Connecting to your runner…");
 *  - a session `error` state was set and never rendered — with the same hang
 *    for the next question;
 *  - the backend's `error` frame (it could not forward the request) was only
 *    logged.
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

vi.mock("@/contexts/active-runner-context", () => ({
  useDispatchTarget: () => ({
    runnerId: DESK,
    reason: "explicit",
    message: null,
  }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: { getWebSocketToken: async () => "test-token" },
}));

import { AskTheTwin } from "./AskTheTwin";

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
  /** A frame as the chat socket receives it. */
  push(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** Frames this client sent, minus keepalive pings. */
  requests(): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type !== "ping");
  }
}

/** Render, wait for the hook's socket, and open it. */
async function renderConnected(): Promise<FakeWebSocket> {
  render(<AskTheTwin />);
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const ws = FakeWebSocket.instances[0];
  if (!ws) throw new Error("the hook opened no socket");
  act(() => ws.open());
  return ws;
}

function ask(question: string) {
  fireEvent.change(
    screen.getByPlaceholderText("Ask a question about the digital twin…"),
    { target: { value: question } }
  );
  fireEvent.click(screen.getByRole("button", { name: /ask/i }));
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // The hook logs the failures it now also reports; keep the output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AskTheTwin error paths", () => {
  it("a refused spawn (chat_created with error) shows the runner's message and stops the spinner", async () => {
    const ws = await renderConnected();

    ask("Is coord's deployed commit live?");
    await waitFor(() => expect(ws.requests()).toHaveLength(1));
    expect(ws.requests()[0]).toMatchObject({ type: "chat_create" });

    act(() =>
      ws.push({
        type: "chat_created",
        error: "device_drained: this device is drained for new work",
      })
    );

    const alert = await screen.findByTestId("ask-the-twin-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain(
      "device_drained: this device is drained for new work"
    );
    expect(screen.queryByText("Connecting to your runner…")).toBeNull();
    // The question is still shown — it is the answer that failed.
    expect(screen.getByText("Is coord's deployed commit live?")).toBeTruthy();
  });

  it("a follow-up after a refusal starts a fresh session instead of hanging", async () => {
    const ws = await renderConnected();

    ask("first question");
    await waitFor(() => expect(ws.requests()).toHaveLength(1));
    act(() =>
      ws.push({ type: "chat_created", error: "spawn-authorization deny: no" })
    );
    await screen.findByTestId("ask-the-twin-error");

    ask("second question");

    // A second chat_create — never a chat_message to a session that does not
    // exist, and never a question parked behind "Connecting to your runner…".
    await waitFor(() => expect(ws.requests()).toHaveLength(2));
    expect(ws.requests()[1]).toMatchObject({ type: "chat_create" });
    expect(
      (ws.requests()[1]?.params as { prompt?: string } | undefined)?.prompt
    ).toContain("second question");
    expect(screen.queryByText("Connecting to your runner…")).toBeNull();
    // Asking again clears the old failure.
    expect(screen.queryByTestId("ask-the-twin-error")).toBeNull();
  });

  it("a session error state is rendered, and the next question starts a fresh session", async () => {
    const ws = await renderConnected();

    ask("which observers are blind?");
    await waitFor(() => expect(ws.requests()).toHaveLength(1));
    act(() =>
      ws.push({
        type: "chat_created",
        id: "run-1",
        task_name: "Digital Twin question",
        state: "initializing",
      })
    );
    act(() => ws.push({ type: "chat_session_state", state: "processing" }));
    expect(
      screen.getByText("Your runner’s agent is working on an answer…")
    ).toBeTruthy();

    act(() => ws.push({ type: "chat_session_state", state: "error" }));

    const alert = await screen.findByTestId("ask-the-twin-error");
    expect(alert.textContent).toContain(
      "The runner reported the session failed and gave no reason."
    );
    expect(
      screen.queryByText("Your runner’s agent is working on an answer…")
    ).toBeNull();

    ask("try again");
    await waitFor(() => expect(ws.requests()).toHaveLength(2));
    expect(ws.requests()[1]).toMatchObject({ type: "chat_create" });
  });

  it("a relay error frame (runner not connected) is shown, not only logged", async () => {
    const ws = await renderConnected();

    ask("anything");
    await waitFor(() => expect(ws.requests()).toHaveLength(1));
    // Backend `runner_chat_ws.py` when it cannot forward the request.
    act(() => ws.push({ type: "error", message: "Runner is not connected." }));

    const alert = await screen.findByTestId("ask-the-twin-error");
    expect(alert.textContent).toContain("Runner is not connected.");
  });

  it("says whether the twin's tools were used only as far as it can know", async () => {
    await renderConnected();

    expect(
      screen.getByText(
        /uses the twin’s tools only if the runner could provision them/
      )
    ).toBeTruthy();
  });
});
