import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each coord-findings client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchCoordFindingById, fetchCoordFindings } =
  await import("./coordFindings");

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

describe("coordFindings", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchCoordFindings GETs one page with only the limit when no filter is set", async () => {
    answer({ findings: [] });
    await expect(
      fetchCoordFindings({ limit: 50, triaged: null })
    ).resolves.toEqual({ findings: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/findings?limit=50",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchCoordFindings sends every filter, in order, encoded", async () => {
    answer({ findings: [] });
    await fetchCoordFindings({
      limit: 50,
      topic: "plan corpus",
      kind: "observation",
      resourceKeys: "repo:qontinui-web",
      triaged: false,
      cursor: "c/1",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/findings?limit=50&topic=plan+corpus&kind=observation&resource_keys=repo%3Aqontinui-web&triaged=false&cursor=c%2F1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchCoordFindings keeps coord's 400 in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("cursor does not match this query", { status: 400 })
    );
    await expect(
      fetchCoordFindings({ limit: 50, cursor: "stale" })
    ).rejects.toThrow(
      "GET /api/v1/operations/coord/findings?limit=50&cursor=stale failed: 400 - cursor does not match this query"
    );
  });

  it("fetchCoordFindingById GETs one finding with its id encoded", async () => {
    answer({ findings: [] });
    await fetchCoordFindingById("a b/c");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/findings?finding_id=a%20b%2Fc",
      { method: "GET", idempotent: true },
    ]);
  });
});
