import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request the overlord-flow client sends, and its error shape. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchOverlordFlow, fetchOverlordPass, fetchOverlordPasses } =
  await import("./overlordFlow");

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

  it("reads the pass list with the query verbatim", async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"ok":true}', { status: 200 })
    );
    await expect(fetchOverlordPasses("limit=200")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        `${B}/coord/overlord/passes?limit=200`,
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("encodes the pass id into the path", async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"ok":true}', { status: 200 })
    );
    await fetchOverlordPass("a/b");
    expect(fetchMock.mock.calls[0][0]).toBe(`${B}/coord/overlord/passes/a%2Fb`);
  });

  it("rejects a missing pass with coord's body", async () => {
    fetchMock.mockImplementation(
      async () => new Response('{"error":"pass_not_found"}', { status: 404 })
    );
    await expect(fetchOverlordPass("p")).rejects.toThrow(
      `GET ${B}/coord/overlord/passes/p failed: 404 - {"error":"pass_not_found"}`
    );
  });
});
