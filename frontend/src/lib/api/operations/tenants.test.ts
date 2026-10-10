import { afterEach, describe, expect, it, vi } from "vitest";

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
  listRegisteredRepos,
  listTenants,
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
});
