import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins every `tenants.ts` request: the RELATIVE URL (plan D6, literal here)
 * and the method + retry policy each call states. The tenant-create retry
 * hazard itself is `createTenant.test.ts`'s, driven through the real client.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  createTenant,
  deregisterRepo,
  fetchRepos,
  listRegisteredRepos,
  listTenants,
  registerRepo,
  renameTenant,
  TenantRenameError,
} = await import("./tenants");
const { NON_IDEMPOTENT_POST_NO_RETRY_STATUSES } = await import("./sessions");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("tenants client", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("listTenants GETs /tenants, declared idempotent", async () => {
    fetchMock.mockResolvedValueOnce(json({ tenants: [], active_tenant_id: "t" }));
    await listTenants();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenants",
      { signal: undefined, idempotent: true },
    ]);
  });

  it("createTenant POSTs /tenants, never re-sent", async () => {
    fetchMock.mockResolvedValueOnce(json({ tenant_id: "t" }));
    await createTenant({ name: "Acme" } as never);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenants",
      {
        method: "POST",
        body: JSON.stringify({ name: "Acme" }),
        idempotent: false,
        noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
      },
    ]);
  });

  it("renameTenant PATCHes /tenants/{id}, never re-sent, with the long ceiling", async () => {
    fetchMock.mockResolvedValueOnce(json({}));
    await renameTenant("t/1", { name: "B" } as never);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenants/t%2F1",
      {
        method: "PATCH",
        body: JSON.stringify({ name: "B" }),
        idempotent: false,
        noRetryStatuses: NON_IDEMPOTENT_POST_NO_RETRY_STATUSES,
        timeoutMs: 120_000,
      },
    ]);

    fetchMock.mockResolvedValueOnce(
      json({ detail: JSON.stringify({ error: "slug_taken", slug: "b" }) }, 409)
    );
    const err = await renameTenant("t1", { name: "B" } as never).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(TenantRenameError);
    expect((err as InstanceType<typeof TenantRenameError>).code).toBe(
      "slug_taken"
    );
  });

  it("listRegisteredRepos GETs /repos and unwraps the list", async () => {
    fetchMock.mockResolvedValueOnce(json({ repos: [{ repo: "o/r" }] }));
    await expect(listRegisteredRepos()).resolves.toEqual([{ repo: "o/r" }]);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos",
      { signal: undefined, idempotent: true },
    ]);
  });

  it("fetchRepos GETs /repos uncached and parses the envelope", async () => {
    fetchMock.mockResolvedValueOnce(json({ repos: [{ repo: "o/r" }] }));
    await expect(fetchRepos()).resolves.toEqual({ repos: [{ repo: "o/r" }] });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos",
      { method: "GET", cache: "no-store", idempotent: true },
    ]);
  });

  it("registerRepo POSTs {repo} to /repos, never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(registerRepo("o/r")).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos",
      {
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({ repo: "o/r" }),
        idempotent: false,
      },
    ]);
  });

  it("registerRepo rejects a non-2xx in readJson's shape, body kept", async () => {
    fetchMock.mockResolvedValueOnce(new Response("already registered", { status: 409 }));
    const err = await registerRepo("o/r").catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(409);
    expect(httpBodyOf(err)).toBe("already registered");
  });

  it("deregisterRepo DELETEs /repos?repo= with the slug encoded", async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }));
    await deregisterRepo("o/r");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/repos?repo=o%2Fr",
      { method: "DELETE", cache: "no-store", idempotent: true },
    ]);
  });
});
