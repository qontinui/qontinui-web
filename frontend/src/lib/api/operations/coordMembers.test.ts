import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins each `coordMembers` function's exact request: the URL (origin
 * included, which `route-walker.test.ts` drops), the `encodeURIComponent` of
 * every path parameter, and the `httpClient.fetch` options the walker cannot
 * see. None of these calls declares `idempotent`, and `toEqual` on the whole
 * options object keeps it that way unless a change says so.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { OPERATIONS_API } = await import("@/components/operations/utils");
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

describe("coordMembers", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("returns the raw Response httpClient.fetch resolved", async () => {
    const res = new Response("{}", { status: 503 });
    fetchMock.mockResolvedValueOnce(res);
    await expect(fetchMembers()).resolves.toBe(res);
  });

  it("fetchMyTenants GETs /coord/my-tenants with no options", async () => {
    await fetchMyTenants();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/my-tenants`,
    ]);
  });

  it("fetchMembers GETs /coord/members with no options", async () => {
    await fetchMembers();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/members`,
    ]);
  });

  it("grantMemberRole POSTs the role to the encoded operator's roles", async () => {
    await grantMemberRole(AWKWARD_ID, "admin");
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/members/${AWKWARD_ID_ENCODED}/roles`,
      { method: "POST", body: JSON.stringify({ role: "admin" }) },
    ]);
  });

  it("revokeMemberRole DELETEs the role from the encoded operator's roles", async () => {
    await revokeMemberRole(AWKWARD_ID, "operator");
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/members/${AWKWARD_ID_ENCODED}/roles`,
      { method: "DELETE", body: JSON.stringify({ role: "operator" }) },
    ]);
  });

  it("addTenantMember POSTs email then role to /coord/tenant-members", async () => {
    await addTenantMember("a@b.example", "operator");
    expect(fetchMock.mock.calls[0]).toEqual([
      `${OPERATIONS_API}/coord/tenant-members`,
      {
        method: "POST",
        body: '{"email":"a@b.example","role":"operator"}',
      },
    ]);
  });
});
