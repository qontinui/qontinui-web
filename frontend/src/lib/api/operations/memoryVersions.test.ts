import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins the exact request of each memoryVersions function: RELATIVE URL literal, method, body. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchMemoryVersion, restoreMemoryVersion } =
  await import("./memoryVersions");

describe("memoryVersions", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchMemoryVersion GETs the encoded version URL and parses the body", async () => {
    const body = { name: "a b", version: 3, content: "x" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchMemoryVersion("a b", "3")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/a%20b/version/3",
      { method: "GET" },
    ]);
  });

  it("restoreMemoryVersion POSTs {version} to /restore", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    );
    await restoreMemoryVersion("m", 4);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/memory/m/restore",
      { method: "POST", body: JSON.stringify({ version: 4 }) },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 404 }));
    const err = await fetchMemoryVersion("m", "1").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(404);
  });
});
