import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * `useDependencyAdvisories` — what a failed poll does to the last census the
 * section holds, and how coord's answers are worded. A failed read must keep
 * the last body (rendered as last-known), never clear it into an empty list
 * that would read as "no census"; and it must not re-stamp `fetchedAtMs`,
 * the clock the row ages are anchored to.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  describeDependencyAdvisoriesError,
  SURFACE_UNAVAILABLE_TEXT,
  useDependencyAdvisories,
} = await import("./useDependencyAdvisories");

const CENSUS = {
  available: true,
  census: [
    {
      repo: "qontinui/qontinui-coord",
      ecosystem: "rust",
      sha: "fe1dde77f",
      db_commit: "abc1234",
      state: "clean",
      reason: null,
      advisory_count: 0,
      observed_at: "2026-11-04T10:00:00Z",
      age_secs: 60,
      advisories: [],
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("useDependencyAdvisories", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("keeps the last census and its answer time through a failed poll", async () => {
    fetchMock.mockResolvedValueOnce(json(CENSUS));
    const { result } = renderHook(() => useDependencyAdvisories());

    await waitFor(() => expect(result.current.data).not.toBeNull());
    const answeredAt = result.current.fetchedAtMs;
    expect(answeredAt).not.toBeNull();
    expect(result.current.error).toBeNull();

    fetchMock.mockResolvedValueOnce(
      json({ error: "dependency_advisories_surface_unavailable" }, 503)
    );
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() =>
      expect(result.current.error).toBe(SURFACE_UNAVAILABLE_TEXT)
    );
    expect(result.current.data?.census).toHaveLength(1);
    expect(result.current.data?.census[0]?.repo).toBe(
      "qontinui/qontinui-coord"
    );
    expect(result.current.fetchedAtMs).toBe(answeredAt);
  });

  it("a non-census body is an error, not an empty census", async () => {
    fetchMock.mockResolvedValueOnce(json({ census: [] }));
    const { result } = renderHook(() => useDependencyAdvisories());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe(
      "coord answered without a dependency-advisory census body"
    );
  });
});

describe("describeDependencyAdvisoriesError", () => {
  const rejection = (status: number, body: string) =>
    new Error(
      `GET /api/v1/operations/coord/dependency-advisories failed: ${status} - ${body}`
    );

  it("names coord's surface-unavailable 503 from the status and the body field together", () => {
    expect(
      describeDependencyAdvisoriesError(
        rejection(503, '{"error":"dependency_advisories_surface_unavailable"}')
      )
    ).toBe(SURFACE_UNAVAILABLE_TEXT);
  });

  it("does not name it for a 503 with another body", () => {
    expect(
      describeDependencyAdvisoriesError(rejection(503, "upstream page"))
    ).not.toBe(SURFACE_UNAVAILABLE_TEXT);
  });

  it("does not name it for the right body on another status", () => {
    expect(
      describeDependencyAdvisoriesError(
        rejection(500, '{"error":"dependency_advisories_surface_unavailable"}')
      )
    ).not.toBe(SURFACE_UNAVAILABLE_TEXT);
  });

  it("words a route this deployment does not serve", () => {
    expect(describeDependencyAdvisoriesError(rejection(404, "nope"))).toBe(
      "coord does not serve the dependency-advisories route yet"
    );
  });
});
