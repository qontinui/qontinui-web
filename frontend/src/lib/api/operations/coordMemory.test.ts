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
  restoreMemoryVersion,
  upsertMemory,
} = await import("./coordMemory");

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

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
});
