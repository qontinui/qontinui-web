import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins `fetchMigrationQueue`'s exact request: the RELATIVE URL as a LITERAL
 * (with `repo` form-encoded, as `URLSearchParams` always sent it), the
 * method, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchMigrationQueue } = await import("./migrations");

describe("migrations", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchMigrationQueue GETs /migrations/queue?repo= with the repo form-encoded and no client retries", async () => {
    const body = { repo: "qontinui/web app", live: [] };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchMigrationQueue("qontinui/web app")).resolves.toEqual(
      body
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/migrations/queue?repo=qontinui%2Fweb+app",
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("fetchMigrationQueue rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    const err = await fetchMigrationQueue("o/r").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/migrations/queue?repo=o%2Fr failed: 400 - bad"
    );
    expect(httpStatusOf(err)).toBe(400);
  });
});
