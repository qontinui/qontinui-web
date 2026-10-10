import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOfError } from "@/components/console/readFailure";

/**
 * Pins `fetchPlanAttribution`'s request — the RELATIVE URL on
 * `httpClient.fetch`, the stem URL-encoded, the caller's retry budget kept —
 * and that a non-2xx keeps the `GET <url> failed: <status> - <body>` shape
 * the plans page reads its status from.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchPlanAttribution } = await import("./planAttribution");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("planAttribution", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("GETs /plans/{stem}/attribution, encoded, keeping the retry budget", async () => {
    fetchMock.mockResolvedValueOnce(json({ attribution_available: true }));
    await expect(
      fetchPlanAttribution("a b/c", { maxRetries: 0 })
    ).resolves.toEqual({
      attribution_available: true,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/plans/a%20b%2Fc/attribution",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("rejects a non-2xx with a status httpStatusOfError reads", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: "forbidden" }, 403));
    const err = await fetchPlanAttribution("p").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(httpStatusOfError(err)).toBe(403);
  });
});
