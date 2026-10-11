import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `sessionsConsole` function's exact request: the RELATIVE URL written out as a
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

const apiConfig = vi.hoisted(() => ({
  API_BASE_URL: "https://api.example.test",
}));
vi.mock("@/services/api-config", () => ({ ApiConfig: apiConfig }));
const m = await import("./sessionsConsole");

describe("sessionsConsole", () => {
  it("the session reads GET relative URLs and forward the signal", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer({})));
    const controller = new AbortController();
    const signal = controller.signal;
    await m.fetchSessions({
      scope: "all",
      tenantScope: "all",
      since: "t",
      signal,
    });
    await m.fetchConsolidatedSessions({
      device: "d",
      q: "x",
      status: "live",
      signal,
    });
    await m.fetchSession("a/b", signal);
    await m.fetchSessionOutput("s", {
      tier: "cold",
      stream: "transcript",
      limit: 5,
      signal,
    });
    await m.fetchSessionRestoreRecord("s", signal);
    await m.fetchSessionClaims("s", signal);
    await m.fetchSessionAgentStatus("s", signal);
    await m.fetchSessionLineage("s", signal);
    await m.fetchTenants(signal);
    await m.fetchRegisteredRepos(signal);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/operations/sessions?scope=all&tenant_scope=all&since=t",
      "/api/v1/operations/sessions?shape=consolidated&device=d&q=x&status=live",
      "/api/v1/operations/sessions/a%2Fb",
      "/api/v1/operations/sessions/s/output?tier=cold&stream=transcript&limit=5",
      "/api/v1/operations/sessions/s/restore-record",
      "/api/v1/operations/sessions/s/claims",
      "/api/v1/operations/sessions/s/agent-status",
      "/api/v1/operations/sessions/s/lineage",
      "/api/v1/operations/tenants",
      "/api/v1/operations/repos",
    ]);
    for (const c of fetchMock.mock.calls) {
      expect((c[1] as RequestInit).signal).toBe(signal);
    }
  });

  it("an unfiltered list has no query string", async () => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await m.fetchSessions();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/operations/sessions");
  });

  it("steal and handoff POST and are never re-sent on an ambiguous 5xx", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer({ ok: true })));
    await m.postSessionSteal("s", { reason: "r", machine_id: "m" });
    await m.postSessionHandoff("s", { target_device_id: "d" });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/sessions/s/steal",
        {
          method: "POST",
          body: '{"reason":"r","machine_id":"m"}',
          noRetryStatuses: m.NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
        },
      ],
      [
        "/api/v1/operations/sessions/s/handoff",
        {
          method: "POST",
          body: '{"target_device_id":"d"}',
          noRetryStatuses: m.NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
        },
      ],
    ]);
  });

  it("deleteSession DELETEs, and tenant create / rename never retry (rename waits 120s)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(answer({})));
    await m.deleteSession("s");
    await m.postTenant({ name: "n" } as never);
    await m.patchTenant("t/1", { name: "n" } as never);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions/s",
      { method: "DELETE" },
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/v1/operations/tenants",
      {
        method: "POST",
        body: '{"name":"n"}',
        noRetryStatuses: m.NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
      },
    ]);
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/v1/operations/tenants/t%2F1",
      {
        method: "PATCH",
        body: '{"name":"n"}',
        noRetryStatuses: m.NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
        timeoutMs: 120000,
      },
    ]);
  });

  it("a non-2xx rejects in the helpers error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "gone" }, 404));
    const err = await m.fetchSession("s").catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/sessions/s failed: 404 - {"detail":"gone"}'
    );
    expect(httpStatusOf(err)).toBe(404);
  });

  it("sessionEventsUrl is the one ABSOLUTE url", () => {
    expect(m.sessionEventsUrl("a/b")).toBe(
      "https://api.example.test/api/v1/operations/sessions/a%2Fb/events"
    );
  });
});
