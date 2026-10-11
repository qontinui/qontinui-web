import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { fetchFleetPolicy, putFleetPolicy } = await import("./fleetPolicyApi");

describe("fleetPolicyApi", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("fetchFleetPolicy GETs /fleet-policy with the encoded domain", async () => {
    const body = { domain: "a b", effective_level: "on" };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 })
    );
    await expect(fetchFleetPolicy("a b")).resolves.toEqual(body);
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy?domain=a%20b",
      { method: "GET", idempotent: true },
    ]);
  });

  it("putFleetPolicy PUTs the JSON body to /fleet-policy", async () => {
    const write = {
      domain: "d",
      scope_band: "tenant" as const,
      scope_key: null,
      level: "on",
      master_enabled: true,
      change_note: "n",
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    await expect(putFleetPolicy(write)).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/fleet-policy",
      { method: "PUT", body: JSON.stringify(write) },
    ]);
  });

  it("rejects a non-2xx with its status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 403 }));
    const err = await putFleetPolicy({
      domain: "d",
      scope_band: "repo",
      scope_key: "o/r",
      level: "on",
      master_enabled: true,
      change_note: "n",
    }).catch((e: unknown) => e);
    expect(httpStatusOf(err)).toBe(403);
  });
});
