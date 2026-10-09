import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins `fetchDeviceResourceSamples`' exact request: the literal RELATIVE URL
 * with the device id encoded, and the `httpClient.fetch` options (method,
 * idempotent, `maxRetries: 0` for a poll).
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { fetchDeviceResourceSamples } = await import("./coordRunnerWindDown");

const DEVICE = "dev/1 #a";
const DEVICE_ENCODED = "dev%2F1%20%23a";

describe("coordRunnerWindDown", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchDeviceResourceSamples GETs the encoded device's latest sample, one attempt", async () => {
    const body = { latest: [], count: 0 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(fetchDeviceResourceSamples(DEVICE)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/fleet/resource-samples?device_id=${DEVICE_ENCODED}&history=false`,
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("rejects a non-2xx in the `<METHOD> <url> failed: <status> - <body>` shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"deadline"}', { status: 503 })
    );
    const err = await fetchDeviceResourceSamples(DEVICE).catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(503);
    expect(httpBodyOf(err)).toBe('{"error":"deadline"}');
  });
});
