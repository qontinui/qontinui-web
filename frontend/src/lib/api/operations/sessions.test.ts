import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `sessions` function's exact request: the RELATIVE URL written out
 * as a LITERAL, the `encodeURIComponent` of every path parameter, and the
 * `httpClient.fetch` options the route walker cannot see (method, the stated
 * retry policy). Each function resolves the parsed body and rejects a non-2xx
 * as the module's own error class.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
    getAuthToken: () => null,
  },
}));

const {
  closeSession,
  createTenant,
  fetchDeviceFleetSessions,
  fetchRegisteredRepos,
  getSession,
  getSessionAgentStatus,
  getSessionClaims,
  getSessionLineage,
  getSessionOutput,
  getSessionRestoreRecord,
  handoffSession,
  listConsolidatedSessions,
  listSessions,
  listTenants,
  NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
  postSessionControlRequest,
  renameTenant,
  SessionsApiError,
  stealSession,
  TenantCreateError,
  TenantRenameError,
} = await import("./sessions");

const ID = "ses/1 #a";
const ID_ENCODED = "ses%2F1%20%23a";
const BASE = "/api/v1/operations";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("sessions", () => {
  afterEach(() => fetchMock.mockReset());

  it("a non-2xx rejects as SessionsApiError keeping the historic message and status", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "x" }, 404));
    const err = await getSession(ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionsApiError);
    expect((err as Error).message).toBe(
      `GET ${BASE}/sessions/${ID_ENCODED} failed: 404`
    );
    expect((err as InstanceType<typeof SessionsApiError>).status).toBe(404);
  });

  it("listSessions GETs /sessions with only the given filters, declared idempotent", async () => {
    fetchMock.mockImplementation(async () => answer({ sessions: [] }));
    await listSessions();
    await listSessions({ scope: "all", tenantScope: "all", since: "t" });
    expect(fetchMock.mock.calls).toEqual([
      [
        `${BASE}/sessions`,
        { method: "GET", idempotent: true, signal: undefined },
      ],
      [
        `${BASE}/sessions?scope=all&tenant_scope=all&since=t`,
        { method: "GET", idempotent: true, signal: undefined },
      ],
    ]);
  });

  it("listConsolidatedSessions GETs shape=consolidated and keeps the body in its error", async () => {
    fetchMock.mockResolvedValueOnce(answer({ rows: [] }));
    await listConsolidatedSessions({ device: "d", q: "x y", status: "live" });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions?shape=consolidated&device=d&q=x+y&status=live`,
      { method: "GET", idempotent: true, signal: undefined },
    ]);
    fetchMock.mockResolvedValueOnce(answer({ detail: "gone" }, 404));
    const err = await listConsolidatedSessions().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionsApiError);
    expect(httpStatusOf(err)).toBe(404);
    expect(httpBodyOf(err)).toBe('{"detail":"gone"}');
  });

  it("getSession GETs the encoded session", async () => {
    fetchMock.mockResolvedValueOnce(answer({ id: "s" }));
    await expect(getSession(ID)).resolves.toEqual({ id: "s" });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions/${ID_ENCODED}`,
      { method: "GET", idempotent: true, signal: undefined },
    ]);
  });

  it("getSessionOutput GETs the encoded session's output with tier/stream/limit when given", async () => {
    fetchMock.mockImplementation(async () => answer({ chunks: [] }));
    await getSessionOutput(ID);
    await getSessionOutput(ID, {
      tier: "cold",
      stream: "transcript",
      limit: 0,
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        `${BASE}/sessions/${ID_ENCODED}/output`,
        { method: "GET", idempotent: true, signal: undefined },
      ],
      [
        `${BASE}/sessions/${ID_ENCODED}/output?tier=cold&stream=transcript&limit=0`,
        { method: "GET", idempotent: true, signal: undefined },
      ],
    ]);
  });

  it("closeSession DELETEs the encoded session, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(answer({ id: "s" }));
    await closeSession(ID);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions/${ID_ENCODED}`,
      { method: "DELETE", idempotent: true },
    ]);
  });

  it("stealSession POSTs the body, never retried", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await stealSession(ID, { reason: "r", machine_id: "m" });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions/${ID_ENCODED}/steal`,
      {
        method: "POST",
        body: '{"reason":"r","machine_id":"m"}',
        idempotent: false,
        noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
      },
    ]);
  });

  it("handoffSession POSTs the body, never retried", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await handoffSession(ID, { target_device_id: "d2" });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions/${ID_ENCODED}/handoff`,
      {
        method: "POST",
        body: '{"target_device_id":"d2"}',
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
  ] as const)("%s GETs the encoded session's %s", async (_n, fn, suffix) => {
    fetchMock.mockResolvedValueOnce(answer({}));
    await fn(ID);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions/${ID_ENCODED}/${suffix}`,
      { method: "GET", idempotent: true, signal: undefined },
    ]);
  });

  it("listTenants GETs /tenants", async () => {
    fetchMock.mockResolvedValueOnce(answer({ tenants: [] }));
    await listTenants();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/tenants`,
      { method: "GET", idempotent: true, signal: undefined },
    ]);
  });

  it("createTenant POSTs once, and a failure parses coord's body into TenantCreateError", async () => {
    fetchMock.mockResolvedValueOnce(answer({ id: "t" }));
    await createTenant({ name: "n" } as never);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/tenants`,
      {
        method: "POST",
        body: '{"name":"n"}',
        idempotent: false,
        maxRetries: 0,
        noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
      },
    ]);
    fetchMock.mockResolvedValueOnce(
      answer({ detail: '{"error":"slug_taken","slug":"s"}' }, 409)
    );
    const err = await createTenant({ name: "n" } as never).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(TenantCreateError);
    expect((err as InstanceType<typeof TenantCreateError>).status).toBe(409);
    expect((err as InstanceType<typeof TenantCreateError>).code).toBe(
      "slug_taken"
    );
  });

  it("renameTenant PATCHes the encoded tenant with the long timeout, and a failure parses into TenantRenameError", async () => {
    fetchMock.mockResolvedValueOnce(answer({ id: "t" }));
    await renameTenant(ID, { name: "n" } as never);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/tenants/${ID_ENCODED}`,
      {
        method: "PATCH",
        body: '{"name":"n"}',
        idempotent: false,
        noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
        timeoutMs: 120_000,
      },
    ]);
    fetchMock.mockResolvedValueOnce(
      answer({ detail: '{"error":"slug_pinned","reason":"p"}' }, 409)
    );
    const err = await renameTenant(ID, {} as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantRenameError);
    expect((err as InstanceType<typeof TenantRenameError>).code).toBe(
      "slug_pinned"
    );
    expect((err as InstanceType<typeof TenantRenameError>).reason).toBe("p");
  });

  it("fetchRegisteredRepos GETs /repos", async () => {
    fetchMock.mockResolvedValueOnce(answer({ repos: [] }));
    await fetchRegisteredRepos();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/repos`,
      { method: "GET", idempotent: true, signal: undefined },
    ]);
  });

  it("fetchDeviceFleetSessions GETs the encoded device's census, one attempt", async () => {
    fetchMock.mockResolvedValueOnce(answer({ rows: [] }));
    await fetchDeviceFleetSessions(ID, 500);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions/fleet?device_id=${ID_ENCODED}&limit=500`,
      { method: "GET", idempotent: true, maxRetries: 0 },
    ]);
  });

  it("postSessionControlRequest POSTs the encoded session's control, resolving null on an unparseable 2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 202 }));
    await expect(
      postSessionControlRequest(ID, { action: "drain", reason: "r" })
    ).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${BASE}/sessions/${ID_ENCODED}/control`,
      {
        method: "POST",
        body: '{"action":"drain","reason":"r"}',
        idempotent: false,
      },
    ]);
  });
});
