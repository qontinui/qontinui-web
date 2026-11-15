import { afterEach, describe, expect, it, vi } from "vitest";

/** Pins the exact request each tenant-policy client function sends. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  deleteTenantGithubHost,
  fetchFleetPolicy,
  fetchTenantGithubHost,
  putFleetPolicy,
  putTenantGithubHost,
} = await import("./tenantPolicy");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("tenantPolicy", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchFleetPolicy GETs /fleet-policy with the domain encoded", async () => {
    const body = { domain: "a b", effective_level: "on" };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchFleetPolicy("a b")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy?domain=a%20b",
      { method: "GET", idempotent: true },
    ]);
  });

  it("fetchFleetPolicy resolves as a repo would when given one", async () => {
    fetchMock.mockResolvedValueOnce(json({ domain: "ci_model_access" }));
    await fetchFleetPolicy("ci_model_access", "qontinui/qontinui-web");
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy?domain=ci_model_access&repo=qontinui%2Fqontinui-web",
      { method: "GET", idempotent: true },
    ]);
  });

  it("putFleetPolicy PUTs the write body, declared non-idempotent", async () => {
    const write = {
      domain: "plan_capture",
      scope_band: "tenant" as const,
      scope_key: null,
      level: "record",
      master_enabled: true,
      change_note: "n",
    };
    fetchMock.mockResolvedValueOnce(json({ ok: true, effective: null }));
    await putFleetPolicy(write);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy",
      { method: "PUT", body: JSON.stringify(write), idempotent: false },
    ]);
  });

  // A pin rides as the header the HTTP client keeps on every attempt instead
  // of re-reading the stored project; a `null` pin has no header to keep, so
  // it is a single attempt. Unpinned requests are the literals above.
  it("fetchFleetPolicy pins the read to a project, beside a repo", async () => {
    fetchMock.mockResolvedValueOnce(json({ domain: "policy_write" }));
    await fetchFleetPolicy("policy_write", "o/r", { tenant: "t-b" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy?domain=policy_write&repo=o%2Fr",
      {
        method: "GET",
        idempotent: true,
        headers: { "X-Qontinui-Active-Tenant": "t-b" },
      },
    ]);
  });

  it("putFleetPolicy pins the write to a project on every attempt", async () => {
    const write = {
      domain: "policy_write",
      scope_band: "tenant" as const,
      scope_key: null,
      level: "full",
      master_enabled: true,
      change_note: "n",
    };
    fetchMock.mockResolvedValueOnce(json({ ok: true, effective: null }));
    await putFleetPolicy(write, { tenant: "t-b" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy",
      {
        method: "PUT",
        body: JSON.stringify(write),
        idempotent: false,
        headers: { "X-Qontinui-Active-Tenant": "t-b" },
      },
    ]);
  });

  it("a null pin makes the read and the write a single attempt, with no header", async () => {
    const write = {
      domain: "policy_write",
      scope_band: "tenant" as const,
      scope_key: null,
      level: "full",
      master_enabled: true,
      change_note: "n",
    };
    fetchMock.mockResolvedValueOnce(json({ domain: "policy_write" }));
    fetchMock.mockResolvedValueOnce(json({ ok: true, effective: null }));
    await fetchFleetPolicy("policy_write", undefined, { tenant: null });
    await putFleetPolicy(write, { tenant: null });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/fleet-policy?domain=policy_write",
        { method: "GET", idempotent: true, maxRetries: 0 },
      ],
      [
        "/api/v1/operations/fleet-policy",
        {
          method: "PUT",
          body: JSON.stringify(write),
          idempotent: false,
          maxRetries: 0,
        },
      ],
    ]);
  });

  it("putFleetPolicy rejects in the httpClient.put shape, refusal code included", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"repo_not_in_tenant"}', { status: 400 })
    );
    await expect(
      putFleetPolicy({
        domain: "d",
        scope_band: "repo",
        scope_key: "o/r",
        level: "on",
        master_enabled: true,
        change_note: "n",
      })
    ).rejects.toThrow(
      'PUT /api/v1/operations/fleet-policy failed: 400 - {"error":"repo_not_in_tenant"}'
    );
  });
  it("fetchTenantGithubHost GETs /tenant/github-host", async () => {
    const body = { configured: false, web_base: "https://github.com" };
    fetchMock.mockResolvedValueOnce(json(body));
    await expect(fetchTenantGithubHost()).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenant/github-host",
      { method: "GET", idempotent: true },
    ]);
  });

  it("putTenantGithubHost PUTs both bases", async () => {
    const write = {
      api_base: "https://ghe.example.com/api/v3",
      web_base: "https://ghe.example.com",
    };
    fetchMock.mockResolvedValueOnce(json({ ...write, configured: true }));
    await putTenantGithubHost(write);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenant/github-host",
      { method: "PUT", body: JSON.stringify(write), idempotent: true },
    ]);
  });

  it("putTenantGithubHost rejects with coord's refusal code in the message", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ detail: { error: "invalid_github_host", detail: "x" } }, 400)
    );
    await expect(
      putTenantGithubHost({ api_base: "http://x", web_base: "http://x" })
    ).rejects.toThrow(
      /^PUT \/api\/v1\/operations\/tenant\/github-host failed: 400 - .*invalid_github_host/
    );
  });

  it("deleteTenantGithubHost DELETEs /tenant/github-host", async () => {
    fetchMock.mockResolvedValueOnce(json({ configured: false }));
    await deleteTenantGithubHost();
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/tenant/github-host",
      { method: "DELETE", idempotent: true },
    ]);
  });
});
