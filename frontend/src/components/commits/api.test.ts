/**
 * Tests for the commit-lineage API client (`api.ts`).
 *
 * These exercise the WEB-layer contract only: the helpers call the backend
 * proxy via the shared `httpClient`, unwrap coord's enveloped bodies
 * (`rows` / `commits`), return a STABLE empty array when the envelope is
 * empty/missing, pass through the stats body as-is, and throw
 * `CommitsApiError` (carrying the status) on a non-ok response.
 *
 * The `httpClient` is mocked at `@/services/service-factory` and
 * `ApiConfig.API_BASE_URL` is pinned to "" so the asserted URLs are stable —
 * the same mocking pattern as `useCoPilotActivity.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));
vi.mock("@/services/api-config", () => ({
  ApiConfig: { API_BASE_URL: "" },
}));

import {
  CommitsApiError,
  getLineageStats,
  getRecentCommits,
  getSessionCommits,
} from "./api";
import type { LineageRow, LineageStats } from "./types";

const BASE = "/api/v1/operations/lineage";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function row(overrides: Partial<LineageRow> = {}): LineageRow {
  return {
    commit_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    repo: "qontinui/qontinui-web",
    branch: "main",
    pr_number: 123,
    agent_session_id: "abcdabcd-1234-5678-9abc-def012345678",
    session_name: "ufix-2026-06-08",
    source: "merge_orchestrator",
    recorded_at: "2026-06-08T12:00:00+00:00",
    ...overrides,
  };
}

describe("getRecentCommits", () => {
  beforeEach(() => fetchMock.mockReset());

  it("calls the recent proxy with the default limit and unwraps rows", async () => {
    const rows = [row(), row({ commit_sha: "cafebabe" })];
    fetchMock.mockResolvedValue(
      jsonResponse({ rows, count: rows.length, limit: 100 })
    );

    const result = await getRecentCommits();

    expect(result).toEqual(rows);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(`${BASE}/recent?limit=100`);
  });

  it("forwards a custom limit in the query string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [], count: 0, limit: 25 }));

    await getRecentCommits(25);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(`${BASE}/recent?limit=25`);
  });

  it("returns a stable empty array when rows is empty", async () => {
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ rows: [], count: 0, limit: 100 }))
    );

    const a = await getRecentCommits();
    const b = await getRecentCommits();

    expect(a).toEqual([]);
    // Same module-level constant — identity-stable across calls so
    // identity-memoing consumers don't re-render in a loop.
    expect(a).toBe(b);
  });

  it("returns a stable empty array when rows is missing entirely", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ count: 0, limit: 100 }));

    const result = await getRecentCommits();

    expect(result).toEqual([]);
  });

  it("forwards an AbortSignal to httpClient.fetch", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [], count: 0, limit: 100 }));
    const controller = new AbortController();

    await getRecentCommits(50, controller.signal);

    const calledInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(calledInit.signal).toBe(controller.signal);
  });

  it("throws CommitsApiError carrying the status on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "forbidden" }, 403));

    await expect(getRecentCommits()).rejects.toMatchObject({
      name: "CommitsApiError",
      status: 403,
    });
    await expect(getRecentCommits()).rejects.toBeInstanceOf(CommitsApiError);
  });
});

describe("getSessionCommits", () => {
  beforeEach(() => fetchMock.mockReset());

  const SESSION_ID = "abcdabcd-1234-5678-9abc-def012345678";

  it("calls the session-commits proxy with an encoded session id", async () => {
    const commits = [row()];
    fetchMock.mockResolvedValue(
      jsonResponse({ session_id: SESSION_ID, commits, count: 1 })
    );

    const result = await getSessionCommits(SESSION_ID);

    expect(result).toEqual(commits);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      `${BASE}/sessions/${encodeURIComponent(SESSION_ID)}/commits`
    );
  });

  it("returns a stable empty array when commits is empty", async () => {
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ session_id: SESSION_ID, commits: [], count: 0 })
      )
    );

    const a = await getSessionCommits(SESSION_ID);
    const b = await getSessionCommits(SESSION_ID);

    expect(a).toEqual([]);
    expect(a).toBe(b);
  });

  it("returns a stable empty array when commits is missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ session_id: SESSION_ID, count: 0 })
    );

    expect(await getSessionCommits(SESSION_ID)).toEqual([]);
  });

  it("throws CommitsApiError on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "no session" }, 404));

    await expect(getSessionCommits(SESSION_ID)).rejects.toMatchObject({
      name: "CommitsApiError",
      status: 404,
    });
  });
});

describe("getLineageStats", () => {
  beforeEach(() => fetchMock.mockReset());

  const stats: LineageStats = {
    totals: { commits: 42, attributed: 30, sessions: 7, repos: 3 },
    by_source: [{ source: "merge_orchestrator", commits: 30 }],
    top_sessions: [
      {
        agent_session_id: "abcdabcd-1234-5678-9abc-def012345678",
        session_name: "ufix",
        commits: 7,
        last_commit_at: "2026-06-08T12:00:00+00:00",
      },
    ],
    by_repo_day: [
      {
        repo: "qontinui/qontinui-web",
        day: "2026-06-08",
        commits: 5,
        sessions: 2,
      },
    ],
  };

  it("calls the stats proxy and returns the body as-is (no unwrap)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(stats));

    const result = await getLineageStats();

    expect(result).toEqual(stats);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toBe(`${BASE}/stats`);
  });

  it("throws CommitsApiError on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    await expect(getLineageStats()).rejects.toMatchObject({
      name: "CommitsApiError",
      status: 500,
    });
  });
});
