import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins the session-run client's exact requests — the RELATIVE same-origin
 * URLs under `/api/v1/operations` (never coord), each declared idempotent and
 * keeping the caller's retry budget — and that a rejection keeps the
 * `<METHOD> <url> failed: <status> - <body>` shape the console's
 * `httpStatusOf` parses (which is how coord's 503 schema_missing reaches the
 * page as itself).
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  fetchSessionRunConcurrency,
  fetchSessionRunGrowth,
  fetchSessionRunStats,
  fetchSessionRuns,
} = await import("./coordSessionRuns");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordSessionRuns", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchSessionRuns GETs /session-runs with only the filters it was given", async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [], as_of: "t" }));
    await fetchSessionRuns(
      { since: "2026-10-19T12:00:00.000Z", limit: 100 },
      { maxRetries: 0 }
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/session-runs?since=2026-10-19T12%3A00%3A00.000Z&limit=100",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchSessionRuns sends work_type, device, initiator and cursor under coord's names", async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [], as_of: "t" }));
    await fetchSessionRuns({
      workType: "post_merge",
      device: "d-1",
      initiator: "runner_local",
      cursor: "c~1",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/session-runs?work_type=post_merge&device=d-1&initiator=runner_local&cursor=c%7E1"
    );
  });

  it("fetchSessionRunStats GETs /session-runs/stats for the window and grouping", async () => {
    fetchMock.mockResolvedValueOnce(json({ groups: [] }));
    await fetchSessionRunStats("7d", "device,work_type");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/session-runs/stats?window=7d&group_by=device%2Cwork_type"
    );
  });

  it("fetchSessionRunConcurrency and fetchSessionRunGrowth GET their routes", async () => {
    fetchMock.mockImplementation(async () => json({}));
    await fetchSessionRunConcurrency("30d", "6h");
    await fetchSessionRunGrowth("90d", "day");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/operations/session-runs/concurrency?window=30d&bucket=6h",
      "/api/v1/operations/session-runs/growth?window=90d&bucket=day",
    ]);
  });

  it("a 503 schema_missing rejects with its status and body intact", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "schema_missing" }, 503));
    const err = await fetchSessionRunGrowth("90d", "day").catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(503);
    expect(String((err as Error).message)).toContain("schema_missing");
  });
});
