import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins `fetchOperatorAudit`'s exact request: the RELATIVE URL as a LITERAL. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchOperatorAudit } = await import("./operatorAudit");

describe("operatorAudit", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchOperatorAudit GETs /coord/audit/recent with the query and parses the body", async () => {
    const body = { rows: [] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await expect(fetchOperatorAudit("limit=100&via=web")).resolves.toEqual(
      body
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/audit/recent?limit=100&via=web",
      { method: "GET" },
    ]);
  });

  it("fetchOperatorAudit rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    const err = await fetchOperatorAudit("limit=1").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/coord/audit/recent?limit=1 failed: 403 - denied"
    );
    expect(httpStatusOf(err)).toBe(403);
  });
});
