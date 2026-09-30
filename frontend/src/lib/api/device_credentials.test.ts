/**
 * The device-credential client emits the routes the shared contract names:
 * target device in the PATH only, never in a body field; typed `detail.code`
 * surfaced on failure.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
}));

import {
  authorizeDeviceRedeem,
  DeviceCredentialApiError,
  getDeviceCredentialOverview,
  revokeDeviceMachineCredential,
} from "./device_credentials";

const DEVICE = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as unknown as Response;
}

function pathOf(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "");
}

describe("device_credentials client", () => {
  beforeEach(() => fetchMock.mockReset());

  it("reads the credential overview", async () => {
    fetchMock.mockResolvedValue(ok({ devices: [{ device_id: DEVICE }] }));
    const res = await getDeviceCredentialOverview();
    expect(pathOf(fetchMock.mock.calls[0][0])).toBe(
      "/api/v1/devices/credential-overview"
    );
    expect(res.devices).toHaveLength(1);
  });

  it("authorizes a redeem on the path-scoped route with no device in the body", async () => {
    fetchMock.mockResolvedValue(
      ok({ device_id: DEVICE, expires_at: "2026-09-30T12:30:00Z" }, 202)
    );
    const res = await authorizeDeviceRedeem(DEVICE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(pathOf(url)).toBe(`/api/v1/devices/${DEVICE}/authorize-redeem`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({});
    expect(res.expires_at).toBe("2026-09-30T12:30:00Z");
  });

  it("revokes on the machine-credential revoke route", async () => {
    fetchMock.mockResolvedValue(
      ok({ device_id: DEVICE, revoked_at: "2026-09-30T12:00:00Z" })
    );
    await revokeDeviceMachineCredential(DEVICE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(pathOf(url)).toBe(
      `/api/v1/devices/${DEVICE}/machine-credential/revoke`
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("surfaces the backend's typed detail.code on failure", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        detail: { code: "device_not_in_tenant", message: "Not your device." },
      }),
    } as unknown as Response);
    const err = await authorizeDeviceRedeem(DEVICE).catch((e) => e);
    expect(err).toBeInstanceOf(DeviceCredentialApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("device_not_in_tenant");
    expect(err.message).toBe("Not your device.");
  });
});
