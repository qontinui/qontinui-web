import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchTranscriptSync, patchTranscriptSync } =
  await import("./tenantPolicyReads");

describe("tenantPolicyReads", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchTranscriptSync GETs the transcript-sync setting", async () => {
    const body = { transcript_sync_enabled: true };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchTranscriptSync()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenant-policy/transcript-sync",
      { method: "GET", idempotent: true },
    ]);
  });

  it("patchTranscriptSync PATCHes only the flag", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ written: true }), { status: 200 })
    );
    await expect(patchTranscriptSync(false)).resolves.toEqual({
      written: true,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenant-policy/transcript-sync",
      {
        method: "PATCH",
        body: JSON.stringify({ transcript_sync_enabled: false }),
      },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 504 }));
    const err = await patchTranscriptSync(true).catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(504);
  });
});
