import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `runnerReleases` function's exact request: the RELATIVE URL written out as a
 * LITERAL (so a change to the shared base cannot move every expectation with
 * it), the method, the body, and the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => fetchMock.mockReset());

const m = await import("./runnerReleases");

describe("runnerReleases", () => {
  it("fetchReleaseHistory GETs /releases with the query and the caller options", async () => {
    const body = { history: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(
      m.fetchReleaseHistory({ repo: "o/r", limit: 20 }, { maxRetries: 0 })
    ).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/releases?repo=o%2Fr&limit=20",
      { maxRetries: 0, method: "GET", idempotent: true },
    ]);
  });

  it("fetchReleaseHistory with no opts has no query string", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await m.fetchReleaseHistory();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/operations/releases");
  });

  it("fetchReleaseEntry encodes the tag and rejects a 404 in the helpers error shape", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ error: "release_tag_not_found" }, 404)
    );
    const err = await m
      .fetchReleaseEntry("v1.0/x", { repo: "o/r" })
      .catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(404);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/operations/releases/v1.0%2Fx?repo=o%2Fr"
    );
  });
});
