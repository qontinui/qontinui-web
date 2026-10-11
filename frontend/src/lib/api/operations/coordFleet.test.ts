import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import { describeCoordPollError } from "@/components/operations/coordPollError";

/**
 * Pins `fetchFleetHealth`'s exact request — the RELATIVE URL (plan D6) on
 * `httpClient.fetch` (the D6 amendment: the helpers would prefix the absolute
 * base) and the init the route walker cannot see — and that the caller's
 * options are kept while the read stays declared `idempotent`. Its rejection
 * must keep `httpClient.get`'s `GET <url> failed: <status> - <body>` shape,
 * because `describeCoordPollError` / `httpStatusOf` / `httpBodyOf` parse it.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchFleetHealth } = await import("./coordFleet");
const { OPERATIONS_BASE } = await import("./base");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordFleet", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("OPERATIONS_BASE is the relative, same-origin form", () => {
    expect(OPERATIONS_BASE).toBe("/api/v1/operations");
  });

  it("fetchFleetHealth GETs /fleet/health, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchFleetHealth();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/health",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchFleetHealth keeps the caller's retry budget", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await fetchFleetHealth({ maxRetries: 0 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet/health",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchFleetHealth resolves to the parsed body", async () => {
    const body = { devices: [{ device_id: "d1" }] };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchFleetHealth()).resolves.toEqual(body);
  });

  it("fetchFleetHealth rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "deadline", budget_ms: 4000 }, 503)
    );
    const err = await fetchFleetHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/fleet/health failed: 503 - {"error":"deadline","budget_ms":4000}'
    );
    // The three readers of that shape still read it.
    expect(httpStatusOf(err)).toBe(503);
    expect(httpBodyOf(err)).toBe('{"error":"deadline","budget_ms":4000}');
    expect(describeCoordPollError(err)).toBe(
      "coord read deadline (4000 ms) exceeded — unknown"
    );
  });

  it("fetchFleetHealth passes a network failure through untouched", async () => {
    const err = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValueOnce(err);
    await expect(fetchFleetHealth()).rejects.toBe(err);
  });
});
