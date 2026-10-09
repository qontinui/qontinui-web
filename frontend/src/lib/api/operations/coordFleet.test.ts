import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins `fetchFleetHealth`'s exact request — the RELATIVE URL (plan D6) and
 * the `httpClient.get` options the route walker cannot see — and that the
 * caller's options are kept while the read stays declared `idempotent`.
 */

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

const { fetchFleetHealth } = await import("./coordFleet");
const { OPERATIONS_BASE } = await import("./base");

describe("coordFleet", () => {
  afterEach(() => {
    getMock.mockReset();
  });

  it("OPERATIONS_BASE is the relative, same-origin form", () => {
    expect(OPERATIONS_BASE).toBe("/api/v1/operations");
  });

  it("fetchFleetHealth GETs /fleet/health, declared idempotent", async () => {
    await fetchFleetHealth();
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/health",
      { idempotent: true },
    ]);
  });

  it("fetchFleetHealth keeps the caller's retry budget", async () => {
    await fetchFleetHealth({ maxRetries: 0 });
    expect(getMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/health",
      { maxRetries: 0, idempotent: true },
    ]);
  });

  it("fetchFleetHealth resolves to the parsed body httpClient.get returned", async () => {
    const body = { devices: [{ device_id: "d1" }] };
    getMock.mockResolvedValueOnce(body);
    await expect(fetchFleetHealth()).resolves.toBe(body);
  });

  it("fetchFleetHealth passes httpClient.get's rejection through untouched", async () => {
    const err = new Error(
      "GET /api/v1/operations/fleet/health failed: 401 - {}"
    );
    getMock.mockRejectedValueOnce(err);
    await expect(fetchFleetHealth()).rejects.toBe(err);
  });
});
