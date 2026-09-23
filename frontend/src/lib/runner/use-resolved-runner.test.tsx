/**
 * `useResolvedRunner` and the resolve client (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3).
 *
 * The web backend's `POST /api/v1/devices/resolve` is stubbed at the app's
 * `httpClient`. What is pinned:
 *
 * - the body is coord's, with no `user_id` in it;
 * - each outcome becomes its typed state, and anything else is UNKNOWN;
 * - a backend that cannot be reached is `unavailable`, never a device;
 * - `lastResolvedDeviceId` survives an outage and is cleared only when coord
 *   answers that nothing is eligible.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => backend.fetch(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "https://api.test" },
}));

import {
  deviceResolveBody,
  parseDeviceResolve,
  requestDeviceResolve,
} from "./resolve";
import { useResolvedRunner } from "./use-resolved-runner";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resolved(deviceId: string, via = "pool") {
  return {
    outcome: "resolved",
    device_id: deviceId,
    via,
    pin_released_reason: null,
    pin_released_detail: null,
  };
}

beforeEach(() => {
  backend.fetch.mockReset();
});

describe("resolve client", () => {
  it("posts coord's body — capabilities, work class, pin — and never a user_id", async () => {
    backend.fetch.mockResolvedValue(json(resolved(A, "pin")));
    const state = await requestDeviceResolve({
      capabilities: ["os:linux"],
      workClass: "machine_bound",
      preferred: A,
    });

    expect(state).toEqual({
      status: "resolved",
      deviceId: A,
      via: "pin",
      pinReleased: null,
    });
    const [url, init] = backend.fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/devices/resolve");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      required_capabilities: ["os:linux"],
      work_class: "machine_bound",
      preferred_device: A,
    });
    expect(body).not.toHaveProperty("user_id");
  });

  it("leaves an absent pin out of the body", () => {
    expect(
      deviceResolveBody({ capabilities: [], workClass: "placeable" })
    ).toEqual({ required_capabilities: [], work_class: "placeable" });
  });

  it.each([
    [
      {
        outcome: "resolved",
        device_id: B,
        via: "pool",
        pin_released_reason: "offline",
        pin_released_detail: "stale heartbeat",
      },
      {
        status: "resolved",
        deviceId: B,
        via: "pool",
        pinReleased: { reason: "offline", detail: "stale heartbeat" },
      },
    ],
    [
      {
        outcome: "pin_ineligible",
        device_id: A,
        reason: "missing_capabilities",
        detail: "no pwsh",
        missing_capabilities: ["shell:powershell"],
      },
      {
        status: "pin_ineligible",
        deviceId: A,
        reason: "missing_capabilities",
        detail: "no pwsh",
        missingCapabilities: ["shell:powershell"],
      },
    ],
    [
      {
        outcome: "no_capable_device",
        missing: ["os:windows"],
        online_devices: 1,
        pin_released_reason: null,
        pin_released_detail: null,
      },
      {
        status: "no_capable",
        missing: ["os:windows"],
        onlineDevices: 1,
        pinReleased: null,
      },
    ],
    [
      { outcome: "all_capable_drained", pin_released_reason: null },
      { status: "all_drained", pinReleased: null },
    ],
    [{ outcome: "drain_unreadable" }, { status: "drain_unreadable" }],
    [
      {
        outcome: "unavailable",
        reason: "not_deployed",
        status: 404,
        code: null,
      },
      {
        status: "unavailable",
        reason: "not_deployed",
        httpStatus: 404,
        code: null,
      },
    ],
  ])("parses %o", (body, expected) => {
    expect(parseDeviceResolve(body)).toEqual(expected);
  });

  it.each([
    [{ outcome: "resolved", device_id: A }],
    [{ outcome: "teleported" }],
    [null],
    ["resolved"],
  ])("anything off-contract is UNKNOWN, never a device: %o", (body) => {
    expect(parseDeviceResolve(body)).toMatchObject({
      status: "unavailable",
      reason: "malformed_response",
    });
  });

  it("a backend that cannot be reached is unavailable", async () => {
    backend.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      requestDeviceResolve({ capabilities: [], workClass: "placeable" })
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "backend_unreachable",
    });
  });

  it("a backend error status is unavailable", async () => {
    backend.fetch.mockResolvedValue(json({ detail: "boom" }, 500));
    await expect(
      requestDeviceResolve({ capabilities: [], workClass: "placeable" })
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "backend_error",
      httpStatus: 500,
    });
  });
});

describe("useResolvedRunner", () => {
  it("starts loading, then reports coord's answer", async () => {
    backend.fetch.mockResolvedValue(json(resolved(A)));
    const { result } = renderHook(() =>
      useResolvedRunner({ capabilities: [], workClass: "placeable" })
    );
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "resolved",
        deviceId: A,
      })
    );
    expect(result.current.lastResolvedDeviceId).toBe(A);
  });

  it("keeps the last resolved device across an outage", async () => {
    backend.fetch.mockResolvedValueOnce(json(resolved(A)));
    const { result } = renderHook(() =>
      useResolvedRunner({ capabilities: [], workClass: "placeable" })
    );
    await waitFor(() => expect(result.current.lastResolvedDeviceId).toBe(A));

    backend.fetch.mockResolvedValueOnce(
      json({ outcome: "unavailable", reason: "coord_unreachable" })
    );
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: "unavailable" })
    );
    expect(result.current.lastResolvedDeviceId).toBe(A);
  });

  it("drops the last resolved device when coord says nothing is eligible", async () => {
    backend.fetch.mockResolvedValueOnce(json(resolved(A)));
    const { result } = renderHook(() =>
      useResolvedRunner({ capabilities: [], workClass: "placeable" })
    );
    await waitFor(() => expect(result.current.lastResolvedDeviceId).toBe(A));

    backend.fetch.mockResolvedValueOnce(
      json({ outcome: "all_capable_drained", pin_released_reason: null })
    );
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "all_drained",
        pinReleased: null,
      })
    );
    expect(result.current.lastResolvedDeviceId).toBeNull();
  });

  it("re-asks when the pin or refreshKey changes, and asks nothing while disabled", async () => {
    backend.fetch.mockResolvedValue(json(resolved(A)));
    const { rerender } = renderHook(
      (props: { preferred: string | null; enabled: boolean; key: string }) =>
        useResolvedRunner({
          capabilities: [],
          workClass: "placeable",
          preferred: props.preferred,
          enabled: props.enabled,
          refreshKey: props.key,
        }),
      { initialProps: { preferred: null, enabled: false, key: "x" } }
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(backend.fetch).not.toHaveBeenCalled();

    rerender({ preferred: null, enabled: true, key: "x" });
    await waitFor(() => expect(backend.fetch).toHaveBeenCalledTimes(1));
    rerender({ preferred: B, enabled: true, key: "x" });
    await waitFor(() => expect(backend.fetch).toHaveBeenCalledTimes(2));
    const lastBody = JSON.parse(
      String((backend.fetch.mock.calls[1]![1] as RequestInit).body)
    );
    expect(lastBody.preferred_device).toBe(B);
    rerender({ preferred: B, enabled: true, key: "y" });
    await waitFor(() => expect(backend.fetch).toHaveBeenCalledTimes(3));
  });

  it("a different capability requirement starts over: loading, no last device", async () => {
    backend.fetch.mockResolvedValueOnce(json(resolved(A)));
    const { result, rerender } = renderHook(
      (caps: string[]) =>
        useResolvedRunner({ capabilities: caps, workClass: "placeable" }),
      { initialProps: [] as string[] }
    );
    await waitFor(() => expect(result.current.lastResolvedDeviceId).toBe(A));

    backend.fetch.mockImplementation(() => new Promise(() => {}));
    rerender(["os:windows"]);
    expect(result.current.state).toEqual({ status: "loading" });
    expect(result.current.lastResolvedDeviceId).toBeNull();
  });
});
