/**
 * The recording socket (`recording:status` / `recording:stop`) is served by
 * the UI Bridge SDK's own server inside the SDK-enabled APP — not by the
 * runner, whose only sockets are `/ws/events` and `/ui-bridge/ws`. So the
 * indicator asks the active runner, ONLY when it is proven local, which app
 * it is connected to, and opens the socket to that app ONLY when the app's
 * URL is a loopback address. Anything else opens nothing and shows nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));

const runnerTargetMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/contexts/active-runner-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/contexts/active-runner-context")>();
  return {
    ...actual,
    useRunnerTarget: () => runnerTargetMock.current,
  };
});

import {
  RecordingIndicator,
  recordingSocketUrlFor,
} from "./RecordingIndicator";

const opened: string[] = [];
/** What the fake socket answers `recording:status` with (null = no answer). */
let socketStatus: Record<string, unknown> | null = null;

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    opened.push(url);
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    const msg = JSON.parse(raw);
    if (msg.type !== "recording:status" || socketStatus === null) return;
    queueMicrotask(() =>
      this.onmessage?.({
        data: JSON.stringify({
          type: "response",
          requestId: msg.id,
          payload: { success: true, data: socketStatus },
        }),
      })
    );
  }
  close() {}
}

let loopbackFetch: ReturnType<typeof vi.fn>;

function connections(list: unknown[]): Response {
  return new Response(JSON.stringify({ success: true, data: list }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function localRunner(port = 9901) {
  return {
    kind: "runner",
    runner: { id: "dev-local", port, name: "Local" },
    locality: "local",
  };
}

describe("<RecordingIndicator> transport", () => {
  beforeEach(() => {
    opened.length = 0;
    socketStatus = null;
    relayFetch.mockReset();
    loopbackFetch = vi.fn(async () =>
      connections([{ url: "http://127.0.0.1:3001", isActive: true }])
    );
    vi.stubGlobal("fetch", loopbackFetch);
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the recording socket of the app the proven-local runner is connected to — not the runner's port", async () => {
    runnerTargetMock.current = localRunner(9901);
    render(<RecordingIndicator />);

    await waitFor(() => expect(opened).toEqual(["ws://127.0.0.1:3001"]));
    expect(loopbackFetch.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:9901/ui-bridge/sdk/connections"
    );
    expect(opened.some((u) => u.includes(":9901"))).toBe(false);
  });

  it("shows the indicator while that app reports an active recording", async () => {
    runnerTargetMock.current = localRunner();
    socketStatus = {
      active: true,
      duration: 65_000,
      interactionCount: 3,
      captureCount: 1,
    };
    render(<RecordingIndicator />);

    expect(await screen.findByText("Recording")).toBeTruthy();
    expect(screen.getByText("1:05")).toBeTruthy();
  });

  it("opens nothing when the connected app's URL is not a loopback address", async () => {
    loopbackFetch.mockImplementation(async () =>
      connections([{ url: "http://10.0.0.5:3001", isActive: true }])
    );
    runnerTargetMock.current = localRunner();
    render(<RecordingIndicator />);

    await waitFor(() => expect(loopbackFetch).toHaveBeenCalled());
    await Promise.resolve();
    expect(opened).toEqual([]);
  });

  it("opens nothing when the runner has no connected app", async () => {
    loopbackFetch.mockImplementation(async () => connections([]));
    runnerTargetMock.current = localRunner();
    const { container } = render(<RecordingIndicator />);

    await waitFor(() => expect(loopbackFetch).toHaveBeenCalled());
    expect(opened).toEqual([]);
    expect(container.textContent).toBe("");
  });

  it("asks nothing and opens nothing for a runner on another machine", async () => {
    runnerTargetMock.current = {
      kind: "runner",
      runner: { id: "remote-box", port: 9876, name: "Remote" },
      locality: "not_local",
    };
    const { container } = render(<RecordingIndicator />);
    // Long enough for a poll that should not exist to have asked something.
    await new Promise((r) => setTimeout(r, 50));
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(relayFetch).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
    expect(container.textContent).toBe("");
  });

  it("asks nothing and opens nothing while the runner's locality is unknown", async () => {
    runnerTargetMock.current = { kind: "pending" };
    render(<RecordingIndicator />);
    await new Promise((r) => setTimeout(r, 50));
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(relayFetch).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
  });
});

describe("recordingSocketUrlFor", () => {
  it("maps a loopback app URL to its socket", () => {
    expect(recordingSocketUrlFor("http://127.0.0.1:3001")).toBe(
      "ws://127.0.0.1:3001"
    );
    expect(recordingSocketUrlFor("http://localhost:5173/app")).toBe(
      "ws://localhost:5173"
    );
    expect(recordingSocketUrlFor("https://[::1]:8443")).toBe(
      "wss://[::1]:8443"
    );
  });

  it("refuses anything that is not a loopback http(s) URL", () => {
    expect(recordingSocketUrlFor("http://10.0.0.5:3001")).toBeNull();
    expect(recordingSocketUrlFor("http://build-box.lan:3001")).toBeNull();
    expect(recordingSocketUrlFor("file:///tmp/x")).toBeNull();
    expect(recordingSocketUrlFor("not a url")).toBeNull();
  });
});
