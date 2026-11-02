import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins the spawn ledger client's exact requests — the RELATIVE same-origin
 * URLs under `/api/v1/operations` (never coord), each declared idempotent and
 * keeping the caller's retry budget — and that a rejection keeps the
 * `<METHOD> <url> failed: <status> - <body>` shape the console's
 * `httpStatusOf` parses.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchSpawn, fetchSpawnStats, fetchSpawns } =
  await import("./coordSpawns");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordSpawns", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchSpawns GETs /spawns with only the filters it was given", async () => {
    fetchMock.mockResolvedValueOnce(json({ available: true, items: [] }));
    await fetchSpawns(
      { since: "2026-10-14T12:00:00.000Z", limit: 200 },
      { maxRetries: 0 }
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/spawns?since=2026-10-14T12%3A00%3A00.000Z&limit=200",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchSpawns sends a state filter as coord's comma list, oldest first, with no since", async () => {
    fetchMock.mockResolvedValueOnce(json({ available: true, items: [] }));
    await fetchSpawns({
      states: ["queued", "dispatched", "deferred"],
      order: "asc",
      limit: 200,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/spawns?state=queued%2Cdispatched%2Cdeferred&order=asc&limit=200"
    );
  });

  it("fetchSpawnStats GETs /spawns/stats for the window", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ available: false, reason: "schema_missing" })
    );
    await expect(fetchSpawnStats("24h")).resolves.toEqual({
      available: false,
      reason: "schema_missing",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/spawns/stats?window=24h",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchSpawn GETs one request by its id", async () => {
    fetchMock.mockResolvedValueOnce(json({ available: true }));
    await fetchSpawn("0b6f7f0e-2a59-4d3c-9b8e-5d1f2c3a4b5c");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/spawns/0b6f7f0e-2a59-4d3c-9b8e-5d1f2c3a4b5c"
    );
  });

  it("rejects a non-2xx in the shape httpStatusOf reads", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "coord returned HTTP 404" }, 404)
    );
    const err = await fetchSpawnStats("7d").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(404);
  });
});
