/**
 * useSecretsBrokerDevice — what is shown comes from a READ.
 *
 * Pins the honesty properties the hook documents: a write shows the backend's
 * re-read (not the requested device), a missing re-read is UNKNOWN and keeps
 * the last confirmed device, a lost answer (504) is UNKNOWN rather than a
 * failure, a typed refusal is said in operator words, and a read that began
 * before a landed write is discarded.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();
const toastError = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method ?? "GET";
      const body = JSON.parse(init.body ?? "null");
      let out: unknown;
      if (method === "GET") out = await getMock(url);
      else if (method === "PUT") out = await putMock(url, body);
      else throw new Error(`fetch mock: unexpected ${method} ${url}`);
      return out instanceof Response
        ? out
        : new Response(JSON.stringify(out ?? null));
    },
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
    warning: vi.fn(),
  },
}));

import {
  describeBrokerDeviceRefusal,
  useSecretsBrokerDevice,
} from "./useSecretsBrokerDevice";

const API = "/api/v1/operations/secrets-broker/device";
const DEVICE = "5b0e8f2a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER = "0f8c2b1e-4d3a-4b5c-9e6f-7a8b9c0d1e2f";

const view = (deviceId: string | null, reported = true) => ({
  device_id: deviceId,
  reported,
  effective_level: "on",
  master_enabled: true,
  resolved_scope: "tenant",
  can_edit: true,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSecretsBrokerDevice", () => {
  it("sends the device and shows coord's re-read", async () => {
    getMock.mockResolvedValueOnce(view(DEVICE));
    const { result } = renderHook(() => useSecretsBrokerDevice());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMock).toHaveBeenCalledWith(API);

    putMock.mockResolvedValueOnce({
      ok: true,
      written_device_id: OTHER,
      versioned: true,
      version: 2,
      updated_by: "operator",
      effective: view(OTHER),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setBrokerDevice(OTHER);
    });

    expect(putMock).toHaveBeenCalledWith(API, {
      device_id: OTHER,
    });
    expect(result.current.device?.device_id).toBe(OTHER);
    expect(result.current.readbackError).toBeNull();
  });

  it("clears with an explicit null", async () => {
    getMock.mockResolvedValueOnce(view(DEVICE));
    const { result } = renderHook(() => useSecretsBrokerDevice());
    await waitFor(() => expect(result.current.loading).toBe(false));

    putMock.mockResolvedValueOnce({
      ok: true,
      written_device_id: null,
      versioned: true,
      version: 3,
      updated_by: "operator",
      effective: view(null),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setBrokerDevice(null);
    });

    expect(putMock).toHaveBeenCalledWith(API, {
      device_id: null,
    });
    expect(result.current.device?.device_id).toBeNull();
    expect(result.current.device?.reported).toBe(true);
  });

  it("keeps the last confirmed device when the re-read is missing", async () => {
    getMock.mockResolvedValueOnce(view(DEVICE));
    const { result } = renderHook(() => useSecretsBrokerDevice());
    await waitFor(() => expect(result.current.loading).toBe(false));

    putMock.mockResolvedValueOnce({
      ok: true,
      written_device_id: OTHER,
      versioned: true,
      version: 2,
      updated_by: "operator",
      effective: null,
      readback_error: "read-back failed: coord returned 500",
    });
    await act(async () => {
      await result.current.setBrokerDevice(OTHER);
    });

    // NOT painted as the requested device.
    expect(result.current.device?.device_id).toBe(DEVICE);
    expect(result.current.readbackError).toMatch(/read-back failed/);
  });

  it("treats a lost answer (504) as UNKNOWN, not as a failed write", async () => {
    getMock.mockResolvedValueOnce(view(DEVICE));
    const { result } = renderHook(() => useSecretsBrokerDevice());
    await waitFor(() => expect(result.current.loading).toBe(false));

    putMock.mockResolvedValueOnce(
      new Response('{"detail":"timeout waiting for coord"}', { status: 504 })
    );
    let ok = true;
    await act(async () => {
      ok = await result.current.setBrokerDevice(OTHER);
    });

    expect(ok).toBe(false);
    expect(result.current.device?.device_id).toBe(DEVICE);
    expect(result.current.readbackError).toMatch(/unknown/);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says a typed refusal in operator words", async () => {
    getMock.mockResolvedValueOnce(view(DEVICE));
    const { result } = renderHook(() => useSecretsBrokerDevice());
    await waitFor(() => expect(result.current.loading).toBe(false));

    putMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          detail: {
            error: "device_not_in_tenant",
            code: "device_not_in_tenant",
          },
        }),
        { status: 422 }
      )
    );
    await act(async () => {
      await result.current.setBrokerDevice(OTHER);
    });

    expect(result.current.readbackError).toBeNull();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringMatching(/not bound to this tenant/)
    );
  });

  it("keeps the last known device when a refresh fails", async () => {
    getMock.mockResolvedValueOnce(view(DEVICE));
    const { result } = renderHook(() => useSecretsBrokerDevice());
    await waitFor(() => expect(result.current.loading).toBe(false));

    getMock.mockRejectedValueOnce(new Error("HTTP 502"));
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.device?.device_id).toBe(DEVICE);
    expect(result.current.error).toBe("HTTP 502");
  });

  it("discards a read that began before a landed write", async () => {
    getMock.mockResolvedValueOnce(view(DEVICE));
    const { result } = renderHook(() => useSecretsBrokerDevice());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const slowRead = deferred<ReturnType<typeof view>>();
    getMock.mockReturnValueOnce(slowRead.promise);
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.reload();
    });

    putMock.mockResolvedValueOnce({
      ok: true,
      written_device_id: OTHER,
      versioned: true,
      version: 2,
      updated_by: "operator",
      effective: view(OTHER),
      readback_error: null,
    });
    await act(async () => {
      await result.current.setBrokerDevice(OTHER);
    });

    await act(async () => {
      slowRead.resolve(view(DEVICE));
      await refresh;
    });

    expect(result.current.device?.device_id).toBe(OTHER);
  });
});

describe("describeBrokerDeviceRefusal", () => {
  it("names a coord that does not serve the device route yet", () => {
    expect(
      describeBrokerDeviceRefusal(
        'failed: 502 - {"detail":{"code":"coord_secrets_broker_device_route_missing"}}'
      )
    ).toMatch(/does not serve/);
  });

  it("passes an unrecognised message through unchanged", () => {
    expect(describeBrokerDeviceRefusal("PUT x failed: 500 - boom")).toBe(
      "PUT x failed: 500 - boom"
    );
  });

  it("names the column-not-present window", () => {
    expect(
      describeBrokerDeviceRefusal(
        'failed: 503 - {"error":"column_not_present"}'
      )
    ).toMatch(/broker-device column/);
  });
});
