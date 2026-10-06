import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins each `cognitoGroups` function's exact request: the URL (origin
 * included, which `route-walker.test.ts` drops), the `encodeURIComponent` of
 * every path parameter, and the `httpClient.fetch` options the walker cannot
 * see. None of these calls declares `idempotent`, and `toEqual` on the whole
 * options object keeps it that way unless a change says so. Bodies are
 * compared as strings, so the wire key order is pinned too.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { OPERATIONS_API } = await import("@/components/operations/utils");
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
const GROUPS = `${OPERATIONS_API}/coord/cognito/groups`;

describe("cognitoGroups", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("returns the raw Response httpClient.fetch resolved", async () => {
    const res = new Response("{}", { status: 409 });
    fetchMock.mockResolvedValueOnce(res);
    await expect(
      deleteCognitoGroup(GROUP, { allowHomeGroup: false })
    ).resolves.toBe(res);
  });

  it("fetchGroupTenantRoles GETs /coord/group-tenant-roles with no options", async () => {
    await fetchGroupTenantRoles();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/group-tenant-roles`,
    ]);
  });

  it("createGroupTenantRole POSTs the mapping in wire key order", async () => {
    // Keys deliberately out of order: the wire order must not follow them.
    await createGroupTenantRole({
      auto_create_tenant: true,
      role: "admin",
      tenant_slug: "acme",
      group_id: "acme-admins",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/group-tenant-roles`,
      {
        method: "POST",
        body: '{"group_id":"acme-admins","tenant_slug":"acme","role":"admin","auto_create_tenant":true}',
      },
    ]);
  });

  it("deleteGroupTenantRole DELETEs the mapping's key in wire key order", async () => {
    await deleteGroupTenantRole({
      role: "operator",
      tenant_slug: "acme",
      group_id: "acme-devs",
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/group-tenant-roles`,
      {
        method: "DELETE",
        body: '{"group_id":"acme-devs","tenant_slug":"acme","role":"operator"}',
      },
    ]);
  });

  it("fetchCognitoGroups GETs /coord/cognito/groups with no options", async () => {
    await fetchCognitoGroups();
    expect(fetchMock.mock.calls[0]).toEqual([GROUPS]);
  });

  it("createCognitoGroup POSTs the group, description only when given", async () => {
    await createCognitoGroup({ group_name: "g", description: "d" });
    await createCognitoGroup({ group_name: "g" });
    expect(fetchMock.mock.calls).toEqual([
      [
        GROUPS,
        { method: "POST", body: '{"group_name":"g","description":"d"}' },
      ],
      [GROUPS, { method: "POST", body: '{"group_name":"g"}' }],
    ]);
  });

  it("deleteCognitoGroup DELETEs the encoded group, with the home-group override only when asked", async () => {
    await deleteCognitoGroup(GROUP, { allowHomeGroup: false });
    await deleteCognitoGroup(GROUP, { allowHomeGroup: true });
    expect(fetchMock.mock.calls).toEqual([
      [`${GROUPS}/${GROUP_ENCODED}`, { method: "DELETE" }],
      [
        `${GROUPS}/${GROUP_ENCODED}?allow_home_group=true`,
        { method: "DELETE" },
      ],
    ]);
  });

  it("fetchCognitoGroupBlastRadius GETs the encoded group's blast-radius", async () => {
    await fetchCognitoGroupBlastRadius(GROUP);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${GROUPS}/${GROUP_ENCODED}/blast-radius`,
    ]);
  });

  it("fetchCognitoGroupUsers GETs the encoded group's users", async () => {
    await fetchCognitoGroupUsers(GROUP);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${GROUPS}/${GROUP_ENCODED}/users`,
    ]);
  });

  it("addCognitoGroupUser POSTs the email to the encoded group's users", async () => {
    await addCognitoGroupUser(GROUP, "a@b.example");
    expect(fetchMock.mock.calls[0]).toEqual([
      `${GROUPS}/${GROUP_ENCODED}/users`,
      { method: "POST", body: '{"email":"a@b.example"}' },
    ]);
  });

  it("removeCognitoGroupUser DELETEs the email from the encoded group's users", async () => {
    await removeCognitoGroupUser(GROUP, "a@b.example");
    expect(fetchMock.mock.calls[0]).toEqual([
      `${GROUPS}/${GROUP_ENCODED}/users`,
      { method: "DELETE", body: '{"email":"a@b.example"}' },
    ]);
  });
});
