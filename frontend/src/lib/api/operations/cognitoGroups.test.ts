import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `cognitoGroups` function's exact request: the RELATIVE URL written
 * out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the `encodeURIComponent` of every path parameter, and
 * the `httpClient.fetch` options the route walker cannot see — the method and
 * the stated retry policy. `toEqual` on the whole options object keeps them
 * that way unless a change says so. Bodies are compared as strings, so the
 * wire key order is pinned too. Each function resolves the parsed body and
 * rejects a non-2xx in the `<METHOD> <url> failed: <status> - <body>` shape.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  addCognitoGroupUser,
  createCognitoGroup,
  createGroupTenantRole,
  deleteCognitoGroup,
  deleteGroupTenantRole,
  fetchCognitoGroupBlastRadius,
  fetchCognitoGroups,
  fetchCognitoGroupUsers,
  fetchGroupTenantRoles,
  removeCognitoGroupUser,
} = await import("./cognitoGroups");

/** A group name that only survives the trip as one path segment if encoded. */
const GROUP = "ops/admins #1";
const GROUP_ENCODED = "ops%2Fadmins%20%231";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("cognitoGroups", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("rejects a non-2xx in httpClient.get's error shape, naming the method", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "mapped" }, 409));
    const err = await deleteCognitoGroup(GROUP, {
      allowHomeGroup: false,
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `DELETE /api/v1/operations/coord/cognito/groups/${GROUP_ENCODED} failed: 409 - {"detail":"mapped"}`
    );
    expect(httpStatusOf(err)).toBe(409);
    expect(httpBodyOf(err)).toBe('{"detail":"mapped"}');
  });

  it("fetchGroupTenantRoles GETs /coord/group-tenant-roles, declared idempotent, and parses the body", async () => {
    const body = { group_tenant_roles: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchGroupTenantRoles()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/group-tenant-roles",
      { method: "GET", idempotent: true },
    ]);
  });

  it("createGroupTenantRole POSTs the mapping in wire key order", async () => {
    fetchMock.mockResolvedValueOnce(answer({ group_id: "acme-admins" }));
    // Keys deliberately out of order: the wire order must not follow them.
    await expect(
      createGroupTenantRole({
        auto_create_tenant: true,
        role: "admin",
        tenant_slug: "acme",
        group_id: "acme-admins",
      })
    ).resolves.toEqual({ group_id: "acme-admins" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/group-tenant-roles",
      {
        method: "POST",
        body: '{"group_id":"acme-admins","tenant_slug":"acme","role":"admin","auto_create_tenant":true}',
        idempotent: false,
      },
    ]);
  });

  it("deleteGroupTenantRole DELETEs the mapping's key in wire key order", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true, deleted: 1 }));
    await expect(
      deleteGroupTenantRole({
        role: "operator",
        tenant_slug: "acme",
        group_id: "acme-devs",
      })
    ).resolves.toEqual({ ok: true, deleted: 1 });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/group-tenant-roles",
      {
        method: "DELETE",
        body: '{"group_id":"acme-devs","tenant_slug":"acme","role":"operator"}',
        idempotent: true,
      },
    ]);
  });

  it("fetchCognitoGroups GETs /coord/cognito/groups, declared idempotent, and parses the body", async () => {
    const body = { groups: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchCognitoGroups()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/cognito/groups",
      { method: "GET", idempotent: true },
    ]);
  });

  it("createCognitoGroup POSTs the group, description only when given", async () => {
    fetchMock.mockImplementation(async () => answer({ group_name: "g" }));
    // `description` first: the explicit body fixes the wire key order.
    await createCognitoGroup({ description: "d", group_name: "g" });
    await expect(createCognitoGroup({ group_name: "g" })).resolves.toEqual({
      group_name: "g",
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/coord/cognito/groups",
        {
          method: "POST",
          body: '{"group_name":"g","description":"d"}',
          idempotent: false,
        },
      ],
      [
        "/api/v1/operations/coord/cognito/groups",
        { method: "POST", body: '{"group_name":"g"}', idempotent: false },
      ],
    ]);
  });

  it("createCognitoGroup sends only the two declared fields", async () => {
    fetchMock.mockResolvedValueOnce(answer({ group_name: "g" }));
    await createCognitoGroup({
      group_name: "g",
      // A caller-side extra must not ride along onto the wire.
      ...({ precedence: 1 } as object),
    });
    expect(fetchMock.mock.calls[0][1].body).toBe('{"group_name":"g"}');
  });

  it("deleteCognitoGroup DELETEs the encoded group, with the home-group override only when asked", async () => {
    fetchMock.mockImplementation(async () => answer({ ok: true }));
    await deleteCognitoGroup(GROUP, { allowHomeGroup: false });
    await expect(
      deleteCognitoGroup(GROUP, { allowHomeGroup: true })
    ).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls).toEqual([
      [
        `/api/v1/operations/coord/cognito/groups/${GROUP_ENCODED}`,
        { method: "DELETE", idempotent: true },
      ],
      [
        `/api/v1/operations/coord/cognito/groups/${GROUP_ENCODED}?allow_home_group=true`,
        { method: "DELETE", idempotent: true },
      ],
    ]);
  });

  it("fetchCognitoGroupBlastRadius GETs the encoded group's blast-radius", async () => {
    const body = { group_name: GROUP, mapped_total: 0 };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchCognitoGroupBlastRadius(GROUP)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/coord/cognito/groups/${GROUP_ENCODED}/blast-radius`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchCognitoGroupUsers GETs the encoded group's users", async () => {
    const body = { users: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(fetchCognitoGroupUsers(GROUP)).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/coord/cognito/groups/${GROUP_ENCODED}/users`,
      { method: "GET", idempotent: true },
    ]);
  });

  it("addCognitoGroupUser POSTs the email to the encoded group's users", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true, username: "u-1" }));
    await expect(addCognitoGroupUser(GROUP, "a@b.example")).resolves.toEqual({
      ok: true,
      username: "u-1",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/coord/cognito/groups/${GROUP_ENCODED}/users`,
      {
        method: "POST",
        body: '{"email":"a@b.example"}',
        idempotent: false,
      },
    ]);
  });

  it("removeCognitoGroupUser DELETEs the email from the encoded group's users", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true, username: "u-1" }));
    await expect(removeCognitoGroupUser(GROUP, "a@b.example")).resolves.toEqual(
      { ok: true, username: "u-1" }
    );
    expect(fetchMock.mock.calls[0]).toEqual([
      `/api/v1/operations/coord/cognito/groups/${GROUP_ENCODED}/users`,
      {
        method: "DELETE",
        body: '{"email":"a@b.example"}',
        idempotent: true,
      },
    ]);
  });
});
