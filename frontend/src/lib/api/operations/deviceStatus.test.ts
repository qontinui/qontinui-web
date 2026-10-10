import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins `deviceStatus`'s two URLs: the RELATIVE REST read (a LITERAL, with the
 * caller's abort signal and no client retries) and the ABSOLUTE push-channel
 * URL against a mocked `NEXT_PUBLIC_API_URL`.
 */

const fetchMock = vi.fn();
const apiConfig = vi.hoisted(() => ({ API_BASE_URL: "http://localhost:8000" }));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

vi.mock("@/services/api-config", () => ({ ApiConfig: apiConfig }));

const { deviceStatusWsUrl, fetchDeviceStatusResponse } = await import(
  "./deviceStatus"
);

describe("deviceStatus", () => {
  afterEach(() => {
    fetchMock.mockReset();
    window.localStorage.clear();
  });

  it("fetchDeviceStatusResponse GETs /device-status with the caller's signal, no retries, and hands back the Response unread", async () => {
    const res = new Response('{"devices":[],"count":0}', { status: 200 });
    fetchMock.mockResolvedValueOnce(res);
    const controller = new AbortController();
    await expect(fetchDeviceStatusResponse(controller.signal)).resolves.toBe(
      res
    );
    expect(res.bodyUsed).toBe(false);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/device-status",
      {
        method: "GET",
        idempotent: true,
        maxRetries: 0,
        signal: controller.signal,
      },
    ]);
  });

  it("fetchDeviceStatusResponse resolves a non-2xx too: the caller checks ok", async () => {
    const res = new Response("down", { status: 502 });
    fetchMock.mockResolvedValueOnce(res);
    await expect(
      fetchDeviceStatusResponse(new AbortController().signal)
    ).resolves.toBe(res);
  });

  it("deviceStatusWsUrl translates http:// to ws:// and encodes the token", () => {
    window.localStorage.setItem("qontinui.active_tenant_id", "t-1");
    expect(deviceStatusWsUrl("x/y")).toBe(
      "ws://localhost:8000/api/v1/operations/device-status/ws?token=x%2Fy&active_tenant=t-1"
    );
  });
});
