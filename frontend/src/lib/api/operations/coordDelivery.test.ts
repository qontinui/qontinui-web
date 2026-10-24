import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each delivery-history client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchDeployList,
  fetchDeployRollbackProposal,
  fetchDomainCost,
  fetchFederationReports,
  fetchGitOpsBranches,
  fetchGitOpsList,
  fetchLandList,
  fetchLandPrecision,
  fetchLandPreview,
  fetchLandVerifications,
  fetchPullDecisions,
  fetchTreesByDevice,
  fetchTreesContention,
} = await import("./coordDelivery");

const POLL = { maxRetries: 0 };

function answer(body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
}

describe("coordDelivery", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchLandPrecision GETs /lands/precision with the caller's retry budget", async () => {
    answer({ dimensions: [] });
    await expect(fetchLandPrecision(POLL)).resolves.toEqual({ dimensions: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands/precision",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchLandPreview GETs /lands/preview with repo and pr encoded", async () => {
    answer({ ok: true });
    await fetchLandPreview({ repo: "a/b", pr: "7" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands/preview?repo=a%2Fb&pr=7",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchLandList GETs /lands with the repo filter and limit", async () => {
    answer({ lands: [] });
    await expect(
      fetchLandList({ repo: "a/b", limit: 25 }, POLL)
    ).resolves.toEqual({ lands: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands?repo=a%2Fb&limit=25",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchLandList omits an absent repo from the query", async () => {
    answer({ lands: [] });
    await fetchLandList({ limit: 25 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands?limit=25",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchLandVerifications GETs /lands/verifications by correlation id", async () => {
    answer({ repos: [] });
    await fetchLandVerifications("c 1");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/lands/verifications?correlation_id=c+1",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchDeployList GETs /deploys with the service filter and limit", async () => {
    answer({ deploys: [] });
    await fetchDeployList({ service: "web", limit: 25 }, POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/deploys?service=web&limit=25",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchDeployRollbackProposal GETs one deploy's rollback proposal", async () => {
    answer({ deploy_id: "abc" });
    await fetchDeployRollbackProposal("abc");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/deploys/abc/rollback-proposal",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchDeployRollbackProposal keeps the 404 in the httpClient error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("none", { status: 404 }));
    await expect(fetchDeployRollbackProposal("abc")).rejects.toThrow(
      "GET /api/v1/operations/deploys/abc/rollback-proposal failed: 404 - none"
    );
  });

  it("fetchTreesByDevice GETs /trees/by-device with the device id encoded", async () => {
    answer({ trees: [] });
    await fetchTreesByDevice("dev/1", POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/trees/by-device/dev%2F1",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchTreesContention GETs /trees/contention", async () => {
    answer({ overlaps: [] });
    await fetchTreesContention(POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/trees/contention",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchGitOpsList GETs /git-ops/list with since, repo and limit", async () => {
    answer({ ops: [] });
    await fetchGitOpsList(
      { since: "2026-01-01T00:00:00Z", repo: "a/b", limit: 200 },
      POLL
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/git-ops/list?since=2026-01-01T00%3A00%3A00Z&repo=a%2Fb&limit=200",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchGitOpsBranches GETs /git-ops/branches", async () => {
    answer({ branches: [] });
    await fetchGitOpsBranches(POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/git-ops/branches",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchFederationReports GETs /federation/reports, omitting an absent since", async () => {
    answer({ reports: [] });
    await fetchFederationReports({ limit: 200 }, POLL);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/federation/reports?limit=200",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPullDecisions GETs /coord/pull-decisions with no `?` when unfiltered", async () => {
    answer({ resolutions: [] });
    await expect(fetchPullDecisions({}, POLL)).resolves.toEqual({
      resolutions: [],
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/pull-decisions",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchPullDecisions sends both filters and normalizes a bare array", async () => {
    answer([{ id: "r1" }]);
    await expect(
      fetchPullDecisions({ deviceId: "d1", repo: "a/b" })
    ).resolves.toEqual({ resolutions: [{ id: "r1" }] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/pull-decisions?device_id=d1&repo=a%2Fb",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchDomainCost GETs /domain-cost and returns the body unvalidated", async () => {
    answer({ anything: 1 });
    await expect(fetchDomainCost(POLL)).resolves.toEqual({ anything: 1 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/domain-cost",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("a non-2xx rejects with the httpClient error shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 502 }));
    await expect(fetchLandList({ limit: 25 })).rejects.toThrow(
      "GET /api/v1/operations/lands?limit=25 failed: 502 - down"
    );
  });
});
