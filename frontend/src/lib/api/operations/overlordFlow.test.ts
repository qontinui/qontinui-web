import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the overlord-flow client sends, and its error shape. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchOverlordFlow } = await import("./overlordFlow");

const B = "/api/v1/operations";

describe("overlordFlow", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("is an idempotent relative GET carrying the query verbatim", async () => {
    fetchMock.mockImplementation(async () => new Response('{"ok":true}'));
    await expect(fetchOverlordFlow("window_hours=168")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        `${B}/coord/overlord/flow?window_hours=168`,
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("rejects a non-2xx with the status and coord's body", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response('{"error":"schema_migration_pending"}', { status: 503 })
    );
    await expect(fetchOverlordFlow("window_hours=24")).rejects.toThrow(
      `GET ${B}/coord/overlord/flow?window_hours=24 failed: 503 - {"error":"schema_migration_pending"}`
    );
  });
});
