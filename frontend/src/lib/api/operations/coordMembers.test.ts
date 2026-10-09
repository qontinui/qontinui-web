import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordMembers` function's exact request: the RELATIVE URL written
 * out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the `encodeURIComponent` of every path parameter, and
 * the `httpClient.fetch` options the route walker cannot see — the method and
 * the stated retry policy. `toEqual` on the whole options object keeps them
 * that way unless a change says so. Each function also resolves the parsed
 * body and rejects a non-2xx in the `<METHOD> <url> failed: <status> -
 * <body>` shape `httpStatusOf` reads.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  addTenantMember,
  fetchMembers,
  fetchMyTenants,
  grantMemberRole,
  revokeMemberRole,
} = await import("./coordMembers");

/** An operator id that only survives the trip as one path segment if encoded. */
const AWKWARD_ID = "sso|okta/42 a";
const AWKWARD_ID_ENCODED = "sso%7Cokta%2F42%20a";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("coordMembers", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchMyTenants GETs /coord/my-tenants, declared idempotent, and parses the body", async () => {
    const body = { home_tenant_id: "t-1", tenants: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchMyTenants()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/my-tenants",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchMyTenants resolves a bare null body as null, for the caller to refuse", async () => {
    fetchMock.mockResolvedValueOnce(answer(null));
    await expect(fetchMyTenants()).resolves.toBeNull();
  });

  it("fetchMembers GETs /coord/members, declared idempotent, and parses the body", async () => {
    const body = { operators: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchMembers()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/members",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchMembers rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "no" }, 403));
    const err = await fetchMembers().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/coord/members failed: 403 - {"detail":"no"}'
    );
    expect(httpStatusOf(err)).toBe(403);
  });

  it("grantMemberRole POSTs the role to the encoded operator's roles", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await expect(grantMemberRole(AWKWARD_ID, "admin")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/coord/members/${AWKWARD_ID_ENCODED}/roles`,
      {
        method: "POST",
        body: JSON.stringify({ role: "admin" }),
        idempotent: false,
      },
    ]);
  });

  it("revokeMemberRole DELETEs the role from the encoded operator's roles", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await expect(revokeMemberRole(AWKWARD_ID, "operator")).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/coord/members/${AWKWARD_ID_ENCODED}/roles`,
      {
        method: "DELETE",
        body: JSON.stringify({ role: "operator" }),
        idempotent: true,
      },
    ]);
  });

  it("revokeMemberRole names the DELETE in its rejection", async () => {
    fetchMock.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    const err = await revokeMemberRole("op-1", "admin").catch(
      (e: unknown) => e
    );
    expect((err as Error).message).toBe(
      "DELETE /api/v1/operations/coord/members/op-1/roles failed: 404 - gone"
    );
  });

  it("addTenantMember POSTs email then role to /coord/tenant-members", async () => {
    const body = { status: "added", operator_id: "op-1", role: "operator" };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(addTenantMember("a@b.example", "operator")).resolves.toEqual(
      body
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/tenant-members",
      {
        method: "POST",
        body: '{"email":"a@b.example","role":"operator"}',
        idempotent: false,
      },
    ]);
  });

  it("addTenantMember rejects a 409 with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "ambiguous" }, 409));
    const err = await addTenantMember("a@b.example", "admin").catch(
      (e: unknown) => e
    );
    expect(httpStatusOf(err)).toBe(409);
  });
});

describe("coordMembers writes whose result is discarded", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it.each([
    ["grantMemberRole", () => grantMemberRole("op-1", "admin")],
    ["revokeMemberRole", () => revokeMemberRole("op-1", "admin")],
  ])(
    "%s treats a 204 or an unparseable 2xx as success, not a failure",
    async (_name, call) => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(call()).resolves.toBeNull();
      fetchMock.mockResolvedValueOnce(
        new Response("not json", { status: 200 })
      );
      await expect(call()).resolves.toBeNull();
      fetchMock.mockResolvedValueOnce(new Response("no", { status: 500 }));
      await expect(call()).rejects.toThrow(/failed: 500/);
    }
  );
});
