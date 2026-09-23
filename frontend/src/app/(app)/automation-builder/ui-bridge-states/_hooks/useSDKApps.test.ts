/**
 * useSDKApps names its runner by TARGET and goes through the resolver. The
 * relay carries none of the SDK routes, so for a runner on another machine
 * the hook must expose the typed "needs the runner on this machine" message
 * (`needsLocalError`) — not a toast that vanishes or a silent empty list —
 * and its snapshot recording must stop for good.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => relayFetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, info: vi.fn() },
}));

import type { RunnerTarget } from "@/lib/runner";
import { useSDKApps } from "./useSDKApps";

const RELAY_PATH_REFUSAL = {
  error:
    "this path is not carried by the HTTP relay — the relay serves a closed set of routes",
};

const remote: RunnerTarget = {
  kind: "runner",
  runner: { id: "remote-box", port: 9876, name: "Remote" },
  locality: "not_local",
};

let loopbackFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  relayFetch.mockReset();
  relayFetch.mockImplementation(
    async () =>
      new Response(JSON.stringify(RELAY_PATH_REFUSAL), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
  );
  toastError.mockReset();
  loopbackFetch = vi.fn();
  vi.stubGlobal("fetch", loopbackFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSDKApps over the relay", () => {
  it("exposes the typed needs-local message when a scan is refused", async () => {
    const { result } = renderHook(() => useSDKApps(remote));
    await act(async () => {
      await result.current.scanForApps();
    });

    expect(relayFetch.mock.calls[0]![0]).toBe(
      "https://api.test/api/v1/device-bridge/runner-proxy/ui-bridge/apps/scan"
    );
    expect(loopbackFetch).not.toHaveBeenCalled();
    expect(result.current.needsLocalError).toMatch(
      /needs the runner on this machine/
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("stops snapshot recording for good on the refusal", async () => {
    const { result } = renderHook(() => useSDKApps(remote));
    act(() => {
      result.current.startRecording();
    });

    await waitFor(() => expect(result.current.isRecording).toBe(false));
    expect(result.current.needsLocalError).toMatch(
      /needs the runner on this machine/
    );
    expect(relayFetch).toHaveBeenCalledTimes(1);
  });
});
