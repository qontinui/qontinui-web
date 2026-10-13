/**
 * A chat session page keeps to its own run, driven through the REAL
 * `useChatWebSocket` over a fake WebSocket. Every chat socket of a device
 * receives the runner's chat frames (the backend relay cannot tell which one
 * asked), so another tab's session traffic arrives here too.
 *
 * Before: another tab's `chat_created` renamed this page's header and took
 * over where its next message went; another run's transcript replaced this
 * one's; this run's own refusals (an interrupt, a rename) were only logged;
 * and the page's load on mount was sent before its socket opened, so it was
 * dropped and the page never learned its session's state or transcript.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWN = "run-own";
const OTHER = "run-other";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "run-own" }),
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/lib/runner", () => ({
  RunnerApiError: class RunnerApiError extends Error {},
  runnerRequest: vi.fn(),
  targetRunnerId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  useRunnerTarget: () => ({ kind: "runner" }),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: { getWebSocketToken: async () => "test-token" },
}));

import ChatSessionPage from "./page";

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

function sessionState(run: string, state: string) {
  return {
    type: "chat_session_state",
    task_run_id: run,
    state,
    can_send: state === "ready",
    can_interrupt: state === "processing",
  };
}

function transcript(run: string, question: string, answer: string) {
  return {
    type: "chat_output",
    task_run_id: run,
    output_log: `\n[USER_MESSAGE]\n${question}\n[/USER_MESSAGE]\n${answer}\n`,
  };
}

/** Render the page for `run-own`, open its socket, and report it ready. */
async function renderReady(): Promise<FakeWebSocket> {
  render(<ChatSessionPage />);
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const ws = FakeWebSocket.instances[0];
  if (!ws) throw new Error("the page opened no socket");
  act(() => ws.open());
  ws.push(sessionState(OWN, "ready"));
  return ws;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  mocks.push.mockClear();
  mocks.toastError.mockClear();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chat session page", () => {
  it("loads its own session once the socket opens, then shows it", async () => {
    const ws = await renderReady();

    // The load was asked for on mount, before the socket was open.
    expect(ws.requests().slice(0, 2)).toEqual([
      { type: "chat_session_state", params: { task_run_id: OWN } },
      { type: "chat_get_output", params: { task_run_id: OWN } },
    ]);

    ws.push(transcript(OWN, "my question", "my answer"));
    expect(screen.getByText("my question")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type a message/)).not.toBeDisabled();
  });

  it("another tab's new session renames nothing and takes nothing over", async () => {
    const ws = await renderReady();

    ws.push({
      type: "chat_created",
      id: OTHER,
      task_name: "Their chat",
      state: "initializing",
    });

    expect(screen.queryByText("Their chat")).toBeNull();
    expect(screen.getByText("New Chat")).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(input, { target: { value: "follow-up" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ws.requests().find((r) => r.type === "chat_message")).toMatchObject({
      task_run_id: OWN,
      content: "follow-up",
    });
  });

  it("another run's transcript does not replace this one", async () => {
    const ws = await renderReady();
    ws.push(transcript(OWN, "my question", "my answer"));

    ws.push(transcript(OTHER, "their question", "their answer"));

    expect(screen.getByText("my question")).toBeInTheDocument();
    expect(screen.queryByText("their question")).toBeNull();
  });

  it("another run's close does not close this page's session", async () => {
    const ws = await renderReady();

    ws.push(sessionState(OTHER, "closed"));

    expect(screen.getByPlaceholderText(/Type a message/)).not.toBeDisabled();
  });

  it("shows this run's refusals, and not another run's", async () => {
    const ws = await renderReady();

    ws.push({
      type: "error",
      task_run_id: OTHER,
      error: "Interrupt failed: not running",
    });
    expect(mocks.toastError).not.toHaveBeenCalled();

    ws.push({
      type: "error",
      task_run_id: OWN,
      error: "Failed to rename session",
    });
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to rename session");
  });
});
