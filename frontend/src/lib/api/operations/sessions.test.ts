import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins every `sessions.ts` request: the RELATIVE URL (plan D6) and the init
 * the route walker cannot see — the method and the retry policy each call
 * states. URLs are literal strings on purpose; importing `OPERATIONS_BASE`
 * into the expectation would let a base change pass unseen.
 *
 * The SSE readers keep their own streaming `fetch` (stubbed globally here);
 * what is pinned for them is the relative URL and the hand-built bearer.
 */

const fetchMock = vi.fn();
const getAuthToken = vi.fn<() => string | null>(() => "tok-123");

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    getAuthToken: () => getAuthToken(),
  },
}));

const {
  closeSession,
  getSession,
  getSessionAgentStatus,
  getSessionClaims,
  getSessionLineage,
  getSessionOutput,
  getSessionRestoreRecord,
  handoffSession,
  listConsolidatedSessions,
  listSessions,
  NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  SessionsApiError,
  stealSession,
  subscribeSessionEvents,
  subscribeSessionOutput,
} = await import("./sessions");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("sessions client", () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("listSessions GETs /sessions with its filters, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({ sessions: [] }));
    await listSessions({ scope: "all", tenantScope: "all", since: "t0" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions?scope=all&tenant_scope=all&since=t0",
      { signal: undefined, idempotent: true },
    ]);
  });

  it("listConsolidatedSessions GETs the consolidated shape and keeps the body in its error", async () => {
    fetchMock.mockResolvedValueOnce(json({ rows: [] }));
    await listConsolidatedSessions({ device: "d 1", status: "live" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions?shape=consolidated&device=d+1&status=live",
      { signal: undefined, idempotent: true },
    ]);

    fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    const err = await listConsolidatedSessions().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionsApiError);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/sessions?shape=consolidated failed: 404 - gone"
    );
  });

  it("getSession GETs /sessions/{id} with the id encoded", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "a/b" }));
    await getSession("a/b");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions/a%2Fb",
      { signal: undefined, idempotent: true },
    ]);
  });

  it("getSessionOutput GETs /sessions/{id}/output with tier, stream and limit", async () => {
    fetchMock.mockResolvedValueOnce(json({ chunks: [] }));
    await getSessionOutput("s1", { tier: "cold", stream: "transcript", limit: 5 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions/s1/output?tier=cold&stream=transcript&limit=5",
      { signal: undefined, idempotent: true },
    ]);
  });

  it("closeSession DELETEs /sessions/{id}", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "s1" }));
    await closeSession("s1");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions/s1",
      { method: "DELETE", idempotent: true },
    ]);
  });

  it("stealSession POSTs /sessions/{id}/steal, never re-sent", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await stealSession("s1", { reason: "r", machine_id: "m" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions/s1/steal",
      {
        method: "POST",
        body: JSON.stringify({ reason: "r", machine_id: "m" }),
        idempotent: false,
        noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
      },
    ]);
  });

  it("handoffSession POSTs /sessions/{id}/handoff, never re-sent", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await handoffSession("s1", { target_device_id: "d2" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/sessions/s1/handoff",
      {
        method: "POST",
        body: JSON.stringify({ target_device_id: "d2" }),
        idempotent: false,
        noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
      },
    ]);
  });

  it.each([
    ["getSessionRestoreRecord", getSessionRestoreRecord, "restore-record"],
    ["getSessionClaims", getSessionClaims, "claims"],
    ["getSessionAgentStatus", getSessionAgentStatus, "agent-status"],
    ["getSessionLineage", getSessionLineage, "lineage"],
  ] as const)("%s GETs /sessions/{id}/%s", async (_name, fn, leaf) => {
    fetchMock.mockResolvedValueOnce(json({}));
    const controller = new AbortController();
    await fn("s 1", controller.signal);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/sessions/s%201/${leaf}`,
      { signal: controller.signal, idempotent: true },
    ]);
  });

  it("a non-2xx read rejects as SessionsApiError carrying the status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    const err = await getSession("s1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionsApiError);
    expect((err as InstanceType<typeof SessionsApiError>).status).toBe(503);
    expect((err as Error).message).toBe(
      "GET /api/v1/operations/sessions/s1 failed: 503"
    );
  });

  it.each([
    ["subscribeSessionEvents", subscribeSessionEvents],
    ["subscribeSessionOutput", subscribeSessionOutput],
  ] as const)(
    "%s streams the relative /sessions/{id}/events with the bearer attached by hand",
    async (_name, subscribe) => {
      const streamFetch = vi.fn(
        async () => new Response(": keepalive\n\n", { status: 200 })
      );
      vi.stubGlobal("fetch", streamFetch);
      const onClose = vi.fn();
      const stop = subscribe("s/1", {
        onEvent: vi.fn(),
        onChunk: vi.fn(),
        onClose,
      } as never);
      await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
      stop();
      expect(fetchMock).not.toHaveBeenCalled();
      const [url, init] = streamFetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("/api/v1/operations/sessions/s%2F1/events");
      expect(init.headers).toEqual({
        Accept: "text/event-stream",
        Authorization: "Bearer tok-123",
      });
      expect(init.credentials).toBe("include");
      expect(init.cache).toBe("no-store");
    }
  );
});
