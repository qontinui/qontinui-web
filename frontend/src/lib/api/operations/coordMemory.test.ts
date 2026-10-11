import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const { deleteMemory, fetchMemory, fetchMemoryList, upsertMemory } =
  await import("./coordMemory");

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("coordMemory", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchMemoryList GETs /memory/list with no client retries", async () => {
    fetchMock.mockResolvedValueOnce(answer({ items: [] }));
    await expect(fetchMemoryList()).resolves.toEqual({ items: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/list",
      { method: "GET", maxRetries: 0 },
    ]);
  });

  it("fetchMemory encodes the name and rejects with the status", async () => {
    fetchMock.mockResolvedValueOnce(answer({ name: "a b", content: "c" }));
    await fetchMemory("a b");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/a%20b",
      { method: "GET" },
    ]);
    fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    const err = await fetchMemory("x").catch((e) => e);
    expect(err.message).toBe(
      "GET /api/v1/operations/memory/x failed: 404 - gone"
    );
    expect(httpStatusOf(err)).toBe(404);
  });

  it("upsertMemory POSTs the JSON body", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await upsertMemory({ name: "n", content: "c" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/upsert",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "n", content: "c" }),
      },
    ]);
  });

  it("deleteMemory DELETEs, accepts 204, and rejects a non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteMemory("n")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/n",
      { method: "DELETE" },
    ]);
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 500 }));
    await expect(deleteMemory("n")).rejects.toThrow(
      "DELETE /api/v1/operations/memory/n failed: 500 - bad"
    );
  });
});
