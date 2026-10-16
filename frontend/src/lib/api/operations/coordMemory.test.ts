import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each coord-memory client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  deleteMemory,
  fetchMemoryEntry,
  fetchMemoryList,
  fetchMemoryVersion,
  fetchMemoryVersionTrail,
  restoreMemoryVersion,
  upsertMemory,
} = await import("./coordMemory");

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

function fail(status: number, body: string) {
  fetchMock.mockResolvedValueOnce(new Response(body, { status }));
}

const V1 = { name: "m", version: 1, content: "first", is_tombstone: false };
const V2 = { name: "m", version: 2, content: "", is_tombstone: true };

describe("coordMemory", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchMemoryList GETs /memory/list with the caller's retry budget", async () => {
    answer({ items: [] });
    await expect(fetchMemoryList({ maxRetries: 0 })).resolves.toEqual({
      items: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/list",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchMemoryEntry GETs one memory with its name encoded", async () => {
    answer({ name: "a/b", content: "x" });
    await expect(fetchMemoryEntry("a/b")).resolves.toEqual({
      name: "a/b",
      content: "x",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/a%2Fb",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchMemoryEntry keeps coord's 404 in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(fetchMemoryEntry("m")).rejects.toThrow(
      "GET /api/v1/operations/memory/m failed: 404 - not found"
    );
  });

  it("fetchMemoryVersion GETs one version with both segments encoded", async () => {
    answer({ name: "a/b", version: 3, content: "x" });
    await fetchMemoryVersion("a/b", "3?");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/a%2Fb/version/3%3F",
      { method: "GET", idempotent: true },
    ]);
  });

  it("upsertMemory POSTs the new head version, never re-sent on a 5xx, undefined keys dropped", async () => {
    answer({ version: 4 });
    await upsertMemory({
      name: "m",
      content: "body",
      description: undefined,
      type: "feedback",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/upsert",
      {
        method: "POST",
        body: '{"name":"m","content":"body","type":"feedback"}',
        idempotent: false,
      },
    ]);
  });

  it("deleteMemory DELETEs the memory, retryable like the httpClient.delete it replaced", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteMemory("a/b")).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/a%2Fb",
      { method: "DELETE", idempotent: true },
    ]);
  });

  it("deleteMemory rejects a non-2xx in httpClient.delete's error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 }));
    await expect(deleteMemory("m")).rejects.toThrow(
      "DELETE /api/v1/operations/memory/m failed: 403 - nope"
    );
  });

  it("restoreMemoryVersion POSTs the version number, never re-sent on a 5xx", async () => {
    answer({ version: 5 });
    await restoreMemoryVersion("a/b", 3);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/a%2Fb/restore",
      { method: "POST", body: '{"version":3}', idempotent: false },
    ]);
  });

  describe("fetchMemoryVersionTrail", () => {
    it("stops at the first 404", async () => {
      answer(V1);
      answer(V2);
      fail(404, "no version 3");
      await expect(fetchMemoryVersionTrail("m")).resolves.toEqual({
        versions: [V1, V2],
        truncated: false,
      });
      // Two versions cost exactly three reads: v1, v2, and the 404 on v3.
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        "/api/v1/operations/memory/m/version/1",
        "/api/v1/operations/memory/m/version/2",
        "/api/v1/operations/memory/m/version/3",
      ]);
    });

    it("carries is_tombstone through", async () => {
      answer(V1);
      answer(V2);
      fail(404, "no version 3");
      const trail = await fetchMemoryVersionTrail("m");
      expect(trail.versions.map((v) => v.is_tombstone)).toEqual([false, true]);
    });

    it("resolves an empty trail when v1 404s", async () => {
      fail(404, "no version 1");
      await expect(fetchMemoryVersionTrail("ghost")).resolves.toEqual({
        versions: [],
        truncated: false,
      });
    });

    it("stops at max and reports truncated", async () => {
      answer(V1);
      answer(V2);
      await expect(fetchMemoryVersionTrail("m", 2)).resolves.toEqual({
        versions: [V1, V2],
        truncated: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects on a 500 instead of returning a short trail", async () => {
      answer(V1);
      fail(500, "boom");
      await expect(fetchMemoryVersionTrail("m")).rejects.toThrow(
        "GET /api/v1/operations/memory/m/version/2 failed: 500 - boom"
      );
    });
  });
});
