import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each tenant-policy client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchFleetPolicy,
  putFleetPolicy,
  fetchTranscriptSyncPolicy,
  patchTranscriptSyncPolicy,
} = await import("./tenantPolicy");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("tenantPolicy", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchFleetPolicy GETs /fleet-policy with the domain encoded", async () => {
    const body = { domain: "a b", effective_level: "on" };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchFleetPolicy("a b")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy?domain=a%20b",
      { method: "GET", idempotent: true },
    ]);
  });

  it("putFleetPolicy PUTs the write body, declared non-idempotent", async () => {
    const write = {
      domain: "plan_capture",
      scope_band: "tenant" as const,
      scope_key: null,
      level: "record",
      master_enabled: true,
      change_note: "n",
    };
    fetchMock.mockResolvedValueOnce(json({ ok: true, effective: null }));
    await putFleetPolicy(write);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy",
      { method: "PUT", body: JSON.stringify(write), idempotent: false },
    ]);
  });

  it("putFleetPolicy rejects in the httpClient.put shape, refusal code included", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"repo_not_in_tenant"}', { status: 400 })
    );
    await expect(
      putFleetPolicy({
        domain: "d",
        scope_band: "repo",
        scope_key: "o/r",
        level: "on",
        master_enabled: true,
        change_note: "n",
      })
    ).rejects.toThrow(
      'PUT /api/v1/operations/fleet-policy failed: 400 - {"error":"repo_not_in_tenant"}'
    );
  });

  it("fetchTranscriptSyncPolicy GETs /tenant-policy/transcript-sync", async () => {
    fetchMock.mockResolvedValueOnce(json({ transcript_sync_enabled: true }));
    await fetchTranscriptSyncPolicy();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenant-policy/transcript-sync",
      { method: "GET", idempotent: true },
    ]);
  });

  it("patchTranscriptSyncPolicy PATCHes only the flag and is never retried", async () => {
    fetchMock.mockResolvedValueOnce(json({ written: true, effective: null }));
    await patchTranscriptSyncPolicy(false);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenant-policy/transcript-sync",
      {
        method: "PATCH",
        body: '{"transcript_sync_enabled":false}',
        idempotent: false,
      },
    ]);
  });

  it("a 504 keeps the failed-504 text the hook reads as UNKNOWN", async () => {
    fetchMock.mockResolvedValueOnce(new Response("timeout", { status: 504 }));
    await expect(patchTranscriptSyncPolicy(true)).rejects.toThrow(
      "PATCH /api/v1/operations/tenant-policy/transcript-sync failed: 504 - timeout"
    );
  });
});
