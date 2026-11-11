import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the exact request each `/operations/subprojects*` client function
 * sends — the literal relative URL and the full `httpClient.fetch` init — and
 * how it parses the answer.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  changeSubprojectMember,
  continueSubproject,
  fetchSubproject,
  fetchSubprojects,
  mergeSubproject,
  updateSubproject,
} = await import("./coordSubprojects");

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordSubprojects", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchSubprojects sends the caller's query and options and parses the page", async () => {
    const page = { items: [], next_cursor: null, truncated: false, total: 0 };
    fetchMock.mockResolvedValueOnce(json(page));
    const qs = new URLSearchParams({ headline: "stalled", limit: "1" });
    await expect(fetchSubprojects(qs, { maxRetries: 0 })).resolves.toEqual(
      page
    );
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/subprojects?headline=stalled&limit=1",
        { maxRetries: 0, method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchSubprojects with an empty query sends no `?`", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    await fetchSubprojects(new URLSearchParams());
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/subprojects", { method: "GET", idempotent: true }],
    ]);
  });

  it("fetchSubprojects rejects a non-2xx in httpClient.get's shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"schema_migration_pending"}', { status: 503 })
    );
    await expect(fetchSubprojects(new URLSearchParams())).rejects.toThrow(
      'GET /api/v1/operations/subprojects failed: 503 - {"error":"schema_migration_pending"}'
    );
  });

  it("fetchSubproject encodes the id and is an idempotent GET", async () => {
    fetchMock.mockResolvedValueOnce(json({ subproject: { id: ID } }));
    await expect(fetchSubproject(ID)).resolves.toEqual({
      subproject: { id: ID },
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        `/api/v1/operations/subprojects/${ID}`,
        { method: "GET", idempotent: true },
      ],
    ]);
  });

  it("fetchSubproject surfaces coord's 404 as the status isNotFoundError reads", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(fetchSubproject(ID)).rejects.toThrow(
      `GET /api/v1/operations/subprojects/${ID} failed: 404 - `
    );
  });

  it("updateSubproject PATCHes only the keys it is given, never retried", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: ID, title: "New" }));
    await updateSubproject(ID, { title: "New" });
    expect(fetchMock.mock.calls).toEqual([
      [
        `/api/v1/operations/subprojects/${ID}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New" }),
          idempotent: false,
        },
      ],
    ]);
  });

  it("mergeSubproject POSTs the target as into_id", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ merged_into: "target", moved_members: 3 })
    );
    await expect(mergeSubproject(ID, "target")).resolves.toEqual({
      merged_into: "target",
      moved_members: 3,
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        `/api/v1/operations/subprojects/${ID}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ into_id: "target" }),
          idempotent: false,
        },
      ],
    ]);
  });

  it("changeSubprojectMember POSTs the request verbatim", async () => {
    fetchMock.mockResolvedValueOnce(json({ member: { id: "m" } }));
    const request = {
      action: "move" as const,
      member_kind: "work_unit" as const,
      work_unit_slug: "2026-10-27-spawn-time-effort",
    };
    await changeSubprojectMember(ID, request);
    expect(fetchMock.mock.calls).toEqual([
      [
        `/api/v1/operations/subprojects/${ID}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          idempotent: false,
        },
      ],
    ]);
  });

  it("continueSubproject returns the raw Response and is never retried", async () => {
    const answer = new Response('{"error":"no_capacity"}', { status: 409 });
    fetchMock.mockResolvedValueOnce(answer);
    const body = { effort: "high" as const, prompt_addendum: "go" };
    await expect(continueSubproject(ID, body)).resolves.toBe(answer);
    expect(fetchMock.mock.calls).toEqual([
      [
        `/api/v1/operations/subprojects/${ID}/spawn`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          idempotent: false,
          maxRetries: 0,
        },
      ],
    ]);
  });
});
