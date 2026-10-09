import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordMemory` function's exact request: the RELATIVE URL written
 * out as a LITERAL, the `encodeURIComponent` of every path parameter, and the
 * `httpClient.fetch` options the route walker cannot see (method, stated retry
 * policy). Bodies are compared as strings, so the wire key order is pinned too.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  deleteMemory,
  fetchMemory,
  fetchMemoryList,
  fetchMemoryVersion,
  restoreMemoryVersion,
  upsertMemory,
} = await import("./coordMemory");

/** A name that only survives the trip as one path segment if encoded. */
const NAME = "feedback/a b #1";
const NAME_ENCODED = "feedback%2Fa%20b%20%231";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordMemory", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in the <METHOD> <url> failed shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "gone" }, 404));
    const err = await fetchMemory(NAME).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `GET /api/v1/operations/memory/${NAME_ENCODED} failed: 404 - {"detail":"gone"}`
    );
    expect(httpStatusOf(err)).toBe(404);
    expect(httpBodyOf(err)).toBe('{"detail":"gone"}');
  });

  it("fetchMemoryList GETs /memory/list, idempotent, carrying the caller options", async () => {
    const body = { items: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchMemoryList({ noRetryStatuses: [503] })).resolves.toEqual(
      body
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/list",
      { noRetryStatuses: [503], method: "GET", idempotent: true },
    ]);
  });

  it("fetchMemory GETs the encoded name", async () => {
    fetchMock.mockResolvedValueOnce(answer({ name: NAME, content: "c" }));
    await fetchMemory(NAME);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/memory/${NAME_ENCODED}`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchMemoryVersion GETs the encoded name and version", async () => {
    fetchMock.mockResolvedValueOnce(answer({ name: NAME, version: 3 }));
    await fetchMemoryVersion(NAME, "3/x");
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/memory/${NAME_ENCODED}/version/3%2Fx`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("upsertMemory POSTs in wire key order, not re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await upsertMemory({
      type: "feedback",
      description: "d",
      content: "c",
      name: "n",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/upsert",
      {
        method: "POST",
        body: '{"name":"n","content":"c","description":"d","type":"feedback"}',
        idempotent: false,
      },
    ]);
  });

  it("upsertMemory leaves absent optional fields off the wire", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await upsertMemory({ name: "n", content: "c" });
    expect(fetchMock.mock.calls[0][1].body).toBe('{"name":"n","content":"c"}');
  });

  it("deleteMemory DELETEs the encoded name, idempotent, and a 204 resolves", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteMemory(NAME)).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/memory/${NAME_ENCODED}`,
      { method: "DELETE", idempotent: true },
    ]);
  });

  it("restoreMemoryVersion POSTs the version to the encoded name restore route", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await restoreMemoryVersion(NAME, { version: 2 });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/memory/${NAME_ENCODED}/restore`,
      { method: "POST", body: '{"version":2}', idempotent: false },
    ]);
  });
});
