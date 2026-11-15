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
  tenantsListRefusal,
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
    fetchMock.mockResolvedValueOnce(
      json({ tenants: [], active_tenant_id: "t" })
    );
    await listTenants();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenants",
      { signal: undefined, idempotent: true },
    ]);
  });

  it("listTenants names the status, and the backend's reason when its body names one", async () => {
    // The production envelope (`app/main.py`'s handler), FastAPI's bare
    // `{detail}`, and a body naming no reason.
    fetchMock
      .mockResolvedValueOnce(
        json(
          {
            error: "FORBIDDEN",
            message: "tenant_not_resolved",
            timestamp: "2026-11-15T12:00:00Z",
            path: "/api/v1/operations/tenants",
          },
          403
        )
      )
      .mockResolvedValueOnce(json({ detail: "coord is not reachable" }, 502))
      .mockResolvedValueOnce(
        new Response("<html>bad gateway</html>", { status: 502 })
      );

    await expect(listTenants()).rejects.toMatchObject({
      message:
        "GET /api/v1/operations/tenants failed: 403 (tenant_not_resolved)",
      status: 403,
    });
    await expect(listTenants()).rejects.toMatchObject({
      message:
        "GET /api/v1/operations/tenants failed: 502 (coord is not reachable)",
      status: 502,
    });
    await expect(listTenants()).rejects.toMatchObject({
      message: "GET /api/v1/operations/tenants failed: 502",
      status: 502,
    });
  });

  it("tenantsListRefusal reads coord's own token through the proxy, and nothing from a body naming none", () => {
    expect(
      tenantsListRefusal(
        JSON.stringify({
          detail: JSON.stringify({ error: "tenant_not_resolved" }),
        })
      )
    ).toBe("tenant_not_resolved");
    expect(
      tenantsListRefusal(JSON.stringify({ detail: "  timeout\n waiting " }))
    ).toBe("timeout waiting");
    expect(
      tenantsListRefusal(JSON.stringify({ detail: [{ loc: ["x"] }] }))
    ).toBeNull();
    expect(tenantsListRefusal("")).toBeNull();
    expect(tenantsListRefusal("not json")).toBeNull();
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
